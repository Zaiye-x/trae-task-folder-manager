import { execFile } from "node:child_process";

export type NativeTaskSearchSelection =
  | "selected"
  | "filled"
  | "unsupported"
  | "permission-denied"
  | "not-found"
  | "failed";

export type AccessibilityScriptRunner = (
  taskTitle: string
) => Promise<string>;

export class MacOsTaskSearchNavigator {
  constructor(
    private readonly platform = process.platform,
    private readonly runScript: AccessibilityScriptRunner =
      runAccessibilityScript
  ) {}

  async selectTask(
    taskTitle: string
  ): Promise<NativeTaskSearchSelection> {
    const title = taskTitle.trim();
    if (this.platform !== "darwin") {
      return "unsupported";
    }
    if (!title) {
      return "not-found";
    }

    try {
      const result = (await this.runScript(title)).trim();
      if (
        result === "pressed" ||
        result === "clicked" ||
        result === "submitted"
      ) {
        return "selected";
      }
      if (result === "search-filled") {
        return "filled";
      }
      if (result === "matches:0") {
        return "not-found";
      }
      return "failed";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return /-25211|not allowed assistive access|不允许辅助访问/i.test(
        message
      )
        ? "permission-denied"
        : "failed";
    }
  }
}

export const ACCESSIBILITY_SCRIPT = `
on run argv
  set targetTitle to item 1 of argv
  tell application "System Events"
    set matchingProcesses to every application process whose bundle identifier is "cn.trae.app"
    if (count of matchingProcesses) is 0 then return "process-not-found"
    set traeProcess to item 1 of matchingProcesses
    tell traeProcess
      set frontmost to true
      if not (exists front window) then return "window-not-found"
      set searchField to missing value
      repeat 20 times
        repeat with candidate in (entire contents of front window)
          try
            if role of candidate is "AXTextField" then
              set searchField to candidate
              exit repeat
            end if
          end try
        end repeat
        if searchField is not missing value then exit repeat
        delay 0.1
      end repeat

      if searchField is missing value then return "search-field-not-found"

      set focused of searchField to true
      keystroke "a" using command down
      keystroke "v" using command down

      set searchWasFilled to false
      repeat 20 times
        try
          if value of searchField is targetTitle then set searchWasFilled to true
        end try
        if searchWasFilled then exit repeat
        delay 0.1
      end repeat
      if not searchWasFilled then return "search-field-not-filled"

      delay 0.6
      keystroke return
      return "submitted"
    end tell
  end tell
end run
`;

function runAccessibilityScript(taskTitle: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      ["-e", ACCESSIBILITY_SCRIPT, taskTitle],
      { timeout: 8_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              [error.message, stderr.trim()].filter(Boolean).join("\n")
            )
          );
          return;
        }
        resolve(stdout);
      }
    );
  });
}
