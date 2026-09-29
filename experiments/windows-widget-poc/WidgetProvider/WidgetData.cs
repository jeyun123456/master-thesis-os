using System.Text.Json;

namespace MasterThesisOs.WidgetProvider;

internal static class WidgetData
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string CreateMockJson() => JsonSerializer.Serialize(
        new WidgetPayload(
            "Master Thesis OS",
            "오늘",
            [
                new WidgetTask("발표 피드백 반영", false),
                new WidgetTask("필요노동 결과 정리", false),
            ],
            new WidgetEvent("연구 미팅", "14:30"),
            new ResearchProgress("논문 진행", 72, "███████████░░░"),
            "대시보드 열기 →",
            "https://master-thesis-os.vercel.app"),
        SerializerOptions);

    private sealed record WidgetPayload(
        string Title,
        string TodayLabel,
        WidgetTask[] Tasks,
        WidgetEvent NextEvent,
        ResearchProgress Research,
        string OpenDashboardLabel,
        string DashboardUrl);

    private sealed record WidgetTask(string Title, bool Done);
    private sealed record WidgetEvent(string Title, string Time);
    private sealed record ResearchProgress(string Label, int Progress, string ProgressBar);
}
