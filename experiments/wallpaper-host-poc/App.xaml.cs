using System.Runtime.InteropServices;
using System.Windows;

namespace WallpaperHostPoc;

public partial class App : System.Windows.Application
{
    static App()
    {
        // 1. Process-level DPI Awareness Context:
        // 'app.manifest' is the canonical source of truth declaring PerMonitorV2.
        // If the process was started in an environment where the manifest was bypassed,
        // attempt runtime fallback.
        try
        {
            var success = NativeMethods.SetProcessDpiAwarenessContext(NativeMethods.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            var lastError = Marshal.GetLastWin32Error();
            if (!success)
            {
                // When app.manifest already set PerMonitorV2, Windows returns FALSE with ERROR_ACCESS_DENIED (5)
                // because the process DPI awareness context was already initialized by the OS loader.
                AppLog.Info($"SetProcessDpiAwarenessContext fallback call: result=False, lastError={lastError} (expected 5/ACCESS_DENIED when manifest is active).");
            }
            else
            {
                AppLog.Info("SetProcessDpiAwarenessContext fallback successfully applied PerMonitorV2 at runtime.");
            }
        }
        catch (Exception ex)
        {
            AppLog.Warn($"SetProcessDpiAwarenessContext call skipped or failed: {ex.Message}");
        }

        // 2. Thread-level DPI Hosting Behavior (CRITICAL for child HWNDs in WorkerW):
        // Unlike process-level awareness, thread DPI hosting behavior is NOT set by app.manifest.
        // It must be explicitly configured on the UI thread before creating any Windows or HwndHost controls,
        // so that child windows (like WebView2) can host Mixed-DPI content independently of WorkerW's DPI.
        try
        {
            var prevHosting = NativeMethods.SetThreadDpiHostingBehavior(NativeMethods.DPI_HOSTING_BEHAVIOR_MIXED);
            var hostingErr = Marshal.GetLastWin32Error();
            AppLog.Info($"SetThreadDpiHostingBehavior(MIXED) applied on UI thread: previous={prevHosting}, lastError={hostingErr}.");
        }
        catch (Exception ex)
        {
            AppLog.Warn($"SetThreadDpiHostingBehavior call skipped or failed: {ex.Message}");
        }
    }
}
