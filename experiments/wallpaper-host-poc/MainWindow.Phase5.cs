using System.Windows;
using System.Windows.Threading;

namespace WallpaperHostPoc;

public partial class MainWindow
{
    private DispatcherTimer? _phase5RecoveryTimer;
    private bool _phase5RecoveryInProgress;
    private int _phase5RecoveryFailures;

    private void InitializePhase5()
    {
        AppLog.Initialize();
        AppLog.Info("Phase 5 runtime services initialized.");

        SingleInstanceGuard.StartActivationListener(() =>
        {
            Dispatcher.BeginInvoke(
                DispatcherPriority.Normal,
                new Action(HandleSecondaryLaunchActivation));
        });

        if (Application.Current is not null)
        {
            Application.Current.DispatcherUnhandledException += Phase5_DispatcherUnhandledException;
        }

        _phase5RecoveryTimer = new DispatcherTimer(
            TimeSpan.FromSeconds(5),
            DispatcherPriority.Background,
            Phase5RecoveryTimer_Tick,
            Dispatcher);
        _phase5RecoveryTimer.Start();
    }

    private void DisposePhase5()
    {
        _phase5RecoveryTimer?.Stop();
        _phase5RecoveryTimer = null;

        SingleInstanceGuard.StopActivationListener();

        if (Application.Current is not null)
        {
            Application.Current.DispatcherUnhandledException -= Phase5_DispatcherUnhandledException;
        }

        AppLog.Info("Wallpaper host is shutting down.");
    }

    private void HandleSecondaryLaunchActivation()
    {
        AppLog.Info("Activation request received from a secondary launch.");

        if (_wallpaperAttachment?.IsAttached == true)
        {
            ToggleInteractiveMode();
            _trayIcon?.RefreshState();
            return;
        }

        if (_hostHwnd != nint.Zero)
        {
            _ = NativeMethods.SetForegroundWindow(_hostHwnd);
        }

        _ = Activate();
        _ = Browser.Focus();
        _trayIcon?.RefreshState();
    }

    private void Phase5RecoveryTimer_Tick(object? sender, EventArgs e)
    {
        if (_phase5RecoveryInProgress ||
            _wallpaperAttachment?.IsAttached != true)
        {
            return;
        }

        if (_wallpaperAttachment.IsAttachmentHealthy(out _))
        {
            _phase5RecoveryFailures = 0;
            return;
        }

        _phase5RecoveryInProgress = true;

        try
        {
            if (_wallpaperAttachment.TryRecoverWallpaperAttachment(out var status))
            {
                if (_phase5RecoveryFailures > 0)
                {
                    AppLog.Info(status);
                    _trayIcon?.ShowInfo(
                        "Master Thesis OS Wallpaper",
                        "Desktop host recovered after Explorer/WorkerW changed.");
                }

                _phase5RecoveryFailures = 0;

                if (Browser.CoreWebView2 is not null)
                {
                    Browser.CoreWebView2Controller.NotifyParentWindowPositionChanged();
                }

                _trayIcon?.RefreshState();
                return;
            }

            _phase5RecoveryFailures++;

            // Avoid a noisy log line every five seconds while Explorer is restarting.
            if (_phase5RecoveryFailures == 1 || _phase5RecoveryFailures % 6 == 0)
            {
                AppLog.Warn(status);
            }
        }
        catch (Exception ex)
        {
            _phase5RecoveryFailures++;
            AppLog.Error("Automatic wallpaper recovery failed unexpectedly.", ex);
        }
        finally
        {
            _phase5RecoveryInProgress = false;
        }
    }

    private static void Phase5_DispatcherUnhandledException(
        object sender,
        DispatcherUnhandledExceptionEventArgs e)
    {
        AppLog.Error("Unhandled WPF dispatcher exception.", e.Exception);
        // Preserve normal WPF crash semantics. Logging must not hide failures.
    }
}
