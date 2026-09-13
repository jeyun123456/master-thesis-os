using System.Windows;
using System.Windows.Threading;
using Application = System.Windows.Application;

namespace WallpaperHostPoc;

public partial class MainWindow
{
    private DispatcherTimer? _recoveryTimer;
    private bool _recoveryInProgress;
    private int _recoveryFailures;
    private DateTimeOffset _nextRecoveryAttemptUtc;

    private void InitializeRuntimeServices()
    {
        AppLog.Initialize();
        AppLog.Info("Runtime services initialized.");

        SingleInstanceGuard.StartActivationListener(() =>
        {
            Dispatcher.BeginInvoke(
                DispatcherPriority.Normal,
                new Action(HandleSecondaryLaunchActivation));
        });

        if (Application.Current is not null)
        {
            Application.Current.DispatcherUnhandledException += RuntimeServices_DispatcherUnhandledException;
        }

        _recoveryTimer = new DispatcherTimer(
            TimeSpan.FromSeconds(5),
            DispatcherPriority.Background,
            RecoveryTimer_Tick,
            Dispatcher);
        _recoveryTimer.Start();
    }

    private void DisposeRuntimeServices()
    {
        _recoveryTimer?.Stop();
        _recoveryTimer = null;

        SingleInstanceGuard.StopActivationListener();

        if (Application.Current is not null)
        {
            Application.Current.DispatcherUnhandledException -= RuntimeServices_DispatcherUnhandledException;
        }

        AppLog.Info("Wallpaper host is shutting down.");
    }

    private void HandleSecondaryLaunchActivation()
    {
        AppLog.Info("Activation request received from a secondary launch.");

        if (_wallpaperAttachment?.IsAttached == true)
        {
            _ = EnterInteractiveMode();
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

    private void RecoveryTimer_Tick(object? sender, EventArgs e)
    {
        if (_recoveryInProgress ||
            _wallpaperAttachment?.IsAttached != true)
        {
            return;
        }

        if (DateTimeOffset.UtcNow < _nextRecoveryAttemptUtc)
        {
            return;
        }

        if (_wallpaperAttachment.IsAttachmentHealthy(out _))
        {
            _recoveryFailures = 0;
            _nextRecoveryAttemptUtc = default;
            return;
        }

        _recoveryInProgress = true;

        try
        {
            if (_wallpaperAttachment.TryRecoverWallpaperAttachment(out var status))
            {
                if (_recoveryFailures > 0)
                {
                    AppLog.Info(status);
                    _trayIcon?.ShowInfo(
                        "Master Thesis OS Wallpaper",
                        "Desktop host recovered after Explorer/WorkerW changed.");
                }

                _recoveryFailures = 0;
                _nextRecoveryAttemptUtc = default;
                _trayIcon?.RefreshState();
                return;
            }

            _recoveryFailures++;
            _nextRecoveryAttemptUtc = DateTimeOffset.UtcNow.AddSeconds(
                GetRecoveryRetryDelaySeconds(_recoveryFailures));

            // Avoid a noisy log line while Explorer is restarting.
            if (_recoveryFailures == 1 || _recoveryFailures % 3 == 0)
            {
                AppLog.Warn(status);
            }
        }
        catch (Exception ex)
        {
            _recoveryFailures++;
            _nextRecoveryAttemptUtc = DateTimeOffset.UtcNow.AddSeconds(
                GetRecoveryRetryDelaySeconds(_recoveryFailures));
            AppLog.Error("Automatic wallpaper recovery failed unexpectedly.", ex);
        }
        finally
        {
            _recoveryInProgress = false;
        }
    }

    private static double GetRecoveryRetryDelaySeconds(int failureCount)
    {
        var exponent = Math.Min(Math.Max(failureCount - 1, 0), 4);
        return Math.Min(60, 5 * Math.Pow(2, exponent));
    }

    private static void RuntimeServices_DispatcherUnhandledException(
        object sender,
        DispatcherUnhandledExceptionEventArgs e)
    {
        AppLog.Error("Unhandled WPF dispatcher exception.", e.Exception);
        // Preserve normal WPF crash semantics. Logging must not hide failures.
    }
}
