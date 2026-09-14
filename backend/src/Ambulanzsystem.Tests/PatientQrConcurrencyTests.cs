using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

// Runs against the dev docker-compose Postgres, same convention as AuthFlowTests.
public class PatientQrConcurrencyTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record TokenBearing(string? token);
    private record SceneBearing(int id);
    private record PatientBearing(int id);
    private record VerifyResult(PatientBearing patient, bool created);

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    [Fact]
    public async Task ConcurrentScansOfSameCode_CreateExactlyOnePatient()
    {
        // The core safety property from UC-04: two responders' devices scanning the same
        // physical QR tag at the same moment must never create two patient records. Backed by a
        // `SELECT ... FOR UPDATE` row lock in PersonsController.VerifyQrCode.
        var admin = await AdminClientAsync();

        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"concurrency-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;

        var generated = await (await admin.PostAsJsonAsync("/api/patient-qr-codes/generate", new { number = 1 }))
            .Content.ReadFromJsonAsync<string[]>();
        var code = generated![0];

        var token = admin.DefaultRequestHeaders.Authorization!.Parameter;
        var tasks = Enumerable.Range(0, 12).Select(async _ =>
        {
            // Separate HttpClient per call for genuine concurrency, but ONE shared login — the
            // login endpoints are rate-limited (NFR-SEC-05) and this test's concern is the QR
            // row lock, not auth.
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);
            var res = await client.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = code, operationSceneId = scene.id });
            res.EnsureSuccessStatusCode();
            return (await res.Content.ReadFromJsonAsync<VerifyResult>())!;
        });

        var results = await Task.WhenAll(tasks);

        var distinctPatientIds = results.Select(r => r.patient.id).Distinct().ToList();
        Assert.Single(distinctPatientIds);
        Assert.Single(results, r => r.created);
    }
}
