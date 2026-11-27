using Atlas.Core;
using Atlas.Core.Definitions;
using Atlas.Core.Items;
using Atlas.Core.Layout;
using Atlas.Core.Placement;

namespace Loveevo.App.Services;

public static class LoveevoWorkspaceDefinition
{
    public const string WorkspaceId = "loveevo-workspace-v2";
    public const string DocumentGroupId = "documents";
    public const string ToolGroupId = "tools";
    public const string OverviewItemId = "overview";
    public const string SettingsItemId = "settings";

    public static readonly string[] ContentKinds =
    [
        "loveevo-stages", "loveevo-filters", "loveevo-overview", "loveevo-settings",
        "loveevo-event-detail", "loveevo-event-editor"
    ];

    public static AtlasWorkspaceDefinition Create()
    {
        var tools = new[]
        {
            Tool("stages", "loveevo-stages", "阶段", "layers"),
            Tool("filters", "loveevo-filters", "筛选", "filter")
        };
        var overview = Document(OverviewItemId, "loveevo-overview", "关系总览", "chart");
        var settings = Document(SettingsItemId, "loveevo-settings", "备份与设置", "settings");

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
            [overview.Id, settings.Id],
            overview.Id);
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
            [.. tools, overview, settings],
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

    private static DockItem Document(string id, string kind, string title, string icon) =>
        new(
            new DockItemId(id),
            DockItemKind.Document,
            new ContentReference(kind, id),
            DockItemCapabilityPresets.Document,
            title,
            icon,
            new DocumentState(isPinned: true, isPreview: false));
}
