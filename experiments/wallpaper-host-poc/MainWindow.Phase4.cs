using System.Windows.Interop;
using System.Windows.Threading;

namespace WallpaperHostPoc;

public partial class MainWindow
{
    private TrayIconController? _trayIcon;
    private HwndSource? _phase4HwndSource;
    private bool _phase4Initialized;

    protected override void OnContentRendered(EventArgs e)
    {
        base.OnContentRendered(e);

        if (!_wallpaperRequested || _phase4Initialized)
        {
            return;
        }

        _phase4Initialized = true;

        var hwnd = new WindowInteropHelper(this).Handle;
        _phase4HwndSource = HwndSource.FromHwnd(hwnd);
        _phase4HwndSource?.AddHook(Phase4WndProc);

        _trayIcon = new TrayIconController(
            isWallpaperMode: () => _wallpaperAttachment?.IsAttached == true,
            enterInteractiveMode: () => Phase4RunOnUiThread(EnterInteractiveFromTray),
            returnToWallpaperMode: () => Phase4RunOnUiThread(ReturnToWallpaperFromTray),
            refresh: () => Phase4RunOnUiThread(RefreshWebView),
            getDisplays: DisplayManager.GetDisplays,
            getSelectedDisplayDeviceName: GetSelectedDisplayDeviceName,
            selectDisplay: deviceName => Phase4RunOnUiThread(
                () => SelectDisplayFromTray(deviceName)),
            isAutoReturnEnabled: IsAutoReturnToWallpaperEnabled,
            setAutoReturnEnabled: enabled => Phase4RunOnUiThread(
                () => SetAutoReturnToWallpaperEnabled(enabled)),
            isStartupEnabled: StartupManager.IsEnabled,
            setStartupEnabled: StartupManager.SetEnabled,
            exit: () => Phase4RunOnUiThread(Close));

        InitializePhase5();
        InitializePhase6();
    }

    protected override void OnClosed(EventArgs e)
    {
        DisposePhase6();
        DisposePhase5();

        if (_phase4HwndSource is not null)
        {
            _phase4HwndSource.RemoveHook(Phase4WndProc);
            _phase4HwndSource = null;
        }

        _trayIcon?.Dispose();
        _trayIcon = null;

        base.OnClosed(e);
    }

    private nint Phase4WndProc(
        nint hwnd,
        int msg,
        nint wParam,
        nint lParam,
        ref bool handled)
    {
        if (msg == NativeMethods.WM_DISPLAYCHANGE)
        {
            Dispatcher.BeginInvoke(
                DispatcherPriority.Background,
                new Action(RefreshWallpaperBoundsAfterDisplayChange));
        }

        return nint.Zero;
    }

    private void EnterInteractiveFromTray()
    {
        if (_wallpaperAttachment?.IsAttached == true)
        {
            ToggleInteractiveMode();
            AppLog.Info("Tray requested Interactive mode.");
        }

        _trayIcon?.RefreshState();
    }

    private void ReturnToWallpaperFromTray()
    {
        if (_wallpaperAttachment is not null && !_wallpaperAttachment.IsAttached)
        {
            ToggleInteractiveMode();
            AppLog.Info("Tray requested Wallpaper mode.");
        }

        _trayIcon?.RefreshState();
    }

    private void RefreshWebView()
    {
        AppLog.Info("Tray requested WebView refresh.");

        if (Browser.CoreWebView2 is not null)
        {
            Browser.CoreWebView2.Reload();
            return;
        }

        Browser.Source = ProductionUri;
    }

    private string GetSelectedDisplayDeviceName()
    {
        if (_wallpaperAttachment is not null)
        {
            return _wallpaperAttachment.TargetDisplayDeviceName;
        }

        var settings = WallpaperSettings.Load();
        return DisplayManager.ResolveTarget(
            settings.TargetDisplayDeviceName,
            out _).DeviceName;
    }

    private void SelectDisplayFromTray(string deviceName)
    {
        if (_wallpaperAttachment is null)
        {
            return;
        }

        var display = DisplayManager.GetDisplays().FirstOrDefault(candidate =>
            string.Equals(
                candidate.DeviceName,
                deviceName,
                StringComparison.OrdinalIgnoreCase));

        if (display is null)
        {
            _trayIcon?.ShowInfo(
                "Display unavailable",
                "The selected display is no longer connected.",
                2500);
            _trayIcon?.RefreshState();
            return;
        }

        try
        {
            WallpaperSettings.SetTargetDisplayDeviceName(display.DeviceName);
            _wallpaperAttachment.SetTargetDisplay(display);

            if (!_wallpaperAttachment.TryApplyTargetDisplayBounds(out var status))
            {
                AppLog.Warn(status);
                _trayIcon?.ShowInfo(
                    "Display change failed",
                    status,
                    3000);
                return;
            }

            AppLog.Info($"Selected display changed to {display.DeviceName}. {status}");
            _trayIcon?.RefreshState();
        }
        catch (Exception ex)
        {
            AppLog.Error("Could not change the selected display.", ex);
            _trayIcon?.ShowInfo("Display change failed", ex.Message, 3000);
        }
    }

    private void RefreshWallpaperBoundsAfterDisplayChange()
    {
        if (_wallpaperAttachment is null)
        {
            return;
        }

        if (!_wallpaperAttachment.TryRefreshWallpaperBounds(out var status))
        {
            AppLog.Warn(status);
            Title = "Master Thesis OS - display refresh failed";
            _trayIcon?.RefreshState();
            return;
        }

        AppLog.Info(status);
        _trayIcon?.RefreshState();
    }

    private void Phase4RunOnUiThread(Action action)
    {
        if (Dispatcher.CheckAccess())
        {
            action();
            return;
        }

        Dispatcher.BeginInvoke(action);
    }
}
