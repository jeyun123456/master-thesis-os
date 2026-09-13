using System.Diagnostics;
using System.Windows.Input;
using System.Windows.Threading;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;

namespace WallpaperHostPoc;

public partial class MainWindow
{
    private static readonly TimeSpan AutoReturnDelay = TimeSpan.FromMilliseconds(1500);

    private DispatcherTimer? _autoReturnTimer;
    private bool _autoReturnToWallpaper = true;

    private void InitializeAutoReturn()
    {
        _autoReturnToWallpaper = WallpaperSettings.Load().AutoReturnToWallpaper;

        _autoReturnTimer = new DispatcherTimer(
            AutoReturnDelay,
            DispatcherPriority.Background,
            AutoReturnTimer_Tick,
            Dispatcher)
        {
            IsEnabled = false,
        };

        Activated += AutoReturn_Activated;
        Deactivated += AutoReturn_Deactivated;
        PreviewKeyDown += AutoReturn_PreviewKeyDown;

        AppLog.Info(
            $"Auto-return initialized. Enabled={_autoReturnToWallpaper}; " +
            $"installedCopy={InstallLayout.IsRunningInstalledCopy}; version={BuildInfo.Version}.");
    }

    private void DisposeAutoReturn()
    {
        Activated -= AutoReturn_Activated;
        Deactivated -= AutoReturn_Deactivated;
        PreviewKeyDown -= AutoReturn_PreviewKeyDown;

        _autoReturnTimer?.Stop();
        _autoReturnTimer = null;
    }

    private bool IsAutoReturnToWallpaperEnabled() => _autoReturnToWallpaper;

    private void SetAutoReturnToWallpaperEnabled(bool enabled)
    {
        _autoReturnToWallpaper = enabled;
        WallpaperSettings.SetAutoReturnToWallpaper(enabled);

        if (!enabled)
        {
            _autoReturnTimer?.Stop();
        }

        AppLog.Info($"Auto-return to Wallpaper set to {enabled}.");
    }

    private void AutoReturn_Activated(object? sender, EventArgs e)
    {
        _autoReturnTimer?.Stop();
    }

    private void AutoReturn_Deactivated(object? sender, EventArgs e)
    {
        if (!_autoReturnToWallpaper ||
            _wallpaperAttachment is null ||
            _wallpaperAttachment.IsAttached)
        {
            return;
        }

        _autoReturnTimer?.Stop();
        _autoReturnTimer?.Start();
    }

    private void AutoReturn_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape ||
            _wallpaperAttachment is null ||
            _wallpaperAttachment.IsAttached)
        {
            return;
        }

        e.Handled = true;
        _autoReturnTimer?.Stop();

        if (ReturnToWallpaperMode())
        {
            AppLog.Info("Escape returned Interactive mode to Wallpaper mode.");
        }
    }

    private void AutoReturnTimer_Tick(object? sender, EventArgs e)
    {
        if (!_autoReturnToWallpaper ||
            _wallpaperAttachment is null ||
            _wallpaperAttachment.IsAttached)
        {
            _autoReturnTimer?.Stop();
            return;
        }

        if (IsActive)
        {
            _autoReturnTimer?.Stop();
            return;
        }

        var foregroundWindow = NativeMethods.GetForegroundWindow();
        if (foregroundWindow == _hostHwnd)
        {
            _autoReturnTimer?.Stop();
            return;
        }

        if (ShouldDeferAutoReturnForForegroundWindow(foregroundWindow))
        {
            return;
        }

        _autoReturnTimer?.Stop();
        if (ReturnToWallpaperMode())
        {
            AppLog.Info(
                "Interactive mode automatically returned to Wallpaper after " +
                "focus moved away.");
        }
    }

    private static bool ShouldDeferAutoReturnForForegroundWindow(nint hwnd)
    {
        if (hwnd == nint.Zero)
        {
            return false;
        }

        _ = NativeMethods.GetWindowThreadProcessId(hwnd, out var processId);
        var currentProcessId = unchecked((uint)Environment.ProcessId);

        if (processId == 0 || processId == currentProcessId)
        {
            return processId == currentProcessId;
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
