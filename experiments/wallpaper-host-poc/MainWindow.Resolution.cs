using System.Drawing;

namespace WallpaperHostPoc;

public partial class MainWindow
{
    private string _currentResolutionPreset = ResolutionManager.PresetAuto;
    private string? _resolutionInitScriptId;
    private bool _resolutionInitialized;

    private async Task InitializeResolutionAsync()
    {
        if (_resolutionInitialized)
        {
            return;
        }

        var settings = WallpaperSettings.Load();
        _currentResolutionPreset = ResolutionManager.NormalizePreset(settings.ResolutionPreset);

        await ApplyResolutionAsync(_currentResolutionPreset, force: true);
        _resolutionInitialized = true;
    }

    private void SelectResolutionFromTray(string presetId)
    {
        var normalized = ResolutionManager.NormalizePreset(presetId);
        _currentResolutionPreset = normalized;

        try
        {
            WallpaperSettings.SetResolutionPreset(normalized);
        }
        catch (Exception ex)
        {
            AppLog.Error($"Could not persist resolution preset '{normalized}'.", ex);
        }

        _ = ApplyResolutionAsync(normalized, force: true);
        _trayIcon?.RefreshState();

        var bounds = GetCurrentMonitorBounds();
        var label = ResolutionManager.GetPresetLabel(normalized, bounds);
        _trayIcon?.ShowInfo(
            BuildInfo.ShortProductName,
            $"해상도가 {label}(으)로 변경되었어.",
            1500);
    }

    private async Task ApplyResolutionAsync(string presetId, bool force = false)
    {
        if (Browser.CoreWebView2 is null)
        {
            return;
        }

        var bounds = GetCurrentMonitorBounds();
        var scaleFactor = GetCurrentScaleFactor();
        var (width, height, zoom, isAuto) = ResolutionManager.CalculateResolution(presetId, bounds, scaleFactor);

        try
        {
            // Set the WebView2 ZoomFactor to 1.0 so the browser renders at native 1:1 physical pixel grid.
            Browser.ZoomFactor = 1.0;

            var script = ResolutionManager.BuildInjectionScript(presetId, width, height, isAuto, zoom);
            await Browser.CoreWebView2.ExecuteScriptAsync(script);

            var messageJson = ResolutionManager.BuildWebMessageJson(presetId, width, height, isAuto, zoom);
            Browser.CoreWebView2.PostWebMessageAsJson(messageJson);

            if (_resolutionInitScriptId is not null)
            {
                try
                {
                    Browser.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(_resolutionInitScriptId);
                }
                catch (Exception ex)
                {
                    AppLog.Warn($"Could not remove previous resolution init script: {ex.Message}");
                }
                _resolutionInitScriptId = null;
            }

            _resolutionInitScriptId = await Browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(script);

            var density = ResolutionManager.MapPresetToDensity(presetId);
            AppLog.Info($"Applied resolution preset '{presetId}': density={density}, logical={width}x{height}, scale={scaleFactor:0.##}, auto={isAuto}.");
        }
        catch (Exception ex)
        {
            AppLog.Error($"Failed to apply resolution preset '{presetId}'.", ex);
        }
    }

    private void ReapplyResolutionAfterDisplayChange()
    {
        _ = ApplyResolutionAsync(_currentResolutionPreset, force: true);
        _trayIcon?.RefreshState();
    }

    private void ReapplyResolutionOnNavigation()
    {
        _ = ApplyResolutionAsync(_currentResolutionPreset, force: false);
    }

    private IReadOnlyList<ResolutionOption> GetResolutionOptions()
    {
        var bounds = GetCurrentMonitorBounds();
        return ResolutionManager.GetOptions(bounds);
    }

    private string GetCurrentResolutionLabel()
    {
        var bounds = GetCurrentMonitorBounds();
        return ResolutionManager.GetPresetLabel(_currentResolutionPreset, bounds);
    }

    private DisplayTarget GetCurrentDisplayTarget()
    {
        var settings = WallpaperSettings.Load();
        var preferred = _wallpaperAttachment?.TargetDisplayDeviceName ?? settings.TargetDisplayDeviceName;
        return DisplayManager.ResolveTarget(preferred, out _);
    }

    private Rectangle GetCurrentMonitorBounds()
    {
        if (_wallpaperAttachment is not null)
        {
            var attachedBounds = _wallpaperAttachment.TargetScreenBounds;
            if (attachedBounds.Width > 0 && attachedBounds.Height > 0)
            {
                return attachedBounds;
            }
        }

        return GetCurrentDisplayTarget().Bounds;
    }

    private double GetCurrentScaleFactor()
    {
        if (_wallpaperAttachment is not null)
        {
            var factor = _wallpaperAttachment.TargetScaleFactor;
            if (factor > 0)
            {
                return factor;
            }
        }

        return GetCurrentDisplayTarget().ScaleFactor;
    }
}
