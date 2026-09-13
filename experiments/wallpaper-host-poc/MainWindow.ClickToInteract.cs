using System.Threading;
using System.Windows.Threading;

namespace WallpaperHostPoc;

public partial class MainWindow
{
    private static readonly TimeSpan MaximumClickReplayAge =
        TimeSpan.FromSeconds(2);

    private DesktopClickInterceptor? _clickToInteract;
    private bool _clickToInteractEnabled;
    private int _clickTargetLeft;
    private int _clickTargetTop;
    private int _clickTargetRight;
    private int _clickTargetBottom;

    private void InitializeClickToInteract()
    {
        _clickToInteractEnabled = WallpaperSettings.Load().ClickToInteractEnabled;
        RefreshClickToInteractTargetBounds();

        if (_clickToInteractEnabled)
        {
            if (!TryStartClickToInteract(out var status))
            {
                AppLog.Warn(status);
                _clickToInteractEnabled = false;
            }
            else
            {
                AppLog.Info(status);
            }
        }

        AppLog.Info(
            $"Click-to-interact initialized. Enabled={_clickToInteractEnabled}.");
    }

    private void DisposeClickToInteract()
    {
        _clickToInteract?.Dispose();
        _clickToInteract = null;
    }

    private bool IsClickToInteractEnabled() => _clickToInteractEnabled;

    private void SetClickToInteractEnabled(bool enabled)
    {
        if (enabled == _clickToInteractEnabled)
        {
            return;
        }

        if (enabled)
        {
            RefreshClickToInteractTargetBounds();

            if (!TryStartClickToInteract(out var status))
            {
                throw new InvalidOperationException(status);
            }

            _clickToInteractEnabled = true;
            WallpaperSettings.SetClickToInteractEnabled(true);
            AppLog.Info(status);
            AppLog.Info("Click-to-interact enabled.");
            return;
        }

        _clickToInteractEnabled = false;
        _clickToInteract?.Dispose();
        _clickToInteract = null;
        WallpaperSettings.SetClickToInteractEnabled(false);
        AppLog.Info("Click-to-interact disabled.");
    }

    private bool TryStartClickToInteract(out string status)
    {
        _clickToInteract?.Dispose();
        _clickToInteract = new DesktopClickInterceptor(
            ShouldCaptureWallpaperClick,
            OnWallpaperClickCaptured);

        if (_clickToInteract.Start(out status))
        {
            return true;
        }

        _clickToInteract.Dispose();
        _clickToInteract = null;
        return false;
    }

    private bool ShouldCaptureWallpaperClick(NativeMethods.POINT point)
    {
        if (!_clickToInteractEnabled ||
            _wallpaperAttachment?.IsAttached != true)
        {
            return false;
        }

        var left = Volatile.Read(ref _clickTargetLeft);
        var top = Volatile.Read(ref _clickTargetTop);
        var right = Volatile.Read(ref _clickTargetRight);
        var bottom = Volatile.Read(ref _clickTargetBottom);

        if (point.X < left ||
            point.X >= right ||
            point.Y < top ||
            point.Y >= bottom)
        {
            return false;
        }

        return DesktopClickInterceptor.IsEligibleDesktopPoint(
            point,
            _hostHwnd,
            _wallpaperAttachment.WorkerWindowHandle);
    }

    private void OnWallpaperClickCaptured(
        DesktopClickInterceptor.CapturedClick capturedClick)
    {
        Dispatcher.BeginInvoke(
            DispatcherPriority.Input,
            new Action(() => HandleWallpaperClickCaptured(capturedClick)));
    }

    private void HandleWallpaperClickCaptured(
        DesktopClickInterceptor.CapturedClick capturedClick)
    {
        if (!_clickToInteractEnabled ||
            _wallpaperAttachment?.IsAttached != true)
        {
            return;
        }

        if (!EnterInteractiveMode())
        {
            AppLog.Warn(
                $"Click-to-interact could not enter Interactive mode for " +
                $"desktop click at {capturedClick.Point.X},{capturedClick.Point.Y}.");
            return;
        }

        _trayIcon?.RefreshState();

        AppLog.Info(
            $"Click-to-interact opened Master Thesis OS from " +
            $"{capturedClick.Point.X},{capturedClick.Point.Y}.");

        // Let WPF/WebView2 complete the already-existing native activation path,
        // then replay only the captured mouse click. No keyboard input is synthesized.
        Dispatcher.BeginInvoke(
            DispatcherPriority.ContextIdle,
            new Action(() =>
            {
                if (DesktopClickInterceptor.ReplayLeftClick(
                        capturedClick,
                        _hostHwnd,
                        MaximumClickReplayAge,
                        out var replayStatus))
                {
                    AppLog.Info(replayStatus);
                }
                else
                {
                    AppLog.Warn(replayStatus);
                }
            }));
    }

    private void RefreshClickToInteractTargetBounds()
    {
        try
        {
            var target = DisplayManager.ResolveTarget(
                GetSelectedDisplayDeviceName(),
                out _);

            Volatile.Write(ref _clickTargetLeft, target.Bounds.Left);
            Volatile.Write(ref _clickTargetTop, target.Bounds.Top);
            Volatile.Write(ref _clickTargetRight, target.Bounds.Right);
            Volatile.Write(ref _clickTargetBottom, target.Bounds.Bottom);
        }
        catch (Exception ex)
        {
            AppLog.Error("Could not refresh click-to-interact display bounds.", ex);
        }
    }
}
