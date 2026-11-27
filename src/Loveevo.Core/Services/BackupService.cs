using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Loveevo.Core.Services;

public sealed class BackupFile
{
    public string Path { get; set; } = string.Empty;
    public string Sha256 { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
}

public sealed class BackupManifest
{
    public int FormatVersion { get; set; } = 1;
    public string AppVersion { get; set; } = "1.0.0";
    public DateTimeOffset ExportedAt { get; set; }
    public int StageCount { get; set; }
    public int EventCount { get; set; }
    public int PhotoCount { get; set; }
    public List<BackupFile> Files { get; set; } = [];
}

public sealed class BackupResult
{
    public byte[] Data { get; set; } = [];
    public string FileName { get; set; } = string.Empty;
}

public sealed class BackupService(ILoveevoStore store)
{
    public const int CurrentFormatVersion = 1;
    private const long MaxJsonBytes = 16 * 1024 * 1024;
    private const long MaxPhotoBytes = 25 * 1024 * 1024;
    private const long MaxLayoutBytes = 4 * 1024 * 1024;
    private const long MaxTotalUncompressedBytes = 256 * 1024 * 1024;
    private const int MaxArchiveEntries = 10_000;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public async Task<BackupResult> ExportAsync(CancellationToken cancellationToken = default)
    {
        var data = await store.LoadAsync(cancellationToken);
        var layout = await store.GetLayoutAsync(cancellationToken);
        var manifest = new BackupManifest
        {
            ExportedAt = DateTimeOffset.UtcNow,
            StageCount = data.Stages.Count,
            EventCount = data.Events.Count
        };

        using var buffer = new MemoryStream();
        using (var archive = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            var dataBytes = JsonSerializer.SerializeToUtf8Bytes(data, JsonOptions);
            AddEntry(archive, "loveevo.json", dataBytes, manifest);
            if (!string.IsNullOrWhiteSpace(layout))
                AddEntry(archive, "layout.xml", Encoding.UTF8.GetBytes(layout), manifest);

            foreach (var photo in data.Events.SelectMany(item => item.Photos))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var bytes = await store.GetPhotoBytesAsync(photo.Id, cancellationToken);
                if (bytes is null)
                    throw new InvalidDataException($"备份失败：找不到照片 {photo.FileName}。");
                AddEntry(archive, $"photos/{photo.Id}.webp", bytes, manifest);
            }

            manifest.PhotoCount = manifest.Files.Count(file => file.Path.StartsWith("photos/", StringComparison.Ordinal));
            var manifestBytes = JsonSerializer.SerializeToUtf8Bytes(manifest, JsonOptions);
            var entry = archive.CreateEntry("manifest.json", CompressionLevel.Optimal);
            await using var stream = entry.Open();
            await stream.WriteAsync(manifestBytes, cancellationToken);
        }

        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        return new BackupResult
        {
            Data = buffer.ToArray(),
            FileName = $"loveevo-backup-{stamp}.zip"
        };
    }

    public async Task<BackupImportSummary> ImportAsync(
        byte[] backupBytes,
        bool replaceAll,
        CancellationToken cancellationToken = default)
    {
        using var input = new MemoryStream(backupBytes, writable: false);
        using var archive = new ZipArchive(input, ZipArchiveMode.Read);
        ValidateArchiveShape(archive);
        var manifestEntry = archive.GetEntry("manifest.json")
            ?? throw new InvalidDataException("备份缺少 manifest.json。");
        var manifest = await ReadJsonAsync<BackupManifest>(manifestEntry, cancellationToken)
            ?? throw new InvalidDataException("备份清单无法读取。");

        if (manifest.FormatVersion != CurrentFormatVersion)
            throw new InvalidDataException($"不支持备份格式版本 {manifest.FormatVersion}。");
        if (manifest.Files is null || manifest.StageCount < 0 || manifest.EventCount < 0 || manifest.PhotoCount < 0)
            throw new InvalidDataException("备份清单无效。");

        var dataEntry = archive.GetEntry("loveevo.json")
            ?? throw new InvalidDataException("备份缺少 loveevo.json。");
        var imported = await ReadJsonAsync<LoveevoData>(dataEntry, cancellationToken)
            ?? throw new InvalidDataException("备份数据无法读取。");

        if (imported.SchemaVersion > LoveevoData.CurrentSchemaVersion)
            throw new InvalidDataException("备份来自更新版本，无法安全导入。");

        ValidateArchive(archive, manifest);
        if (manifest.StageCount != imported.Stages.Count || manifest.EventCount != imported.Events.Count)
            throw new InvalidDataException("备份清单与数据记录数量不一致。");

        ValidateImportedData(imported, manifest);
        var puts = new List<PhotoWrite>();
        foreach (var photo in imported.Events.SelectMany(item => item.Photos))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var entry = archive.GetEntry($"photos/{photo.Id}.webp")
                ?? throw new InvalidDataException($"备份缺少照片 {photo.Id}。");
            await using var source = entry.Open();
            using var target = new MemoryStream();
            await source.CopyToAsync(target, cancellationToken);
            if (target.Length > MaxPhotoBytes)
                throw new InvalidDataException($"照片 {photo.FileName} 超过导入大小限制。");
            puts.Add(new PhotoWrite(photo, target.ToArray()));
        }

