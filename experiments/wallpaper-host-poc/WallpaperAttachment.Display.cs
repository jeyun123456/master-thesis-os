namespace WallpaperHostPoc;

internal sealed partial class WallpaperAttachment
{
    internal bool TryRefreshWallpaperBounds(out string status)
    {
        if (_attached)
        {
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
        }

        return TryApplyTargetDisplayBounds(out status);
    }
}
