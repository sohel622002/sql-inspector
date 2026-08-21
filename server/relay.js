// Relay: routes requests from the browser UI to whichever app-client is
// currently connected over WebSocket, and resolves them when the app
// client replies. v1 supports a single connected app-client.

let appSocket = null;
const pending = new Map(); // id -> { resolve, reject, timer }

let nextId = 0;
function makeId() {
  nextId += 1;
  return String(nextId);
}

export function setAppSocket(ws) {
  appSocket = ws;
}

export function clearAppSocket(ws) {
  if (appSocket === ws) appSocket = null;
}

export function isAppConnected() {
  return appSocket !== null && appSocket.readyState === appSocket.OPEN;
}

export function handleAppMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const entry = pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  clearTimeout(entry.timer);
  if (msg.error) {
    entry.reject(new Error(msg.error));
  } else {
    entry.resolve(msg);
  }
}

export function requestFromApp(type, payload, timeoutMs = 8000) {
  if (!isAppConnected()) {
    return Promise.reject(new Error('No app client connected'));
  }

  const id = makeId();
  const message = { id, type, ...payload };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Timed out waiting for app client response'));
    }, timeoutMs);

    pending.set(id, { id, resolve, reject, timer });
    appSocket.send(JSON.stringify(message));
  });
}
