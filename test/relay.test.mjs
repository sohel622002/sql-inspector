import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setAppSocket,
  clearAppSocket,
  isAppConnected,
  handleAppMessage,
  requestFromApp,
} from '../server/relay.js';

// A minimal fake WebSocket good enough for the relay module: it only ever
// touches .readyState, .OPEN and .send().
function makeFakeSocket() {
  const sent = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    send(data) {
      sent.push(JSON.parse(data));
    },
  };
  return { socket, sent };
}

beforeEach(() => {
  clearAppSocket({}); // reset module-level appSocket between tests
});

describe('relay: connection state', () => {
  test('isAppConnected is false with no socket', () => {
    assert.equal(isAppConnected(), false);
  });

  test('isAppConnected is true once a socket is set and open', () => {
    const { socket } = makeFakeSocket();
    setAppSocket(socket);
    assert.equal(isAppConnected(), true);
  });

  test('isAppConnected is false once the socket is not OPEN', () => {
    const { socket } = makeFakeSocket();
    socket.readyState = 3; // CLOSED
    setAppSocket(socket);
    assert.equal(isAppConnected(), false);
  });

  test('clearAppSocket only clears if it is the same socket instance', () => {
    const { socket: a } = makeFakeSocket();
    const { socket: b } = makeFakeSocket();
    setAppSocket(a);
    clearAppSocket(b);
    assert.equal(isAppConnected(), true);
    clearAppSocket(a);
    assert.equal(isAppConnected(), false);
  });
});

describe('relay: requestFromApp', () => {
  test('rejects immediately when no app is connected', async () => {
    await assert.rejects(
      requestFromApp('listTables', {}),
      /No app client connected/
    );
  });

  test('resolves once the app client replies with the matching id', async () => {
    const { socket, sent } = makeFakeSocket();
    setAppSocket(socket);

    const promise = requestFromApp('listTables', {});
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'listTables');

    handleAppMessage(JSON.stringify({ id: sent[0].id, tables: ['users', 'devices'] }));

    const result = await promise;
    assert.deepEqual(result.tables, ['users', 'devices']);
  });

  test('rejects when the app client replies with an error field', async () => {
    const { socket, sent } = makeFakeSocket();
    setAppSocket(socket);

    const promise = requestFromApp('getTableData', { table: 'missing' });
    handleAppMessage(JSON.stringify({ id: sent[0].id, error: 'no such table' }));

    await assert.rejects(promise, /no such table/);
  });

  test('times out if the app client never replies', async () => {
    const { socket } = makeFakeSocket();
    setAppSocket(socket);

    await assert.rejects(
      requestFromApp('listTables', {}, 20),
      /Timed out waiting for app client response/
    );
  });

  test('ignores malformed JSON from the app client instead of throwing', () => {
    const { socket } = makeFakeSocket();
    setAppSocket(socket);
    assert.doesNotThrow(() => handleAppMessage('not json'));
  });

  test('ignores a reply whose id has no pending request', () => {
    const { socket } = makeFakeSocket();
    setAppSocket(socket);
    assert.doesNotThrow(() => handleAppMessage(JSON.stringify({ id: 'unknown-id', tables: [] })));
  });

  test('each request gets a distinct id', async () => {
    const { socket, sent } = makeFakeSocket();
    setAppSocket(socket);

    const p1 = requestFromApp('listTables', {});
    const p2 = requestFromApp('listTables', {});
    assert.notEqual(sent[0].id, sent[1].id);

    handleAppMessage(JSON.stringify({ id: sent[0].id, tables: ['a'] }));
    handleAppMessage(JSON.stringify({ id: sent[1].id, tables: ['b'] }));

    assert.deepEqual((await p1).tables, ['a']);
    assert.deepEqual((await p2).tables, ['b']);
  });
});
