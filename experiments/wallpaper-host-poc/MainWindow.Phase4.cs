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
            isStartupEnabled: StartupManager.IsEnabled,
            setStartupEnabled: StartupManager.SetEnabled,
            exit: () => Phase4RunOnUiThread(Close));
    }

    protected override void OnClosed(EventArgs e)
    {
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
        }

        _trayIcon?.RefreshState();
    }

    private void ReturnToWallpaperFromTray()
    {
        if (_wallpaperAttachment is not null && !_wallpaperAttachment.IsAttached)
        {
            ToggleInteractiveMode();
        }

        _trayIcon?.RefreshState();
    }

    private void RefreshWebView()
    {
        if (Browser.CoreWebView2 is not null)
        {
            Browser.CoreWebView2.Reload();
            return;
        }

        Browser.Source = ProductionUri;
    }

    private void RefreshWallpaperBoundsAfterDisplayChange()
    {
        if (_wallpaperAttachment?.IsAttached != true)
        {
            return;
        }

        if (!_wallpaperAttachment.TryRefreshWallpaperBounds(out _))
        {
            Title = "Master Thesis OS - display refresh failed";
            return;
        }

        if (Browser.CoreWebView2 is not null)
        {
            Browser.CoreWebView2Controller.NotifyParentWindowPositionChanged();
        }
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
