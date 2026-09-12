# Master Thesis OS Wallpaper Host PoC

Windows-only WPF + Microsoft Edge WebView2 proof of concept for the production
Master Thesis OS.

Everything here is isolated under:

`master-thesis-os/experiments/wallpaper-host-poc/`

No changes are required to the Next.js production app, Local Bridge, or the
existing Sucrose experiment.

## Phase 1 — normal WPF window

Default execution loads:

`https://master-thesis-os.vercel.app/`

The WebView uses the normal Windows/WebView2 keyboard path. There is no
RawInput-based keyboard forwarding, text injection, or custom IME composer.

Run:

```powershell
dotnet run --project .\WallpaperHostPoc.csproj
```

## Phase 2 — opt-in WorkerW wallpaper mode

Wallpaper attachment exists only behind an explicit switch:

```powershell
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper
```

The implementation:

- locates `Progman`;
- requests/exposes a wallpaper `WorkerW`;
- supports a Progman-child WorkerW layout and the older
  `SHELLDLL_DefView` / sibling-WorkerW layout;
- re-parents only the PoC host window;
- never re-parents Explorer's desktop icons or `SHELLDLL_DefView`;
- removes only the PoC from taskbar/Alt+Tab in wallpaper mode;
- fills the selected WorkerW client area;
- avoids forced startup activation/focus;
- falls back to a normal WPF window when a usable WorkerW is not found.

The WorkerW mechanism uses undocumented Explorer behavior and therefore remains
a PoC boundary.

## Intentionally not implemented yet

- forced Progman fallback if WorkerW discovery fails
- Explorer icon-window modification
- RawInput keyboard capture
- synthetic key-message forwarding
- SendInput text injection
- custom Hangul/Japanese composition
- tray
- refresh UI
- startup integration
- per-monitor management

## Build

Requirements:

- Windows 10/11
- .NET 8 SDK
- Microsoft Edge WebView2 Runtime

Then:

```powershell
cd master-thesis-os\experiments\wallpaper-host-poc
dotnet restore
dotnet build -c Debug
```

## Manual test order when back at the PC

### 1. Phase 1 baseline

Run without arguments and verify:

- production page loads;
- mouse works;
- English typing works;
- Korean native IME composition works;
- Japanese native IME composition and candidate window work;
- IME survives normal focus/Alt-Tab transitions.

### 2. Phase 2 placement

Run with `--wallpaper` and verify:

- Master Thesis OS is behind desktop icons;
- desktop icons remain visible and clickable;
- Explorer/taskbar remain normal;
- the PoC does not appear as a normal taskbar/Alt+Tab window;
- terminating the PoC does not disturb desktop icons.

If WorkerW discovery fails, keep the warning text. Do not manually re-parent
Explorer windows as a workaround.

### 3. Phase 3 input gate

In wallpaper mode, then verify:

- an editable Master Thesis OS field can be clicked;
- English works;
- Korean native IME composition works;
- Japanese native IME candidate window appears at/near the WebView caret;
- IME still works after leaving/re-entering the desktop host.

If wallpaper placement works but native IME does not, treat that as a
focus/activation design issue for Phase 3. Do not replace native IME with
synthetic input.


## Phase 3 — native IME focus bridge

Wallpaper mode now enables a minimal focus bridge by default.

It does **not** synthesize keyboard input. Instead:

1. a document-start script observes only real editable-element `focusin` /
   `focusout` events;
2. when a user has focused an editable element, the host asks Windows/WPF to
   activate the PoC window;
3. it focuses the real WebView2 control;
4. it calls `CoreWebView2Controller.MoveFocus(Programmatic)`, which returns
   native WebView focus to the previously focused web element;
5. WebView2 remains responsible for TSF/IME composition and candidate UI.

Normal Phase 3 run:

```powershell
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper
```

For an A/B comparison, disable only the Phase 3 focus bridge while keeping the
same WorkerW attachment:

```powershell
dotnet run --project .\WallpaperHostPoc.csproj -- --wallpaper --phase2-only
```

Compare Korean/Japanese IME behavior between those two commands. If Phase 2
fails but Phase 3 succeeds, the missing piece was native activation/focus rather
than text injection.

Phase 3 still does not use RawInput, SendInput, synthetic key messages, or a
custom Hangul/Japanese composer.
