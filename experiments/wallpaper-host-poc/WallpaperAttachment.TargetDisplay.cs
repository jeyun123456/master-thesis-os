using Drawing = System.Drawing;

namespace WallpaperHostPoc;

internal sealed partial class WallpaperAttachment
{
    private string? _targetDisplayDeviceName;
    private Drawing.Rectangle _targetScreenBounds;
    private double _targetScaleFactor = 1.0;
    private bool _targetDisplayResolved;

    internal string TargetDisplayDeviceName
    {
        get
        {
            EnsureTargetDisplayResolved();
            return _targetDisplayDeviceName ?? string.Empty;
        }
    }

    internal Drawing.Rectangle TargetScreenBounds
    {
        get
        {
            EnsureTargetDisplayResolved();
            return _targetScreenBounds;
        }
    }

    internal double TargetScaleFactor
    {
        get
        {
            EnsureTargetDisplayResolved();
            return _targetScaleFactor;
        }
    }

    internal void SetTargetDisplay(DisplayTarget target)
    {
        _targetDisplayDeviceName = target.DeviceName;
        _targetScreenBounds = target.Bounds;
        _targetScaleFactor = target.ScaleFactor > 0 ? target.ScaleFactor : 1.0;
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

        SynchronizeWindowLogicalDimensions();

        _wallpaperWidth = _targetScreenBounds.Width;
        _wallpaperHeight = _targetScreenBounds.Height;
        status =
            $"Interactive bounds applied to {_targetDisplayDeviceName}: " +
            $"{_targetScreenBounds.Left},{_targetScreenBounds.Top} " +
            $"{_targetScreenBounds.Width}x{_targetScreenBounds.Height} (scale={_targetScaleFactor:0.##}).";
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
                "to WorkerW client coordinates. Win32 error: " +
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

        SynchronizeWindowLogicalDimensions();

        _wallpaperWidth = _targetScreenBounds.Width;
        _wallpaperHeight = _targetScreenBounds.Height;

        status =
            $"Wallpaper placed on {_targetDisplayDeviceName}: screen=" +
            $"{_targetScreenBounds.Left},{_targetScreenBounds.Top} " +
            $"{_targetScreenBounds.Width}x{_targetScreenBounds.Height} (scale={_targetScaleFactor:0.##}), " +
            $"WorkerW client origin={topLeft.X},{topLeft.Y}.";
        return true;
    }

    private void SynchronizeWindowLogicalDimensions()
    {
        void Apply()
        {
            try
            {
                _window.MinWidth = 0;
                _window.MinHeight = 0;
                _window.MaxWidth = double.PositiveInfinity;
                _window.MaxHeight = double.PositiveInfinity;

                var dpi = System.Windows.Media.VisualTreeHelper.GetDpi(_window);
                var scaleX = dpi.DpiScaleX > 0 ? dpi.DpiScaleX : _targetScaleFactor;
                var scaleY = dpi.DpiScaleY > 0 ? dpi.DpiScaleY : _targetScaleFactor;

                if (scaleX <= 0) scaleX = 1.0;
                if (scaleY <= 0) scaleY = 1.0;

                _window.Width = _targetScreenBounds.Width / scaleX;
                _window.Height = _targetScreenBounds.Height / scaleY;
                _window.UpdateLayout();
            }
            catch (Exception ex)
            {
                AppLog.Warn($"Failed to synchronize window logical dimensions: {ex.Message}");
            }
        }

        if (_window.Dispatcher.CheckAccess())
        {
            Apply();
        }
        else
        {
            _window.Dispatcher.Invoke(Apply);
        }
    }
}
