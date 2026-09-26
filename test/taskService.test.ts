import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createEmptyDocument, type StoreDocument } from "../src/model";
import { type MementoLike, TaskRepository } from "../src/repository";
import { TaskFolderError, TaskService } from "../src/taskService";

class MemoryMemento implements MementoLike {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

function createFixture(): {
  service: TaskService;
  repository: TaskRepository;
} {
  let nextId = 0;
  let timestamp = 0;
  const repository = new TaskRepository(
    new MemoryMemento(),
    new MemoryMemento()
  );
  const service = new TaskService(
    repository,
    () => `id-${++nextId}`,
    () => new Date(timestamp++)
  );
  return { service, repository };
}

describe("TaskService", () => {
  it("creates nested folders and rejects duplicate sibling names", async () => {
    const { service } = createFixture();
    const root = await service.createFolder("workspace", "产品", null);
    await service.createFolder("workspace", "需求", root.id);

    await assert.rejects(
      service.createFolder("workspace", "需求", root.id),
      (error: unknown) =>
        error instanceof TaskFolderError &&
        error.code === "duplicate-folder"
    );
  });

  it("prevents moving a folder into one of its descendants", async () => {
    const { service } = createFixture();
    const parent = await service.createFolder("workspace", "父级", null);
    const child = await service.createFolder(
      "workspace",
      "子级",
      parent.id
    );

    await assert.rejects(
      service.moveFolder(
        { scope: "workspace", folder: parent },
        child.id
      ),
      (error: unknown) =>
        error instanceof TaskFolderError && error.code === "folder-cycle"
    );
  });

  it("deletes descendant folders and their task references", async () => {
    const { service } = createFixture();
    const parent = await service.createFolder("workspace", "父级", null);
    const child = await service.createFolder(
      "workspace",
      "子级",
      parent.id
    );
    await service.addOrMoveTask("workspace", {
      sessionId: "session-1",
      title: "任务一",
      folderId: child.id
    });

    await service.deleteFolder({ scope: "workspace", folder: parent });

    assert.deepEqual(service.getDocument("workspace"), createEmptyDocument());
  });

  it("deduplicates a Session ID and moves its existing record", async () => {
    const { service } = createFixture();
    const first = await service.createFolder("workspace", "待办", null);
    const second = await service.createFolder("workspace", "进行中", null);
    const original = await service.addOrMoveTask("workspace", {
      sessionId: "session-1",
      title: "旧标题",
      folderId: first.id
    });
    const updated = await service.addOrMoveTask("workspace", {
      sessionId: "session-1",
      title: "新标题",
      folderId: second.id
    });

    const document = service.getDocument("workspace");
    assert.equal(document.tasks.length, 1);
    assert.equal(updated.id, original.id);
    assert.equal(updated.folderId, second.id);
    assert.equal(updated.title, "新标题");
  });

  it("moves a task from workspace storage to global storage", async () => {
    const { service } = createFixture();
    const workspaceFolder = await service.createFolder(
      "workspace",
      "项目",
      null
    );
    const globalFolder = await service.createFolder("global", "全局", null);
    const task = await service.addOrMoveTask("workspace", {
      sessionId: "session-1",
      title: "共享任务",
      folderId: workspaceFolder.id,
      workspaceUri: "file:///workspace"
    });

    await service.moveTask(
      { scope: "workspace", task },
      "global",
      globalFolder.id
    );

    assert.equal(service.getDocument("workspace").tasks.length, 0);
    assert.equal(service.getDocument("global").tasks.length, 1);
    assert.equal(
      service.getDocument("global").tasks[0]?.folderId,
      globalFolder.id
    );
  });
});

describe("TaskRepository", () => {
  it("does not overwrite corrupt stored data", () => {
    const workspace = new MemoryMemento();
    const global = new MemoryMemento();
    const corrupt: StoreDocument = {
      version: 1,
      folders: [],
      tasks: []
    };
    void workspace.update("traeTaskFolders.workspace.v1", {
      ...corrupt,
      folders: "invalid"
    });
    let reported = false;
    const repository = new TaskRepository(workspace, global, () => {
      reported = true;
    });

    assert.deepEqual(repository.load("workspace"), createEmptyDocument());
    assert.equal(reported, true);
    assert.equal(
      typeof workspace.get<Record<string, unknown>>(
        "traeTaskFolders.workspace.v1"
      )?.folders,
      "string"
    );
  });
});
