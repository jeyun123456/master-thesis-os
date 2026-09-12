using System.Runtime.InteropServices;

namespace WallpaperHostPoc;

internal sealed partial class WallpaperAttachment
{
    internal bool IsAttachmentHealthy(out string status)
    {
        if (!_attached)
        {
            status = "Host is intentionally outside WorkerW.";
            return true;
        }

        if (_workerW == nint.Zero || !NativeMethods.IsWindow(_workerW))
        {
            status = $"WorkerW 0x{_workerW.ToInt64():X} is no longer a valid window.";
            return false;
        }

        var actualParent = NativeMethods.GetParent(_hostHwnd);
        if (actualParent != _workerW)
        {
            status =
                $"Host parent changed from WorkerW 0x{_workerW.ToInt64():X} " +
                $"to 0x{actualParent.ToInt64():X}.";
            return false;
        }

        if (!HasUsableClientArea(_workerW))
        {
            status = $"WorkerW 0x{_workerW.ToInt64():X} no longer has a usable client area.";
            return false;
        }

        status = $"WorkerW 0x{_workerW.ToInt64():X} is healthy.";
        return true;
    }

    internal bool TryRecoverWallpaperAttachment(out string status)
    {
        if (!_attached)
        {
            status = "Recovery skipped because the host is in Interactive mode.";
            return false;
        }

        if (IsAttachmentHealthy(out var healthyStatus))
        {
            status = healthyStatus;
            return true;
        }

        var staleWorker = _workerW;

        // Do not detach to the desktop while Explorer is rebuilding. Keep the
        // existing child styles and switch parents only after a replacement
        // WorkerW has been found.
        if (!TryFindWallpaperWorker(out var replacementWorker, out var discovery))
        {
            status =
                $"Wallpaper recovery is waiting for Explorer. Previous WorkerW=" +
                $"0x{staleWorker.ToInt64():X}. {discovery}";
            return false;
        }

        if (!NativeMethods.IsWindow(replacementWorker) ||
            !HasUsableClientArea(replacementWorker))
        {
            status =
                $"Replacement WorkerW 0x{replacementWorker.ToInt64():X} is not usable yet.";
            return false;
        }

        EnsureWallpaperStyles();

        NativeMethods.SetLastError(0);
        _ = NativeMethods.SetParent(_hostHwnd, replacementWorker);
        var setParentError = Marshal.GetLastWin32Error();
        var actualParent = NativeMethods.GetParent(_hostHwnd);

        if (actualParent != replacementWorker)
        {
            status =
                $"Recovery found WorkerW 0x{replacementWorker.ToInt64():X}, but SetParent failed. " +
                $"Immediate Win32 error: {setParentError}; actual parent=0x{actualParent.ToInt64():X}.";
            return false;
        }

        if (!TryPlaceAttachedHost(replacementWorker, out var placementStatus))
        {
            status =
                $"Recovery attached to WorkerW 0x{replacementWorker.ToInt64():X}, " +
                $"but selected-display placement failed. {placementStatus}";
            return false;
        }

        _workerW = replacementWorker;
        _attached = true;

        status =
            $"Recovered wallpaper attachment from WorkerW 0x{staleWorker.ToInt64():X} " +
            $"to 0x{replacementWorker.ToInt64():X}. Target={_targetDisplayDeviceName}. " +
            $"{placementStatus} Discovery: {discovery}";
        return true;
    }

    private void EnsureWallpaperStyles()
    {
        var style = _originalStyle.ToInt64();
        style &= ~(
            NativeMethods.WS_POPUP |
            NativeMethods.WS_CAPTION |
            NativeMethods.WS_THICKFRAME |
            NativeMethods.WS_MINIMIZEBOX |
            NativeMethods.WS_MAXIMIZEBOX |
            NativeMethods.WS_SYSMENU);
        style |= NativeMethods.WS_CHILD;

        var exStyle = _originalExStyle.ToInt64();
        exStyle &= ~NativeMethods.WS_EX_APPWINDOW;
        exStyle |= NativeMethods.WS_EX_TOOLWINDOW;

        NativeMethods.SetWindowLongPtr(_hostHwnd, NativeMethods.GWL_STYLE, new nint(style));
        NativeMethods.SetWindowLongPtr(_hostHwnd, NativeMethods.GWL_EXSTYLE, new nint(exStyle));
    }
}
