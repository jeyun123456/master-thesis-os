using Drawing = System.Drawing;
using Forms = System.Windows.Forms;

namespace WallpaperHostPoc;

internal sealed record DisplayTarget(
    string DeviceName,
    string Label,
    Drawing.Rectangle Bounds,
    bool IsPrimary);

internal static class DisplayManager
{
    internal static IReadOnlyList<DisplayTarget> GetDisplays()
    {
        var screens = Forms.Screen.AllScreens
            .OrderBy(screen => GetDisplayNumber(screen.DeviceName))
            .ThenBy(screen => screen.DeviceName, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var result = new List<DisplayTarget>(screens.Length);

        for (var index = 0; index < screens.Length; index++)
        {
            var screen = screens[index];
            var primarySuffix = screen.Primary ? " (Primary)" : string.Empty;
            var displayNumber = GetDisplayNumber(screen.DeviceName);
            var displayLabel = displayNumber == int.MaxValue
                ? $"Display {index + 1}"
                : $"Display {displayNumber}";
            var label =
                $"{displayLabel} — {screen.Bounds.Width}x{screen.Bounds.Height}{primarySuffix}";

            result.Add(new DisplayTarget(
                screen.DeviceName,
                label,
                screen.Bounds,
                screen.Primary));
        }

        return result;
    }

    internal static DisplayTarget ResolveTarget(string? preferredDeviceName, out bool fellBack)
    {
        var displays = GetDisplays();
        if (displays.Count == 0)
        {
            throw new InvalidOperationException("Windows did not report any connected displays.");
        }

        if (!string.IsNullOrWhiteSpace(preferredDeviceName))
        {
            var preferred = displays.FirstOrDefault(display =>
                string.Equals(
                    display.DeviceName,
                    preferredDeviceName,
                    StringComparison.OrdinalIgnoreCase));

            if (preferred is not null)
            {
                fellBack = false;
                return preferred;
            }
        }

        fellBack = !string.IsNullOrWhiteSpace(preferredDeviceName);
        return displays.FirstOrDefault(display => display.IsPrimary) ?? displays[0];
    }

    private static int GetDisplayNumber(string deviceName)
    {
        var digits = new string(deviceName.Where(char.IsDigit).ToArray());
        return int.TryParse(digits, out var number)
            ? number
            : int.MaxValue;
    }
}
