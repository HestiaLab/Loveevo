using System.Text.Json;
using Loveevo.Core.Models;
using Loveevo.Core.Services;
using Loveevo.Core.Validation;

namespace Loveevo.App.Services;

public sealed class LoveevoState
{
    private readonly ILoveevoStore _store;
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private LoveevoData _data = new();
    private bool _isLoading = true;

    public LoveevoState(ILoveevoStore store)
    {
        _store = store;
        if (store is BrowserStore browserStore)
            browserStore.DataChanged += () => _ = ReloadAsync();
    }

    public event Action? Changed;
    public LoveevoData Data => _data;
    public bool IsLoading => _isLoading;
    public DateOnly Today => DateOnly.FromDateTime(DateTime.Today);
    public IReadOnlyList<RelationshipEvent> VisibleEvents =>
        _data.Events.Where(item => item.DeletedAt is null).OrderBy(item => item.OccurredOn).ToList();
    public IReadOnlyList<RelationshipEvent> TrashedEvents =>
        _data.Events.Where(item => item.DeletedAt is not null).OrderByDescending(item => item.DeletedAt).ToList();

    public async Task InitializeAsync()
    {
        _data = await _store.LoadAsync();
        _isLoading = false;
        Changed?.Invoke();
    }

    public async Task ReloadAsync()
    {
        _data = await _store.LoadAsync();
        Changed?.Invoke();
    }

    public async Task SaveEventAsync(
        RelationshipEvent candidate,
        IReadOnlyList<PhotoUpload>? uploads = null,
        IReadOnlyList<string>? deletePhotoIds = null)
    {
        await WriteAsync(data =>
        {
            var item = Clone(candidate);
            item.Title = item.Title.Trim();
            item.Location = item.Location.Trim();
            item.Story = item.Story.Trim();
            item.UpdatedAt = DateTimeOffset.UtcNow;
            item.DeletedAt = null;

            var issues = LoveevoValidation.ValidateEvent(item, data, Today).ToList();
            if (issues.Count > 0) throw new ValidationException(issues);

            var existing = data.Events.FirstOrDefault(existing => existing.Id == item.Id);
            if (existing is not null && existing.UpdatedAt != candidate.UpdatedAt)
                throw new InvalidOperationException("这条事件已在另一个标签页中更新，请关闭后重新打开再编辑。");

            var removed = (deletePhotoIds ?? []).ToHashSet(StringComparer.Ordinal);
            var deletedPhotos = existing?.Photos
                .Where(photo => removed.Contains(photo.Id) || item.Photos.All(current => current.Id != photo.Id))
                .Select(photo => photo.Id)
                .ToList() ?? [];
            item.Photos = item.Photos.Where(photo => !removed.Contains(photo.Id)).ToList();
            var puts = new List<PhotoWrite>();
            foreach (var upload in uploads ?? [])
            {
                if (item.Photos.Count >= LoveevoValidation.MaxPhotosPerEvent)
                    throw new ValidationException([new(nameof(item.Photos), $"每条事件最多 {LoveevoValidation.MaxPhotosPerEvent} 张照片。")]);
                var photo = new EventPhoto
                {
                    EventId = item.Id,
                    FileName = upload.FileName,
                    ContentType = upload.ContentType,
                    Width = upload.Width,
                    Height = upload.Height,
                    SizeBytes = upload.SizeBytes,
                    Sha256 = upload.Sha256,
                    SortOrder = item.Photos.Count
                };
                item.Photos.Add(photo);
                puts.Add(new PhotoWrite(photo, upload.Data));
            }

            var hasCover = item.Photos.Any(photo => photo.IsCover);
            var ordered = item.Photos.OrderBy(photo => photo.SortOrder).ToList();
            for (var index = 0; index < ordered.Count; index += 1)
            {
                ordered[index].SortOrder = index;
                ordered[index].IsCover = !hasCover ? index == 0 : ordered[index].IsCover;
            }
            item.Photos = ordered;

            var indexInData = data.Events.FindIndex(existing => existing.Id == item.Id);
            if (indexInData >= 0) data.Events[indexInData] = item;
            else data.Events.Add(item);

            return new WriteResult(data, puts, deletedPhotos);
        });
    }

    public Task MoveToTrashAsync(string eventId) => WriteAsync(data =>
    {
        var item = data.Events.FirstOrDefault(existing => existing.Id == eventId)
            ?? throw new InvalidOperationException("找不到要删除的事件。");
        item.DeletedAt = DateTimeOffset.UtcNow;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        return new WriteResult(data);
    });

    public Task RestoreAsync(string eventId) => WriteAsync(data =>
    {
        var item = data.Events.FirstOrDefault(existing => existing.Id == eventId)
            ?? throw new InvalidOperationException("找不到要恢复的事件。");
        item.DeletedAt = null;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        return new WriteResult(data);
    });

    public Task DeleteForeverAsync(string eventId) => WriteAsync(data =>
    {
        var item = data.Events.FirstOrDefault(existing => existing.Id == eventId)
            ?? throw new InvalidOperationException("找不到要删除的事件。");
        data.Events.Remove(item);
        return new WriteResult(data, PhotosToDelete: item.Photos.Select(photo => photo.Id).ToList());
    });

