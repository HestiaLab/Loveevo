namespace Loveevo.Core.Validation;

public sealed record ValidationIssue(string PropertyName, string Message);

public static class LoveevoValidation
{
    public const int MaxTitleLength = 80;
    public const int MaxLocationLength = 100;
    public const int MaxStoryLength = 5000;
    public const int MaxStageNameLength = 40;
    public const int MaxPhotosPerEvent = 9;
    public const long MaxPhotoBytes = 10 * 1024 * 1024;

    public static IReadOnlyList<ValidationIssue> ValidateEvent(RelationshipEvent item, LoveevoData data, DateOnly today)
    {
        var issues = new List<ValidationIssue>();
        if (string.IsNullOrWhiteSpace(item.Title))
            issues.Add(new(nameof(item.Title), "请填写事件标题。"));
        else if (item.Title.Trim().Length > MaxTitleLength)
            issues.Add(new(nameof(item.Title), $"标题不能超过 {MaxTitleLength} 字。"));

        if (item.OccurredOn > today)
            issues.Add(new(nameof(item.OccurredOn), "发生日期不能晚于今天。"));

        if (!data.Stages.Any(stage => stage.Id == item.StageId))
            issues.Add(new(nameof(item.StageId), "请选择一个有效阶段。"));

        if (item.Location.Length > MaxLocationLength)
            issues.Add(new(nameof(item.Location), $"地点不能超过 {MaxLocationLength} 字。"));

        if (item.Story.Length > MaxStoryLength)
            issues.Add(new(nameof(item.Story), $"回忆不能超过 {MaxStoryLength} 字。"));

        if (item.Photos.Count > MaxPhotosPerEvent)
            issues.Add(new(nameof(item.Photos), $"每条事件最多 {MaxPhotosPerEvent} 张照片。"));

        return issues;
    }

    public static IReadOnlyList<ValidationIssue> ValidateStage(RelationshipStage stage, LoveevoData data)
    {
        var issues = new List<ValidationIssue>();
        var name = stage.Name.Trim();
        if (string.IsNullOrWhiteSpace(name))
            issues.Add(new(nameof(stage.Name), "请填写阶段名称。"));
        else if (name.Length > MaxStageNameLength)
            issues.Add(new(nameof(stage.Name), $"阶段名称不能超过 {MaxStageNameLength} 字。"));

        if (!string.IsNullOrWhiteSpace(name) && data.Stages.Any(other =>
                other.Id != stage.Id &&
                string.Equals(other.Name.Trim(), name, StringComparison.OrdinalIgnoreCase)))
            issues.Add(new(nameof(stage.Name), "已存在同名阶段。"));

        return issues;
    }

    public static IReadOnlyList<ValidationIssue> ValidateProfile(RelationshipProfile profile, DateOnly today)
    {
        var issues = new List<ValidationIssue>();
        if (profile.PartnerOneName.Trim().Length > 20)
            issues.Add(new(nameof(profile.PartnerOneName), "称呼不能超过 20 字。"));
        if (profile.PartnerTwoName.Trim().Length > 20)
            issues.Add(new(nameof(profile.PartnerTwoName), "称呼不能超过 20 字。"));
        if (profile.StartDate > today)
            issues.Add(new(nameof(profile.StartDate), "开始日期不能晚于今天。"));
        return issues;
    }
}
