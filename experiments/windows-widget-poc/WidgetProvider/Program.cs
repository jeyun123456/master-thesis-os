using System.Runtime.InteropServices;
using Microsoft.Windows.Widgets.Providers;

namespace MasterThesisOs.WidgetProvider;

internal static class Program
{
    [MTAThread]
    private static void Main(string[] args)
    {
        if (args.Length == 0 || !string.Equals(args[0], "-RegisterProcessAsComServer", StringComparison.Ordinal))
        {
            return;
        }

        WinRT.ComWrappersSupport.InitializeComWrappers();
        using var registration = RegistrationManager<MasterThesisWidgetProvider>.RegisterProvider();
        registration.DisposedEvent.WaitOne();
    }
}

internal static class ComGuids
{
    public const string IClassFactory = "00000001-0000-0000-C000-000000000046";
    public const string IUnknown = "00000000-0000-0000-C000-000000000046";
}

[ComImport]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
[Guid(ComGuids.IClassFactory)]
internal interface IClassFactory
{
    [PreserveSig]
    int CreateInstance(IntPtr outer, ref Guid interfaceId, out IntPtr instance);

    [PreserveSig]
    int LockServer(bool shouldLock);
}

internal static class ClassObject
{
    private const uint LocalServer = 0x4;
    private const uint MultipleUse = 0x1;

    [DllImport("ole32.dll")]
    private static extern int CoRegisterClassObject(
        [MarshalAs(UnmanagedType.LPStruct)] Guid classId,
        [MarshalAs(UnmanagedType.IUnknown)] object classFactory,
        uint classContext,
        uint flags,
        out uint registrationCookie);

    [DllImport("ole32.dll")]
    private static extern int CoRevokeClassObject(uint registrationCookie);

    public static uint Register(Guid classId, object classFactory)
    {
        var result = CoRegisterClassObject(classId, classFactory, LocalServer, MultipleUse, out var cookie);
        Marshal.ThrowExceptionForHR(result);
        return cookie;
    }

    public static void Revoke(uint cookie) => Marshal.ThrowExceptionForHR(CoRevokeClassObject(cookie));
}

internal sealed class WidgetProviderFactory<T> : IClassFactory where T : IWidgetProvider, new()
{
    private const int ClassNoAggregation = unchecked((int)0x80040110);
    private const int NoInterface = unchecked((int)0x80004002);

    public int CreateInstance(IntPtr outer, ref Guid interfaceId, out IntPtr instance)
    {
        instance = IntPtr.Zero;
        if (outer != IntPtr.Zero)
        {
            return ClassNoAggregation;
        }

        if (interfaceId != typeof(T).GUID && interfaceId != Guid.Parse(ComGuids.IUnknown))
        {
            return NoInterface;
        }

        instance = WinRT.MarshalInspectable<IWidgetProvider>.FromManaged(new T());
        return 0;
    }

    public int LockServer(bool shouldLock) => 0;
}

internal sealed class RegistrationManager<T> : IDisposable where T : IWidgetProvider, new()
{
    private readonly uint _cookie;
    private bool _disposed;

    private RegistrationManager(uint cookie) => _cookie = cookie;

    public ManualResetEvent DisposedEvent { get; } = new(false);

    public static RegistrationManager<T> RegisterProvider()
    {
        var cookie = ClassObject.Register(typeof(T).GUID, new WidgetProviderFactory<T>());
        return new RegistrationManager<T>(cookie);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        ClassObject.Revoke(_cookie);
        _disposed = true;
        DisposedEvent.Set();
        DisposedEvent.Dispose();
    }
}
