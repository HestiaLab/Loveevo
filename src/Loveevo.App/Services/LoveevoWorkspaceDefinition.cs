using Atlas.Core;
using Atlas.Core.Definitions;
using Atlas.Core.Items;
using Atlas.Core.Layout;
using Atlas.Core.Placement;

namespace Loveevo.App.Services;

public static class LoveevoWorkspaceDefinition
{
    public const string WorkspaceId = "loveevo-workspace";
    public const string DocumentGroupId = "documents";
    public const string TimelineItemId = "timeline";
    public const string ToolGroupId = "tools";

    public static readonly string[] ContentKinds =
    [
        "loveevo-timeline", "loveevo-stages", "loveevo-filters", "loveevo-overview", "loveevo-settings",
        "loveevo-event-detail", "loveevo-event-editor"
    ];

    public static AtlasWorkspaceDefinition Create()
    {
        var tools = new[]
        {
            Tool("stages", "loveevo-stages", "阶段", "layers"),
            Tool("filters", "loveevo-filters", "筛选", "filter"),
            Tool("overview", "loveevo-overview", "关系总览", "chart"),
            Tool("settings", "loveevo-settings", "备份与设置", "settings")
        };
        var timeline = new DockItem(
            new DockItemId(TimelineItemId),
            DockItemKind.Document,
            new ContentReference("loveevo-timeline", "timeline"),
            DockItemCapabilityPresets.Document,
            "我们的时间线",
            "heart",
            new DocumentState(isPinned: true, isPreview: false));

        var toolGroup = new GroupNode(
            new LayoutNodeId(ToolGroupId),
            DockItemKind.Tool,
            GroupRetentionPolicy.Persistent,
            GroupVisibility.Expanded,
            tools.Select(item => item.Id).ToArray(),
            tools[0].Id,
            toolbarRegion: LogicalRegion.InlineStartUpper);
        var documentGroup = new GroupNode(
            new LayoutNodeId(DocumentGroupId),
            DockItemKind.Document,
            GroupRetentionPolicy.Persistent,
            GroupVisibility.Expanded,
            [timeline.Id],
            timeline.Id);
        var root = new SplitNode(
            new LayoutNodeId("root"),
            SplitAxis.InlineChildren,
            SplitBasis.FixedPixels(280, SplitAnchor.First),
            new SplitConstraints(220, 380, 320, null),
            toolGroup.Id,
            documentGroup.Id);

        return new AtlasWorkspaceDefinition(
            new WorkspaceId(WorkspaceId),
            root.Id,
            [root, toolGroup, documentGroup],
            [.. tools, timeline],
            [new ToolBarState(LogicalSide.InlineStart, ToolBarVisibility.Expanded)],
            [new ToolBarOrderState(LogicalRegion.InlineStartUpper, tools.Select(item => item.Id).ToArray())]);
    }

    private static DockItem Tool(string id, string kind, string title, string icon) =>
        new(
            new DockItemId(id),
            DockItemKind.Tool,
            new ContentReference(kind, id),
            DockItemCapabilityPresets.Tool,
            title,
            icon);
}
