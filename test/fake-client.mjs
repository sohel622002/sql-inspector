import { createInspectorClient } from '../client/index.js';

const fakeDataSource = {
  async listTables() {
    return ['users', 'devices'];
  },
  async getTableData(table) {
    if (table === 'users') {
      return { columns: ['id', 'name'], rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] };
    }
    return { columns: ['id', 'status'], rows: [{ id: 'dev-1', status: 'online' }] };
  },
};

createInspectorClient({ dataSource: fakeDataSource, url: 'ws://localhost:4545/relay' });
console.log('fake client connected');
