using Atlas.Core.Items;
using Atlas.Core.Operations;

namespace Loveevo.App.Services;

public sealed class EditorDirtyRegistry
{
    private readonly Dictionary<string, EditorRegistration> _editors = new(StringComparer.Ordinal);

    public void Register(string itemId, Func<bool> isDirty, Func<Task<bool>> save)
    {
        _editors[itemId] = new EditorRegistration(isDirty, save);
    }

    public void Unregister(string itemId) => _editors.Remove(itemId);

    public bool IsDirty(string itemId) => _editors.TryGetValue(itemId, out var editor) && editor.IsDirty();

    public Task<bool> SaveAsync(string itemId) =>
        _editors.TryGetValue(itemId, out var editor) ? editor.Save() : Task.FromResult(true);

    private sealed record EditorRegistration(Func<bool> IsDirty, Func<Task<bool>> Save);
}

public sealed class EditorCloseGuardResolver(EditorDirtyRegistry registry, DialogService dialogs) : IDockItemCloseGuardResolver
{
    public IDockItemCloseGuard? Resolve(DockItem item) =>
        item.Content.Kind == "loveevo-event-editor" ? new EditorCloseGuard(registry, dialogs, item.Id.Value) : null;
}

public sealed class EditorCloseGuard(
    EditorDirtyRegistry registry,
    DialogService dialogs,
    string itemId) : IDockItemCloseGuard
{
    public async ValueTask<bool> CanCloseAsync(DockItemCloseContext context, CancellationToken cancellationToken)
    {
        if (!registry.IsDirty(itemId)) return true;
        var decision = await dialogs.RequestCloseDecisionAsync("未保存的修改");
        return decision switch
        {
            CloseDecision.Cancel => false,
            CloseDecision.Discard => true,
            CloseDecision.Save => await registry.SaveAsync(itemId),
            _ => false
        };
    }
}
