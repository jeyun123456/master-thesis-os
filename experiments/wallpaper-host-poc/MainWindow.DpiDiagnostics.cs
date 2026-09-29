using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;
using Forms = System.Windows.Forms;

namespace WallpaperHostPoc;

public partial class MainWindow
{
    private static string? ResolvePreferredDisplay(string[] args)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--display", StringComparison.OrdinalIgnoreCase))
            {
                return args[i + 1];
            }
        }

        return null;
    }

    private async Task DumpRuntimeDpiMetricsAsync()
    {
        try
        {
            // Give WebView2 and WPF layout time to complete first frame rendering
            await Task.Delay(1500);

            var sb = new StringBuilder();
            sb.AppendLine("=== RUNTIME DPI & GEOMETRY DIAGNOSTIC DUMP ===");
            sb.AppendLine($"Timestamp: {DateTimeOffset.Now:O}");
            sb.AppendLine($"Process ID: {Environment.ProcessId}");

            // 1 & 2. Screens and Target Monitor
            sb.AppendLine("\n--- 1 & 2. SCREENS & TARGET MONITOR ---");
            var allScreens = Forms.Screen.AllScreens;
            var displays = DisplayManager.GetDisplays();
            sb.AppendLine($"Total Screens Detected: {allScreens.Length}");
            foreach (var d in displays)
            {
                sb.AppendLine($"  Screen: DeviceName='{d.DeviceName}', Primary={d.IsPrimary}, Bounds={d.Bounds}, DpiX={d.DpiX}, DpiY={d.DpiY}, ScaleFactor={d.ScaleFactor:P0}");
            }

            var targetDeviceName = _wallpaperAttachment?.TargetDisplayDeviceName ?? "Unknown";
            var targetBounds = _wallpaperAttachment?.TargetScreenBounds ?? System.Drawing.Rectangle.Empty;
            var targetScale = _wallpaperAttachment?.TargetScaleFactor ?? 1.0;
            var matchedDisplay = displays.FirstOrDefault(d => string.Equals(d.DeviceName, targetDeviceName, StringComparison.OrdinalIgnoreCase));
            var targetDpiX = matchedDisplay?.DpiX ?? (uint)(96 * targetScale);
            var targetDpiY = matchedDisplay?.DpiY ?? (uint)(96 * targetScale);

            sb.AppendLine($"Target Display: '{targetDeviceName}'");
            sb.AppendLine($"Target Screen.Bounds: {targetBounds}");
            sb.AppendLine($"Target Monitor DPI: {targetDpiX}x{targetDpiY} (Scale={targetScale:F2} / {targetScale * 100:0}%)");

            // 3. GetDpiForWindow(MainWindow HWND)
            sb.AppendLine("\n--- 3. MAIN WINDOW HWND DPI ---");
            var hostDpi = _hostHwnd != nint.Zero ? NativeMethods.GetDpiForWindow(_hostHwnd) : 0;
            sb.AppendLine($"GetDpiForWindow(MainWindow HWND 0x{_hostHwnd.ToInt64():X}): {hostDpi} DPI (Scale={hostDpi / 96.0:F2})");

            // 4. MainWindow HWND GetWindowRect / GetClientRect
            sb.AppendLine("\n--- 4. MAIN WINDOW HWND RECTANGLES ---");
            NativeMethods.GetWindowRect(_hostHwnd, out var hostWinRect);
            NativeMethods.GetClientRect(_hostHwnd, out var hostClientRect);
            sb.AppendLine($"MainWindow HWND GetWindowRect: Left={hostWinRect.Left}, Top={hostWinRect.Top}, Right={hostWinRect.Right}, Bottom={hostWinRect.Bottom} (Size: {hostWinRect.Width}x{hostWinRect.Height} px)");
            sb.AppendLine($"MainWindow HWND GetClientRect: Left={hostClientRect.Left}, Top={hostClientRect.Top}, Right={hostClientRect.Right}, Bottom={hostClientRect.Bottom} (Size: {hostClientRect.Width}x{hostClientRect.Height} px)");

            // 5. WPF MainWindow ActualWidth / ActualHeight
            sb.AppendLine("\n--- 5. WPF MAINWINDOW LOGICAL DIMENSIONS ---");
            sb.AppendLine($"WPF MainWindow ActualWidth x ActualHeight: {ActualWidth:F2} x {ActualHeight:F2} DIP");
            sb.AppendLine($"WPF MainWindow Width x Height property: {Width:F2} x {Height:F2} DIP");

            // 6. WebView2 ActualWidth / ActualHeight
            sb.AppendLine("\n--- 6. WEBVIEW2 LOGICAL DIMENSIONS ---");
            sb.AppendLine($"WebView2 Browser ActualWidth x ActualHeight: {Browser.ActualWidth:F2} x {Browser.ActualHeight:F2} DIP");

            // 7. WebView2 Child HWNDs
            sb.AppendLine("\n--- 7. CHILD HWNDS UNDER MAINWINDOW ---");
            var childCount = 0;
            if (_hostHwnd != nint.Zero)
            {
                NativeMethods.EnumChildWindows(_hostHwnd, (childHwnd, _) =>
                {
                    childCount++;
                    var cls = NativeMethods.GetWindowClassName(childHwnd);
                    NativeMethods.GetWindowRect(childHwnd, out var cwr);
                    NativeMethods.GetClientRect(childHwnd, out var ccr);
                    var childDpi = NativeMethods.GetDpiForWindow(childHwnd);
                    sb.AppendLine($"  Child #{childCount}: HWND=0x{childHwnd.ToInt64():X}, Class='{cls}', DPI={childDpi}, WindowRect={cwr.Left},{cwr.Top} {cwr.Width}x{cwr.Height} px, ClientRect={ccr.Width}x{ccr.Height} px");
                    return true;
                }, nint.Zero);
            }
            sb.AppendLine($"Total Child HWNDs: {childCount}");

            // 8. CSS Viewport & --app-logical-width
            sb.AppendLine("\n--- 8. CSS VIEWPORT & LOGICAL WIDTH ---");
            if (Browser.CoreWebView2 is not null)
            {
                try
                {
                    var script = @"(() => {
                        return JSON.stringify({
                            innerWidth: window.innerWidth,
                            innerHeight: window.innerHeight,
                            devicePixelRatio: window.devicePixelRatio,
                            clientWidth: document.documentElement.clientWidth,
                            clientHeight: document.documentElement.clientHeight,
                            appLogicalWidth: getComputedStyle(document.documentElement).getPropertyValue('--app-logical-width').trim(),
                            appLogicalHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-logical-height').trim(),
                            appScale: getComputedStyle(document.documentElement).getPropertyValue('--app-scale').trim()
                        });
                    })()";
                    var jsonStr = await Browser.CoreWebView2.ExecuteScriptAsync(script);
                    // ExecuteScriptAsync returns JSON-encoded string (or stringified json)
                    sb.AppendLine($"CSS Script Result Raw: {jsonStr}");
                    try
                    {
                        var unescaped = JsonSerializer.Deserialize<string>(jsonStr);
                        if (!string.IsNullOrEmpty(unescaped))
                        {
                            using var doc = JsonDocument.Parse(unescaped);
                            var root = doc.RootElement;
                            var innerW = root.GetProperty("innerWidth").GetInt32();
                            var innerH = root.GetProperty("innerHeight").GetInt32();
                            var dpr = root.GetProperty("devicePixelRatio").GetDouble();
                            var appLogW = root.GetProperty("appLogicalWidth").GetString();
                            var appLogH = root.GetProperty("appLogicalHeight").GetString();
                            var appScale = root.GetProperty("appScale").GetString();
                            sb.AppendLine($"Parsed CSS Metrics:");
                            sb.AppendLine($"  window.innerWidth x window.innerHeight: {innerW} x {innerH} CSS px");
                            sb.AppendLine($"  window.devicePixelRatio: {dpr}");
                            sb.AppendLine($"  --app-logical-width: {appLogW}");
                            sb.AppendLine($"  --app-logical-height: {appLogH}");
                            sb.AppendLine($"  --app-scale: {appScale}");
                        }
                    }
                    catch (Exception parseEx)
                    {
                        sb.AppendLine($"  (JSON parse fallback: {parseEx.Message})");
                    }
                }
                catch (Exception ex)
                {
                    sb.AppendLine($"  Failed to query CSS viewport: {ex.Message}");
                }
            }
            else
            {
                sb.AppendLine("  CoreWebView2 is null.");
            }

            // 9. WorkerW HWND & GetDpiForWindow(workerW)
            sb.AppendLine("\n--- 9. WORKERW HWND & DPI ---");
            var workerW = _wallpaperAttachment?.WorkerWindowHandle ?? nint.Zero;
            if (workerW != nint.Zero)
            {
                var workerDpi = NativeMethods.GetDpiForWindow(workerW);
                NativeMethods.GetWindowRect(workerW, out var workerWinRect);
                NativeMethods.GetClientRect(workerW, out var workerClientRect);
                sb.AppendLine($"WorkerW HWND: 0x{workerW.ToInt64():X}");
                sb.AppendLine($"GetDpiForWindow(WorkerW): {workerDpi} DPI (Scale={workerDpi / 96.0:F2})");
                sb.AppendLine($"WorkerW WindowRect: {workerWinRect.Left},{workerWinRect.Top} {workerWinRect.Width}x{workerWinRect.Height} px");
                sb.AppendLine($"WorkerW ClientRect: {workerClientRect.Width}x{workerClientRect.Height} px");
            }
            else
            {
                sb.AppendLine("WorkerW HWND: 0 (Not attached)");
            }

            sb.AppendLine("\n=== END OF DIAGNOSTIC DUMP ===");
            var report = sb.ToString();

            // Log via AppLog
            AppLog.Info(report);

            // Write to dedicated diagnostic file
            var diagPath = Path.Combine(AppLog.LogDirectory, "dpi-runtime-diagnostic.txt");
            File.WriteAllText(diagPath, report, Encoding.UTF8);

            // Also copy to artifacts directory if accessible
            try
            {
                var artifactsDir = Path.Combine(AppContext.BaseDirectory, "artifacts");
                Directory.CreateDirectory(artifactsDir);
                File.WriteAllText(Path.Combine(artifactsDir, "dpi-runtime-diagnostic.txt"), report, Encoding.UTF8);
            }
            catch
            {
                // Ignore artifacts write error
            }
        }
        catch (Exception ex)
        {
            AppLog.Error("DumpRuntimeDpiMetricsAsync failed.", ex);
        }
    }
}
