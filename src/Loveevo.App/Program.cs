using Atlas.Blazor.DependencyInjection;
using Loveevo.App;
using Loveevo.App.Services;
using Loveevo.Core.Services;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Microsoft.Extensions.Localization;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddAtlasWorkspace();
builder.Services.AddLocalization();
builder.Services.AddScoped<BrowserStore>();
builder.Services.AddScoped<ILoveevoStore>(provider => provider.GetRequiredService<BrowserStore>());
builder.Services.AddScoped<LoveevoState>();
builder.Services.AddScoped<ImageService>();
builder.Services.AddScoped<BackupService>();
builder.Services.AddScoped<TimelineFilterState>();
builder.Services.AddScoped<EditorDirtyRegistry>();
builder.Services.AddScoped<BeforeUnloadGuard>();
builder.Services.AddScoped<DialogService>();

await builder.Build().RunAsync();
