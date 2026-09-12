using System.Diagnostics;
using System.Windows.Input;
using System.Windows.Threading;

namespace WallpaperHostPoc;

public partial class MainWindow
{
    private static readonly TimeSpan AutoReturnDelay = TimeSpan.FromMilliseconds(1500);

    private DispatcherTimer? _phase6AutoReturnTimer;
    private bool _autoReturnToWallpaper = true;

    private void InitializePhase6()
    {
        _autoReturnToWallpaper = WallpaperSettings.Load().AutoReturnToWallpaper;

        _phase6AutoReturnTimer = new DispatcherTimer(
            AutoReturnDelay,
            DispatcherPriority.Background,
            Phase6AutoReturnTimer_Tick,
            Dispatcher)
        {
            IsEnabled = false,
        };

        Activated += Phase6_Activated;
        Deactivated += Phase6_Deactivated;
        PreviewKeyDown += Phase6_PreviewKeyDown;

        AppLog.Info(
            $"Phase 6 interaction UX initialized. AutoReturn={_autoReturnToWallpaper}; " +
            $"installedCopy={InstallLayout.IsRunningInstalledCopy}; version={BuildInfo.Version}.");
    }

    private void DisposePhase6()
    {
        Activated -= Phase6_Activated;
        Deactivated -= Phase6_Deactivated;
        PreviewKeyDown -= Phase6_PreviewKeyDown;

        _phase6AutoReturnTimer?.Stop();
        _phase6AutoReturnTimer = null;
    }

    private bool IsAutoReturnToWallpaperEnabled() => _autoReturnToWallpaper;

    private void SetAutoReturnToWallpaperEnabled(bool enabled)
    {
        _autoReturnToWallpaper = enabled;
        WallpaperSettings.SetAutoReturnToWallpaper(enabled);

        if (!enabled)
        {
            _phase6AutoReturnTimer?.Stop();
        }

        AppLog.Info($"Auto-return to Wallpaper set to {enabled}.");
    }

    private void Phase6_Activated(object? sender, EventArgs e)
    {
        _phase6AutoReturnTimer?.Stop();
    }

    private void Phase6_Deactivated(object? sender, EventArgs e)
    {
        if (!_autoReturnToWallpaper ||
            _wallpaperAttachment is null ||
            _wallpaperAttachment.IsAttached)
        {
            return;
        }

        _phase6AutoReturnTimer?.Stop();
        _phase6AutoReturnTimer?.Start();
    }

    private void Phase6_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape ||
            _wallpaperAttachment is null ||
            _wallpaperAttachment.IsAttached)
        {
            return;
        }

        e.Handled = true;
        _phase6AutoReturnTimer?.Stop();

        ToggleInteractiveMode();
        _trayIcon?.RefreshState();
        AppLog.Info("Escape returned Interactive mode to Wallpaper mode.");
    }

    private void Phase6AutoReturnTimer_Tick(object? sender, EventArgs e)
    {
        if (!_autoReturnToWallpaper ||
            _wallpaperAttachment is null ||
            _wallpaperAttachment.IsAttached)
        {
            _phase6AutoReturnTimer?.Stop();
            return;
        }

        if (IsActive)
        {
            _phase6AutoReturnTimer?.Stop();
            return;
        }

        var foregroundWindow = NativeMethods.GetForegroundWindow();
        if (foregroundWindow == _hostHwnd)
        {
            _phase6AutoReturnTimer?.Stop();
            return;
        }

        if (IsLikelyImeForegroundWindow(foregroundWindow))
        {
            return;
        }

        _phase6AutoReturnTimer?.Stop();
        ToggleInteractiveMode();
        _trayIcon?.RefreshState();
        AppLog.Info("Interactive mode automatically returned to Wallpaper after focus moved away.");
    }

    private static bool IsLikelyImeForegroundWindow(nint hwnd)
    {
        if (hwnd == nint.Zero)
        {
            return false;
        }

        _ = NativeMethods.GetWindowThreadProcessId(hwnd, out var processId);
        if (processId == 0 || processId == Environment.ProcessId)
        {
            return processId == Environment.ProcessId;
        }

        try
        {
            var processName = Process.GetProcessById(unchecked((int)processId)).ProcessName;
            return processName.Equals("TextInputHost", StringComparison.OrdinalIgnoreCase) ||
                   processName.Equals("ctfmon", StringComparison.OrdinalIgnoreCase) ||
                   processName.Equals("TabTip", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }
}
