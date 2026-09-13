using System.Windows.Interop;
using System.Windows.Threading;

namespace WallpaperHostPoc;

public partial class MainWindow
{
    private TrayIconController? _trayIcon;
    private HwndSource? _trayHwndSource;
    private bool _trayInitialized;

    protected override void OnContentRendered(EventArgs e)
    {
        base.OnContentRendered(e);

        if (!_wallpaperRequested || _trayInitialized)
        {
            return;
        }

        _trayInitialized = true;
        Icon = BrandIcon.CreateImageSource();

        var hwnd = new WindowInteropHelper(this).Handle;
        _trayHwndSource = HwndSource.FromHwnd(hwnd);
        _trayHwndSource?.AddHook(TrayWndProc);

        _trayIcon = new TrayIconController(
            isWallpaperMode: () => _wallpaperAttachment?.IsAttached == true,
            enterInteractiveMode: () => RunOnUiThread(EnterInteractiveFromTray),
            returnToWallpaperMode: () => RunOnUiThread(ReturnToWallpaperFromTray),
            refresh: () => RunOnUiThread(RefreshWebView),
            getDisplays: DisplayManager.GetDisplays,
            getSelectedDisplayDeviceName: GetSelectedDisplayDeviceName,
            selectDisplay: deviceName => RunOnUiThread(
                () => SelectDisplayFromTray(deviceName)),
            isAutoReturnEnabled: IsAutoReturnToWallpaperEnabled,
            setAutoReturnEnabled: enabled => RunOnUiThread(
                () => SetAutoReturnToWallpaperEnabled(enabled)),
            isClickToInteractEnabled: IsClickToInteractEnabled,
            setClickToInteractEnabled: enabled => RunOnUiThread(
                () => SetClickToInteractEnabled(enabled)),
            isStartupEnabled: StartupManager.IsEnabled,
            setStartupEnabled: StartupManager.SetEnabled,
            exit: () => RunOnUiThread(Close));

        InitializeRuntimeServices();
        InitializeAutoReturn();
        InitializeClickToInteract();
    }

    protected override void OnClosed(EventArgs e)
    {
        DisposeClickToInteract();
        DisposeAutoReturn();
        DisposeRuntimeServices();

        if (_trayHwndSource is not null)
        {
            _trayHwndSource.RemoveHook(TrayWndProc);
            _trayHwndSource = null;
        }

        _trayIcon?.Dispose();
        _trayIcon = null;

        base.OnClosed(e);
    }

    private nint TrayWndProc(
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
        if (_wallpaperAttachment?.IsAttached == true &&
            EnterInteractiveMode())
        {
            AppLog.Info("Tray requested Interactive mode.");
        }

        _trayIcon?.RefreshState();
    }

    private void ReturnToWallpaperFromTray()
    {
        if (_wallpaperAttachment is not null &&
            !_wallpaperAttachment.IsAttached &&
            ReturnToWallpaperMode())
        {
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

            RefreshClickToInteractTargetBounds();
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

        RefreshClickToInteractTargetBounds();
        AppLog.Info(status);
        _trayIcon?.RefreshState();
    }

    private void RunOnUiThread(Action action)
    {
        if (Dispatcher.CheckAccess())
        {
            action();
            return;
        }

        Dispatcher.BeginInvoke(action);
    }
}
