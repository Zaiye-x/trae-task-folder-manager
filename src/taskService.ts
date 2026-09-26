import { randomUUID } from "node:crypto";

import {
  type FolderRecord,
  type ScopedFolder,
  type ScopedTask,
  type StorageScope,
  type StoreDocument,
  type TaskRecord
} from "./model";
import { TaskRepository } from "./repository";

export class TaskFolderError extends Error {
  constructor(
    readonly code:
      | "duplicate-folder"
      | "folder-cycle"
      | "folder-not-found"
      | "invalid-name"
      | "task-not-found",
    message: string
  ) {
    super(message);
    this.name = "TaskFolderError";
  }
}

export interface AddTaskInput {
  sessionId: string;
  title: string;
  folderId: string | null;
  workspaceUri?: string;
}

export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date()
  ) {}

  getDocument(scope: StorageScope): StoreDocument {
    return this.repository.load(scope);
  }

  async createFolder(
    scope: StorageScope,
    name: string,
    parentId: string | null
  ): Promise<FolderRecord> {
    const document = this.repository.load(scope);
    const normalizedName = validateName(name);
    assertParentExists(document, parentId);
    assertUniqueSiblingName(document, normalizedName, parentId);

    const folder: FolderRecord = {
      id: this.createId(),
      name: normalizedName,
      parentId,
      order: nextFolderOrder(document, parentId),
      createdAt: this.now().toISOString()
    };

    document.folders.push(folder);
    await this.repository.save(scope, document);
    return folder;
  }

  async renameFolder(
    scopedFolder: ScopedFolder,
    name: string
  ): Promise<FolderRecord> {
    const document = this.repository.load(scopedFolder.scope);
    const folder = requireFolder(document, scopedFolder.folder.id);
    const normalizedName = validateName(name);
    assertUniqueSiblingName(
      document,
      normalizedName,
      folder.parentId,
      folder.id
    );

    folder.name = normalizedName;
    await this.repository.save(scopedFolder.scope, document);
    return folder;
  }

  async moveFolder(
    scopedFolder: ScopedFolder,
    parentId: string | null
  ): Promise<FolderRecord> {
    const document = this.repository.load(scopedFolder.scope);
    const folder = requireFolder(document, scopedFolder.folder.id);
    assertParentExists(document, parentId);

    if (
      parentId === folder.id ||
      (parentId !== null &&
        descendantFolderIds(document, folder.id).has(parentId))
    ) {
      throw new TaskFolderError(
        "folder-cycle",
        "文件夹不能移动到自身或其子文件夹中。"
      );
    }

    assertUniqueSiblingName(document, folder.name, parentId, folder.id);
    folder.parentId = parentId;
    folder.order = nextFolderOrder(document, parentId);
    await this.repository.save(scopedFolder.scope, document);
    return folder;
  }

  async deleteFolder(scopedFolder: ScopedFolder): Promise<void> {
    const document = this.repository.load(scopedFolder.scope);
    requireFolder(document, scopedFolder.folder.id);

    const deletedIds = descendantFolderIds(
      document,
      scopedFolder.folder.id
    );
    deletedIds.add(scopedFolder.folder.id);
    document.folders = document.folders.filter(
      (folder) => !deletedIds.has(folder.id)
    );
    document.tasks = document.tasks.filter(
      (task) => task.folderId === null || !deletedIds.has(task.folderId)
    );
    await this.repository.save(scopedFolder.scope, document);
  }

  async addOrMoveTask(
    scope: StorageScope,
    input: AddTaskInput
  ): Promise<TaskRecord> {
    const document = this.repository.load(scope);
    assertParentExists(document, input.folderId);
    const now = this.now().toISOString();
    const existing = document.tasks.find(
      (task) => task.sessionId === input.sessionId
    );

    if (existing) {
      existing.title = validateName(input.title);
      existing.folderId = input.folderId;
      existing.workspaceUri = input.workspaceUri;
      existing.updatedAt = now;
      existing.order = nextTaskOrder(document, input.folderId, existing.id);
      await this.repository.save(scope, document);
      return existing;
    }

    const task: TaskRecord = {
      id: this.createId(),
      sessionId: input.sessionId,
      title: validateName(input.title),
      folderId: input.folderId,
      order: nextTaskOrder(document, input.folderId),
      workspaceUri: input.workspaceUri,
      createdAt: now,
      updatedAt: now
    };

    document.tasks.push(task);
    await this.repository.save(scope, document);
    return task;
  }

  async renameTask(
    scopedTask: ScopedTask,
    title: string
  ): Promise<TaskRecord> {
    const document = this.repository.load(scopedTask.scope);
    const task = requireTask(document, scopedTask.task.id);
    task.title = validateName(title);
    task.updatedAt = this.now().toISOString();
    await this.repository.save(scopedTask.scope, document);
    return task;
  }

  async moveTask(
    scopedTask: ScopedTask,
    destinationScope: StorageScope,
    folderId: string | null
  ): Promise<TaskRecord> {
    if (scopedTask.scope === destinationScope) {
      const document = this.repository.load(scopedTask.scope);
      const task = requireTask(document, scopedTask.task.id);
      assertParentExists(document, folderId);
      task.folderId = folderId;
      task.order = nextTaskOrder(document, folderId, task.id);
      task.updatedAt = this.now().toISOString();
      await this.repository.save(scopedTask.scope, document);
      return task;
    }

    const source = this.repository.load(scopedTask.scope);
    const sourceTask = requireTask(source, scopedTask.task.id);
    const destination = this.repository.load(destinationScope);
    assertParentExists(destination, folderId);
    const now = this.now().toISOString();
    const duplicate = destination.tasks.find(
      (task) => task.sessionId === sourceTask.sessionId
    );

    let movedTask: TaskRecord;
    if (duplicate) {
      duplicate.title = sourceTask.title;
      duplicate.folderId = folderId;
      duplicate.workspaceUri = sourceTask.workspaceUri;
      duplicate.updatedAt = now;
      duplicate.order = nextTaskOrder(destination, folderId, duplicate.id);
      movedTask = duplicate;
    } else {
      movedTask = {
        ...sourceTask,
        folderId,
        order: nextTaskOrder(destination, folderId),
        updatedAt: now
      };
      destination.tasks.push(movedTask);
    }

    source.tasks = source.tasks.filter((task) => task.id !== sourceTask.id);
    await this.repository.save(destinationScope, destination);
    await this.repository.save(scopedTask.scope, source);
    return movedTask;
  }

  async removeTask(scopedTask: ScopedTask): Promise<void> {
    const document = this.repository.load(scopedTask.scope);
    requireTask(document, scopedTask.task.id);
    document.tasks = document.tasks.filter(
      (task) => task.id !== scopedTask.task.id
    );
    await this.repository.save(scopedTask.scope, document);
  }
}

