export const TRAE_COMMANDS = {
  createTask: "workbench.action.icube.aiChatSidebar.createNewSession",
  currentSessionId: "icube.chat.getCurrentSessionId",
  openSession: "workbench.action.chat.openSessionInSidebar",
  globalSearch: "workbench.action.icube.aiChatSidebar.globalSearch",
  showHistory: "workbench.action.icube.aiChatSidebar.showHistory"
} as const;

export type TraeCommandName = keyof typeof TRAE_COMMANDS;

export interface TraeHost {
  executeCommand<T>(command: string, ...args: unknown[]): Promise<T>;
  getCommands(): Promise<string[]>;
  writeClipboard(value: string): Promise<void>;
  showWarning(message: string): Promise<void>;
}

export interface TraeCapabilities {
  createTask: boolean;
  currentSessionId: boolean;
  openSession: boolean;
  globalSearch: boolean;
  showHistory: boolean;
}

export type OpenTaskResult = "opened" | "search-fallback";

export class TraeCompatibilityError extends Error {
  constructor(
    readonly command: TraeCommandName,
    message: string
  ) {
    super(message);
    this.name = "TraeCompatibilityError";
  }
}

export class TraeAdapter {
  constructor(
    private readonly host: TraeHost,
    private readonly createSessionResource: (sessionId: string) => unknown,
    private readonly delay: (milliseconds: number) => Promise<void> = (
      milliseconds
    ) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly openVerificationAttempts = 8
  ) {}

  async getCapabilities(): Promise<TraeCapabilities> {
    const commands = new Set(await this.host.getCommands());
    return {
      createTask: commands.has(TRAE_COMMANDS.createTask),
      currentSessionId: commands.has(TRAE_COMMANDS.currentSessionId),
      openSession: commands.has(TRAE_COMMANDS.openSession),
      globalSearch: commands.has(TRAE_COMMANDS.globalSearch),
      showHistory: commands.has(TRAE_COMMANDS.showHistory)
    };
  }

  async getCurrentSessionId(): Promise<string> {
    let sessionId: unknown;
    try {
      sessionId = await this.host.executeCommand<unknown>(
        TRAE_COMMANDS.currentSessionId
      );
    } catch (error) {
      throw new TraeCompatibilityError(
        "currentSessionId",
        `无法读取当前 SOLO 任务：${errorMessage(error)}`
      );
    }

    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new TraeCompatibilityError(
        "currentSessionId",
        "当前没有可登记的 SOLO 任务，请先打开或创建一个任务。"
      );
    }
    return sessionId;
  }

  async createTaskAndGetSessionId(
    timeoutMilliseconds = 6_000
  ): Promise<string> {
    const previousSessionId = await this.tryGetCurrentSessionId();

    try {
      await this.host.executeCommand<void>(TRAE_COMMANDS.createTask);
    } catch (error) {
      throw new TraeCompatibilityError(
        "createTask",
        `TraeCode 未能创建新任务：${errorMessage(error)}`
      );
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMilliseconds) {
      const sessionId = await this.tryGetCurrentSessionId();
      if (sessionId && sessionId !== previousSessionId) {
        return sessionId;
      }
      await this.delay(150);
    }

    throw new TraeCompatibilityError(
      "currentSessionId",
      "新任务已经触发，但未能取得新的 Session ID。请在任务中发送第一条消息后使用“将当前任务加入文件夹”。"
    );
  }

  async openTask(
    sessionId: string,
    taskTitle: string
  ): Promise<OpenTaskResult> {
    if ((await this.tryGetCurrentSessionId()) === sessionId) {
      return "opened";
    }

    const resource = this.createSessionResource(sessionId);
    try {
      await this.host.executeCommand<void>(TRAE_COMMANDS.openSession, {
        session: { resource }
      });
      if (await this.waitForSession(sessionId)) {
        return "opened";
      }
    } catch {
      // Continue to the verified native-search fallback.
    }

    const searchText = taskTitle.trim() || sessionId;
    await this.host.writeClipboard(searchText);
    try {
      await this.host.executeCommand<void>(TRAE_COMMANDS.globalSearch, {
        entryType: "plugin"
      });
    } catch {
      try {
        await this.host.executeCommand<void>(TRAE_COMMANDS.showHistory);
      } catch {
        // The copied title still gives the user a recovery path.
      }
    }
    await this.host.showWarning(
      `TraeCode 未开放按 Session ID 直接切换的接口。已打开任务搜索并复制“${searchText}”，请粘贴后选择对应任务。`
    );
    return "search-fallback";
  }

  private async waitForSession(sessionId: string): Promise<boolean> {
    for (let attempt = 0; attempt < this.openVerificationAttempts; attempt++) {
      if ((await this.tryGetCurrentSessionId()) === sessionId) {
        return true;
      }
      await this.delay(120);
    }
    return false;
  }

  private async tryGetCurrentSessionId(): Promise<string | undefined> {
    try {
      const sessionId = await this.host.executeCommand<unknown>(
        TRAE_COMMANDS.currentSessionId
      );
      return typeof sessionId === "string" && sessionId.trim().length > 0
        ? sessionId
        : undefined;
    } catch {
      return undefined;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
