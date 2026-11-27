using System.IO.Compression;
using Loveevo.Core.Models;
using Loveevo.Core.Services;

namespace Loveevo.Tests;

public sealed class BackupServiceTests
{
    [Fact]
    public async Task ZipBackupRoundTripsEventsPhotosTrashAndLayout()
    {
        var source = new FakeStore();
        var state = new Loveevo.App.Services.LoveevoState(source);
        await state.InitializeAsync();
        var item = new RelationshipEvent
        {
            StageId = state.Data.Stages[1].Id,
            OccurredOn = state.Today.AddDays(-2),
            Title = "Held hands",
            Story = "By the river.",
            MoodTags = ["心动"]
        };
        await state.SaveEventAsync(item, [new PhotoUpload("hands.jpg", "image/webp", [7, 8, 9], 20, 20, 3, "hash")]);
        await state.MoveToTrashAsync(item.Id);
        await source.SaveLayoutAsync("<atlas />");
        var backupService = new BackupService(source);

        var backup = await backupService.ExportAsync();
        var target = new FakeStore();
        var summary = await new BackupService(target).ImportAsync(backup.Data, replaceAll: true);

        Assert.Equal(1, summary.EventCount);
        Assert.Equal(1, summary.PhotoCount);
        var restored = await target.LoadAsync();
        var restoredEvent = Assert.Single(restored.Events);
        Assert.NotNull(restoredEvent.DeletedAt);
        Assert.Equal("Held hands", restoredEvent.Title);
        Assert.Equal(new byte[] { 7, 8, 9 }, await target.GetPhotoBytesAsync(restoredEvent.Photos[0].Id));
        Assert.Equal("<atlas />", await target.GetLayoutAsync());
    }

    [Fact]
    public async Task TamperedBackupIsRejectedWithoutChangingTarget()
    {
        var source = new FakeStore();
        var state = new Loveevo.App.Services.LoveevoState(source);
        await state.InitializeAsync();
        await state.SaveEventAsync(new RelationshipEvent { StageId = state.Data.Stages[0].Id, OccurredOn = state.Today, Title = "Original" });
        var backup = await new BackupService(source).ExportAsync();
        using var input = new MemoryStream(backup.Data, writable: false);
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(input, ZipArchiveMode.Read))
        using (var modified = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var entry in archive.Entries)
            {
                var destination = modified.CreateEntry(entry.FullName);
                await using var sourceStream = entry.Open();
                await using var destinationStream = destination.Open();
                if (entry.FullName == "loveevo.json")
                {
                    var bytes = System.Text.Encoding.UTF8.GetBytes("{\"tampered\":true}");
                    await destinationStream.WriteAsync(bytes);
                }
                else
                {
                    await sourceStream.CopyToAsync(destinationStream);
                }
            }
        }

        var target = new FakeStore();
        await Assert.ThrowsAsync<InvalidDataException>(() => new BackupService(target).ImportAsync(output.ToArray(), replaceAll: true));
        Assert.Empty((await target.LoadAsync()).Events);
    }

    [Fact]
    public async Task BackupRejectsPhotoOwnedByAnotherEvent()
    {
        var source = new FakeStore();
        var item = new RelationshipEvent
        {
            Id = "event-1",
            StageId = "preset-meet",
            OccurredOn = DateOnly.FromDateTime(DateTime.Today),
            Title = "Photo"
        };
        var photo = new EventPhoto { Id = "photo-1", EventId = "event-2", FileName = "photo.webp", SizeBytes = 3, Sha256 = "hash" };
        item.Photos.Add(photo);
        var data = new LoveevoData();
        data.Events.Add(item);
        await source.CommitAsync(data, [new PhotoWrite(photo, [1, 2, 3])]);
        var backup = await new BackupService(source).ExportAsync();

        await Assert.ThrowsAsync<InvalidDataException>(() => new BackupService(new FakeStore()).ImportAsync(backup.Data, replaceAll: true));
    }

    [Fact]
    public async Task MergeImportDeduplicatesStableIds()
    {
        var source = new FakeStore();
        var state = new Loveevo.App.Services.LoveevoState(source);
        await state.InitializeAsync();
        await state.SaveEventAsync(new RelationshipEvent { StageId = state.Data.Stages[0].Id, OccurredOn = state.Today, Title = "Coffee" });
        var backup = await new BackupService(source).ExportAsync();

        var target = new FakeStore();
        var targetState = new Loveevo.App.Services.LoveevoState(target);
        await targetState.InitializeAsync();
        await new BackupService(target).ImportAsync(backup.Data, replaceAll: false);

        var restored = await target.LoadAsync();
        Assert.Single(restored.Events);
        Assert.Single(restored.Stages, stage => stage.Id == "preset-meet");
    }
}
