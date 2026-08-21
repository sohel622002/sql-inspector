// Reference adapter only — NOT imported by sql-inspector's core code.
// Shows how to satisfy the DataSource contract using
// @capacitor-community/sqlite (e.g. loft-edge's SqliteCoreService).
//
// Usage:
//   import { createCapacitorSqliteAdapter } from 'sql-inspector/adapters/capacitor-sqlite.js';
//   const dataSource = createCapacitorSqliteAdapter(sqliteCoreService);

export function createCapacitorSqliteAdapter(sqliteCoreService) {
  return {
    async listTables() {
      const res = await sqliteCoreService.db.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      );
      return (res.values ?? []).map((r) => r.name);
    },

    async getTableData(table) {
      const res = await sqliteCoreService.db.query(`SELECT * FROM ${table}`);
      const rows = res.values ?? [];
      return {
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows,
      };
    },
  };
}