function validateName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 100) {
    throw new TaskFolderError(
      "invalid-name",
      "名称不能为空，且不能超过 100 个字符。"
    );
  }
  return normalized;
}

function requireFolder(
  document: StoreDocument,
  folderId: string
): FolderRecord {
  const folder = document.folders.find((candidate) => candidate.id === folderId);
  if (!folder) {
    throw new TaskFolderError("folder-not-found", "目标文件夹不存在。");
  }
  return folder;
}

function requireTask(document: StoreDocument, taskId: string): TaskRecord {
  const task = document.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new TaskFolderError("task-not-found", "目标任务不存在。");
  }
  return task;
}

function assertParentExists(
  document: StoreDocument,
  parentId: string | null
): void {
  if (parentId !== null) {
    requireFolder(document, parentId);
  }
}

function assertUniqueSiblingName(
  document: StoreDocument,
  name: string,
  parentId: string | null,
  ignoredFolderId?: string
): void {
  const duplicate = document.folders.some(
    (folder) =>
      folder.id !== ignoredFolderId &&
      folder.parentId === parentId &&
      folder.name.localeCompare(name, undefined, {
        sensitivity: "accent"
      }) === 0
  );
  if (duplicate) {
    throw new TaskFolderError(
      "duplicate-folder",
      "同一层级已经存在同名文件夹。"
    );
  }
}

function descendantFolderIds(
  document: StoreDocument,
  folderId: string
): Set<string> {
  const result = new Set<string>();
  const queue = [folderId];

  while (queue.length > 0) {
    const parentId = queue.shift();
    for (const folder of document.folders) {
      if (folder.parentId === parentId && !result.has(folder.id)) {
        result.add(folder.id);
        queue.push(folder.id);
      }
    }
  }

  return result;
}

function nextFolderOrder(
  document: StoreDocument,
  parentId: string | null
): number {
  return nextOrder(
    document.folders
      .filter((folder) => folder.parentId === parentId)
      .map((folder) => folder.order)
  );
}

function nextTaskOrder(
  document: StoreDocument,
  folderId: string | null,
  ignoredTaskId?: string
): number {
  return nextOrder(
    document.tasks
      .filter(
        (task) => task.folderId === folderId && task.id !== ignoredTaskId
      )
      .map((task) => task.order)
  );
}

function nextOrder(orders: number[]): number {
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}
