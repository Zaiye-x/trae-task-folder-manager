import {
  createEmptyDocument,
  isStoreDocument,
  type StorageScope,
  type StoreDocument
} from "./model";

const WORKSPACE_STORE_KEY = "traeTaskFolders.workspace.v1";
const GLOBAL_STORE_KEY = "traeTaskFolders.global.v1";

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export type CorruptionHandler = (
  scope: StorageScope,
  storedValue: unknown
) => void;

export class TaskRepository {
  constructor(
    private readonly workspaceState: MementoLike,
    private readonly globalState: MementoLike,
    private readonly onCorruption?: CorruptionHandler
  ) {}

  load(scope: StorageScope): StoreDocument {
    const memento = this.mementoFor(scope);
    const storedValue = memento.get<unknown>(this.keyFor(scope));

    if (typeof storedValue === "undefined") {
      return createEmptyDocument();
    }

    if (!isStoreDocument(storedValue)) {
      this.onCorruption?.(scope, storedValue);
      return createEmptyDocument();
    }

    return cloneDocument(storedValue);
  }

  async save(scope: StorageScope, document: StoreDocument): Promise<void> {
    await this.mementoFor(scope).update(
      this.keyFor(scope),
      cloneDocument(document)
    );
  }

  private keyFor(scope: StorageScope): string {
    return scope === "workspace" ? WORKSPACE_STORE_KEY : GLOBAL_STORE_KEY;
  }

  private mementoFor(scope: StorageScope): MementoLike {
    return scope === "workspace" ? this.workspaceState : this.globalState;
  }
}

function cloneDocument(document: StoreDocument): StoreDocument {
  return {
    version: document.version,
    folders: document.folders.map((folder) => ({ ...folder })),
    tasks: document.tasks.map((task) => ({ ...task }))
  };
}
