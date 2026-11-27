namespace Loveevo.App.Services;

public enum CloseDecision { Cancel, Discard, Save }

public sealed class DialogService
{
    private TaskCompletionSource<bool>? _confirmation;
    private TaskCompletionSource<CloseDecision>? _closeDecision;
    public event Action? Changed;

    public bool IsConfirmationOpen => _confirmation is not null;
    public bool IsCloseDecisionOpen => _closeDecision is not null;
    public string Title { get; private set; } = string.Empty;
    public string Message { get; private set; } = string.Empty;
    public string ConfirmText { get; private set; } = "确认";
    public bool IsDestructive { get; private set; }

    public Task<bool> ConfirmAsync(string title, string message, string confirmText = "确认", bool destructive = false)
    {
        _confirmation = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        Title = title;
        Message = message;
        ConfirmText = confirmText;
        IsDestructive = destructive;
        Changed?.Invoke();
        return _confirmation.Task;
    }

    public Task<CloseDecision> RequestCloseDecisionAsync(string title)
    {
        _closeDecision = new TaskCompletionSource<CloseDecision>(TaskCreationOptions.RunContinuationsAsynchronously);
        Title = title;
        Message = "这条事件还有未保存的修改。你想保存、放弃，还是继续编辑？";
        Changed?.Invoke();
        return _closeDecision.Task;
    }

    public void ResolveConfirmation(bool result)
    {
        var source = _confirmation;
        _confirmation = null;
        IsDestructive = false;
        Changed?.Invoke();
        source?.TrySetResult(result);
    }

    public void ResolveCloseDecision(CloseDecision decision)
    {
        var source = _closeDecision;
        _closeDecision = null;
        Changed?.Invoke();
        source?.TrySetResult(decision);
    }
}
