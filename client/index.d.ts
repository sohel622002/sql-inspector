export interface InspectorDataSource {
  listTables(): Promise<string[]>;
  getTableData(tableName: string): Promise<{ columns: string[]; rows: Record<string, any>[] }>;
}

export interface InspectorClientOptions {
  dataSource: InspectorDataSource;
  url?: string;
  reconnectMs?: number;
}

export interface InspectorClientHandle {
  close(): void;
}

export function createInspectorClient(options: InspectorClientOptions): InspectorClientHandle;
