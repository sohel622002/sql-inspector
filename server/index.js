import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { setAppSocket, clearAppSocket, handleAppMessage, requestFromApp, isAppConnected } from './relay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
    res.end(content);
  });
}

async function handleApi(req, res, urlPath) {
  try {
    if (urlPath === '/api/status') {
      sendJson(res, 200, { connected: isAppConnected() });
      return;
    }

    if (urlPath === '/api/tables') {
      const result = await requestFromApp('listTables', {});
      sendJson(res, 200, { tables: result.tables ?? [] });
      return;
    }

    const tableMatch = urlPath.match(/^\/api\/tables\/([^/]+)$/);
    if (tableMatch) {
      const table = decodeURIComponent(tableMatch[1]);
      const result = await requestFromApp('getTableData', { table });
      sendJson(res, 200, { columns: result.columns ?? [], rows: result.rows ?? [] });
      return;
    }

    sendJson(res, 404, { error: 'Unknown API route' });
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}

export function startServer({ port = 4545 } = {}) {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    if (urlPath.startsWith('/api/')) {
      handleApi(req, res, urlPath);
    } else {
      serveStatic(req, res);
    }
  });

  const wss = new WebSocketServer({ server, path: '/relay' });

  wss.on('connection', (ws) => {
    setAppSocket(ws);
    ws.on('message', (raw) => handleAppMessage(raw.toString()));
    ws.on('close', () => clearAppSocket(ws));
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, port: server.address().port }));
  });
}
