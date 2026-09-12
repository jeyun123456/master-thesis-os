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

Tray menu:

- `Enter Interactive mode`
- `Return to Wallpaper`
- `Refresh`
- `Start with Windows`
- `Open Logs Folder`
- `Exit`

Double-clicking the tray icon toggles Wallpaper / Interactive mode.

`Start with Windows` writes only a current-user startup entry under:

`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

No administrator rights are required.

The host listens for Windows `WM_DISPLAYCHANGE`. While attached to WorkerW it
re-reads the WorkerW client rectangle and resizes the host to match desktop
resolution/topology changes.

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

## v0.2 validation

After building:

```powershell
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper
```

Check:

1. wallpaper attaches behind desktop icons;
2. tray icon appears and all Phase 4 actions still work;
3. Korean native IME remains stable in Interactive mode;
4. launching a second copy does not create a second wallpaper host and raises the existing instance;
5. `Open Logs Folder` opens the local log directory and a daily log file is written;
6. restarting Explorer, if tested, eventually re-attaches the host to a valid WorkerW;
7. `Start with Windows` remains configurable;
8. display-resolution changes still resize the wallpaper correctly;
9. `Exit` removes the tray icon and terminates the host cleanly.

## Deliberately not implemented

- Explorer icon-window re-parenting;
- RawInput keyboard forwarding;
- `SendInput` text injection;
- synthetic keyboard messages;
- custom Korean/Japanese composition;
- a general-purpose Wallpaper Engine;
- explicit per-monitor wallpaper instances / monitor picker.
