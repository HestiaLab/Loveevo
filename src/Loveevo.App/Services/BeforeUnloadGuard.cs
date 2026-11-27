using Microsoft.JSInterop;

namespace Loveevo.App.Services;

public sealed class BeforeUnloadGuard(IJSRuntime js)
{
    private readonly HashSet<string> _dirtyEditors = new(StringComparer.Ordinal);
    private IJSObjectReference? _module;
    private bool _isEnabled;

    public void SetDirty(string editorId, bool isDirty)
    {
        var changed = isDirty ? _dirtyEditors.Add(editorId) : _dirtyEditors.Remove(editorId);
        if (!changed) return;
        var shouldEnable = _dirtyEditors.Count > 0;
        if (shouldEnable == _isEnabled) return;
        _isEnabled = shouldEnable;
        _ = ApplyAsync(shouldEnable);
    }

    private async Task ApplyAsync(bool enabled)
    {
        try
        {
            _module ??= await js.InvokeAsync<IJSObjectReference>("getLoveevo");
            await _module.InvokeVoidAsync("setBeforeUnload", enabled);
        }
        catch (JSException)
        {
            // The current session remains usable if the optional unload guard cannot attach.
        }
    }
}
