using Windows.Storage;

namespace MasterThesisOs.WidgetProvider;

internal static class WidgetTemplate
{
    private static readonly Lazy<string> MediumTemplate = new(() => ReadPackageFile("ms-appx:///Templates/MediumWidget.json"));

    public static string Medium => MediumTemplate.Value;

    private static string ReadPackageFile(string packageUri)
    {
        var file = StorageFile.GetFileFromApplicationUriAsync(new Uri(packageUri)).AsTask().GetAwaiter().GetResult();
        return FileIO.ReadTextAsync(file).AsTask().GetAwaiter().GetResult();
    }
}
