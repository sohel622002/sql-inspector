import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { createInspectorClient } from '../client/index.js';

function startFakeServer() {
  const wss = new WebSocketServer({ port: 0 });
  const port = wss.address().port;
  return { wss, port };
}

function nextConnection(wss) {
  return new Promise((resolve) => wss.once('connection', resolve));
}

function nextMessage(ws) {
  return new Promise((resolve) => ws.once('message', (raw) => resolve(JSON.parse(raw.toString()))));
}

describe('createInspectorClient', () => {
  test('answers listTables by calling the DataSource', async () => {
    const { wss, port } = startFakeServer();
    const clientPromise = nextConnection(wss);

    const client = createInspectorClient({
      dataSource: {
        async listTables() {
          return ['a', 'b'];
        },
        async getTableData() {
          return { columns: [], rows: [] };
        },
      },
      url: `ws://localhost:${port}`,
    });

    const serverSideSocket = await clientPromise;
    serverSideSocket.send(JSON.stringify({ id: '1', type: 'listTables' }));
    const reply = await nextMessage(serverSideSocket);

    assert.deepEqual(reply, { id: '1', tables: ['a', 'b'] });

    client.close();
    wss.close();
  });

  test('answers getTableData with the table name passed through', async () => {
    const { wss, port } = startFakeServer();
    const clientPromise = nextConnection(wss);

    const client = createInspectorClient({
      dataSource: {
        async listTables() {
          return [];
        },
        async getTableData(table) {
          return { columns: ['id'], rows: [{ id: table }] };
        },
      },
      url: `ws://localhost:${port}`,
    });

    const serverSideSocket = await clientPromise;
    serverSideSocket.send(JSON.stringify({ id: '7', type: 'getTableData', table: 'devices' }));
    const reply = await nextMessage(serverSideSocket);

    assert.deepEqual(reply, { id: '7', columns: ['id'], rows: [{ id: 'devices' }] });

    client.close();
    wss.close();
  });

  test('replies with an error when the DataSource throws', async () => {
    const { wss, port } = startFakeServer();
    const clientPromise = nextConnection(wss);

    const client = createInspectorClient({
      dataSource: {
        async listTables() {
          throw new Error('db is locked');
        },
        async getTableData() {
          return { columns: [], rows: [] };
        },
      },
      url: `ws://localhost:${port}`,
    });

    const serverSideSocket = await clientPromise;
    serverSideSocket.send(JSON.stringify({ id: '2', type: 'listTables' }));
    const reply = await nextMessage(serverSideSocket);

    assert.equal(reply.id, '2');
    assert.match(reply.error, /db is locked/);

    client.close();
    wss.close();
  });

  test('replies with an error for an unknown request type', async () => {
    const { wss, port } = startFakeServer();
    const clientPromise = nextConnection(wss);

    const client = createInspectorClient({
      dataSource: {
        async listTables() {
          return [];
        },
        async getTableData() {
          return { columns: [], rows: [] };
        },
      },
      url: `ws://localhost:${port}`,
    });

    const serverSideSocket = await clientPromise;
    serverSideSocket.send(JSON.stringify({ id: '3', type: 'dropTable' }));
    const reply = await nextMessage(serverSideSocket);

    assert.equal(reply.id, '3');
    assert.match(reply.error, /Unknown request type/);

    client.close();
    wss.close();
  });

  test('reconnects after the server drops the connection', async () => {
    const { wss, port } = startFakeServer();
    const firstConnection = nextConnection(wss);

    const client = createInspectorClient({
      dataSource: {
        async listTables() {
          return [];
        },
        async getTableData() {
          return { columns: [], rows: [] };
        },
      },
      url: `ws://localhost:${port}`,
      reconnectMs: 20,
    });

    const first = await firstConnection;
    const secondConnection = nextConnection(wss);
    first.close();

    const second = await secondConnection;
    assert.ok(second);

    client.close();
    wss.close();
  });

  test('close() stops further reconnect attempts', async () => {
    const { wss, port } = startFakeServer();
    const firstConnection = nextConnection(wss);

    const client = createInspectorClient({
      dataSource: {
        async listTables() {
          return [];
        },
        async getTableData() {
          return { columns: [], rows: [] };
        },
      },
      url: `ws://localhost:${port}`,
      reconnectMs: 20,
    });

    const first = await firstConnection;
    client.close();
    first.close();

    let reconnected = false;
    wss.once('connection', () => {
      reconnected = true;
    });

    await new Promise((r) => setTimeout(r, 100));
    assert.equal(reconnected, false);

    wss.close();
  });
});
