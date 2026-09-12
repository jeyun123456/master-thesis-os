# Master Thesis OS Wallpaper Host PoC

Windows-only WPF + Microsoft Edge WebView2 host for the production Master Thesis OS.

Path:

`master-thesis-os/experiments/wallpaper-host-poc/`

The PoC is isolated from the Next.js production app, Local Bridge, and Sucrose.

## Current behavior

### Phase 1 — normal WPF/WebView2

```powershell
dotnet run --project .\WallpaperHostPoc.csproj
```

Loads:

`https://master-thesis-os.vercel.app/`

Verified design goal:

- normal mouse input;
- native English keyboard input;
- Windows native Korean/Japanese IME path;
- no RawInput forwarding;
- no `SendInput`;
- no synthetic key-message injection;
- no custom Hangul/Japanese composer.

### Phase 2/3 — wallpaper + interactive mode

```powershell
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper
```

The host attaches only its own WPF HWND to the wallpaper WorkerW. Explorer's
`SHELLDLL_DefView` and desktop icon windows are never re-parented.

While attached to WorkerW, the web app is visible behind desktop icons. The
icon layer receives desktop mouse input first, so direct web interaction is not
attempted there.

Press `Ctrl + Alt + W` to switch between:

- **Wallpaper mode** — host is attached behind desktop icons;
- **Interactive mode** — host returns to a normal top-level WebView2 window so
  native mouse/focus/IME works through the normal Windows/WebView2 path.

The abandoned DOM/native focus bridge is intentionally not installed because
repeated forced focus can break IME composition.

For a WorkerW-only baseline:

```powershell
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper --phase2-only
```

## Phase 4 — tray, refresh, startup, display changes

Wallpaper mode creates a notification-area icon.

Tray menu includes:

- `Enter Interactive mode`
- `Return to Wallpaper`
- `Refresh`
- `Display`
- `Start with Windows`
- `Open Logs Folder`
- `Exit`

Double-clicking the tray icon toggles Wallpaper / Interactive mode.

`Start with Windows` writes only a current-user startup entry under:

`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

No administrator rights are required.

The host listens for Windows `WM_DISPLAYCHANGE` and re-applies its target-display
bounds after resolution/topology changes.

## Phase 5 / v0.2 — runtime hardening

### Single instance

A named per-user mutex prevents multiple wallpaper hosts from running at once.
Launching the host again signals the existing instance instead of creating a
second WorkerW host. The primary instance responds by entering/raising
Interactive mode.

### WorkerW health recovery

While in Wallpaper mode the host checks the WorkerW attachment every five
seconds. If Explorer restarts, the WorkerW is replaced, or the host loses its
expected parent, the host searches for a replacement WorkerW and re-attaches
only its own HWND. Explorer icon windows remain untouched.

### Runtime logs

Operational and error logs are stored under:

`%LOCALAPPDATA%\MasterThesisOSWallpaper\logs\`

The tray menu can open that folder directly. Logging is best-effort and is not
allowed to block application startup or hide unhandled failures.

## Phase 6 / v0.3 — choose exactly one display

The wallpaper host still runs as one process and one WebView2 instance. Even if
Windows has multiple monitors connected, Master Thesis OS is shown on exactly
one selected display.

Use the tray `Display` submenu to choose the target monitor. The menu follows
Windows `DISPLAY1`, `DISPLAY2`, ... numbering and allows only one selected item.

The selection is persisted in:

`%LOCALAPPDATA%\MasterThesisOSWallpaper\settings.json`

Behavior:

- Wallpaper mode occupies only the selected display;
- Interactive mode opens full-screen only on that same display;
- changing the selected display moves the current host immediately;
- display coordinates are converted from screen coordinates into WorkerW client
  coordinates before positioning, so left/negative-coordinate monitor layouts
  are supported;
- if the saved display is disconnected, the host falls back to the Windows
  primary display and persists that fallback;
- no additional wallpaper process or per-monitor WebView is created.

## Build

Requirements:

- Windows 10/11
- .NET 8 SDK
- Microsoft Edge WebView2 Runtime

```powershell
cd master-thesis-os\experiments\wallpaper-host-poc
dotnet restore
dotnet build -c Debug
```

## v0.3 validation

After building:

```powershell
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper
```

Check:

1. tray `Display` lists every connected monitor once;
2. exactly one display is checked;
3. selecting another display moves Wallpaper mode to only that display;
4. `Ctrl+Alt+W` opens Interactive mode on the selected display only;
5. Korean native IME remains stable;
6. switching the display while Interactive mode is active moves the top-level host;
7. restarting the app restores the selected display from `settings.json`;
8. disconnecting the selected display falls back to the Windows primary display;
9. single-instance, tray, refresh, startup, logging, and WorkerW recovery still work;
10. `Exit` terminates the one wallpaper host cleanly.

## Deliberately not implemented

- Explorer icon-window re-parenting;
- RawInput keyboard forwarding;
- `SendInput` text injection;
- synthetic keyboard messages;
- custom Korean/Japanese composition;
- a general-purpose Wallpaper Engine;
- multiple simultaneous wallpaper instances across displays.
