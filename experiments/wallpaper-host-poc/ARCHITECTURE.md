# Wallpaper Companion architecture

This document describes the supported runtime boundaries for Master Thesis OS Wallpaper Companion. The implementation is intentionally small and Windows-specific; the source directory and project filename retain their historical repository paths for compatibility, while the assembly and installed product use the formal `MasterThesisOSWallpaper` identity.

## Runtime topology

There is exactly one process, one WPF host HWND, and one WebView2 instance. A single selected display is the target even when several displays are connected. The same host moves between two window states:

| State | Host HWND | WebView2 input |
| --- | --- | --- |
| Wallpaper | child of the selected WorkerW | inactive; no focus forcing |
| Open | ordinary top-level window on the selected display | normal Windows/WPF/WebView2 path |

Explorer's `SHELLDLL_DefView` and `SysListView32` windows belong to Explorer. They are never re-parented, hidden, resized, or otherwise manipulated by this application. They are used only while discovering a WorkerW and while checking whether a desktop click is on an icon.

## Wallpaper attachment and recovery

The attachment service discovers the shell's wallpaper WorkerW, saves the host's original parent and styles, and attaches only the companion HWND. The selected display's screen bounds are converted to WorkerW client coordinates, including negative monitor coordinates. The recovery timer checks the saved WorkerW relationship and re-attaches only the companion if Explorer recreates the shell surface. Failed recovery attempts use a bounded backoff so an Explorer restart does not cause repeated expensive discovery calls.

If attachment or target-display resolution fails, the application remains a normal top-level WPF window. It does not guess at another Explorer window.

## Open and return flow

Open can be requested by the tray, the Ctrl+Alt+W registered hotkey, a second launch signal, or click-to-interact. The existing host is detached, its normal top-level styles are restored, and it is placed on the selected display.

`Esc` and the normal return commands attach that same HWND back to WorkerW. When enabled, losing foreground focus in Open state starts a roughly 1.5 second timer. The timer cancels when this application becomes active again and defers for common Windows IME helper processes so candidate/composition UI is not mistaken for an application switch.

## Click-to-interact

When enabled, the mouse-only low-level hook examines left-button events. It captures a click only if all of the following are true:

1. the host is attached to WorkerW;
2. the point is inside the selected display;
3. `WindowFromPoint` identifies the selected Explorer desktop surface rather than an application or taskbar; and
4. Explorer's desktop `SysListView32` returns no item from `LVM_HITTEST`.

The desktop surface and icon windows are checked against their expected parent and Explorer owner process. An icon hit-test failure is fail-closed: the hook leaves the original click alone. It never falls back to capturing an uncertain icon click. For a verified empty desktop click, the original left down/up is suppressed, the host enters Open state, and exactly one mouse left-click is replayed after activation. The replay is cancelled if the cursor moved, foreground ownership changed, or the captured click is older than two seconds. The replayed event is ignored by the hook using `LLMHF_INJECTED`.

This replay is mouse-only. Keyboard input and IME composition are never synthesized by the application.

## Native keyboard and IME policy

Open state deliberately uses the normal top-level WPF/WebView2 input path. Windows owns Korean and Japanese IME composition, conversion, and candidate windows. No DOM focus probe or focus bridge is installed at runtime.

### DO NOT

- synthesize keyboard input;
- use keyboard `SendInput`;
- forward keyboard through RawInput;
- post synthetic `WM_KEYDOWN` or `WM_KEYUP` messages;
- add a custom Hangul/Japanese composer;
- repeatedly call `MoveFocus` or `Keyboard.Focus`;
- poll or probe DOM focus to repair native focus;
- re-parent or hide Explorer icon windows;
- create a process or WebView2 instance per monitor.

The retired focus experiment and its failure rationale are kept in [`docs/history/NativeImeFocusBridge.md`](docs/history/NativeImeFocusBridge.md).

## Display, settings, and single instance

`DisplayManager` enumerates connected screens and persists one Windows device name such as `\\.\DISPLAY2`. If that device disappears, the primary display is used as a safe fallback. `WallpaperSettings` stores the selected display, auto-return preference, and click-to-interact preference under `%LOCALAPPDATA%\MasterThesisOSWallpaper\settings.json`. Missing `ClickToInteractEnabled` values use the current default; an explicit `false` is preserved. Invalid JSON is moved to a timestamped `.corrupt-*.json` backup before defaults are used, so a recovery write does not erase the original evidence.

`SingleInstanceGuard` uses one per-user identity and signals the existing process on a second launch. This prevents duplicate WorkerW hosts and duplicate WebView2 instances.

## Installation and update layout

The replaceable binaries live at:

`%LOCALAPPDATA%\MasterThesisOSWallpaper\app\MasterThesisOSWallpaper.exe`

Settings and `logs\` remain beside, not inside, the app directory. The publish and install scripts preserve those files, update an existing startup command to the stable installed executable, and recreate Start Menu shortcuts. The uninstaller removes the app and shortcuts while preserving data unless `-PurgeData` is explicitly supplied.

## Maintainer validation

From this directory:

```powershell
dotnet restore
dotnet build -c Debug
powershell -ExecutionPolicy Bypass -File .\scripts\Publish-Release.ps1
```

Runtime checks should verify one process, one WebView2, selected-display-only placement, WorkerW recovery, tray and hotkey transitions, native Korean/Japanese IME input, and fail-closed icon protection. Desktop icon, taskbar, other-app, and IME candidate-window checks require a human using the actual Windows shell.
