using Drawing = System.Drawing;

namespace WallpaperHostPoc;

internal sealed partial class WallpaperAttachment
{
    private string? _targetDisplayDeviceName;
    private Drawing.Rectangle _targetScreenBounds;
    private bool _targetDisplayResolved;

    internal string TargetDisplayDeviceName
    {
        get
        {
            EnsureTargetDisplayResolved();
            return _targetDisplayDeviceName ?? string.Empty;
        }
    }

    internal void SetTargetDisplay(DisplayTarget target)
    {
        _targetDisplayDeviceName = target.DeviceName;
        _targetScreenBounds = target.Bounds;
        _targetDisplayResolved = true;
    }

    internal bool TryApplyTargetDisplayBounds(out string status)
    {
        EnsureTargetDisplayResolved();

        if (_attached)
        {
            return TryPlaceAttachedHost(_workerW, out status);
        }

        if (!NativeMethods.SetWindowPos(
                _hostHwnd,
                NativeMethods.HWND_TOP,
                _targetScreenBounds.Left,
                _targetScreenBounds.Top,
                _targetScreenBounds.Width,
                _targetScreenBounds.Height,
                NativeMethods.SWP_FRAMECHANGED |
                NativeMethods.SWP_SHOWWINDOW))
        {
            status =
                $"Failed to move Interactive mode to {_targetDisplayDeviceName}. " +
                $"Win32 error: {System.Runtime.InteropServices.Marshal.GetLastWin32Error()}.";
            return false;
        }

        _wallpaperWidth = _targetScreenBounds.Width;
        _wallpaperHeight = _targetScreenBounds.Height;
        status =
            $"Interactive bounds applied to {_targetDisplayDeviceName}: " +
            $"{_targetScreenBounds.Left},{_targetScreenBounds.Top} " +
            $"{_targetScreenBounds.Width}x{_targetScreenBounds.Height}.";
        return true;
    }

    private void EnsureTargetDisplayResolved()
    {
        var settings = WallpaperSettings.Load();
        var preferred = _targetDisplayResolved
            ? _targetDisplayDeviceName
            : settings.TargetDisplayDeviceName;

        var target = DisplayManager.ResolveTarget(preferred, out var fellBack);
        SetTargetDisplay(target);

        if (fellBack || string.IsNullOrWhiteSpace(settings.TargetDisplayDeviceName))
        {
            try
            {
                WallpaperSettings.SetTargetDisplayDeviceName(target.DeviceName);
            }
            catch (Exception ex)
            {
                AppLog.Error("Could not persist the resolved display target.", ex);
            }
        }
    }

    private bool TryPlaceAttachedHost(nint workerW, out string status)
    {
        EnsureTargetDisplayResolved();

        if (!NativeMethods.IsWindow(workerW))
        {
            status = $"WorkerW 0x{workerW.ToInt64():X} is no longer valid.";
            return false;
        }

        var topLeft = new NativeMethods.POINT
        {
            X = _targetScreenBounds.Left,
            Y = _targetScreenBounds.Top,
        };

        if (!NativeMethods.ScreenToClient(workerW, ref topLeft))
        {
            status =
                $"Could not convert {_targetDisplayDeviceName} screen coordinates " +
                $"to WorkerW client coordinates. Win32 error: " +
                $"{System.Runtime.InteropServices.Marshal.GetLastWin32Error()}.";
            return false;
        }

        if (!NativeMethods.SetWindowPos(
                _hostHwnd,
                NativeMethods.HWND_BOTTOM,
                topLeft.X,
                topLeft.Y,
                _targetScreenBounds.Width,
                _targetScreenBounds.Height,
                NativeMethods.SWP_NOACTIVATE |
                NativeMethods.SWP_FRAMECHANGED |
                NativeMethods.SWP_SHOWWINDOW))
        {
            status =
                $"Failed to place the wallpaper on {_targetDisplayDeviceName}. " +
                $"Win32 error: {System.Runtime.InteropServices.Marshal.GetLastWin32Error()}.";
            return false;
        }

        _wallpaperWidth = _targetScreenBounds.Width;
        _wallpaperHeight = _targetScreenBounds.Height;

        status =
            $"Wallpaper placed on {_targetDisplayDeviceName}: screen=" +
            $"{_targetScreenBounds.Left},{_targetScreenBounds.Top} " +
            $"{_targetScreenBounds.Width}x{_targetScreenBounds.Height}, " +
            $"WorkerW client origin={topLeft.X},{topLeft.Y}.";
        return true;
    }
}