        string? layout = null;
        var layoutEntry = archive.GetEntry("layout.xml");
        if (layoutEntry is not null)
        {
            await using var layoutStream = layoutEntry.Open();
            using var reader = new StreamReader(layoutStream);
            layout = await reader.ReadToEndAsync(cancellationToken);
        }

        for (var attempt = 0; attempt < 5; attempt += 1)
        {
            var current = await store.LoadAsync(cancellationToken);
            var merged = replaceAll ? imported : Merge(current, imported);
            var deletes = current.Events
                .Where(existing => imported.Events.Any(item => item.Id == existing.Id))
                .SelectMany(existing => existing.Photos)
                .Where(photo => imported.Events.First(item => item.Id == photo.EventId).Photos.All(candidate => candidate.Id != photo.Id))
                .Select(photo => photo.Id)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            try
            {
                await store.CommitAsync(merged, puts, deletes, replaceAll, current.Revision, layout, cancellationToken);
                return new BackupImportSummary
                {
                    StageCount = imported.Stages.Count,
                    EventCount = imported.Events.Count,
                    PhotoCount = puts.Count,
                    ReplacedExistingData = replaceAll
                };
            }
            catch (ConcurrencyConflictException) when (attempt < 4)
            {
                continue;
            }
        }
        throw new ConcurrencyConflictException();
    }

    private static LoveevoData Merge(LoveevoData current, LoveevoData imported)
    {
        current.Profile = imported.Profile;
        current.Preferences = imported.Preferences;
        foreach (var stage in imported.Stages)
        {
            var index = current.Stages.FindIndex(item => item.Id == stage.Id);
            if (index >= 0) current.Stages[index] = stage;
            else current.Stages.Add(stage);
        }

        foreach (var item in imported.Events)
        {
            var index = current.Events.FindIndex(existing => existing.Id == item.Id);
            if (index >= 0) current.Events[index] = item;
            else current.Events.Add(item);
        }

        Normalize(current);
        return current;
    }

    private static void ValidateArchiveShape(ZipArchive archive)
    {
        var entries = archive.Entries.Where(entry => !string.IsNullOrEmpty(entry.Name)).ToArray();
        if (entries.Length > MaxArchiveEntries)
            throw new InvalidDataException("备份条目过多。");
        var total = entries.Sum(entry => entry.Length);
        if (total > MaxTotalUncompressedBytes)
            throw new InvalidDataException("备份解压后的大小超过安全限制。");
        if (entries.SingleOrDefault(entry => entry.FullName == "manifest.json")?.Length > MaxJsonBytes)
            throw new InvalidDataException("备份清单过大。");
        if (entries.SingleOrDefault(entry => entry.FullName == "loveevo.json")?.Length > MaxJsonBytes)
            throw new InvalidDataException("备份数据过大。");
        if (entries.SingleOrDefault(entry => entry.FullName == "layout.xml")?.Length > MaxLayoutBytes)
            throw new InvalidDataException("布局文件过大。");
    }

    private static void ValidateImportedData(LoveevoData data, BackupManifest manifest)
    {
        if (data.Stages is null || data.Events is null || data.Profile is null || data.Preferences is null ||
            data.Stages.Any(stage => stage is null) || data.Events.Any(item => item is null))
            throw new InvalidDataException("备份数据结构无效。");
        if (data.Stages.Select(stage => stage.Id).Distinct(StringComparer.Ordinal).Count() != data.Stages.Count ||
            data.Events.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count() != data.Events.Count)
            throw new InvalidDataException("备份包含重复的阶段或事件 ID。");

        var today = DateOnly.FromDateTime(DateTime.Today);
        foreach (var stage in data.Stages)
        {
            if (string.IsNullOrWhiteSpace(stage.Id) || LoveevoValidation.ValidateStage(stage, data).Count > 0)
                throw new InvalidDataException("备份包含无效阶段。");
        }
        foreach (var item in data.Events)
        {
            if (item.Photos is null || item.MoodTags is null || item.Photos.Any(photo => photo is null))
                throw new InvalidDataException("备份事件结构无效。");
        }
        var allPhotos = data.Events.SelectMany(item => item.Photos).ToList();
        if (allPhotos.Select(photo => photo.Id).Distinct(StringComparer.Ordinal).Count() != allPhotos.Count)
            throw new InvalidDataException("备份包含重复照片 ID。");
        foreach (var item in data.Events)
        {
            if (string.IsNullOrWhiteSpace(item.Id) || LoveevoValidation.ValidateEvent(item, data, today).Count > 0)
                throw new InvalidDataException($"备份包含无效事件：{item.Title}。");
            foreach (var photo in item.Photos)
            {
                if (string.IsNullOrWhiteSpace(photo.Id) || photo.EventId != item.Id || photo.SizeBytes <= 0 || photo.SizeBytes > MaxPhotoBytes)
                    throw new InvalidDataException("备份包含无效照片元数据。");
            }
        }
        if (LoveevoValidation.ValidateProfile(data.Profile, today).Count > 0)
            throw new InvalidDataException("备份包含无效关系资料。");
        if (manifest.PhotoCount != data.Events.Sum(item => item.Photos.Count))
            throw new InvalidDataException("备份清单与照片数量不一致。");
    }

    private static void ValidateArchive(ZipArchive archive, BackupManifest manifest)
    {
        var entries = archive.Entries.ToDictionary(entry => entry.FullName, StringComparer.Ordinal);
        var expectedPaths = manifest.Files.Select(file => file.Path).Append("manifest.json").ToHashSet(StringComparer.Ordinal);
        if (entries.Count != expectedPaths.Count || entries.Keys.Any(path => !expectedPaths.Contains(path)))
            throw new InvalidDataException("备份包含未声明或缺失的文件。");
        foreach (var file in manifest.Files)
        {
            if (string.IsNullOrWhiteSpace(file.Path) ||
                file.Path.Contains("..", StringComparison.Ordinal) ||
                file.Path.StartsWith('/') ||
                file.Path.Contains('\\'))
                throw new InvalidDataException("备份包含不安全路径。");

            if (!entries.TryGetValue(file.Path, out var entry))
                throw new InvalidDataException($"备份缺少文件 {file.Path}。");
            if (entry.Length != file.SizeBytes)
                throw new InvalidDataException($"文件大小不匹配：{file.Path}。");
            using var stream = entry.Open();
            var hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            if (!string.Equals(hash, file.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"文件校验失败：{file.Path}。");
        }
    }

    private static void AddEntry(ZipArchive archive, string path, byte[] bytes, BackupManifest manifest)
    {
        var entry = archive.CreateEntry(path, CompressionLevel.Optimal);
        using var stream = entry.Open();
        stream.Write(bytes);
        manifest.Files.Add(new BackupFile
        {
            Path = path,
            SizeBytes = bytes.LongLength,
            Sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()
        });
    }

    private static async Task<T?> ReadJsonAsync<T>(ZipArchiveEntry entry, CancellationToken cancellationToken)
    {
        await using var stream = entry.Open();
        return await JsonSerializer.DeserializeAsync<T>(stream, JsonOptions, cancellationToken);
    }

    private static void Normalize(LoveevoData data)
    {
        var order = 0;
        foreach (var stage in data.Stages.OrderBy(item => item.SortOrder))
            stage.SortOrder = order++;
        foreach (var item in data.Events)
        {
            item.Title = item.Title.Trim();
            item.Location = item.Location.Trim();
            item.MoodTags = item.MoodTags.Distinct(StringComparer.Ordinal).ToList();
            var photoOrder = 0;
            foreach (var photo in item.Photos.OrderBy(photo => photo.SortOrder))
                photo.SortOrder = photoOrder++;
            if (item.Photos.Count > 0 && item.Photos.All(photo => !photo.IsCover))
                item.Photos.OrderBy(photo => photo.SortOrder).First().IsCover = true;
        }
    }
}

public sealed class BackupImportSummary
{
    public int StageCount { get; set; }
    public int EventCount { get; set; }
    public int PhotoCount { get; set; }
    public bool ReplacedExistingData { get; set; }
}
