import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NativeTaskSearchSelection } from "../src/macOsTaskSearchNavigator";
import { createLocalChatSessionUri } from "../src/sessionResource";
import {
  TraeAdapter,
  type TraeHost,
  TRAE_COMMANDS
} from "../src/traeAdapter";

class FakeHost implements TraeHost {
  readonly calls: Array<{ command: string; args: unknown[] }> = [];
  readonly clipboard: string[] = [];
  readonly searchSelections: string[] = [];
  readonly warnings: string[] = [];
  commands = Object.values(TRAE_COMMANDS);
  currentSessionIds: Array<string | undefined> = [];
  failOpen = false;
  searchSelection: NativeTaskSearchSelection = "unsupported";

  async executeCommand<T>(
    command: string,
    ...args: unknown[]
  ): Promise<T> {
    this.calls.push({ command, args });
    if (command === TRAE_COMMANDS.currentSessionId) {
      return this.currentSessionIds.shift() as T;
    }
    if (command === TRAE_COMMANDS.openSession && this.failOpen) {
      throw new Error("unsupported");
    }
    return undefined as T;
  }

  async getCommands(): Promise<string[]> {
    return this.commands;
  }

  async writeClipboard(value: string): Promise<void> {
    this.clipboard.push(value);
  }

  async selectTaskInNativeSearch(
    taskTitle: string
  ): Promise<NativeTaskSearchSelection> {
    this.searchSelections.push(taskTitle);
    return this.searchSelection;
  }

  async showWarning(message: string): Promise<void> {
    this.warnings.push(message);
  }
}

describe("TraeAdapter", () => {
  it("captures a changed Session ID after creating a task", async () => {
    const host = new FakeHost();
    host.currentSessionIds.push("old-session", "new-session");
    const adapter = new TraeAdapter(
      host,
      (sessionId) => ({ sessionId }),
      async () => undefined
    );

    const sessionId = await adapter.createTaskAndGetSessionId();

    assert.equal(sessionId, "new-session");
    assert.equal(
      host.calls.some((call) => call.command === TRAE_COMMANDS.createTask),
      true
    );
  });

  it("opens and focuses the native SOLO view when the target is already current", async () => {
    const host = new FakeHost();
    host.currentSessionIds.push("session-123");
    const adapter = new TraeAdapter(host, createLocalChatSessionUri);

    const result = await adapter.openTask("session-123", "目标任务");

    assert.equal(result, "opened");
    assert.equal(
      host.calls.some(
        (call) =>
          call.command === TRAE_COMMANDS.openChatView &&
          JSON.stringify(call.args) === JSON.stringify([{ keepOpen: true }])
      ),
      true
    );
    assert.equal(
      host.calls.some(
        (call) => call.command === TRAE_COMMANDS.focusChatView
      ),
      true
    );
    assert.equal(
      host.calls.some((call) => call.command === TRAE_COMMANDS.openSession),
      false
    );
  });

  it("opens a task using a local chat-session resource", async () => {
    const host = new FakeHost();
    host.currentSessionIds.push("current-session", "session-123");
    const adapter = new TraeAdapter(
      host,
      createLocalChatSessionUri,
      async () => undefined,
      1
    );

    const result = await adapter.openTask("session-123", "目标任务");

    assert.equal(result, "opened");
    const openCall = host.calls.find(
      (call) => call.command === TRAE_COMMANDS.openSession
    );
    assert.deepEqual(openCall?.args, [
      {
        session: {
          resource: createLocalChatSessionUri("session-123")
        }
      }
    ]);
  });

  it("falls back when the open command reports success without switching", async () => {
    const host = new FakeHost();
    host.currentSessionIds.push("current-session", "current-session");
    const adapter = new TraeAdapter(
      host,
      createLocalChatSessionUri,
      async () => undefined,
      1
    );

    const result = await adapter.openTask("session-123", "目标任务");

    assert.equal(result, "search-fallback");
    assert.deepEqual(host.clipboard, ["目标任务"]);
    assert.equal(
      host.calls.some((call) => call.command === TRAE_COMMANDS.globalSearch),
      true
    );
    const globalSearchIndex = host.calls.findIndex(
      (call) => call.command === TRAE_COMMANDS.globalSearch
    );
    const selectAllIndex = host.calls.findIndex(
      (call) => call.command === TRAE_COMMANDS.selectAll
    );
    const pasteIndex = host.calls.findIndex(
      (call) => call.command === TRAE_COMMANDS.paste
    );
    assert.ok(globalSearchIndex >= 0);
    assert.ok(selectAllIndex > globalSearchIndex);
    assert.ok(pasteIndex > selectAllIndex);
    assert.equal(host.warnings.length, 1);
    assert.match(
      host.warnings[0] ?? "",
      /已将“目标任务”填入任务搜索框/
    );
  });

  it("verifies a Session switch after accessibility selects the search result", async () => {
    const host = new FakeHost();
    host.searchSelection = "selected";
    host.currentSessionIds.push(
      "current-session",
      "current-session",
      "session-123"
    );
    const adapter = new TraeAdapter(
      host,
      createLocalChatSessionUri,
      async () => undefined,
      1
    );

    const result = await adapter.openTask("session-123", "目标任务");

    assert.equal(result, "opened");
    assert.deepEqual(host.searchSelections, ["目标任务"]);
    assert.equal(host.warnings.length, 0);
  });

  it("reports the currently available TraeCode commands", async () => {
    const host = new FakeHost();
    host.commands = [
      TRAE_COMMANDS.currentSessionId,
      TRAE_COMMANDS.globalSearch
    ];
    const adapter = new TraeAdapter(host, createLocalChatSessionUri);

    assert.deepEqual(await adapter.getCapabilities(), {
      createTask: false,
      currentSessionId: true,
      openSession: false,
      globalSearch: true,
      showHistory: false,
      openChatView: false,
      focusChatView: false,
      selectAll: false,
      paste: false
    });
  });
});

describe("createLocalChatSessionUri", () => {
  it("uses TraeCode's local session URI format", () => {
    const uri = createLocalChatSessionUri("会话/session-1");
    assert.equal(uri.scheme, "vscode-chat-session");
    assert.equal(uri.authority, "local");
    assert.equal(
      Buffer.from(uri.path.slice(1), "base64url").toString("utf8"),
      "会话/session-1"
    );
  });
});
