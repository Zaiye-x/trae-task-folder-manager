export const STORE_VERSION = 1 as const;

export type StorageScope = "workspace" | "global";

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  sessionId: string;
  title: string;
  folderId: string | null;
  order: number;
  workspaceUri?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreDocument {
  version: typeof STORE_VERSION;
  folders: FolderRecord[];
  tasks: TaskRecord[];
}

export interface ScopedFolder {
  scope: StorageScope;
  folder: FolderRecord;
}

export interface ScopedTask {
  scope: StorageScope;
  task: TaskRecord;
}

export function createEmptyDocument(): StoreDocument {
  return {
    version: STORE_VERSION,
    folders: [],
    tasks: []
  };
}

export function isStoreDocument(value: unknown): value is StoreDocument {
  if (!isRecord(value) || value.version !== STORE_VERSION) {
    return false;
  }

  return (
    Array.isArray(value.folders) &&
    value.folders.every(isFolderRecord) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isTaskRecord)
  );
}

function isFolderRecord(value: unknown): value is FolderRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (typeof value.parentId === "string" || value.parentId === null) &&
    typeof value.order === "number" &&
    typeof value.createdAt === "string"
  );
}

function isTaskRecord(value: unknown): value is TaskRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.title === "string" &&
    (typeof value.folderId === "string" || value.folderId === null) &&
    typeof value.order === "number" &&
    (typeof value.workspaceUri === "string" ||
      typeof value.workspaceUri === "undefined") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
