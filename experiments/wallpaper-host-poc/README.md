# Master Thesis OS Wallpaper Companion

Windows 10/11 companion that keeps the production Master Thesis OS on the desktop while preserving native Windows/WebView2 input and Korean/Japanese IME behavior.

Current version: **0.5.0**

Production page:

`https://master-thesis-os.vercel.app/`

Source:

`master-thesis-os/experiments/wallpaper-host-poc/`

## Install / update

From this directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-WallpaperHost.ps1
```

Installed executable:

`%LOCALAPPDATA%\MasterThesisOSWallpaper\app\MasterThesisOSWallpaper.exe`

The installer publishes the Release build, replaces only the installed `app` directory, creates Start Menu shortcuts, preserves settings/logs, migrates an existing startup entry, and launches the companion.

Optional desktop shortcut:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-WallpaperHost.ps1 -DesktopShortcut
```

Install/update without launching:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-WallpaperHost.ps1 -NoLaunch
```

The same install command can be run again to update the installed copy.

## Start Menu

Installation creates a `Master Thesis OS` folder in the current user's Start Menu with:

- `Master Thesis OS Wallpaper`
- `Uninstall Master Thesis OS Wallpaper`

No administrator rights are required.

## Normal use

The companion has two internal states, but normal use does not require constant manual switching.

- **Wallpaper**: Master Thesis OS sits behind normal desktop icons.
- **Open**: the same WebView2 temporarily becomes a foreground top-level window for normal mouse/keyboard/IME input.

Open it by:

- double-clicking the tray icon;
- tray `Open Master Thesis OS`;
- `Ctrl + Alt + W`;
- launching the app again while it is already running.

Return it to the wallpaper by:

- pressing `Esc`;
- tray `Send to Wallpaper`;
- `Ctrl + Alt + W`;
- switching to another application and waiting about 1.5 seconds when automatic return is enabled.

Re-activating Master Thesis OS during that delay cancels automatic return. Common Windows IME hosts are ignored so candidate/composition UI is not treated as a normal app switch.

## Tray menu

The notification-area menu contains:

- `Status: Wallpaper` / `Status: Open`
- `Open Master Thesis OS`
- `Send to Wallpaper`
- `Refresh`
- `Display`
- `Return to wallpaper when inactive`
- `Start with Windows`
- `Folders`
  - `Open Data Folder`
  - `Open App Folder`
  - `Open Logs Folder`
- `About... v0.5.0`
- `Exit`

The tray and installed executable use the Master Thesis OS Wallpaper icon generated during Release publish.

## Display selection

Only one process and one WebView2 instance are used, even with multiple monitors.

Tray `Display` chooses exactly one target display. The selected Windows `\\.\DISPLAYn` is remembered across restarts.

Behavior:

- Wallpaper appears only on the selected display.
- Open state uses the same display.
- Negative/left-side monitor coordinates are supported.
- If the selected display disappears, the primary display is used as fallback.

## Start with Windows

Tray `Start with Windows` writes a current-user entry only:

`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

When an installed copy exists, the registry entry points to:

`%LOCALAPPDATA%\MasterThesisOSWallpaper\app\MasterThesisOSWallpaper.exe --wallpaper`

## Data and logs

Persistent data lives outside the replaceable app directory:

`%LOCALAPPDATA%\MasterThesisOSWallpaper\`

Important files/directories:

- `settings.json` — selected display and interaction preferences
- `logs\` — runtime logs
- `app\` — installed binaries

Reinstalling/updating preserves settings and logs.

## Single instance and recovery

Only one companion process can run per user. A second launch signals the existing instance instead of creating another WorkerW/WebView2 host.

While in Wallpaper state, the companion periodically verifies its WorkerW attachment. If Explorer recreates WorkerW, only the companion HWND is re-attached; Explorer desktop/icon windows are never re-parented.

## Native input policy

The stable input path intentionally remains the normal Windows/WebView2 path:

- native mouse input
- native keyboard input
- native Korean/Japanese IME composition
- no RawInput forwarding
- no `SendInput`
- no synthetic key-message injection
- no custom Hangul/Japanese composer
- no forced DOM/native focus bridge

`NativeImeFocusBridge.cs` remains in the repository only as historical reference and is excluded from the executable.

## Publish only

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Publish-Release.ps1
```

Default output:

`artifacts\publish\win-x64\`

Release publish is framework-dependent `win-x64` and generates the application `.ico` before building.

Requirements:

- Windows 10/11 x64
- .NET 8 Windows Desktop Runtime
- Microsoft Edge WebView2 Runtime

A .NET 8 SDK is required only to build/publish from source.

## Development build

```powershell
cd master-thesis-os\experiments\wallpaper-host-poc
dotnet restore
dotnet build -c Debug
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper
```

## Uninstall

Use the Start Menu uninstall shortcut, or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Uninstall-WallpaperHost.ps1
```

By default the app, Start Menu/Desktop shortcuts and startup entry are removed while settings/logs are preserved.

Remove everything including settings/logs:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Uninstall-WallpaperHost.ps1 -PurgeData
```

## Architecture boundary

This is intentionally not a general-purpose Wallpaper Engine. It does not modify/re-parent Explorer's desktop icon windows and does not forward synthetic input through the wallpaper layer. The temporary foreground/open state is what preserves normal WebView2 focus and native IME reliability.
