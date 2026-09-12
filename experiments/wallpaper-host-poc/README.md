# Master Thesis OS Wallpaper Companion

Windows 10/11 companion that keeps the production Master Thesis OS on the desktop while preserving native Windows/WebView2 keyboard input and Korean/Japanese IME behavior.

Current version: **0.6.0**

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

The same install command can be run again to update the installed copy.

## Normal use

The companion has two internal states:

- **Wallpaper**: Master Thesis OS sits behind normal desktop icons.
- **Open**: the same WebView2 temporarily becomes a foreground top-level window for normal mouse/keyboard/IME input.

Open it by:

- double-clicking the tray icon;
- tray `Open Master Thesis OS`;
- `Ctrl + Alt + W`;
- launching the app again while it is already running;
- optionally, an empty desktop click when experimental click-to-interact is enabled.

Return it to the wallpaper by:

- pressing `Esc`;
- tray `Send to Wallpaper`;
- `Ctrl + Alt + W`;
- switching to another application and waiting about 1.5 seconds when automatic return is enabled.

## v0.6 experimental click-to-interact

Tray `Click wallpaper to open (experimental)` is **off by default**.

When enabled, the companion installs a low-level **mouse-only** hook while the feature is active. A left click is intercepted only when all of these are true:

1. the companion is currently in Wallpaper state;
2. the pointer is inside the selected display;
3. the actual click target is the Windows desktop surface rather than another application/taskbar;
4. Explorer's desktop ListView hit test says the pointer is not on a desktop icon.

For an eligible empty-desktop click, the original left-button down/up is suppressed, the existing host HWND enters the normal Open state, and **one mouse left-click only** is replayed so the first click can reach WebView2.

Important boundary:

- no keyboard `SendInput`;
- no RawInput keyboard forwarding;
- no synthetic `WM_KEYDOWN` / `WM_KEYUP`;
- no custom Hangul/Japanese composition;
- Korean/Japanese IME continues through the normal top-level WebView2 path;
- the one-shot mouse replay is ignored by the hook itself using the injected-event flag.

If desktop-icon hit testing cannot be performed safely, the feature fails closed and leaves the click with Explorer instead of risking an icon hijack.

Turn the tray option off at any time to return immediately to the stable v0.5 interaction behavior.

## Tray menu

The notification-area menu contains:

- `Status: Wallpaper` / `Status: Open`
- `Open Master Thesis OS`
- `Send to Wallpaper`
- `Refresh`
- `Display`
- `Return to wallpaper when inactive`
- `Click wallpaper to open (experimental)`
- `Start with Windows`
- `Folders`
  - `Open Data Folder`
  - `Open App Folder`
  - `Open Logs Folder`
- `About... v0.6.0`
- `Exit`

## Display selection

Only one process and one WebView2 instance are used, even with multiple monitors.

Tray `Display` chooses exactly one target display. The selected Windows `\\.\DISPLAYn` is remembered across restarts.

- Wallpaper appears only on the selected display.
- Open state uses the same display.
- Click-to-interact is restricted to the selected display.
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

The stable keyboard/IME path remains the normal Windows/WebView2 path:

- native keyboard input
- native Korean/Japanese IME composition
- no RawInput keyboard forwarding
- no keyboard `SendInput`
- no synthetic keyboard messages
- no custom Hangul/Japanese composer
- no forced DOM/native focus bridge

The optional v0.6 experiment uses `SendInput` only for the single captured **mouse left-click replay** after Open state has already been established.

`NativeImeFocusBridge.cs` remains in the repository only as historical reference and is excluded from the executable.

## Publish / development

Publish:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Publish-Release.ps1
```

Development build:

```powershell
cd master-thesis-os\experiments\wallpaper-host-poc
dotnet restore
dotnet build -c Debug
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper
```

Requirements:

- Windows 10/11 x64
- .NET 8 Windows Desktop Runtime
- Microsoft Edge WebView2 Runtime

## v0.6 manual validation

Keep `Click wallpaper to open (experimental)` off first and verify the v0.5 behavior is unchanged. Then enable it and test:

1. click empty desktop space on the selected display: Master Thesis OS should open and the first click should reach the web UI;
2. click a desktop icon: Explorer should receive the click and Master Thesis OS should stay in Wallpaper state;
3. click the taskbar or another visible application: it must not open Master Thesis OS;
4. click empty desktop on a non-selected display: it must not open Master Thesis OS;
5. while Open, normal clicks and native Korean/Japanese IME must remain unchanged;
6. `Esc`, focus-loss auto-return and `Ctrl+Alt+W` must still return to Wallpaper normally;
7. turn the experimental option off and confirm all global mouse interception stops;
8. restart and confirm the experimental setting is persisted.

## Uninstall

Use the Start Menu uninstall shortcut, or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Uninstall-WallpaperHost.ps1
```

By default settings/logs are preserved. Use `-PurgeData` to remove them too.

## Architecture boundary

This is intentionally not a general-purpose Wallpaper Engine. Explorer's desktop icon windows are never re-parented. The temporary Open state remains the mechanism that gives WebView2 normal foreground focus and reliable native IME; v0.6 only experiments with making entry into that state feel like direct wallpaper interaction.
