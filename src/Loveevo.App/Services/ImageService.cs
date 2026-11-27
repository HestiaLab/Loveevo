using Loveevo.Core.Models;
using Microsoft.JSInterop;

namespace Loveevo.App.Services;

public sealed class ImageService(IJSRuntime js)
{
    private IJSObjectReference? _module;
    private static readonly HashSet<string> AllowedContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/webp", "image/gif"
    };

    public async Task<PhotoUpload> CompressAsync(string fileName, string contentType, byte[] data)
    {
        if (!AllowedContentTypes.Contains(contentType))
            throw new InvalidOperationException("仅支持 JPEG、PNG、WebP 和 GIF 图片。");
        if (data.LongLength > Loveevo.Core.Validation.LoveevoValidation.MaxPhotoBytes)
            throw new InvalidOperationException("单张照片不能超过 10MB。");

        var module = await GetModuleAsync();
        var result = await module.InvokeAsync<CompressedImage>("compressImage", Convert.ToBase64String(data), contentType, 1600);
        return new PhotoUpload(
            Path.GetFileName(fileName),
            result.ContentType,
            Convert.FromBase64String(result.Base64),
            result.Width,
            result.Height,
            result.SizeBytes,
            result.Sha256);
    }

    private async ValueTask<IJSObjectReference> GetModuleAsync() =>
        _module ??= await js.InvokeAsync<IJSObjectReference>("getLoveevo");

    private sealed class CompressedImage
    {
        public string Base64 { get; set; } = string.Empty;
        public string ContentType { get; set; } = string.Empty;
        public int Width { get; set; }
        public int Height { get; set; }
        public long SizeBytes { get; set; }
        public string Sha256 { get; set; } = string.Empty;
    }
}
