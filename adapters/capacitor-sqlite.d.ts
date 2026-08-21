import type { InspectorDataSource } from '../client/index.js';

export interface SqliteConnectionLike {
  db: {
    query(statement: string, values?: any[]): Promise<{ values?: any[] }>;
  };
}

export function createCapacitorSqliteAdapter(sqliteCoreService: SqliteConnectionLike): InspectorDataSource;
