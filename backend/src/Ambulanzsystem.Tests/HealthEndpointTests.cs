using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Ambulanzsystem.Api.Endpoints;
using Ambulanzsystem.Api.Realtime;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Ambulanzsystem.Tests;

public class HealthEndpointTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public void DatabaseFailure_EvaluatesUnhealthy503()
    {
        var result = HealthEndpoint.Evaluate(databaseHealthy: false, dispatcherHealthy: true, pendingCount: 0);

        Assert.Equal(503, result.StatusCode);
        Assert.Equal("unhealthy", result.Status);
        Assert.Equal("unhealthy", result.Database);
        Assert.Equal("healthy", result.Realtime);
    }

    [Fact]
    public async Task HealthyDependencies_ReturnHealthy200()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("healthy", body.GetProperty("status").GetString());
        Assert.Equal("healthy", body.GetProperty("database").GetString());
        Assert.Equal("healthy", body.GetProperty("realtime").GetString());
    }

    [Fact]
    public async Task DispatcherFailure_ReturnsUnhealthy503()
    {
        var realtime = factory.Services.GetRequiredService<RealtimePublisher>();
        realtime.DispatcherHealthy = false;
        try
        {
            using var client = factory.CreateClient();
            var response = await client.GetAsync("/health");
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();

            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
            Assert.Equal("unhealthy", body.GetProperty("status").GetString());
            Assert.Equal("unhealthy", body.GetProperty("realtime").GetString());
        }
        finally
        {
            realtime.DispatcherHealthy = true;
        }
    }

    [Fact]
    public async Task PendingQueueAlone_ReturnsDegraded200()
    {
        using var noDispatcherFactory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            var dispatcher = services.Single(descriptor =>
                descriptor.ServiceType == typeof(IHostedService) &&
                descriptor.ImplementationType == typeof(RealtimeDispatcher));
            services.Remove(dispatcher);
        }));
        var realtime = noDispatcherFactory.Services.GetRequiredService<RealtimePublisher>();
        realtime.Publish("scene:1", "test", new { });
        using var client = noDispatcherFactory.CreateClient();

        var response = await client.GetAsync("/health");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("degraded", body.GetProperty("status").GetString());
        Assert.Equal("degraded", body.GetProperty("realtime").GetString());
    }
}
