using Loveevo.Core.Models;

namespace Loveevo.App.Services;

public sealed class TimelineFilterState
{
    public string? StageId { get; set; }
    public DateOnly? From { get; set; }
    public DateOnly? To { get; set; }
    public HashSet<string> Moods { get; set; } = new(StringComparer.Ordinal);
    public string Sort { get; set; } = "ascending";
    public event Action? Changed;

    public void NotifyChanged() => Changed?.Invoke();

    public void Clear()
    {
        StageId = null;
        From = null;
        To = null;
        Moods.Clear();
        Sort = "ascending";
        Changed?.Invoke();
    }

    public bool Matches(RelationshipEvent item)
    {
        if (StageId is not null && item.StageId != StageId) return false;
        if (From is not null && item.OccurredOn < From) return false;
        if (To is not null && item.OccurredOn > To) return false;
        return Moods.Count == 0 || Moods.Any(item.MoodTags.Contains);
    }
}
