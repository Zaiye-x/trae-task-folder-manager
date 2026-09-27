import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCESSIBILITY_SCRIPT,
  MacOsTaskSearchNavigator
} from "../src/macOsTaskSearchNavigator";

describe("MacOsTaskSearchNavigator", () => {
  it("selects an exact task title through macOS accessibility", async () => {
    const titles: string[] = [];
    const navigator = new MacOsTaskSearchNavigator(
      "darwin",
      async (title) => {
        titles.push(title);
        return "clicked";
      }
    );

    assert.equal(await navigator.selectTask("  Target task  "), "selected");
    assert.deepEqual(titles, ["Target task"]);
  });

  it("does not run accessibility automation on other platforms", async () => {
    let called = false;
    const navigator = new MacOsTaskSearchNavigator("linux", async () => {
      called = true;
      return "clicked";
    });

    assert.equal(await navigator.selectTask("Target task"), "unsupported");
    assert.equal(called, false);
  });

  it("reports a missing exact title without clicking", async () => {
    const navigator = new MacOsTaskSearchNavigator(
      "darwin",
      async () => "matches:0"
    );

    assert.equal(await navigator.selectTask("Target task"), "not-found");
  });

  it("reports when the search was filled but not submitted", async () => {
    const navigator = new MacOsTaskSearchNavigator(
      "darwin",
      async () => "search-filled"
    );

    assert.equal(await navigator.selectTask("Target task"), "filled");
  });

  it("reports denied accessibility permission", async () => {
    const navigator = new MacOsTaskSearchNavigator("darwin", async () => {
      throw new Error("osascript not allowed assistive access (-25211)");
    });

    assert.equal(
      await navigator.selectTask("Target task"),
      "permission-denied"
    );
  });

  it("targets the installed Trae app and fills the focused search field", () => {
    assert.match(
      ACCESSIBILITY_SCRIPT,
      /bundle identifier is "cn\.trae\.app"/
    );
    assert.match(ACCESSIBILITY_SCRIPT, /role of candidate is "AXTextField"/);
    assert.match(
      ACCESSIBILITY_SCRIPT,
      /keystroke "v" using command down/
    );
    assert.match(ACCESSIBILITY_SCRIPT, /keystroke return/);
  });
});
