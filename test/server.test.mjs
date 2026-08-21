import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { createInspectorClient } from '../client/index.js';

// End-to-end: real HTTP server + real WebSocket relay + a real
// createInspectorClient talking to a fake DataSource.

let server;
let port;
let client;

const fakeDataSource = {
  async listTables() {
    return ['users', 'devices'];
  },
  async getTableData(table) {
    if (table === 'users') {
      return { columns: ['id', 'name'], rows: [{ id: 1, name: 'Alice' }] };
    }
    if (table === 'boom') {
      throw new Error('simulated adapter failure');
    }
    return { columns: [], rows: [] };
  },
};

async function waitFor(conditionFn, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const start = Date.now();
  while (!conditionFn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

before(async () => {
  ({ server, port } = await startServer({ port: 0 }));
});

after(async () => {
  client?.close();
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /api/status', () => {
  test('reports disconnected before any app client connects', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    const body = await res.json();
    assert.equal(body.connected, false);
  });

  test('reports connected once an app client is attached', async () => {
    client = createInspectorClient({
      dataSource: fakeDataSource,
      url: `ws://127.0.0.1:${port}/relay`,
    });

    await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`);
      return (await res.json()).connected === true;
    });
  });
});

describe('GET /api/tables', () => {
  test('relays listTables() from the connected app client', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/tables`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.tables, ['users', 'devices']);
  });
});

describe('GET /api/tables/:table', () => {
  test('relays getTableData() for an existing table', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/tables/users`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.columns, ['id', 'name']);
    assert.deepEqual(body.rows, [{ id: 1, name: 'Alice' }]);
  });

  test('returns 502 with the adapter error message when the adapter throws', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/tables/boom`);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error, /simulated adapter failure/);
  });
});

describe('static UI', () => {
  test('serves index.html at /', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /SQL Inspector/);
  });

  test('404s for an unknown static path', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/does-not-exist.js`);
    assert.equal(res.status, 404);
  });
});

describe('disconnect behavior', () => {
  test('status flips back to disconnected once the app client closes', async () => {
    client.close();
    client = null;

    await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`);
      return (await res.json()).connected === false;
    });
  });

  test('/api/tables fails once nothing is connected', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/tables`);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error, /No app client connected/);
  });
});