    public Task EmptyTrashAsync() => WriteAsync(data =>
    {
        var trashed = data.Events.Where(item => item.DeletedAt is not null).ToList();
        data.Events.RemoveAll(item => item.DeletedAt is not null);
        return new WriteResult(data, PhotosToDelete: trashed.SelectMany(item => item.Photos).Select(photo => photo.Id).ToList());
    });

    public Task SaveStageAsync(RelationshipStage candidate) => WriteAsync(data =>
    {
        var stage = Clone(candidate);
        stage.Name = stage.Name.Trim();
        stage.UpdatedAt = DateTimeOffset.UtcNow;
        var issues = LoveevoValidation.ValidateStage(stage, data).ToList();
        if (issues.Count > 0) throw new ValidationException(issues);
        var index = data.Stages.FindIndex(item => item.Id == stage.Id);
        if (index >= 0)
        {
            if (data.Stages[index].UpdatedAt != candidate.UpdatedAt)
                throw new InvalidOperationException("该阶段已在另一个标签页中更新，请重新打开后再编辑。");
            if (data.Stages[index].IsPreset) stage.IsPreset = true;
            data.Stages[index] = stage;
        }
        else
        {
            stage.SortOrder = data.Stages.Count;
            data.Stages.Add(stage);
        }
        return new WriteResult(data);
    });

    public Task DeleteStageAsync(string stageId) => WriteAsync(data =>
    {
        var stage = data.Stages.FirstOrDefault(item => item.Id == stageId)
            ?? throw new InvalidOperationException("找不到要删除的阶段。");
        if (stage.IsPreset) throw new InvalidOperationException("预置阶段不可删除。");
        if (data.Events.Any(item => item.StageId == stageId))
            throw new InvalidOperationException("该阶段仍有关联事件，请先转移或删除事件。");
        data.Stages.Remove(stage);
        NormalizeStages(data);
        return new WriteResult(data);
    });

    public Task ReorderStagesAsync(IReadOnlyList<string> orderedIds) => WriteAsync(data =>
    {
        var map = data.Stages.ToDictionary(item => item.Id);
        var ordered = orderedIds.Where(map.ContainsKey).Select(id => map[id]).ToList();
        ordered.AddRange(data.Stages.Where(item => !orderedIds.Contains(item.Id)).OrderBy(item => item.SortOrder));
        data.Stages = ordered;
        NormalizeStages(data);
        return new WriteResult(data);
    });

    public Task SaveProfileAsync(RelationshipProfile profile) => WriteAsync(data =>
    {
        data.Profile.PartnerOneName = profile.PartnerOneName.Trim();
        data.Profile.PartnerTwoName = profile.PartnerTwoName.Trim();
        data.Profile.StartDate = profile.StartDate;
        var issues = LoveevoValidation.ValidateProfile(data.Profile, Today).ToList();
        if (issues.Count > 0) throw new ValidationException(issues);
        return new WriteResult(data);
    });

    public Task SavePreferencesAsync(AppPreferences preferences) => WriteAsync(data =>
    {
        data.Preferences = Clone(preferences);
        return new WriteResult(data);
    });

    public async Task ClearAllAsync()
    {
        await _writeGate.WaitAsync();
        try
        {
            await _store.ClearAsync();
            _data = new LoveevoData();
            Changed?.Invoke();
        }
        finally
        {
            _writeGate.Release();
        }
    }

    private async Task WriteAsync(Func<LoveevoData, WriteResult> mutate)
    {
        await _writeGate.WaitAsync();
        try
        {
            for (var attempt = 0; attempt < 5; attempt += 1)
            {
                var latest = await _store.LoadAsync();
                var result = mutate(latest);
                try
                {
                    await _store.CommitAsync(
                        result.Data,
                        result.PhotosToPut,
                        result.PhotosToDelete,
                        result.ReplaceAll,
                        latest.Revision);
                    _data = result.Data;
                    Changed?.Invoke();
                    return;
                }
                catch (ConcurrencyConflictException) when (attempt < 4)
                {
                    continue;
                }
            }
            throw new ConcurrencyConflictException();
        }
        finally
        {
            _writeGate.Release();
        }
    }

    private static void NormalizeStages(LoveevoData data)
    {
        var order = 0;
        foreach (var stage in data.Stages.OrderBy(item => item.SortOrder))
            stage.SortOrder = order++;
    }

    private static T Clone<T>(T value) =>
        JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value)) ?? throw new InvalidOperationException("无法复制数据。");

    private sealed record WriteResult(
        LoveevoData Data,
        IReadOnlyList<PhotoWrite>? PhotosToPut = null,
        IReadOnlyList<string>? PhotosToDelete = null,
        bool ReplaceAll = false);
}

public sealed class ValidationException(IReadOnlyList<ValidationIssue> issues) : Exception(issues.First().Message)
{
    public IReadOnlyList<ValidationIssue> Issues { get; } = issues;
}
