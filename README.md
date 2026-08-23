# sql-inspector

[![npm version](https://img.shields.io/npm/v/sql-inspector.svg)](https://www.npmjs.com/package/sql-inspector)
[![license](https://img.shields.io/npm/l/sql-inspector.svg)](https://github.com/sohel622002/sql-inspector/blob/main/LICENSE)

A tiny, self-hosted dev tool for looking at live data inside a running app's SQL(-ish) store — a browser UI showing tables and rows, with search and pagination, refreshable on demand.

```bash
npm install --save-dev sql-inspector
```

## Table of contents

- [Why this exists](#why-this-exists)
- [What problem it solves](#what-problem-it-solves)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Detailed usage](#detailed-usage)
- [Testing](#testing)
- [Limitations](#limitations)
- [Roadmap](#roadmap-not-yet-built)
- [License](#license)

## Why this exists

Apps that embed a local database (SQLite via Capacitor, `better-sqlite3`, `sql.js`, etc.) usually have no easy way to look at that local data during development:

- Pulling the `.db` file off a device/emulator and opening it in DB Browser is slow and breaks your dev loop.
- Android Studio's Database Inspector only exists for Android — there's nothing equivalent for iOS or for a plain browser tab.
- Adding a debug screen inside the app itself means shipping inspector UI/code alongside production app code, and rebuilding the app every time you want to check something.

`sql-inspector` solves this: a standalone tool that sits **outside** the app, connects to it over a WebSocket relay, and lets you browse whatever's currently in the local database from an ordinary browser tab — with zero UI added to the app itself beyond a couple of bootstrap lines that are stripped in production builds.

## What problem it solves

- **Fast local-data inspection during development** — no need to pull `.db` files, no native IDE tooling, no platform lock-in (works the same for iOS and Android builds, since it just talks over WebSocket).
- **Cross-platform** — the browser UI is plain HTML/CSS/JS with no build step, so it opens the same way whether the app is running on an Android emulator, a real iOS device, or a browser dev server.
- **Non-invasive** — the app only needs a `DataSource` adapter (`listTables`, `getTableData`) and a client bootstrap call, gated behind a production check. No inspector code ships to real users.
- **Searchable, paginated view** — once a table's rows are pulled into the browser, you can filter across all columns and page through results instead of scrolling one giant table.

## Architecture

The real database lives inside the running app's process. A standalone Node server can't reach into that directly, so three parts talk over a relay:

```
[Browser UI]  <--HTTP-->  [Inspector Server (Node)]  <--WebSocket-->  [App-side Client (inside your app)]
```

- **App-side client** (`sql-inspector/client`) — imported into your app, given a `DataSource` adapter, connects out to the server over WebSocket.
- **Server** (`bin/sql-inspector.js`) — serves the static browser UI and relays `listTables` / `getTableData` requests from the browser to the connected app client, then relays the response back.
- **Browser UI** (`public/`) — table list with search, a data grid with per-table value search and pagination, a light/dark theme toggle, and a Refresh button.

Because the server and UI only ever speak the `DataSource` JSON contract (`listTables(): Promise<string[]>`, `getTableData(table): Promise<{ columns, rows }>`), this is *designed* to work with any embedded store — but see [Limitations](#limitations) for what's actually been exercised.

## Quick start

### 1. Install

```bash
npm install --save-dev sql-inspector
```

### 2. Implement a `DataSource` adapter in your app

```js
// DataSource contract:
//   listTables(): Promise<string[]>
//   getTableData(tableName): Promise<{ columns: string[], rows: object[] }>
```

A reference adapter for `@capacitor-community/sqlite` is included at `adapters/capacitor-sqlite.js`:

```js
import { createCapacitorSqliteAdapter } from 'sql-inspector/adapters/capacitor-sqlite.js';

const dataSource = createCapacitorSqliteAdapter(sqliteService);
```

### 3. Connect the client, dev-only, once at app bootstrap

```js
import { createInspectorClient } from 'sql-inspector/client/index.js';

if (!environment.production) {
  createInspectorClient({
    dataSource,
    url: 'ws://localhost:4545/relay',
  });
}
```

No app route, page, or UI change is required — the client just opens a background WebSocket connection.

> Testing on a physical device (e.g. `ionic cap run android -l --external`)? Point `url` at `ws://${window.location.hostname}:4545/relay` instead of a hardcoded `localhost` — the webview loads your app's JS from your laptop's LAN IP, and that's the address the phone can actually reach.

### 4. Start the server

```bash
npx sql-inspector
# sql-inspector running at http://localhost:4545
```

(Port is configurable via `SQL_INSPECTOR_PORT`.)

### 5. Open the UI

Visit `http://localhost:4545` in a browser.

- Pick a table from the sidebar (filter the table list with the search box above it).
- Use the search box above the grid to filter rows — it matches against every column's value, not just one.
- Use the page-size dropdown (10/30/50/100) and Prev/Next at the bottom to page through results.
- Click the magnifier icon on a cell to inspect a long/JSON value in a modal.
- Hit **Refresh** to re-pull the latest data for the selected table.
- Toggle light/dark theme from the topbar — the choice is remembered per-browser.

## Detailed usage

This walks through the exact pieces involved, using an example Angular + Capacitor application as the concrete example.

### The `DataSource` contract

The server and browser UI never talk to your database directly — they only ever send two message types over the WebSocket relay, and your adapter is what answers them:

```ts
interface DataSource {
  listTables(): Promise<string[]>;
  getTableData(tableName: string): Promise<{ columns: string[]; rows: object[] }>;
}
```

That's the entire surface. Anything that can answer those two calls can be plugged in — the reference adapter just happens to answer them with SQLite queries.

### What a SQLite service typically looks like

The bundled adapter (`adapters/capacitor-sqlite.js`) expects an object shaped like a typical Angular wrapper around `@capacitor-community/sqlite` — for example:

```ts
@Injectable({ providedIn: 'root' })
export class SqliteService {
  db!: SQLiteDBConnection;   // <-- the adapter calls db.query(...) on this
  ready = false;

  async initialize(): Promise<void> {
    // open the connection, run CREATE TABLE IF NOT EXISTS ..., set this.db and this.ready
  }
}
```

- `db` is a `SQLiteDBConnection` from `@capacitor-community/sqlite` — the same object you'd use anywhere else in the app to run `db.query(sql, params?)` or `db.run(sql, params?)`.
- `initialize()` must have already resolved (i.e. `db` assigned) before the inspector client is created — the adapter has no retry logic, it just calls `sqliteService.db.query(...)` immediately when the browser asks for data. Wire the client up *after* your DB initialization promise resolves (see the bootstrap example below).
- On a non-native platform (e.g. plain `ng serve` in a browser tab, where `Capacitor.isNativePlatform()` is false) many such services skip real initialization and never assign `db`. The inspector adapter would then throw the first time it's asked for data. This only matters if you also try to run the inspector client in a non-native dev-server build.

The adapter itself is short enough to read end to end:

```js
export function createCapacitorSqliteAdapter(sqliteService) {
  return {
    async listTables() {
      const res = await sqliteService.db.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      );
      return (res.values ?? []).map((r) => r.name);
    },
    async getTableData(table) {
      const res = await sqliteService.db.query(`SELECT * FROM ${table}`);
      const rows = res.values ?? [];
      return {
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows,
      };
    },
  };
}
```

Notes on that implementation, since they double as gotchas:

- `listTables()` reads straight from `sqlite_master`, so it lists every user table that currently exists in the database at the moment you ask.
- `table` in `getTableData(table)` is interpolated directly into the SQL string (`SELECT * FROM ${table}`) rather than parameterized. That's safe here only because `table` always comes from a name the same `listTables()` call just returned — never from arbitrary user input. Don't repurpose this adapter to accept a table name typed by an end user.
- Columns are derived from `Object.keys(rows[0])` — if a table has rows with inconsistent keys (shouldn't happen with a fixed `CREATE TABLE` schema, but would with a more dynamic store) or is completely empty, you get `columns: []` and the UI shows "Table is empty."

### Wiring it up end to end (example Angular application)

A typical bootstrap in `main.ts`, using Angular's `provideAppInitializer`:

```ts
provideAppInitializer(() => {
  const sqlite = inject(SqliteService);
  return sqlite.initialize().then(async () => {
    if (!environment.production) {
      const { createInspectorClient } = await import('sql-inspector/client/index.js');
      const { createCapacitorSqliteAdapter } = await import('sql-inspector/adapters/capacitor-sqlite.js');
      createInspectorClient({
        dataSource: createCapacitorSqliteAdapter(sqlite),
        url: `ws://${window.location.hostname}:4545/relay`,
      });
    }
  });
}),
```

Why it's structured this way:

- `sqlite.initialize()` is awaited **first**, so `sqlite.db` is guaranteed to exist before `createCapacitorSqliteAdapter(sqlite)` is ever called.
- The two imports are dynamic (`await import(...)`) and guarded by `if (!environment.production)`, so in a production build neither the inspector client nor the adapter code is ever loaded or executed — this keeps the dev tool fully out of the shipped app.
- `url` uses `window.location.hostname` instead of a hardcoded `'localhost'`. When running on a physical device via LAN (e.g. `ionic cap run android -l --external`), the device's webview loads the app bundle from your laptop's LAN IP — so `window.location.hostname` already resolves to an address the phone can reach, whereas `'localhost'` would resolve to the phone itself and never find your laptop's inspector server.

### `createInspectorClient(options)` reference

```ts
createInspectorClient({
  dataSource: DataSource;      // required — your adapter, e.g. createCapacitorSqliteAdapter(sqlite)
  url?: string;                // default: 'ws://localhost:4545/relay'
  reconnectMs?: number;        // default: 3000 — delay before retrying a dropped connection
}): { close(): void }
```

- It connects immediately on call and keeps retrying on `close`/`error` every `reconnectMs` until you call the returned `close()`.
- There's no `connect`/`disconnect` toggle beyond that — call `createInspectorClient` once at bootstrap and hold onto the returned handle only if you need to tear it down later (e.g. in tests).
- It answers exactly two relayed message types (`listTables`, `getTableData`) and forwards any thrown error's `.message` back to the browser UI as `{ error: "..." }`, which is what renders as the red error text in the grid/table-list panels.

### Running the server locally

1. From your app's repo root: `npx sql-inspector` (or set `SQL_INSPECTOR_PORT` first if 4545 is taken).
2. Run the app on a device/emulator as usual — the bootstrap code above connects out automatically as long as `environment.production` is false.
3. Open `http://localhost:4545` (or `http://<your-lan-ip>:4545` if testing on a physical device over LAN) and the sidebar should show "App connected" plus the table list once the app has finished initializing its database.
4. If it says "No app connected", check that the app is actually running non-production and that the port in `url` matches the port the server printed on startup.

## Testing

The suite covers the three moving pieces independently and then end to end, using only Node's built-in test runner (`node:test`) — no extra test framework dependency:

| File | What it covers |
|---|---|
| `test/relay.test.mjs` | The server-side relay in isolation (`server/relay.js`): connection tracking, matching a browser request to the app client's reply by id, rejecting when no app is connected, timing out an unanswered request, and ignoring malformed/unmatched replies. Uses fake WebSocket-shaped objects — no real sockets. |
| `test/client.test.mjs` | `createInspectorClient` against a real `ws` server standing in for the inspector server: answering `listTables`/`getTableData` by calling the `DataSource`, turning a thrown adapter error into an `{ error }` reply, rejecting an unknown request type, auto-reconnecting after the connection drops, and `close()` actually stopping further reconnects. |
| `test/server.test.mjs` | The real HTTP + WebSocket server end to end (`server/index.js`) with a fake `DataSource`: `/api/status` before and after an app client connects, `/api/tables` and `/api/tables/:table` relaying real responses, a 502 with the adapter's error message when the adapter throws, the static UI being served at `/` with a 404 for unknown paths, and `/api/status` plus `/api/tables` correctly reflecting a disconnected app client again after it closes. |

Run everything with:

```bash
npm test
```

Which currently reports:

```
# tests 26
# suites 8
# pass 26
# fail 0
```

## Limitations

- **Only exercised against SQLite (via `@capacitor-community/sqlite`)**, in a Capacitor + Angular app. The `DataSource` contract is written to be store-agnostic in theory, but no adapter for `better-sqlite3`, `sql.js`, a non-SQL store, or any other database/framework has actually been built or tested — treat that as unproven, not supported.
- **Read-only** — only `listTables` and `getTableData` exist. There is no way to edit, insert, delete, or run arbitrary SQL from the UI.
- **Manual refresh only** — the grid is a snapshot from the last fetch/Refresh click; it does not update live as the app writes new data.
- **Single connected app-client at a time** — the server relays to whichever app instance is currently connected. It has no concept of multiple apps/projects.
- **No auth** — the relay is meant for localhost dev use only. Do not expose the server's port beyond your local network.
- **Whole-table fetches** — `getTableData` pulls an entire table in one shot; search and pagination happen client-side in the browser after that. Very large tables will be slow to load and use more memory in the browser tab, since there's no server-side `LIMIT`/`OFFSET` or `WHERE` pushed down to the adapter.
- **Dev-tool assumption baked in** — nothing here has been hardened for production exposure (input validation, error boundaries, etc. are minimal); it's meant to be gated behind a production check and run only while developing.

## Roadmap (not yet built)

- Realtime push: app client notifies the server on writes, server pushes updates to open browser UIs instead of requiring a manual Refresh.
- Multiple simultaneous app-client connections with a project/app picker in the UI.
- Optional ad-hoc `execute(sql)` extension to the `DataSource` contract for a free-form query box.
- Server-side filtering/pagination for large tables, instead of pulling everything into the browser at once.
- Auth/token on the relay for anything beyond localhost dev use.
- Adapters and testing for stores other than `@capacitor-community/sqlite` (e.g. `better-sqlite3`, `sql.js`).

## License

MIT
