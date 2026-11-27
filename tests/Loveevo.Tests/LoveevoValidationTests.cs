using Loveevo.Core.Models;
using Loveevo.Core.Validation;

namespace Loveevo.Tests;

public sealed class LoveevoValidationTests
{
    [Fact]
    public void EventRejectsFutureDateAndMissingTitle()
    {
        var data = new LoveevoData();
        var item = new RelationshipEvent
        {
            StageId = data.Stages[0].Id,
            OccurredOn = DateOnly.FromDateTime(DateTime.Today).AddDays(1)
        };

        var issues = LoveevoValidation.ValidateEvent(item, data, DateOnly.FromDateTime(DateTime.Today));

        Assert.Contains(issues, issue => issue.PropertyName == nameof(item.Title));
        Assert.Contains(issues, issue => issue.PropertyName == nameof(item.OccurredOn));
    }

    [Fact]
    public void StageNamesAreTrimmedAndCaseInsensitiveForDuplicates()
    {
        var data = new LoveevoData();
        data.Stages.Add(new RelationshipStage { Id = "custom", Name = "Travel" });

        var issues = LoveevoValidation.ValidateStage(
            new RelationshipStage { Id = "other", Name = " travel " }, data);

        Assert.Contains(issues, issue => issue.PropertyName == nameof(RelationshipStage.Name));
    }

    [Fact]
    public void EventRejectsMoreThanNinePhotos()
    {
        var data = new LoveevoData();
        var item = new RelationshipEvent
        {
            StageId = data.Stages[0].Id,
            OccurredOn = DateOnly.FromDateTime(DateTime.Today),
            Title = "A day",
            Photos = Enumerable.Range(0, 10).Select(_ => new EventPhoto()).ToList()
        };

        var issues = LoveevoValidation.ValidateEvent(item, data, DateOnly.FromDateTime(DateTime.Today));

        Assert.Contains(issues, issue => issue.PropertyName == nameof(item.Photos));
    }
}
