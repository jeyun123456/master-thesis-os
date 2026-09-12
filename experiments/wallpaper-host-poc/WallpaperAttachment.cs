using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace WallpaperHostPoc;

internal sealed class WallpaperAttachment
{
    private readonly nint _hostHwnd;
    private readonly nint _originalParent;
    private readonly nint _originalStyle;
    private readonly nint _originalExStyle;

    private nint _workerW;
    private int _wallpaperWidth;
    private int _wallpaperHeight;
    private bool _attached;

    private WallpaperAttachment(nint hostHwnd)
    {
        _hostHwnd = hostHwnd;
        _originalParent = NativeMethods.GetParent(hostHwnd);
        _originalStyle = NativeMethods.GetWindowLongPtr(hostHwnd, NativeMethods.GWL_STYLE);
        _originalExStyle = NativeMethods.GetWindowLongPtr(hostHwnd, NativeMethods.GWL_EXSTYLE);
    }

    internal bool IsAttached => _attached;

    internal static WallpaperAttachment ForWindow(System.Windows.Window window)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        if (hwnd == nint.Zero)
        {
            throw new InvalidOperationException(
                "The WPF HWND does not exist yet. Attach only after SourceInitialized.");
        }

        return new WallpaperAttachment(hwnd);
    }

    internal bool TryAttach(out string status)
    {
        if (_attached)
        {
            status = $"Already attached to 0x{_workerW.ToInt64():X}.";
            return true;
        }

        if (!TryFindWallpaperWorker(out var workerW, out var discovery))
        {
            status =
                "Wallpaper WorkerW was not found. " +
                "The host was left as a normal WPF window. " +
                discovery;
            return false;
        }

        if (!NativeMethods.IsWindow(_hostHwnd))
        {
            status = $"Host HWND 0x{_hostHwnd.ToInt64():X} is no longer a valid window.";
            return false;
        }

        if (!NativeMethods.IsWindow(workerW))
        {
            status =
                $"Discovered WorkerW 0x{workerW.ToInt64():X} is no longer a valid window. " +
                $"Discovery: {discovery}";
            return false;
        }

        if (!NativeMethods.GetClientRect(workerW, out var workerRect) ||
            workerRect.Width <= 0 ||
            workerRect.Height <= 0)
        {
            status =
                $"Found WorkerW 0x{workerW.ToInt64():X}, but its client rectangle is invalid. " +
                "No window re-parenting was performed.";
            return false;
        }

        var workerClass = NativeMethods.GetWindowClassName(workerW);
        var workerParent = NativeMethods.GetParent(workerW);

        // SetParent does not automatically switch WS_POPUP/WS_CHILD. Convert only
        // our host into a child before attaching; Explorer-owned windows stay untouched.
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

        // SetParent can legitimately return NULL when the previous parent was NULL,
        // so clear last-error first, capture it immediately, and verify GetParent.
        NativeMethods.SetLastError(0);
        var previousParent = NativeMethods.SetParent(_hostHwnd, workerW);
        var setParentError = Marshal.GetLastWin32Error();
        var actualParent = NativeMethods.GetParent(_hostHwnd);

        if (actualParent != workerW)
        {
            var rollbackError = RestoreOriginalParentIfNeeded();
            RestoreStyles();

            status =
                $"SetParent did not attach host 0x{_hostHwnd.ToInt64():X} " +
                $"to WorkerW 0x{workerW.ToInt64():X}. " +
                $"Immediate Win32 error: {setParentError}. " +
                $"SetParent returned previous parent 0x{previousParent.ToInt64():X}; " +
                $"actual parent is 0x{actualParent.ToInt64():X}. " +
                $"Worker class='{workerClass}', worker parent=0x{workerParent.ToInt64():X}, " +
                $"discovery='{discovery}', rollback error={rollbackError}. " +
                "The host remains in normal-window mode.";
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
            var sizingError = Marshal.GetLastWin32Error();
            var rollbackError = RestoreOriginalParentIfNeeded();
            RestoreStyles();

            status =
                $"WorkerW attachment succeeded but sizing failed with Win32 error {sizingError}. " +
                $"Rollback error={rollbackError}. Attachment was rolled back.";
            return false;
        }

        _workerW = workerW;
        _wallpaperWidth = workerRect.Width;
        _wallpaperHeight = workerRect.Height;
        _attached = true;
        status =
            $"Attached host 0x{_hostHwnd.ToInt64():X} to WorkerW 0x{workerW.ToInt64():X} " +
            $"({workerRect.Width}x{workerRect.Height}, class='{workerClass}', " +
            $"worker parent=0x{workerParent.ToInt64():X}). Discovery: {discovery}";
        return true;
    }

    internal bool TryEnterInteractiveMode(out string status)
    {
        if (!_attached)
        {
            status = "The host is already outside WorkerW.";
            return true;
        }

        var workerW = _workerW;
        var detachError = RestoreOriginalParentIfNeeded();
        var actualParent = NativeMethods.GetParent(_hostHwnd);

        if (actualParent != _originalParent)
        {
            status =
                $"Could not detach host from WorkerW 0x{workerW.ToInt64():X}. " +
                $"Win32 error: {detachError}; actual parent=0x{actualParent.ToInt64():X}.";
            return false;
        }

        RestoreStyles();

        if (!NativeMethods.SetWindowPos(
                _hostHwnd,
                NativeMethods.HWND_TOP,
                0,
                0,
                _wallpaperWidth,
                _wallpaperHeight,
                NativeMethods.SWP_FRAMECHANGED |
                NativeMethods.SWP_SHOWWINDOW))
        {
            var error = Marshal.GetLastWin32Error();
            status =
                $"Detached from WorkerW, but failed to raise the interactive window. " +
                $"Win32 error: {error}.";
            _attached = false;
            _workerW = nint.Zero;
            return false;
        }

        _attached = false;
        _workerW = nint.Zero;
        status = "Interactive mode active. Press Ctrl+Alt+W to return to wallpaper mode.";
        return true;
    }

    private int RestoreOriginalParentIfNeeded()
    {
        if (NativeMethods.GetParent(_hostHwnd) == _originalParent)
        {
            return 0;
        }

        NativeMethods.SetLastError(0);
        _ = NativeMethods.SetParent(_hostHwnd, _originalParent);
        return Marshal.GetLastWin32Error();
    }

    private void RestoreStyles()
    {
        NativeMethods.SetWindowLongPtr(
            _hostHwnd,
            NativeMethods.GWL_STYLE,
            _originalStyle);

        NativeMethods.SetWindowLongPtr(
            _hostHwnd,
            NativeMethods.GWL_EXSTYLE,
            _originalExStyle);

        _ = NativeMethods.SetWindowPos(
            _hostHwnd,
            nint.Zero,
            0,
            0,
            0,
            0,
            NativeMethods.SWP_NOMOVE |
            NativeMethods.SWP_NOSIZE |
            NativeMethods.SWP_NOACTIVATE |
            NativeMethods.SWP_FRAMECHANGED);
    }

    private static bool TryFindWallpaperWorker(
        out nint workerW,
        out string discovery)
    {
        workerW = nint.Zero;
        discovery = string.Empty;

        var progman = NativeMethods.FindWindow("Progman", null);
        if (progman == nint.Zero)
        {
            discovery = "Progman was not found.";
            return false;
        }

        // Undocumented Explorer behavior. Newer Windows 11 implementations use
        // the 0xD/0x1 form; a 0/0 retry is retained only for compatibility.
        SendSpawnWorkerMessage(progman, 0xD, 0x1);

        if (TryFindProgmanChildWorker(progman, out workerW))
        {
            discovery = "Progman child WorkerW.";
            return true;
        }

        if (TryFindLegacySiblingWorker(out workerW))
        {
            discovery = "Legacy WorkerW sibling behind SHELLDLL_DefView.";
            return true;
        }

        SendSpawnWorkerMessage(progman, 0x0, 0x0);

        if (TryFindProgmanChildWorker(progman, out workerW))
        {
            discovery = "Progman child WorkerW after compatibility retry.";
            return true;
        }

        if (TryFindLegacySiblingWorker(out workerW))
        {
            discovery = "Legacy WorkerW sibling after compatibility retry.";
            return true;
        }

        discovery =
            "Neither a Progman child WorkerW nor a legacy WorkerW sibling " +
            "could be located.";
        return false;
    }

    private static void SendSpawnWorkerMessage(
        nint progman,
        nuint wParam,
        nint lParam)
    {
        _ = NativeMethods.SendMessageTimeout(
            progman,
            NativeMethods.SPAWN_WORKERW_MESSAGE,
            wParam,
            lParam,
            NativeMethods.SMTO_NORMAL,
            1000,
            out _);
    }

    private static bool TryFindProgmanChildWorker(
        nint progman,
        out nint workerW)
    {
        workerW = nint.Zero;

        var candidate = nint.Zero;
        while (true)
        {
            candidate = NativeMethods.FindWindowEx(
                progman,
                candidate,
                "WorkerW",
                null);

            if (candidate == nint.Zero)
            {
                return false;
            }

            if (HasUsableClientArea(candidate))
            {
                workerW = candidate;
                return true;
            }
        }
    }

    private static bool TryFindLegacySiblingWorker(out nint workerW)
    {
        workerW = nint.Zero;
        nint found = nint.Zero;

        _ = NativeMethods.EnumWindows((topLevel, _) =>
        {
            var defView = NativeMethods.FindWindowEx(
                topLevel,
                nint.Zero,
                "SHELLDLL_DefView",
                null);

            if (defView == nint.Zero)
            {
                return true;
            }

            var candidate = NativeMethods.FindWindowEx(
                nint.Zero,
                topLevel,
                "WorkerW",
                null);

            if (candidate != nint.Zero && HasUsableClientArea(candidate))
            {
                found = candidate;
                return false;
            }

            return true;
        }, nint.Zero);

        workerW = found;
        return workerW != nint.Zero;
    }

    private static bool HasUsableClientArea(nint hwnd) =>
        NativeMethods.IsWindow(hwnd) &&
        NativeMethods.GetClientRect(hwnd, out var rect) &&
        rect.Width > 0 &&
        rect.Height > 0;
}
