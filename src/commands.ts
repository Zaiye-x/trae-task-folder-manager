import * as vscode from "vscode";

import {
  type FolderRecord,
  type ScopedTask,
  type StorageScope
} from "./model";
import { TaskService } from "./taskService";
import {
  asScopedFolder,
  asScopedTask,
  type TaskTreeNode,
  TaskTreeProvider
} from "./tree";
import { TraeAdapter, TRAE_COMMANDS } from "./traeAdapter";

interface FolderDestination extends vscode.QuickPickItem {
  scope: StorageScope;
  folderId: string | null;
}

export class CommandController {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly service: TaskService,
    private readonly tree: TaskTreeProvider,
    private readonly trae: TraeAdapter
  ) {}

  register(): void {
    this.registerCommand("traeTaskFolders.createFolder", (node) =>
      this.createFolder(node)
    );
    this.registerCommand("traeTaskFolders.renameFolder", (node) =>
      this.renameFolder(node)
    );
    this.registerCommand("traeTaskFolders.deleteFolder", (node) =>
      this.deleteFolder(node)
    );
    this.registerCommand("traeTaskFolders.moveFolder", (node) =>
      this.moveFolder(node)
    );
    this.registerCommand("traeTaskFolders.createTask", (node) =>
      this.createTask(node)
    );
    this.registerCommand("traeTaskFolders.addCurrentTask", (node) =>
      this.addCurrentTask(node)
    );
    this.registerCommand("traeTaskFolders.renameTask", (node) =>
      this.renameTask(node)
    );
    this.registerCommand("traeTaskFolders.moveTask", (node) =>
      this.moveTask(node)
    );
    this.registerCommand("traeTaskFolders.removeTask", (node) =>
      this.removeTask(node)
    );
    this.registerCommand("traeTaskFolders.openTask", (node) =>
      this.openTask(node)
    );
    this.registerCommand("traeTaskFolders.searchTasks", () =>
      this.searchTasks()
    );
    this.registerCommand("traeTaskFolders.refresh", () => this.tree.refresh());
    this.registerCommand("traeTaskFolders.diagnostics", () =>
      this.showDiagnostics()
    );
    this.registerCommand("traeTaskFolders.focus", () =>
      vscode.commands.executeCommand(
        "workbench.view.extension.traeTaskFolders"
      )
    );
  }

  private registerCommand(
    command: string,
    handler: (node?: TaskTreeNode) => unknown
  ): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand(command, async (node?: TaskTreeNode) => {
        try {
          await handler(node);
        } catch (error) {
          await vscode.window.showErrorMessage(errorMessage(error));
        }
      })
    );
  }

  private async createFolder(node?: TaskTreeNode): Promise<void> {
    const scope = scopeForNode(node);
    requireWorkspace(scope);
    const parentId = node?.kind === "folder" ? node.folder.id : null;
    const name = await vscode.window.showInputBox({
      title: "新建任务文件夹",
      prompt:
        parentId === null
          ? "输入文件夹名称"
          : `在“${node?.kind === "folder" ? node.folder.name : ""}”下新建文件夹`,
      validateInput: validateDisplayName
    });
    if (!name) {
      return;
    }

    await this.service.createFolder(scope, name, parentId);
    this.tree.refresh();
  }

  private async renameFolder(node?: TaskTreeNode): Promise<void> {
    const scopedFolder = asScopedFolder(node);
    if (!scopedFolder) {
      return;
    }
    const name = await vscode.window.showInputBox({
      title: "重命名文件夹",
      value: scopedFolder.folder.name,
      validateInput: validateDisplayName
    });
    if (!name || name.trim() === scopedFolder.folder.name) {
      return;
    }

    await this.service.renameFolder(scopedFolder, name);
    this.tree.refresh();
  }

  private async deleteFolder(node?: TaskTreeNode): Promise<void> {
    const scopedFolder = asScopedFolder(node);
    if (!scopedFolder) {
      return;
    }

    const document = this.service.getDocument(scopedFolder.scope);
    const affectedFolderIds = collectDescendants(
      document.folders,
      scopedFolder.folder.id
    );
    affectedFolderIds.add(scopedFolder.folder.id);
    const taskCount = document.tasks.filter(
      (task) =>
        task.folderId !== null && affectedFolderIds.has(task.folderId)
    ).length;
    const answer = await vscode.window.showWarningMessage(
      `确定删除“${scopedFolder.folder.name}”及其子文件夹吗？这会移除 ${taskCount} 个任务引用，但不会删除 SOLO 对话。`,
      { modal: true },
      "删除"
    );
    if (answer !== "删除") {
      return;
    }

    await this.service.deleteFolder(scopedFolder);
    this.tree.refresh();
  }

  private async moveFolder(node?: TaskTreeNode): Promise<void> {
    const scopedFolder = asScopedFolder(node);
    if (!scopedFolder) {
      return;
    }

    const destination = await this.pickFolder({
      scope: scopedFolder.scope,
      includeRoot: true,
      excludedFolderId: scopedFolder.folder.id,
      title: "移动文件夹"
    });
    if (!destination) {
      return;
    }

    await this.service.moveFolder(scopedFolder, destination.folderId);
    this.tree.refresh();
  }

  private async createTask(node?: TaskTreeNode): Promise<void> {
    const destination = await this.destinationForNode(
      node,
      "选择新任务所属文件夹"
    );
    if (!destination) {
      return;
    }
    requireWorkspace(destination.scope);

    const title = await vscode.window.showInputBox({
      title: "新建 SOLO 任务",
      prompt: "输入任务名称",
      validateInput: validateDisplayName
    });
    if (!title) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在创建 SOLO 任务…",
        cancellable: false
      },
      async () => {
        const sessionId = await this.trae.createTaskAndGetSessionId();
        await this.service.addOrMoveTask(destination.scope, {
          sessionId,
          title,
          folderId: destination.folderId,
          workspaceUri: currentWorkspaceUri()
        });
      }
    );
    this.tree.refresh();
  }

  private async addCurrentTask(node?: TaskTreeNode): Promise<void> {
    const destination = await this.destinationForNode(
      node,
      "选择当前任务所属文件夹"
    );
    if (!destination) {
      return;
    }
    requireWorkspace(destination.scope);

    const sessionId = await this.trae.getCurrentSessionId();
    const existing = this.findTaskBySessionId(sessionId);
    const title = await vscode.window.showInputBox({
      title: existing ? "更新任务名称" : "登记当前 SOLO 任务",
      value: existing?.task.title ?? `SOLO 任务 ${sessionId.slice(0, 8)}`,
      validateInput: validateDisplayName
    });
    if (!title) {
      return;
    }

    if (existing) {
      await this.service.renameTask(existing, title);
      await this.service.moveTask(
        existing,
        destination.scope,
        destination.folderId
      );
    } else {
      await this.service.addOrMoveTask(destination.scope, {
        sessionId,
        title,
        folderId: destination.folderId,
        workspaceUri: currentWorkspaceUri()
      });
    }
    this.tree.refresh();
  }

  private async renameTask(node?: TaskTreeNode): Promise<void> {
    const scopedTask = asScopedTask(node);
    if (!scopedTask) {
      return;
    }
    const title = await vscode.window.showInputBox({
      title: "重命名任务",
      value: scopedTask.task.title,
      validateInput: validateDisplayName
    });
    if (!title || title.trim() === scopedTask.task.title) {
      return;
    }

    await this.service.renameTask(scopedTask, title);
    this.tree.refresh();
  }

  private async moveTask(node?: TaskTreeNode): Promise<void> {
    const scopedTask = asScopedTask(node);
    if (!scopedTask) {
      return;
    }
    const destination = await this.pickFolder({
      includeRoot: true,
      title: "移动任务"
    });
    if (!destination) {
      return;
    }
    requireWorkspace(destination.scope);

    await this.service.moveTask(
      scopedTask,
      destination.scope,
      destination.folderId
    );
    this.tree.refresh();
  }

  private async removeTask(node?: TaskTreeNode): Promise<void> {
    const scopedTask = asScopedTask(node);
    if (!scopedTask) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      `从文件夹中移除“${scopedTask.task.title}”？SOLO 对话本身不会被删除。`,
      { modal: true },
      "移除"
    );
    if (answer !== "移除") {
      return;
    }

    await this.service.removeTask(scopedTask);
    this.tree.refresh();
  }

  private async openTask(node?: TaskTreeNode): Promise<void> {
    const scopedTask = asScopedTask(node);
    if (!scopedTask) {
      return;
    }
    await this.trae.openTask(scopedTask.task.sessionId);
  }

  private async searchTasks(): Promise<void> {
    const choices = (["workspace", "global"] as const).flatMap((scope) => {
      if (scope === "workspace" && !vscode.workspace.workspaceFolders) {
        return [];
      }
      const document = this.service.getDocument(scope);
      const scopeLabel = scope === "workspace" ? "当前项目" : "全局任务";
      return document.tasks.map((task) => {
        const folder = task.folderId
          ? folderPath(document.folders, task.folderId)
          : "未归档";
        return {
          label: `$(comment-discussion) ${task.title}`,
          description: `${scopeLabel} / ${folder}`,
          detail: task.sessionId,
          scopedTask: { scope, task }
        };
      });
    });

    if (choices.length === 0) {
      await vscode.window.showInformationMessage("当前还没有已登记的任务。");
      return;
    }

    const selected = await vscode.window.showQuickPick(choices, {
      title: "搜索 SOLO 任务",
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: "输入任务名称、文件夹或 Session ID"
    });
    if (selected) {
      await this.trae.openTask(selected.scopedTask.task.sessionId);
    }
  }

  private async showDiagnostics(): Promise<void> {
    const capabilities = await this.trae.getCapabilities();
    const lines = Object.entries(TRAE_COMMANDS).map(([key, command]) => {
      const available = capabilities[key as keyof typeof capabilities];
      return `${available ? "$(check)" : "$(error)"} ${command}`;
    });

    await vscode.window.showInformationMessage(
      `TRAE 兼容性检查：${lines.join("  |  ")}`
    );
  }

  private async destinationForNode(
    node: TaskTreeNode | undefined,
    title: string
  ): Promise<FolderDestination | undefined> {
    if (node?.kind === "folder") {
      return {
        label: node.folder.name,
        scope: node.scope,
        folderId: node.folder.id
      };
    }
    return this.pickFolder({ title });
  }

  private async pickFolder(options: {
    title: string;
    scope?: StorageScope;
    includeRoot?: boolean;
    excludedFolderId?: string;
  }): Promise<FolderDestination | undefined> {
    const destinations: FolderDestination[] = [];
    const scopes: StorageScope[] = options.scope
      ? [options.scope]
      : vscode.workspace.workspaceFolders
        ? ["workspace", "global"]
        : ["global"];

    for (const scope of scopes) {
      const document = this.service.getDocument(scope);
      const excludedIds = options.excludedFolderId
        ? collectDescendants(document.folders, options.excludedFolderId)
        : new Set<string>();
      if (options.excludedFolderId) {
        excludedIds.add(options.excludedFolderId);
      }
      const scopeLabel = scope === "workspace" ? "当前项目" : "全局任务";

      if (options.includeRoot) {
        destinations.push({
          label: `$(archive) ${scopeLabel} / 未归档`,
          scope,
          folderId: null
        });
      }

      for (const folder of folderPaths(document.folders)) {
        if (!excludedIds.has(folder.folder.id)) {
          destinations.push({
            label: `$(folder) ${folder.path}`,
            description: scopeLabel,
            scope,
            folderId: folder.folder.id
          });
        }
      }
    }

    if (destinations.length === 0) {
      await vscode.window.showInformationMessage(
        "请先在任务文件夹视图中新建一个文件夹。"
      );
      return undefined;
    }

    return vscode.window.showQuickPick(destinations, {
      title: options.title,
      matchOnDescription: true,
      placeHolder: "选择目标文件夹"
    });
  }

  private findTaskBySessionId(sessionId: string): ScopedTask | undefined {
    for (const scope of ["workspace", "global"] as const) {
      const task = this.service
        .getDocument(scope)
        .tasks.find((candidate) => candidate.sessionId === sessionId);
      if (task) {
        return { scope, task };
      }
    }
    return undefined;
  }
}

