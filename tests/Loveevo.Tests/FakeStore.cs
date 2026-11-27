using System.Text.Json;
using Loveevo.Core.Models;
using Loveevo.Core.Services;

namespace Loveevo.Tests;

public sealed class FakeStore : ILoveevoStore
{
    private LoveevoData _data = new();
    private readonly Dictionary<string, byte[]> _photos = new(StringComparer.Ordinal);
    private string? _layout;
    public int CommitCount { get; private set; }

    public Task<LoveevoData> LoadAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(Clone(_data));

    public Task CommitAsync(
        LoveevoData data,
        IReadOnlyList<PhotoWrite>? photosToPut = null,
        IReadOnlyList<string>? photosToDelete = null,
        bool replaceAll = false,
        long? expectedRevision = null,
        string? layoutToSave = null,
        CancellationToken cancellationToken = default)
    {
        if (expectedRevision is not null && expectedRevision != _data.Revision)
            throw new ConcurrencyConflictException();
        if (replaceAll)
        {
            _photos.Clear();
            _layout = null;
        }
        if (layoutToSave is not null) _layout = layoutToSave;
        _data = Clone(data);
        _data.Revision = (expectedRevision ?? _data.Revision) + 1;
        foreach (var item in photosToPut ?? []) _photos[item.Photo.Id] = item.Data.ToArray();
        foreach (var id in photosToDelete ?? []) _photos.Remove(id);
        CommitCount += 1;
        return Task.CompletedTask;
    }

    public Task<byte[]?> GetPhotoBytesAsync(string photoId, CancellationToken cancellationToken = default) =>
        Task.FromResult(_photos.TryGetValue(photoId, out var bytes) ? bytes.ToArray() : null);

    public Task<StorageUsage> GetStorageUsageAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(new StorageUsage(_photos.Values.Sum(value => value.LongLength), 1024 * 1024));

    public Task<string?> GetLayoutAsync(CancellationToken cancellationToken = default) => Task.FromResult(_layout);
    public Task SaveLayoutAsync(string xml, CancellationToken cancellationToken = default)
    {
        _layout = xml;
        return Task.CompletedTask;
    }

    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        _data = new LoveevoData();
        _photos.Clear();
        _layout = null;
        return Task.CompletedTask;
    }

    private static LoveevoData Clone(LoveevoData data) =>
        JsonSerializer.Deserialize<LoveevoData>(JsonSerializer.Serialize(data))!;
}
