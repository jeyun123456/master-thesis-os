using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using Microsoft.Windows.Widgets.Providers;

namespace MasterThesisOs.WidgetProvider;

[ComVisible(true)]
[ComDefaultInterface(typeof(IWidgetProvider))]
[Guid(ProviderClassId)]
public sealed class MasterThesisWidgetProvider : IWidgetProvider
{
    public const string ProviderClassId = "3E1D8D7C-B975-4F14-9AF0-9D89A6A55F21";
    public const string DefinitionId = "MasterThesisOs_Medium_Widget";

    private static readonly ConcurrentDictionary<string, WidgetInstance> Instances = new();
    private static int _hasRecovered;

    public MasterThesisWidgetProvider() => RecoverExistingWidgets();

    public void CreateWidget(WidgetContext widgetContext)
    {
        EnsureKnownDefinition(widgetContext);
        var instance = new WidgetInstance(widgetContext.Id, IsActive: widgetContext.IsActive);
        Instances[widgetContext.Id] = instance;
        UpdateWidget(instance.Id);
    }

    public void DeleteWidget(string widgetId, string customState) => Instances.TryRemove(widgetId, out _);

    public void Activate(WidgetContext widgetContext)
    {
        EnsureKnownDefinition(widgetContext);
        var instance = Instances.AddOrUpdate(
            widgetContext.Id,
            id => new WidgetInstance(id, IsActive: true),
            (_, existing) => existing with { IsActive = true });
        UpdateWidget(instance.Id);
    }

    public void Deactivate(string widgetId)
    {
        if (Instances.TryGetValue(widgetId, out var instance))
        {
            Instances[widgetId] = instance with { IsActive = false };
        }
    }

    public void OnActionInvoked(WidgetActionInvokedArgs actionInvokedArgs)
    {
        // This PoC uses Adaptive Card Action.OpenUrl, so no provider-side action is required.
    }

    public void OnWidgetContextChanged(WidgetContextChangedArgs contextChangedArgs)
    {
        UpdateWidget(contextChangedArgs.WidgetContext.Id);
    }

    private static void UpdateWidget(string widgetId)
    {
        var options = new WidgetUpdateRequestOptions(widgetId)
        {
            Template = WidgetTemplate.Medium,
            Data = WidgetData.CreateMockJson(),
            CustomState = "static-v1",
        };
        WidgetManager.GetDefault().UpdateWidget(options);
    }

    private static void RecoverExistingWidgets()
    {
        if (Interlocked.Exchange(ref _hasRecovered, 1) != 0)
        {
            return;
        }

        var manager = WidgetManager.GetDefault();
        foreach (var widgetInfo in manager.GetWidgetInfos())
        {
            var context = widgetInfo.WidgetContext;
            if (string.Equals(context.DefinitionId, DefinitionId, StringComparison.Ordinal))
            {
                Instances[context.Id] = new WidgetInstance(context.Id, context.IsActive);
            }
            else
            {
                manager.DeleteWidget(context.Id);
            }
        }
    }

    private static void EnsureKnownDefinition(WidgetContext context)
    {
        if (!string.Equals(context.DefinitionId, DefinitionId, StringComparison.Ordinal))
        {
            throw new ArgumentOutOfRangeException(nameof(context), context.DefinitionId, "Unknown widget definition.");
        }
    }

    private sealed record WidgetInstance(string Id, bool IsActive);
}