function scopeForNode(node: TaskTreeNode | undefined): StorageScope {
  if (node) {
    return node.scope;
  }
  return vscode.workspace.workspaceFolders ? "workspace" : "global";
}

function requireWorkspace(scope: StorageScope): void {
  if (scope === "workspace" && !vscode.workspace.workspaceFolders) {
    throw new Error("请先在 TraeCode 中打开一个项目文件夹。");
  }
}

function currentWorkspaceUri(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.toString();
}

function validateDisplayName(value: string): string | undefined {
  const name = value.trim();
  if (name.length === 0) {
    return "名称不能为空。";
  }
  if (name.length > 100) {
    return "名称不能超过 100 个字符。";
  }
  return undefined;
}

function collectDescendants(
  folders: FolderRecord[],
  folderId: string
): Set<string> {
  const result = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const parentId = queue.shift();
    for (const folder of folders) {
      if (folder.parentId === parentId && !result.has(folder.id)) {
        result.add(folder.id);
        queue.push(folder.id);
      }
    }
  }
  return result;
}

function folderPaths(
  folders: FolderRecord[]
): Array<{ folder: FolderRecord; path: string }> {
  const result: Array<{ folder: FolderRecord; path: string }> = [];
  const children = new Map<string | null, FolderRecord[]>();

  for (const folder of folders) {
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder);
    children.set(folder.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) =>
        left.order - right.order ||
        left.name.localeCompare(right.name, "zh-CN")
    );
  }

  const visit = (parentId: string | null, prefix: string): void => {
    for (const folder of children.get(parentId) ?? []) {
      const path = prefix ? `${prefix} / ${folder.name}` : folder.name;
      result.push({ folder, path });
      visit(folder.id, path);
    }
  };
  visit(null, "");
  return result;
}

function folderPath(folders: FolderRecord[], folderId: string): string {
  const names: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = folderId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = folders.find((candidate) => candidate.id === currentId);
    if (!folder) {
      break;
    }
    names.unshift(folder.name);
    currentId = folder.parentId;
  }
  return names.join(" / ") || "未知文件夹";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
