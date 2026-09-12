namespace WallpaperHostPoc;

internal sealed partial class WallpaperAttachment
{
    internal bool TryRefreshWallpaperBounds(out string status)
    {
        if (!_attached)
        {
            status = "Wallpaper bounds refresh skipped because the host is in interactive mode.";
            return false;
        }

        if (!NativeMethods.IsWindow(_workerW))
        {
            status = $"Wallpaper WorkerW 0x{_workerW.ToInt64():X} is no longer valid.";
            return false;
        }

        var actualParent = NativeMethods.GetParent(_hostHwnd);
        if (actualParent != _workerW)
        {
            status =
                $"Wallpaper host parent changed unexpectedly. " +
                $"Expected 0x{_workerW.ToInt64():X}, actual 0x{actualParent.ToInt64():X}.";
            return false;
        }

        if (!NativeMethods.GetClientRect(_workerW, out var workerRect) ||
            workerRect.Width <= 0 ||
            workerRect.Height <= 0)
        {
            status = "WorkerW returned an invalid client rectangle after a display change.";
            return false;
        }

        if (!NativeMethods.SetWindowPos(
                _hostHwnd,
                NativeMethods.HWND_BOTTOM,
                0,
                0,
                workerRect.Width,
                workerRect.Height,
                NativeMethods.SWP_NOACTIVATE |
                NativeMethods.SWP_FRAMECHANGED |
                NativeMethods.SWP_SHOWWINDOW))
        {
            status =
                $"Failed to resize the wallpaper host after a display change. " +
                $"Win32 error: {System.Runtime.InteropServices.Marshal.GetLastWin32Error()}.";
            return false;
        }

        _wallpaperWidth = workerRect.Width;
        _wallpaperHeight = workerRect.Height;
        status = $"Wallpaper bounds refreshed to {workerRect.Width}x{workerRect.Height}.";
        return true;
    }
}
