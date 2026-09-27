import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface SessionTitleRecord {
  title: string;
  updatedAt: number;
  sequence: number;
}

export interface TaskTitleResolver {
  resolveTitle(sessionId: string): Promise<string | undefined>;
}

export class TraeTaskMetadataResolver implements TaskTitleResolver {
  private cache:
    | { expiresAt: number; titles: Map<string, SessionTitleRecord> }
    | undefined;

  constructor(
    private readonly userDataRoot = defaultTraeUserDataRoot(),
    private readonly cacheMilliseconds = 5_000
  ) {}

  async resolveTitle(sessionId: string): Promise<string | undefined> {
    const titles = await this.loadTitles();
    return titles.get(sessionId)?.title;
  }

  private async loadTitles(): Promise<Map<string, SessionTitleRecord>> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.titles;
    }

    const titles = new Map<string, SessionTitleRecord>();
    const files = await findRendererLogFiles(
      path.join(this.userDataRoot, "logs")
    );
    for (const file of files) {
      let content: string;
      try {
        content = await fs.readFile(file.path, "utf8");
      } catch {
        continue;
      }
      for (const [sessionId, candidate] of extractSessionTitles(content)) {
        const existing = titles.get(sessionId);
        if (
          !existing ||
          candidate.updatedAt > existing.updatedAt ||
          candidate.updatedAt === existing.updatedAt
        ) {
          titles.set(sessionId, candidate);
        }
      }
    }

    this.cache = {
      expiresAt: Date.now() + this.cacheMilliseconds,
      titles
    };
    return titles;
  }
}

export function extractSessionTitles(
  content: string
): Map<string, SessionTitleRecord> {
  const titles = new Map<string, SessionTitleRecord>();
  let sequence = 0;

  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    const sessionId = record.chat_session_id;
    const title = record.title;
    if (
      typeof sessionId === "string" &&
      typeof title === "string" &&
      title.trim()
    ) {
      sequence += 1;
      const updatedAt = numericTimestamp(
        record.updated_at ?? record.updatedAt
      );
      const candidate = {
        title: title.trim(),
        updatedAt,
        sequence
      };
      const existing = titles.get(sessionId);
      if (
        !existing ||
        candidate.updatedAt > existing.updatedAt ||
        (candidate.updatedAt === existing.updatedAt &&
          candidate.sequence > existing.sequence)
      ) {
        titles.set(sessionId, candidate);
      }
    }

    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") {
        visit(nested);
      }
    }
  };

  for (const line of content.split(/\r?\n/)) {
    if (
      !line.includes('"chat_session_id"') ||
      !line.includes('"title"')
    ) {
      continue;
    }
    const jsonStart = line.indexOf("{");
    if (jsonStart < 0) {
      continue;
    }
    try {
      visit(JSON.parse(line.slice(jsonStart)));
    } catch {
      // Renderer logs can contain unrelated non-JSON lines.
    }
  }

  return titles;
}

function defaultTraeUserDataRoot(): string {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Trae CN"
    );
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      "Trae CN"
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "Trae CN"
  );
}

async function findRendererLogFiles(
  logsRoot: string
): Promise<Array<{ path: string; modifiedAt: number }>> {
  const files: Array<{ path: string; modifiedAt: number }> = [];
  for (const run of await readDirectories(logsRoot)) {
    const runPath = path.join(logsRoot, run);
    for (const window of await readDirectories(runPath)) {
      if (!window.startsWith("window")) {
        continue;
      }
      const windowPath = path.join(runPath, window);
      let entries: Dirent<string>[];
      try {
        entries = await fs.readdir(windowPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (
          !entry.isFile() ||
          !/^renderer(?:\.\d+)?\.log$/.test(entry.name)
        ) {
          continue;
        }
        const filePath = path.join(windowPath, entry.name);
        try {
          files.push({
            path: filePath,
            modifiedAt: (await fs.stat(filePath)).mtimeMs
          });
        } catch {
          // The log may rotate between readdir and stat.
        }
      }
    }
  }
  files.sort((left, right) => left.modifiedAt - right.modifiedAt);
  return files;
}

async function readDirectories(parent: string): Promise<string[]> {
  try {
    return (await fs.readdir(parent, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function numericTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
