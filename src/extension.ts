import * as vscode from "vscode";

import { CommandController } from "./commands";
import { MacOsTaskSearchNavigator } from "./macOsTaskSearchNavigator";
import { TaskRepository } from "./repository";
import { createLocalChatSessionUri } from "./sessionResource";
import { TaskService } from "./taskService";
import { TaskTreeProvider } from "./tree";
import { TraeAdapter, type TraeHost } from "./traeAdapter";
import { TraeTaskMetadataResolver } from "./traeTaskMetadata";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("SOLO Task Folders");
  context.subscriptions.push(output);

  const repository = new TaskRepository(
    context.workspaceState,
    context.globalState,
    (scope) => {
      output.appendLine(
        `[storage] ${scope} data is invalid; using an empty in-memory document.`
      );
      void vscode.window.showErrorMessage(
        `${scope === "workspace" ? "当前项目" : "全局"}任务文件夹数据格式无效。原始数据未被覆盖。`
      );
    }
  );
  const service = new TaskService(repository);
  const tree = new TaskTreeProvider(
    service,
    () => Boolean(vscode.workspace.workspaceFolders),
    (error) => {
      output.appendLine(`[tree] ${errorMessage(error)}`);
      void vscode.window.showErrorMessage(errorMessage(error));
    }
  );

  const treeView = vscode.window.createTreeView("traeTaskFolders.tasks", {
    treeDataProvider: tree,
    dragAndDropController: tree,
    canSelectMany: true,
    showCollapseAll: true
  });
  context.subscriptions.push(treeView);
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    20
  );
  statusBarItem.name = "SOLO Task Folders";
  statusBarItem.text = "$(folder-library)";
  statusBarItem.tooltip = "打开 SOLO 任务文件夹";
  statusBarItem.command = "traeTaskFolders.focus";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const taskSearchNavigator = new MacOsTaskSearchNavigator();
  const traeHost: TraeHost = {
    executeCommand: <T>(command: string, ...args: unknown[]) =>
      Promise.resolve(vscode.commands.executeCommand<T>(command, ...args)),
    getCommands: () => Promise.resolve(vscode.commands.getCommands(true)),
    writeClipboard: (value: string) =>
      Promise.resolve(vscode.env.clipboard.writeText(value)),
    selectTaskInNativeSearch: (taskTitle: string) =>
      taskSearchNavigator.selectTask(taskTitle),
    showWarning: async (message: string) => {
      await vscode.window.showWarningMessage(message);
    }
  };
  const trae = new TraeAdapter(traeHost, (sessionId) =>
    vscode.Uri.from(createLocalChatSessionUri(sessionId))
  );
  const taskTitles = new TraeTaskMetadataResolver();

  new CommandController(context, service, tree, trae, taskTitles).register();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => tree.refresh())
  );

  output.appendLine(
    `Activated with VS Code API ${vscode.version}; workspace=${currentWorkspace()}`
  );
}

export function deactivate(): void {}

function currentWorkspace(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "none";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
