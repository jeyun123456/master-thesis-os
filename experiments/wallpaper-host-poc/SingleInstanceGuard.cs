using System.Runtime.CompilerServices;

namespace WallpaperHostPoc;

internal static class SingleInstanceGuard
{
    private const string MutexName = @"Local\MasterThesisOSWallpaperHost.Singleton";
    private const string ActivationEventName = @"Local\MasterThesisOSWallpaperHost.Activate";

    private static Mutex? _mutex;
    private static EventWaitHandle? _activationEvent;
    private static RegisteredWaitHandle? _activationWait;
    private static bool _ownsMutex;

    [ModuleInitializer]
    internal static void InitializeModule()
    {
        AppLog.Initialize();

        try
        {
            _mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);

            if (!createdNew)
            {
                SignalPrimaryInstance();
                AppLog.Info("Secondary instance detected; activation was requested from the primary instance.");
                Environment.Exit(0);
                return;
            }

            _ownsMutex = true;
            _activationEvent = new EventWaitHandle(
                initialState: false,
                EventResetMode.AutoReset,
                ActivationEventName,
                out _);

            AppDomain.CurrentDomain.ProcessExit += (_, _) => ReleaseResources();
        }
        catch (Exception ex)
        {
            // Single-instance enforcement is useful, but it must not brick startup.
            AppLog.Error("Single-instance initialization failed; continuing without enforcement.", ex);
        }
    }

    internal static void StartActivationListener(Action callback)
    {
        if (!_ownsMutex || _activationEvent is null)
        {
            return;
        }

        StopActivationListener();

        _activationWait = ThreadPool.RegisterWaitForSingleObject(
            _activationEvent,
            (_, timedOut) =>
            {
                if (!timedOut)
                {
                    callback();
                }
            },
            state: null,
            millisecondsTimeOutInterval: Timeout.Infinite,
            executeOnlyOnce: false);
    }

    internal static void StopActivationListener()
    {
        _activationWait?.Unregister(null);
        _activationWait = null;
    }

    private static void SignalPrimaryInstance()
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                using var activationEvent = EventWaitHandle.OpenExisting(ActivationEventName);
                _ = activationEvent.Set();
                return;
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                Thread.Sleep(50);
            }
            catch (Exception ex)
            {
                AppLog.Error("Could not signal the primary wallpaper host instance.", ex);
                return;
            }
        }

        AppLog.Warn("Primary instance exists, but its activation event was not available in time.");
    }

    private static void ReleaseResources()
    {
        StopActivationListener();

        _activationEvent?.Dispose();
        _activationEvent = null;

        if (_ownsMutex && _mutex is not null)
        {
            try
            {
                _mutex.ReleaseMutex();
            }
            catch
            {
                // Process teardown: there is nothing useful to recover here.
            }
        }

        _mutex?.Dispose();
        _mutex = null;
        _ownsMutex = false;
    }
}
