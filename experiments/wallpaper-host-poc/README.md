# Master Thesis OS Wallpaper Host

Windows-only WPF + Microsoft Edge WebView2 companion for the production Master Thesis OS.

Path:

`master-thesis-os/experiments/wallpaper-host-poc/`

Current app version: **0.4.0**.

The host is isolated from the Next.js production app, Local Bridge, and Sucrose.

## Core design

Run in development mode:

```powershell
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper
```

The host attaches only its own WPF HWND to the wallpaper WorkerW. Explorer's
`SHELLDLL_DefView` and desktop icon windows are never re-parented.

The input design intentionally preserves the normal Windows/WebView2 path:

- native mouse input;
- native English keyboard input;
- native Korean/Japanese IME composition;
- no RawInput keyboard forwarding;
- no `SendInput`;
- no synthetic key-message injection;
- no custom Hangul/Japanese composer;
- no DOM/native focus bridge.

## Wallpaper and Interactive states

Wallpaper state sits behind the desktop icon layer. Explorer receives normal
desktop clicks first, so the host does not synthesize or forward those clicks.

Interactive state temporarily returns the same HWND to a normal top-level
WebView2 window. This is the path that has been verified to preserve native IME.

Manual toggle remains available:

`Ctrl + Alt + W`

The tray also contains `Enter Interactive mode` and `Return to Wallpaper`.

## v0.4 — low-friction interaction

The internal two-state design remains, but normal use requires less explicit
mode management.

While Interactive:

- press `Esc` to return to Wallpaper;
- when focus moves to another application, the host waits about 1.5 seconds and
  automatically returns to Wallpaper;
- re-activating Master Thesis OS during that delay cancels the return;
- common Windows IME foreground hosts (`TextInputHost`, `ctfmon`, `TabTip`) are
  excluded from automatic return so candidate/composition UI is not treated as
  an ordinary app switch.

The tray setting `Auto-return on focus loss` is enabled by default and persisted
in `settings.json`. Turn it off to restore purely manual switching.

`Ctrl + Alt + W` remains as the reliable manual/fallback toggle.

## Tray

The notification-area menu includes:

- `Enter Interactive mode`
- `Return to Wallpaper`
- `Refresh`
- `Display`
- `Auto-return on focus loss`
- `Start with Windows`
- `Open Logs Folder`
- version information
- `Exit`

Double-clicking the tray icon toggles Wallpaper / Interactive state.

## Exactly one selected display

The host always runs one process and one WebView2 instance. Even when Windows
has several monitors, Master Thesis OS appears on exactly one selected display.

Use tray `Display` to choose the monitor. The selected `\\.\DISPLAYn` is stored in:

`%LOCALAPPDATA%\MasterThesisOSWallpaper\settings.json`

Behavior:

- Wallpaper occupies only the selected display;
- Interactive opens on the same display;
- display changes move the existing host rather than creating another one;
- negative/left-side monitor coordinates are translated into WorkerW client coordinates;
- if the selected display disappears, the primary display is used as fallback.

## Runtime hardening

### Single instance

A named per-user mutex prevents a second wallpaper host. Launching another copy
signals the existing instance, which enters/raises Interactive state.

### WorkerW recovery

While in Wallpaper state, the host periodically verifies its WorkerW parent. If
Explorer recreates WorkerW, the host searches for a replacement and re-attaches
only its own HWND.

### Logs

Logs are stored in:

`%LOCALAPPDATA%\MasterThesisOSWallpaper\logs\`

## v0.4 local installation

The installed application lives at the stable path:

`%LOCALAPPDATA%\MasterThesisOSWallpaper\app\WallpaperHostPoc.exe`

Settings and logs stay outside the `app` directory, so reinstalling/updating the
binary does not erase them.

The current v0.4 publish is **framework-dependent win-x64**. Requirements:

- Windows 10/11 x64;
- .NET 8 Windows Desktop Runtime;
- Microsoft Edge WebView2 Runtime.

The development PC already needs the .NET 8 SDK to publish it.

### Install or update

From `experiments\wallpaper-host-poc`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-WallpaperHost.ps1
```

The installer:

1. remembers whether `Start with Windows` currently has an entry;
2. stops the running `WallpaperHostPoc` process;
3. publishes Release/win-x64 to a temporary directory;
4. replaces only `%LOCALAPPDATA%\MasterThesisOSWallpaper\app\`;
5. if startup was already enabled, rewrites it to the stable installed executable;
6. preserves `settings.json` and logs;
7. launches the installed `--wallpaper` host.

Install without launching:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-WallpaperHost.ps1 -NoLaunch
```

### Publish without installing

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Publish-Release.ps1
```

Default output:

`artifacts\publish\win-x64\`

### Uninstall

Keep settings and logs:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Uninstall-WallpaperHost.ps1
```

Remove the app plus settings/logs:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Uninstall-WallpaperHost.ps1 -PurgeData
```

## Start with Windows

The tray option writes only a current-user entry under:

`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

When an installed copy exists, startup always targets the stable installed exe
instead of a Debug/Release path inside the git repository. No administrator
rights are required.

## Build

```powershell
cd master-thesis-os\experiments\wallpaper-host-poc
dotnet restore
dotnet build -c Debug
```

## v0.4 validation

After merging/building, verify:

1. all existing Wallpaper, tray, display, single-instance and Korean IME behavior still works;
2. Interactive -> `Esc` returns to Wallpaper;
3. Interactive -> switch to another app -> about 1.5 seconds later returns to Wallpaper;
4. switch away and immediately back -> automatic return is cancelled;
5. Korean/Japanese IME candidate UI does not trigger an unwanted return;
6. tray `Auto-return on focus loss` can disable/re-enable the behavior and survives restart;
7. Release publish succeeds;
8. installer creates `%LOCALAPPDATA%\MasterThesisOSWallpaper\app\WallpaperHostPoc.exe`;
9. the installed copy runs with the repository/debug process stopped;
10. if startup was enabled, its registry command points at the installed executable;
11. reinstall/update preserves the selected display, auto-return setting, and logs.

## Deliberately not implemented

- Explorer icon-window re-parenting;
- RawInput keyboard forwarding;
- `SendInput` text injection;
- synthetic keyboard messages;
- custom Korean/Japanese composition;
- a general-purpose Wallpaper Engine;
- multiple simultaneous wallpaper instances across displays.
