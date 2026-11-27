namespace Loveevo.Core.Services;

public sealed record PhotoWrite(EventPhoto Photo, byte[] Data);
public sealed record StorageUsage(long UsageBytes, long QuotaBytes);

public sealed class ConcurrencyConflictException : Exception
{
    public ConcurrencyConflictException() : base("本地数据已在另一个标签页中更新，请重试。") { }
}

public interface ILoveevoStore
{
    Task<LoveevoData> LoadAsync(CancellationToken cancellationToken = default);
    Task CommitAsync(
        LoveevoData data,
        IReadOnlyList<PhotoWrite>? photosToPut = null,
        IReadOnlyList<string>? photosToDelete = null,
        bool replaceAll = false,
        long? expectedRevision = null,
        string? layoutToSave = null,
        CancellationToken cancellationToken = default);
    Task<byte[]?> GetPhotoBytesAsync(string photoId, CancellationToken cancellationToken = default);
    Task<StorageUsage> GetStorageUsageAsync(CancellationToken cancellationToken = default);
    Task<string?> GetLayoutAsync(CancellationToken cancellationToken = default);
    Task SaveLayoutAsync(string xml, CancellationToken cancellationToken = default);
    Task ClearAsync(CancellationToken cancellationToken = default);
}
