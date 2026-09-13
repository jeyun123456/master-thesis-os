# Master Thesis OS Wallpaper Companion

Windows 10/11 companion for the production Master Thesis OS page:

`https://master-thesis-os.vercel.app/`

Current version: **0.6.1**

The companion uses one WPF host and one WebView2 instance. In Wallpaper state, only that host HWND is attached to the selected WorkerW, behind normal desktop icons. In Open state, the same host is a normal top-level window so Windows, WebView2, and Korean/Japanese native IME input continue to work normally.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the runtime boundaries and maintainer invariants.

## Install or update

From this directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-WallpaperHost.ps1
```

Installed executable:

`%LOCALAPPDATA%\MasterThesisOSWallpaper\app\MasterThesisOSWallpaper.exe`

The installer publishes the Release build, replaces only the app directory, preserves `settings.json` and `logs\`, updates an existing startup entry, and creates the Start Menu shortcuts. Run the same command again to update.

Use `-NoLaunch` to install without starting the companion:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-WallpaperHost.ps1 -NoLaunch
```

Use `-DesktopShortcut` when a Desktop shortcut is wanted:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Install-WallpaperHost.ps1 -DesktopShortcut
```

The default installation does not create a Desktop shortcut. An existing Desktop shortcut is preserved and refreshed during later updates.

## Start Menu and tray

The current-user Start Menu folder `Master Thesis OS` contains:

- `Master Thesis OS Wallpaper`
- `Uninstall Master Thesis OS Wallpaper`

The tray menu provides status, Open/Wallpaper transitions, Refresh, Display, `Click wallpaper to open`, `Return to wallpaper when inactive`, `Start with Windows`, data/app/log folders, About, and Exit.

`Click wallpaper to open` is enabled by default for new settings. It is a mouse-only convenience: an eligible empty desktop click on the selected display opens the companion and replays exactly that one left click into WebView2. Desktop icons, the taskbar, other application windows, and non-selected displays are not intercepted. If Explorer icon hit testing cannot be completed, the click is left untouched (fail-closed).

Manual fallback paths remain available through the tray, `Ctrl + Alt + W`, double-clicking the tray icon, or launching the installed executable again.

## States and input

Return from Open to Wallpaper with `Esc`, the tray, or `Ctrl + Alt + W`. When auto-return is enabled, focus loss returns to Wallpaper after about 1.5 seconds; returning focus to the companion during that delay cancels the return. Windows IME helper windows are deferred so candidate/composition UI is not treated as a normal application switch.

Keyboard input always follows the normal Windows/WPF/WebView2 path. This project does not synthesize keyboard input, forward keyboard through RawInput, post keyboard messages, implement a custom composer, or force browser/DOM focus in a loop. The only permitted synthetic input is the one captured mouse left-click replay described above.

Explorer's desktop icon windows are never re-parented, hidden, or resized. The WorkerW and desktop ListView are used only for shell discovery and safe icon hit-testing.

## Display selection

The tray `Display` submenu selects exactly one connected display. The Windows device name, including negative-coordinate displays such as `\\.\DISPLAY2`, is stored in settings and restored on restart. If it is unavailable, the primary display is selected. Wallpaper, Open state, and click-to-interact all use the same target display.

## Data, logs, and startup

Persistent data is stored outside the replaceable app directory:

`%LOCALAPPDATA%\MasterThesisOSWallpaper\`

- `settings.json` stores the target display and user preferences;
- `logs\` stores runtime logs;
- `app\` stores installed binaries.

An absent `ClickToInteractEnabled` setting uses the current default `true`; an explicit `false` remains false across updates. The current-user startup entry points to the installed executable with `--wallpaper`, and its existing enabled state is preserved during updates.

Only one companion process can run. A second launch activates the existing instance instead of creating another WorkerW host or WebView2 instance. The runtime periodically checks the WorkerW relationship and re-attaches only the companion HWND after shell recovery.

## Build and publish

Requirements: Windows 10/11 x64, .NET 8 SDK/Desktop Runtime, and Microsoft Edge WebView2 Runtime.

```powershell
dotnet restore
dotnet build -c Debug
powershell -ExecutionPolicy Bypass -File .\scripts\Publish-Release.ps1
```

Release output:

`artifacts\publish\win-x64\MasterThesisOSWallpaper.exe`

The publish script generates the application icon before publishing.

## Uninstall

Use the Start Menu uninstall shortcut or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Uninstall-WallpaperHost.ps1
```

This removes the app, shortcuts, and startup entry while preserving settings and logs. Add `-PurgeData` only when those data files should also be removed.
