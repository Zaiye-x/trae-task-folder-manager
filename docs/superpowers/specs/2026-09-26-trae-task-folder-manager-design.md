# Trae Task Folder Manager Design

## Goal

Build an installable TraeCode extension that organizes SOLO tasks into folders without reading or modifying TraeCode's private databases.

The extension must support:

- nested folders;
- creating a SOLO task from a selected folder;
- adding the current SOLO task to a folder;
- moving, renaming, sorting, and removing task references;
- workspace-scoped folders plus a global root;
- graceful degradation when an internal TraeCode command is unavailable.

## Product Boundary

TraeCode 3.3.104 renders the native SOLO task panel through the private `icube-modules-ai-task-panel-v2` component. Standard VS Code extensions cannot inject tree nodes into that component.

The extension therefore provides its own Tree View and uses a narrow compatibility adapter for available TraeCode commands. Folder data belongs to this extension. SOLO conversations remain owned by TraeCode.

## Architecture

### Extension entry point

Registers the Tree View, commands, context menus, storage repositories, and compatibility diagnostics.

### TaskTreeProvider

Maps folder and task records to native `TreeItem` instances. It supports nested folders, context menus, refresh, and drag-and-drop task movement.

### TaskService

Owns validation and mutations:

- create, rename, and delete folders;
- add or move a task;
- remove a task reference without deleting the SOLO conversation;
- enforce unique sibling folder names;
- prevent moving a folder into itself or its descendants.

### TaskRepository

Persists versioned JSON documents:

- workspace records in `ExtensionContext.workspaceState`;
- global records in `ExtensionContext.globalState`.

The repository writes complete snapshots through VS Code's `Memento.update` API and never accesses TraeCode's internal storage.

### TraeAdapter

Contains all version-sensitive integration:

- create a SOLO task with `workbench.action.icube.aiChatSidebar.createNewSession`;
- read the active Session ID with `icube.chat.getCurrentSessionId`;
- attempt to open a stored session through the local chat-session URI;
- fall back to copying the Session ID and opening the history panel.

No other module may call private TraeCode commands directly.

## Data Model

Both workspace and global stores use:

```ts
interface StoreDocument {
  version: 1;
  folders: FolderRecord[];
  tasks: TaskRecord[];
}

interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt: string;
}

interface TaskRecord {
  id: string;
  sessionId: string;
  title: string;
  folderId: string | null;
  order: number;
  workspaceUri?: string;
  createdAt: string;
  updatedAt: string;
}
```

A Session ID is unique inside one store. Adding it again moves and updates the existing task reference.

## User Flows

### Create a folder

The user invokes `New Folder` at a root or folder node. The extension validates the name, persists the folder, refreshes the tree, and reveals the new node.

### Create a task in a folder

The extension records the current Session ID, invokes TraeCode's new-task command, polls for a changed Session ID, asks for a title, and stores the task under the selected folder. Cancellation or timeout does not create a stale record.

### Add the current task

The extension reads the current Session ID, asks for a title when the task is unknown, and adds or moves it to the selected folder.

### Open a task

The adapter first attempts direct navigation with a reconstructed local chat-session URI. If the command is missing or fails, it copies the Session ID and opens TraeCode's history view with an explanatory notification.

## Error Handling

- Missing workspace: workspace commands explain that a folder must be opened first.
- Missing internal command: the adapter returns a typed unsupported result.
- Session capture timeout: no task record is written.
- Duplicate task: move the existing record instead of creating a duplicate.
- Corrupt stored data: preserve the raw value, load an empty in-memory document, and report an actionable error.
- TraeCode upgrade: a diagnostics command reports which integration commands are available.

## Testing

- Unit tests cover folder validation, recursive deletion, cycle prevention, task deduplication, and movement.
- Adapter tests mock `vscode.commands.executeCommand`.
- Repository tests use an in-memory `Memento`.
- Packaging validation checks the VSIX contents.
- Manual smoke testing covers installation, activation, folder creation, current-task capture, new-task creation, movement, and fallback opening in TraeCode.

## Packaging And Installation

The project uses TypeScript, esbuild, Node's built-in test runner, and `@vscode/vsce`.

Build output is packaged as a local `.vsix`. Installation uses TraeCode's Extensions panel:

1. Open Extensions.
2. Choose `...` > `Install from VSIX`.
3. Select the generated package.
4. Reload TraeCode.

The extension targets the VS Code API level bundled with TraeCode while keeping all Trae-specific behavior behind `TraeAdapter`.
