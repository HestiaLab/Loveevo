using Loveevo.App.Services;
using Loveevo.Core.Models;
using Loveevo.Core.Services;

namespace Loveevo.Tests;

public sealed class LoveevoStateTests
{
    [Fact]
    public async Task SaveTrashAndRestoreKeepEventAndPhotos()
    {
        var store = new FakeStore();
        var state = new LoveevoState(store);
        await state.InitializeAsync();
        var item = new RelationshipEvent
        {
            StageId = state.Data.Stages[0].Id,
            OccurredOn = state.Today,
            Title = "First meeting"
        };

        await state.SaveEventAsync(item, [new PhotoUpload("photo.jpg", "image/webp", [1, 2, 3], 10, 10, 3, "abc")]);
        await state.MoveToTrashAsync(item.Id);

        Assert.Empty(state.VisibleEvents);
        Assert.Single(state.TrashedEvents);
        await state.RestoreAsync(item.Id);
        var restored = Assert.Single(state.VisibleEvents);
        Assert.Single(restored.Photos);
        Assert.Equal(new byte[] { 1, 2, 3 }, await store.GetPhotoBytesAsync(restored.Photos[0].Id));
    }

    [Fact]
    public async Task StageWithEventsCannotBeDeleted()
    {
        var store = new FakeStore();
        var state = new LoveevoState(store);
        await state.InitializeAsync();
        var stage = new RelationshipStage { Name = "Travel", IconKey = "heart", Color = "#fff" };
        await state.SaveStageAsync(stage);
        await state.SaveEventAsync(new RelationshipEvent { StageId = stage.Id, OccurredOn = state.Today, Title = "Trip" });

        await Assert.ThrowsAsync<InvalidOperationException>(() => state.DeleteStageAsync(stage.Id));
    }

    [Fact]
    public async Task PermanentDeleteRemovesPhotoBytes()
    {
        var store = new FakeStore();
        var state = new LoveevoState(store);
        await state.InitializeAsync();
        var item = new RelationshipEvent { StageId = state.Data.Stages[0].Id, OccurredOn = state.Today, Title = "Photo day" };
        await state.SaveEventAsync(item, [new PhotoUpload("photo.jpg", "image/webp", [4, 5, 6], 10, 10, 3, "def")]);
        var photoId = state.Data.Events.Single().Photos.Single().Id;
        await state.MoveToTrashAsync(item.Id);
        await state.DeleteForeverAsync(item.Id);

        Assert.Null(await store.GetPhotoBytesAsync(photoId));
        Assert.Empty(state.Data.Events);
    }

    [Fact]
    public async Task EditingOutAPhotoRemovesItsStoredBytes()
    {
        var store = new FakeStore();
        var state = new LoveevoState(store);
        await state.InitializeAsync();
        var item = new RelationshipEvent { StageId = state.Data.Stages[0].Id, OccurredOn = state.Today, Title = "Photo day" };
        await state.SaveEventAsync(item, [new PhotoUpload("photo.jpg", "image/webp", [4, 5, 6], 10, 10, 3, "def")]);
        var saved = state.Data.Events.Single();
        var photoId = saved.Photos.Single().Id;
        saved.Photos.Clear();

        await state.SaveEventAsync(saved);

        Assert.Null(await store.GetPhotoBytesAsync(photoId));
    }

    [Fact]
    public async Task ConcurrentWritersDoNotLoseIndependentEvents()
    {
        var store = new FakeStore();
        var first = new LoveevoState(store);
        var second = new LoveevoState(store);
        await first.InitializeAsync();
        await second.InitializeAsync();

        await first.SaveEventAsync(new RelationshipEvent { StageId = first.Data.Stages[0].Id, OccurredOn = first.Today, Title = "First tab" });
        await second.SaveEventAsync(new RelationshipEvent { StageId = second.Data.Stages[0].Id, OccurredOn = second.Today, Title = "Second tab" });

        var data = await store.LoadAsync();
        Assert.Equal(2, data.Events.Count);
    }

    [Fact]
    public async Task StaleEditCannotReviveAnEventMovedToTrash()
    {
        var store = new FakeStore();
        var first = new LoveevoState(store);
        var second = new LoveevoState(store);
        await first.InitializeAsync();
        await second.InitializeAsync();
        var item = new RelationshipEvent { StageId = first.Data.Stages[0].Id, OccurredOn = first.Today, Title = "Original" };
        await first.SaveEventAsync(item);
        await second.ReloadAsync();
        var stale = second.Data.Events.Single();
        await first.MoveToTrashAsync(item.Id);
        stale.Title = "Stale edit";

        await Assert.ThrowsAsync<InvalidOperationException>(() => second.SaveEventAsync(stale));
        var restored = (await store.LoadAsync()).Events.Single();
        Assert.NotNull(restored.DeletedAt);
        Assert.Equal("Original", restored.Title);
    }

    [Fact]
    public async Task StaleEditCannotOverwriteANewerVersion()
    {
        var store = new FakeStore();
        var first = new LoveevoState(store);
        var second = new LoveevoState(store);
        await first.InitializeAsync();
        await second.InitializeAsync();
        var item = new RelationshipEvent { StageId = first.Data.Stages[0].Id, OccurredOn = first.Today, Title = "Original" };
        await first.SaveEventAsync(item);
        await second.ReloadAsync();
        var stale = second.Data.Events.Single();
        var fresh = first.Data.Events.Single();
        fresh.Title = "Updated in first tab";
        await first.SaveEventAsync(fresh);
        stale.Title = "Stale update";

        await Assert.ThrowsAsync<InvalidOperationException>(() => second.SaveEventAsync(stale));
        Assert.Equal("Updated in first tab", (await store.LoadAsync()).Events.Single().Title);
    }
}
