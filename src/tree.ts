import * as vscode from "vscode";

import {
  type FolderRecord,
  type ScopedFolder,
  type ScopedTask,
  type StorageScope,
  type TaskRecord
} from "./model";
import { TaskService } from "./taskService";

const TREE_MIME = "application/vnd.code.tree.traetaskfolders.tasks";
const collator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base"
});

export type TaskTreeNode =
  | ScopeNode
  | UnfiledNode
  | FolderNode
  | TaskNode;

export interface ScopeNode {
  kind: "scope";
  scope: StorageScope;
}

export interface UnfiledNode {
  kind: "unfiled";
  scope: StorageScope;
}

export interface FolderNode {
  kind: "folder";
  scope: StorageScope;
  folder: FolderRecord;
}

export interface TaskNode {
  kind: "task";
  scope: StorageScope;
  task: TaskRecord;
}

interface DragPayload {
  kind: "folder" | "task";
  scope: StorageScope;
  id: string;
}

export class TaskTreeProvider
  implements
    vscode.TreeDataProvider<TaskTreeNode>,
    vscode.TreeDragAndDropController<TaskTreeNode>
{
  readonly dragMimeTypes = [TREE_MIME];
  readonly dropMimeTypes = [TREE_MIME];

  private readonly changeEmitter = new vscode.EventEmitter<
    TaskTreeNode | undefined | null | void
  >();

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly service: TaskService,
    private readonly hasWorkspace: () => boolean,
    private readonly onError: (error: unknown) => void
  ) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  getTreeItem(element: TaskTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "scope":
        return this.scopeTreeItem(element);
      case "unfiled":
        return this.unfiledTreeItem(element);
      case "folder":
        return this.folderTreeItem(element);
      case "task":
        return this.taskTreeItem(element);
    }
  }

  getChildren(element?: TaskTreeNode): TaskTreeNode[] {
    if (!element) {
      const roots: ScopeNode[] = [];
      if (this.hasWorkspace()) {
        roots.push({ kind: "scope", scope: "workspace" });
      }
      roots.push({ kind: "scope", scope: "global" });
      return roots;
    }

    if (element.kind === "task" || element.kind === "unfiled") {
      return element.kind === "unfiled"
        ? this.tasksForFolder(element.scope, null)
        : [];
    }

    const parentId =
      element.kind === "scope" ? null : element.folder.id;
    const scope = element.scope;
    const document = this.service.getDocument(scope);
    const folders: FolderNode[] = document.folders
      .filter((folder) => folder.parentId === parentId)
      .sort(compareOrderedNames)
      .map((folder) => ({ kind: "folder", scope, folder }));
    const tasks = this.tasksForFolder(scope, parentId);

    if (element.kind === "scope") {
      const nodes: TaskTreeNode[] = [...folders];
      if (document.tasks.some((task) => task.folderId === null)) {
        nodes.push({ kind: "unfiled", scope });
      }
      return nodes;
    }

    return [...folders, ...tasks];
  }

  getParent(element: TaskTreeNode): TaskTreeNode | undefined {
    if (element.kind === "scope") {
      return undefined;
    }
    if (element.kind === "unfiled") {
      return { kind: "scope", scope: element.scope };
    }

    if (element.kind === "task") {
      if (element.task.folderId === null) {
        return { kind: "unfiled", scope: element.scope };
      }
      const folder = this.service
        .getDocument(element.scope)
        .folders.find((candidate) => candidate.id === element.task.folderId);
      return folder
        ? { kind: "folder", scope: element.scope, folder }
        : { kind: "scope", scope: element.scope };
    }

    if (element.folder.parentId === null) {
      return { kind: "scope", scope: element.scope };
    }
    const parent = this.service
      .getDocument(element.scope)
      .folders.find(
        (candidate) => candidate.id === element.folder.parentId
      );
    return parent
      ? { kind: "folder", scope: element.scope, folder: parent }
      : { kind: "scope", scope: element.scope };
  }

  async handleDrag(
    source: readonly TaskTreeNode[],
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    const payloads: DragPayload[] = [];
    for (const node of source) {
      if (node.kind === "folder") {
        payloads.push({
          kind: "folder",
          scope: node.scope,
          id: node.folder.id
        });
      }
      if (node.kind === "task") {
        payloads.push({
          kind: "task",
          scope: node.scope,
          id: node.task.id
        });
      }
    }

    if (payloads.length > 0) {
      dataTransfer.set(
        TREE_MIME,
        new vscode.DataTransferItem(JSON.stringify(payloads))
      );
    }
  }

  async handleDrop(
    target: TaskTreeNode | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    const item = dataTransfer.get(TREE_MIME);
    if (!item || !target) {
      return;
    }

    try {
      const payloads = JSON.parse(await item.asString()) as DragPayload[];
      const destination = this.dropDestination(target);
      for (const payload of payloads) {
        if (payload.kind === "task") {
          const task = this.service
            .getDocument(payload.scope)
            .tasks.find((candidate) => candidate.id === payload.id);
          if (task) {
            await this.service.moveTask(
              { scope: payload.scope, task },
              destination.scope,
              destination.folderId
            );
          }
        } else if (payload.scope === destination.scope) {
          const folder = this.service
            .getDocument(payload.scope)
            .folders.find((candidate) => candidate.id === payload.id);
          if (folder) {
            await this.service.moveFolder(
              { scope: payload.scope, folder },
              destination.folderId
            );
          }
        } else {
          throw new Error("文件夹暂不支持跨项目与全局区域移动。");
        }
      }
      this.refresh();
    } catch (error) {
      this.onError(error);
    }
  }

  private tasksForFolder(
    scope: StorageScope,
    folderId: string | null
  ): TaskNode[] {
    return this.service
      .getDocument(scope)
      .tasks.filter((task) => task.folderId === folderId)
      .sort(compareOrderedNames)
      .map((task) => ({ kind: "task", scope, task }));
  }

  private scopeTreeItem(node: ScopeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.scope === "workspace" ? "当前项目" : "全局任务",
      vscode.TreeItemCollapsibleState.Expanded
    );
    item.id = `scope:${node.scope}`;
    item.contextValue = "scopeRoot";
    item.iconPath = new vscode.ThemeIcon(
      node.scope === "workspace" ? "root-folder" : "globe"
    );
    return item;
  }

  private unfiledTreeItem(node: UnfiledNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      "未归档",
      vscode.TreeItemCollapsibleState.Collapsed
    );
    item.id = `unfiled:${node.scope}`;
    item.contextValue = "unfiled";
    item.iconPath = new vscode.ThemeIcon("archive");
    return item;
  }

  private folderTreeItem(node: FolderNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.folder.name,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    item.id = `folder:${node.scope}:${node.folder.id}`;
    item.contextValue = "folder";
    item.iconPath = new vscode.ThemeIcon("folder");
    item.tooltip = this.folderPath(node.scope, node.folder);
    return item;
  }

  private taskTreeItem(node: TaskNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.task.title,
      vscode.TreeItemCollapsibleState.None
    );
    item.id = `task:${node.scope}:${node.task.id}`;
    item.contextValue = "task";
    item.iconPath = new vscode.ThemeIcon("comment-discussion");
    item.tooltip = new vscode.MarkdownString(
      [
        `**${escapeMarkdown(node.task.title)}**`,
        "",
        `Session ID: \`${node.task.sessionId}\``,
        "",
        `更新时间：${new Date(node.task.updatedAt).toLocaleString()}`
      ].join("\n")
    );
    item.command = {
      command: "traeTaskFolders.openTask",
      title: "打开 SOLO 任务",
      arguments: [node]
    };
    return item;
  }

  private folderPath(scope: StorageScope, folder: FolderRecord): string {
    const document = this.service.getDocument(scope);
    const names = [folder.name];
    let parentId = folder.parentId;
    const visited = new Set<string>();

    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = document.folders.find(
        (candidate) => candidate.id === parentId
      );
      if (!parent) {
        break;
      }
      names.unshift(parent.name);
      parentId = parent.parentId;
    }

    return names.join(" / ");
  }

  private dropDestination(target: TaskTreeNode): {
    scope: StorageScope;
    folderId: string | null;
  } {
    if (target.kind === "folder") {
      return { scope: target.scope, folderId: target.folder.id };
    }
    if (target.kind === "task") {
      return { scope: target.scope, folderId: target.task.folderId };
    }
    return { scope: target.scope, folderId: null };
  }
}

export function asScopedFolder(
  node: TaskTreeNode | undefined
): ScopedFolder | undefined {
  return node?.kind === "folder"
    ? { scope: node.scope, folder: node.folder }
    : undefined;
}

export function asScopedTask(
  node: TaskTreeNode | undefined
): ScopedTask | undefined {
  return node?.kind === "task"
    ? { scope: node.scope, task: node.task }
    : undefined;
}

function compareOrderedNames(
  left: FolderRecord | TaskRecord,
  right: FolderRecord | TaskRecord
): number {
  const leftName = "name" in left ? left.name : left.title;
  const rightName = "name" in right ? right.name : right.title;
  return left.order - right.order || collator.compare(leftName, rightName);
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}
