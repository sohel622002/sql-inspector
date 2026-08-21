// App-side client. Give it a DataSource adapter — an object with
// listTables() and getTableData(tableName) — and it connects out to the
// sql-inspector server and answers the server's relayed requests.
//
// DataSource contract:
//   listTables(): Promise<string[]>
//   getTableData(tableName: string): Promise<{ columns: string[], rows: object[] }>

export function createInspectorClient({ dataSource, url = 'ws://localhost:4545/relay', reconnectMs = 3000 }) {
  let socket = null;
  let stopped = false;
  let reconnectTimer = null;

  function connect() {
    if (stopped) return;

    socket = new WebSocket(url);

    socket.addEventListener('message', async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      await handleMessage(msg);
    });

    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', scheduleReconnect);
  }

  async function handleMessage(msg) {
    try {
      if (msg.type === 'listTables') {
        const tables = await dataSource.listTables();
        send({ id: msg.id, tables });
        return;
      }
      if (msg.type === 'getTableData') {
        const { columns, rows } = await dataSource.getTableData(msg.table);
        send({ id: msg.id, columns, rows });
        return;
      }
      send({ id: msg.id, error: `Unknown request type: ${msg.type}` });
    } catch (err) {
      send({ id: msg.id, error: err?.message ?? String(err) });
    }
  }

  function send(payload) {
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectMs);
  }

  connect();

  return {
    close() {
      stopped = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
