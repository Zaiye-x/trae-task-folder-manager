# Changelog

## 0.1.6

- Paste the registered task title into TRAE's focused native search field.
- Detect the macOS TRAE process by bundle identifier instead of a stale process name.
- Submit the exact filtered result automatically and verify the resulting Session ID.

## 0.1.5

- Open the native Trae chat container before focusing the current SOLO task.
- Keep macOS accessibility selection for cross-session navigation.

## 0.1.4

- On macOS, use accessibility automation to select an exact native task-search result.
- Verify the resulting Session ID and retain the manual fallback when permission or matching fails.

## 0.1.3

- Focus the native SOLO conversation view before opening a registered task.
- Keep Session ID verification and native-search fallback for cross-task navigation.

## 0.1.2

- Add the current SOLO task immediately after choosing a folder.
- Recover native task titles from local Trae renderer logs by Session ID.
- Use a stable unnamed-task label when a title is not yet available.

## 0.1.1

- Require a readable task title instead of generating a Session ID label.
- Hide Session IDs from the task tree.
- Verify that a direct-open command actually changed the active SOLO session.
- Fall back to TRAE task search with the task title copied to the clipboard.

## 0.1.0

- Add workspace and global task folders.
- Add nested folder management and drag-and-drop.
- Add current SOLO task registration.
- Add task creation and opening through the TraeCode compatibility adapter.
