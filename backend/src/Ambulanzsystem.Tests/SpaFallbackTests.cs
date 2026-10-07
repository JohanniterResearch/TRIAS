using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Ambulanzsystem.Tests;

// The SPA fallback is only mapped when wwwroot/index.html exists, so these tests supply their own web root.
public class SpaFallbackTests : IDisposable
{
    private readonly DirectoryInfo webRoot = Directory.CreateTempSubdirectory("ambulanz-spa-");

    [Theory]
    [InlineData("/")]
    [InlineData("/login")]
    [InlineData("/admin/dashboard")]
    public async Task AppRoute_ServesIndexAsHtml(string path)
    {
        File.WriteAllText(Path.Combine(webRoot.FullName, "index.html"), "<!doctype html><title>spa</title>");
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseWebRoot(webRoot.FullName));
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("<title>spa</title>", await response.Content.ReadAsStringAsync());
    }

    public void Dispose() => webRoot.Delete(recursive: true);
}
