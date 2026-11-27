using System.Text.Json;
using Loveevo.Core.Models;
using Loveevo.Core.Services;
using Microsoft.JSInterop;

namespace Loveevo.App.Services;

public sealed class BrowserStore : ILoveevoStore, IAsyncDisposable
{
    private readonly IJSRuntime _js;
    private IJSObjectReference? _module;
    private IJSObjectReference? _connection;
    private DotNetObjectReference<StoreSyncCallback>? _callbackReference;
    private readonly StoreSyncCallback _callback = new();

    public BrowserStore(IJSRuntime js)
    {
        _js = js;
        _callback.Changed += () => DataChanged?.Invoke();
    }

    public event Action? DataChanged;

    private async ValueTask<IJSObjectReference> GetModuleAsync() =>
        _module ??= await _js.InvokeAsync<IJSObjectReference>("getLoveevo");

    public async Task<LoveevoData> LoadAsync(CancellationToken cancellationToken = default)
    {
        var module = await GetModuleAsync();
        var data = await module.InvokeAsync<LoveevoData>("loadData", cancellationToken);
        if (data is not null) return data;
        data = new LoveevoData();
        await CommitAsync(data, cancellationToken: cancellationToken);
        return data;
    }

    public async Task CommitAsync(
        LoveevoData data,
        IReadOnlyList<PhotoWrite>? photosToPut = null,
        IReadOnlyList<string>? photosToDelete = null,
        bool replaceAll = false,
        long? expectedRevision = null,
        string? layoutToSave = null,
        CancellationToken cancellationToken = default)
    {
        var module = await GetModuleAsync();
        var puts = (photosToPut ?? []).Select(item => new
        {
            id = item.Photo.Id,
            contentType = item.Photo.ContentType,
            data = Convert.ToBase64String(item.Data)
        }).ToArray();
        var deletes = photosToDelete?.ToArray() ?? [];
        var result = await module.InvokeAsync<string>("commitData", cancellationToken, data, puts, deletes, replaceAll, expectedRevision, layoutToSave);
        if (result == "conflict") throw new ConcurrencyConflictException();
        data.Revision = (expectedRevision ?? data.Revision) + 1;
    }

    public async Task<byte[]?> GetPhotoBytesAsync(string photoId, CancellationToken cancellationToken = default)
    {
        var module = await GetModuleAsync();
        var base64 = await module.InvokeAsync<string?>("getPhotoBytes", cancellationToken, photoId);
        return base64 is null ? null : Convert.FromBase64String(base64);
    }

    public async Task<string?> GetPhotoDataUrlAsync(string photoId, CancellationToken cancellationToken = default)
    {
        var module = await GetModuleAsync();
        return await module.InvokeAsync<string?>("getPhotoDataUrl", cancellationToken, photoId);
    }

    public async Task<StorageUsage> GetStorageUsageAsync(CancellationToken cancellationToken = default)
    {
        var module = await GetModuleAsync();
        return await module.InvokeAsync<StorageUsage>("getStorageUsage", cancellationToken);
    }

    public async Task<string?> GetLayoutAsync(CancellationToken cancellationToken = default)
    {
        var module = await GetModuleAsync();
        return await module.InvokeAsync<string?>("getLayout", cancellationToken);
    }

    public async Task SaveLayoutAsync(string xml, CancellationToken cancellationToken = default)
    {
        var module = await GetModuleAsync();
        await module.InvokeVoidAsync("saveLayout", cancellationToken, xml);
    }

    public async Task ClearAsync(CancellationToken cancellationToken = default)
    {
        var module = await GetModuleAsync();
        await module.InvokeVoidAsync("clearAll", cancellationToken);
    }

    public async Task StartListeningAsync()
    {
        var module = await GetModuleAsync();
        _callbackReference = DotNetObjectReference.Create(_callback);
        _connection = await module.InvokeAsync<IJSObjectReference>("connect", _callbackReference);
    }

    public async ValueTask DisposeAsync()
    {
        if (_connection is not null)
            await _connection.InvokeVoidAsync("dispose");
        _callbackReference?.Dispose();
        if (_module is not null)
            await _module.DisposeAsync();
    }
}

public sealed class StoreSyncCallback
{
    public event Action? Changed;

    [JSInvokable]
    public void OnDataChanged(JsonElement payload) => Changed?.Invoke();
}
