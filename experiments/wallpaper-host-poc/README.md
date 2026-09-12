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

Press:

`Ctrl + Alt + W`

to switch between:

- **Wallpaper mode** — host is attached behind desktop icons;
- **Interactive mode** — host returns to a normal top-level WebView2 window so
  native mouse/focus/IME works exactly through the Windows/WebView2 path.

The abandoned DOM/native focus bridge is intentionally not installed because
repeated forced focus can break IME composition.

For a WorkerW-only baseline:

```powershell
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper --phase2-only
```

## Phase 4 — tray, refresh, startup, display changes

Wallpaper mode now creates a notification-area icon.

Tray menu:

- `Enter Interactive mode`
- `Return to Wallpaper`
- `Refresh`
- `Start with Windows`
- `Exit`

Double-clicking the tray icon toggles Wallpaper / Interactive mode.

`Start with Windows` writes only a current-user startup entry under:

`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

No administrator rights are required.

The host also listens for Windows `WM_DISPLAYCHANGE`. While it is attached to
WorkerW, it re-reads the Worker's client rectangle and resizes the wallpaper
host to match the changed desktop topology/resolution. This is the first-pass
monitor handling for the PoC; explicit per-monitor host selection is not yet
implemented.

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

## Phase 4 validation

After building:

```powershell
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper
```

Check:

1. wallpaper attaches behind desktop icons;
2. tray icon appears;
3. tray `Enter Interactive mode` works;
4. Korean native IME remains stable in Interactive mode;
5. tray `Return to Wallpaper` works;
6. tray `Refresh` reloads Master Thesis OS;
7. `Start with Windows` can be enabled and disabled;
8. changing resolution / monitor topology keeps the wallpaper correctly sized;
9. `Exit` removes the tray icon and terminates the host cleanly.

## Deliberately not implemented

- Explorer icon-window re-parenting;
- RawInput keyboard forwarding;
- `SendInput` text injection;
- synthetic keyboard messages;
- custom Korean/Japanese composition;
- a general-purpose Wallpaper Engine;
- explicit per-monitor wallpaper instances / monitor picker.
