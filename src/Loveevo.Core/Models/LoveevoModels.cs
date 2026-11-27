namespace Loveevo.Core.Models;

public sealed class RelationshipProfile
{
    public string PartnerOneName { get; set; } = string.Empty;
    public string PartnerTwoName { get; set; } = string.Empty;
    public DateOnly? StartDate { get; set; }
}

public sealed class RelationshipStage
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = string.Empty;
    public string IconKey { get; set; } = "heart";
    public string Color { get; set; } = "#d97793";
    public int SortOrder { get; set; }
    public bool IsPreset { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class RelationshipEvent
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string StageId { get; set; } = string.Empty;
    public DateOnly OccurredOn { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Story { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public List<string> MoodTags { get; set; } = [];
    public List<EventPhoto> Photos { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DeletedAt { get; set; }
}

public sealed class EventPhoto
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string EventId { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = "image/webp";
    public int Width { get; set; }
    public int Height { get; set; }
    public long SizeBytes { get; set; }
    public string Sha256 { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public bool IsCover { get; set; }
}

public sealed class LoveevoData
{
    public const int CurrentSchemaVersion = 1;
    public int SchemaVersion { get; set; } = CurrentSchemaVersion;
    public long Revision { get; set; }
    public RelationshipProfile Profile { get; set; } = new();
    public List<RelationshipStage> Stages { get; set; } = DefaultStages();
    public List<RelationshipEvent> Events { get; set; } = [];
    public AppPreferences Preferences { get; set; } = new();

    public static List<RelationshipStage> DefaultStages() =>
    [
        new() { Id = "preset-meet", Name = "见面", IconKey = "coffee", Color = "#d69a72", SortOrder = 0, IsPreset = true },
        new() { Id = "preset-hand", Name = "牵手", IconKey = "hand", Color = "#d97793", SortOrder = 1, IsPreset = true },
        new() { Id = "preset-hug", Name = "拥抱", IconKey = "hug", Color = "#a98ac7", SortOrder = 2, IsPreset = true },
        new() { Id = "preset-kiss", Name = "亲吻", IconKey = "heart", Color = "#e26f8d", SortOrder = 3, IsPreset = true }
    ];
}

public sealed class AppPreferences
{
    public string Theme { get; set; } = "system";
    public bool PrivacyMode { get; set; }
    public bool OnboardingCompleted { get; set; }
    public string TimelineSort { get; set; } = "ascending";
}

public sealed record PhotoUpload(
    string FileName,
    string ContentType,
    byte[] Data,
    int Width,
    int Height,
    long SizeBytes,
    string Sha256);
