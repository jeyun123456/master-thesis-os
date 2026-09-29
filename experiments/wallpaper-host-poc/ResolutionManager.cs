using System.Drawing;
using System.Text.Json;

namespace WallpaperHostPoc;

internal sealed record ResolutionOption(
    string Id,
    string Label,
    int Width,
    int Height,
    bool IsAuto);

internal static class ResolutionManager
{
    internal const string PresetAuto = "auto";
    internal const string Preset1280x720 = "1280x720";
    internal const string Preset1280x800 = "1280x800";
    internal const string Preset1920x1080 = "1920x1080";
    internal const string Preset2560x1440 = "2560x1440";
    internal const string Preset3200x1800 = "3200x1800";
    internal const string Preset3840x2160 = "3840x2160";

    internal const string Channel = "master-thesis-os.resolution.v1";

    internal static string NormalizePreset(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return PresetAuto;
        }

        var cleaned = raw.Trim().ToLowerInvariant().Replace(" ", "").Replace("×", "x");
        return cleaned switch
        {
            "auto" or "current" or "currentmonitor" => PresetAuto,
            "1280x720" or "720p" or "hd" => Preset1280x720,
            "1280x800" or "800p" or "wxga" => Preset1280x800,
            "1920x1080" or "1080p" or "fhd" => Preset1920x1080,
            "2560x1440" or "1440p" or "qhd" or "2k" => Preset2560x1440,
            "3200x1800" or "1800p" or "qhd+" => Preset3200x1800,
            "3840x2160" or "2160p" or "uhd" or "4k" => Preset3840x2160,
            _ => PresetAuto,
        };
    }

    internal static string MapPresetToDensity(string preset)
    {
        var normalized = NormalizePreset(preset);
        return normalized switch
        {
            Preset1280x720 or Preset1280x800 => "relaxed",
            Preset2560x1440 => "compact",
            Preset3200x1800 => "dense",
            Preset3840x2160 => "ultra-dense",
            _ => "comfortable",
        };
    }

    internal static IReadOnlyList<ResolutionOption> GetOptions(Rectangle monitorBounds)
    {
        var autoLabel = monitorBounds.Width > 0 && monitorBounds.Height > 0
            ? $"Auto (Current Monitor — {monitorBounds.Width} × {monitorBounds.Height})"
            : "Auto (Current Monitor)";

        return
        [
            new ResolutionOption(PresetAuto, autoLabel, monitorBounds.Width, monitorBounds.Height, true),
            new ResolutionOption(Preset1280x720, "1280 × 720", 1280, 720, false),
            new ResolutionOption(Preset1280x800, "1280 × 800", 1280, 800, false),
            new ResolutionOption(Preset1920x1080, "1920 × 1080", 1920, 1080, false),
            new ResolutionOption(Preset2560x1440, "2560 × 1440", 2560, 1440, false),
            new ResolutionOption(Preset3200x1800, "3200 × 1800", 3200, 1800, false),
            new ResolutionOption(Preset3840x2160, "3840 × 2160", 3840, 2160, false),
        ];
    }

    internal static string GetPresetLabel(string preset, Rectangle monitorBounds)
    {
        var normalized = NormalizePreset(preset);
        var options = GetOptions(monitorBounds);
        var match = options.FirstOrDefault(o => o.Id == normalized);
        return match?.Label ?? (normalized == PresetAuto ? "Auto (Current Monitor)" : normalized);
    }

    internal static (int Width, int Height, double ZoomFactor, bool IsAuto) CalculateResolution(
        string preset,
        Rectangle monitorBounds,
        double dpiScale = 1.0)
    {
        var normalized = NormalizePreset(preset);
        if (dpiScale <= 0)
        {
            dpiScale = 1.0;
        }

        var monitorW = Math.Max(monitorBounds.Width, 800);
        var monitorH = Math.Max(monitorBounds.Height, 600);
        var logicalW = (int)Math.Round(monitorW / dpiScale);
        var logicalH = (int)Math.Round(monitorH / dpiScale);

        if (normalized == PresetAuto)
        {
            return (logicalW, logicalH, 1.0, true);
        }

        var (targetW, targetH) = normalized switch
        {
            Preset1280x720 => (1280, 720),
            Preset1280x800 => (1280, 800),
            Preset1920x1080 => (1920, 1080),
            Preset2560x1440 => (2560, 1440),
            Preset3200x1800 => (3200, 1800),
            Preset3840x2160 => (3840, 2160),
            _ => (logicalW, logicalH),
        };

        // Render with 1.0 browser zoom, logical content layout matches viewport
        return (targetW, targetH, 1.0, false);
    }

    internal static string BuildInjectionScript(
        string preset,
        int width,
        int height,
        bool isAuto,
        double zoomFactor)
    {
        var autoStr = isAuto ? "true" : "false";
        var density = MapPresetToDensity(preset);
        return
            $"(function(){{" +
            $"if(typeof document === 'undefined' || !document.documentElement) return;" +
            $"document.documentElement.setAttribute('data-density', '{density}');" +
            $"document.documentElement.style.setProperty('--app-density', '{density}');" +
            $"document.documentElement.style.setProperty('--app-logical-width', '{width}px');" +
            $"document.documentElement.style.setProperty('--app-logical-height', '{height}px');" +
            $"document.documentElement.style.setProperty('--app-resolution-preset', '{preset}');" +
            $"document.documentElement.style.setProperty('--app-resolution-is-auto', '{autoStr}');" +
            $"document.documentElement.style.setProperty('--app-zoom-factor', '1.0');" +
            $"window.dispatchEvent(new CustomEvent('app:resolution-changed', {{ detail: {{ width: {width}, height: {height}, preset: '{preset}', isAuto: {autoStr}, zoomFactor: 1.0, density: '{density}' }} }}));" +
            $"window.dispatchEvent(new Event('resize'));" +
            $"}})();";
    }

    internal static string BuildWebMessageJson(
        string preset,
        int width,
        int height,
        bool isAuto,
        double zoomFactor)
    {
        var density = MapPresetToDensity(preset);
        return JsonSerializer.Serialize(new
        {
            channel = Channel,
            action = "resolutionChanged",
            preset,
            density,
            width,
            height,
            isAuto,
            zoomFactor = 1.0,
        });
    }
}
