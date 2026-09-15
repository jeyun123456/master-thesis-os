namespace WallpaperHostPoc;

public partial class MainWindow
{
    private BridgeProcessManager? _bridgeProcessManager;

    private async Task InitializeLocalBridgeAsync()
    {
        _bridgeProcessManager = new BridgeProcessManager();
        await _bridgeProcessManager.StartAsync();
    }

    private void DisposeLocalBridge()
    {
        _bridgeProcessManager?.Dispose();
        _bridgeProcessManager = null;
    }
}
