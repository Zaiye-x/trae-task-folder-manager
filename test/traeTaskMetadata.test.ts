import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  extractSessionTitles,
  TraeTaskMetadataResolver
} from "../src/traeTaskMetadata";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe("extractSessionTitles", () => {
  it("extracts direct and nested Session ID to title mappings", () => {
    const content = [
      'prefix {"chat_session_id":"session-a","title":"First title","updated_at":10}',
      'prefix {"items":[{"chat_session_id":"session-b","title":"Second title","updated_at":20}]}'
    ].join("\n");

    assert.deepEqual(
      [...extractSessionTitles(content)].map(([sessionId, value]) => [
        sessionId,
        value.title
      ]),
      [
        ["session-a", "First title"],
        ["session-b", "Second title"]
      ]
    );
  });

  it("keeps the latest non-empty title for a Session ID", () => {
    const content = [
      'prefix {"chat_session_id":"session-a","title":"Old","updated_at":10}',
      'prefix {"chat_session_id":"session-a","title":"","updated_at":30}',
      'prefix {"chat_session_id":"session-a","title":"New","updated_at":20}'
    ].join("\n");

    assert.equal(extractSessionTitles(content).get("session-a")?.title, "New");
  });
});

describe("TraeTaskMetadataResolver", () => {
  it("resolves titles from renderer logs across Trae run directories", async () => {
    const userDataRoot = await mkdtemp(
      path.join(os.tmpdir(), "trae-task-metadata-")
    );
    temporaryDirectories.push(userDataRoot);
    const windowDirectory = path.join(
      userDataRoot,
      "logs",
      "20260927T010000",
      "window1"
    );
    await mkdir(windowDirectory, { recursive: true });
    await writeFile(
      path.join(windowDirectory, "renderer.log"),
      'prefix {"chat_session_id":"session-a","title":"Recovered title","updated_at":20}\n'
    );

    const resolver = new TraeTaskMetadataResolver(userDataRoot);

    assert.equal(await resolver.resolveTitle("session-a"), "Recovered title");
    assert.equal(await resolver.resolveTitle("missing-session"), undefined);
  });
});
