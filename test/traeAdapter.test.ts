import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLocalChatSessionUri } from "../src/sessionResource";
import {
  TraeAdapter,
  type TraeHost,
  TRAE_COMMANDS
} from "../src/traeAdapter";

class FakeHost implements TraeHost {
  readonly calls: Array<{ command: string; args: unknown[] }> = [];
  readonly clipboard: string[] = [];
  readonly warnings: string[] = [];
  commands = Object.values(TRAE_COMMANDS);
  currentSessionIds: Array<string | undefined> = [];
  failOpen = false;

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

  it("opens a task using a local chat-session resource", async () => {
    const host = new FakeHost();
    const adapter = new TraeAdapter(host, createLocalChatSessionUri);

    const result = await adapter.openTask("session-123");

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

  it("falls back to history and clipboard when direct opening fails", async () => {
    const host = new FakeHost();
    host.failOpen = true;
    const adapter = new TraeAdapter(host, createLocalChatSessionUri);

    const result = await adapter.openTask("session-123");

    assert.equal(result, "history-fallback");
    assert.deepEqual(host.clipboard, ["session-123"]);
    assert.equal(
      host.calls.some((call) => call.command === TRAE_COMMANDS.showHistory),
      true
    );
    assert.equal(host.warnings.length, 1);
  });

  it("reports the currently available TraeCode commands", async () => {
    const host = new FakeHost();
    host.commands = [
      TRAE_COMMANDS.currentSessionId,
      TRAE_COMMANDS.showHistory
    ];
    const adapter = new TraeAdapter(host, createLocalChatSessionUri);

    assert.deepEqual(await adapter.getCapabilities(), {
      createTask: false,
      currentSessionId: true,
      openSession: false,
      showHistory: true
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
