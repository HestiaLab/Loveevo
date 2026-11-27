using Bunit;
using Loveevo.App.Components;
using Loveevo.App.Services;
using Loveevo.Core.Models;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;

namespace Loveevo.Tests;

public sealed class TimelineComponentTests
{
    [Fact]
    public async Task TimelineRendersEmptyStateThenNewEvent()
    {
        await using var context = new BunitContext();
        var store = new FakeStore();
        var state = new LoveevoState(store);
        await state.InitializeAsync();
        context.Services.AddSingleton(state);
        context.Services.AddSingleton(new TimelineFilterState());
        context.Services.AddSingleton<IJSRuntime, UnconfiguredJSInterop>();
        context.Services.AddSingleton<BrowserStore>();

        var cut = context.Render<Timeline>();
        Assert.Contains("故事才刚刚开始", cut.Markup);

        await state.SaveEventAsync(new RelationshipEvent
        {
            StageId = state.Data.Stages[0].Id,
            OccurredOn = state.Today,
            Title = "第一次见面",
            Story = "在咖啡馆。"
        });

        cut.WaitForAssertion(() => Assert.Contains("第一次见面", cut.Markup));
        Assert.Single(cut.FindAll(".lv-event-card"));
    }

    private sealed class UnconfiguredJSInterop : IJSRuntime
    {
        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) =>
            throw new InvalidOperationException("JS interop is not expected for an empty photo.");

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args) =>
            throw new InvalidOperationException("JS interop is not expected for an empty photo.");
    }
}
