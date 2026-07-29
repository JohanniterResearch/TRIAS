using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

// Runs against the dev docker-compose Postgres, same convention as AuthFlowTests.
public class AmbulanzprotokollTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record TokenBearing(string? token);
    private record SceneBearing(int id);
    private record PatientBearing(int id);

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    private async Task<int> CreatePatientAsync(HttpClient admin)
    {
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"protokoll-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        var patient = (await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = scene.id }))
            .Content.ReadFromJsonAsync<PatientBearing>())!;
        return patient.id;
    }

    [Fact]
    public async Task Merge_EmptyFieldInNewSave_NeverDeletesNonEmptyExistingValue()
    {
        // The core NFR-SAFE-09 safety property: a second device syncing a draft that never saw
        // an already-recorded field must not wipe it out, even though its PUT is chronologically
        // later. This is the specific behavior FormStateMerge.IsEmpty + the "rule 1" skip exist
        // to guarantee — losing recorded patient data is the failure mode this whole mechanism
        // is built to prevent.
        var client = await AdminClientAsync();
        var patientId = await CreatePatientAsync(client);

        var first = await client.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1", new
        {
            status = "draft",
            formState = new { patient = new { familienname = "Mustermann" } },
        });
        first.EnsureSuccessStatusCode();

        var second = await client.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1", new
        {
            status = "draft",
            formState = new { patient = new { familienname = "" }, history = new { allergien = "Penicillin" } },
        });
        second.EnsureSuccessStatusCode();

        var body = await second.Content.ReadFromJsonAsync<JsonElement>();
        var formState = body.GetProperty("formState");

        Assert.Equal("Mustermann", formState.GetProperty("patient").GetProperty("familienname").GetString());
        Assert.Equal("Penicillin", formState.GetProperty("history").GetProperty("allergien").GetString());
    }

    [Fact]
    public async Task Finalize_WithIncompleteForm_Succeeds_WithWarnings()
    {
        var client = await AdminClientAsync();
        var patientId = await CreatePatientAsync(client);

        var res = await client.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1", new
        {
            status = "finalized",
            formState = new { },
        });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("finalized", body.GetProperty("status").GetString());
        Assert.True(body.GetProperty("warnings").GetArrayLength() > 0);
    }

    [Fact]
    public async Task FinalizedRecord_CannotBeCorrectedByAnUnrelatedResponder()
    {
        var admin = await AdminClientAsync();
        var patientId = await CreatePatientAsync(admin);

        var finalize = await admin.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { } });
        finalize.EnsureSuccessStatusCode();

        var username = $"unrelated-{Guid.NewGuid():N}";
        var create = await admin.PostAsJsonAsync("/api/users", new { username, password = "somePassword1", role = "responder" });
        create.EnsureSuccessStatusCode();

        var responder = factory.CreateClient();
        var login = await responder.PostAsJsonAsync("/api/user-login", new { username, password = "somePassword1" });
        var token = (await login.Content.ReadFromJsonAsync<TokenBearing>())!.token!;
        responder.DefaultRequestHeaders.Authorization = new("Bearer", token);

        var attempt = await responder.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { } });

        Assert.Equal(HttpStatusCode.Forbidden, attempt.StatusCode);
    }
}
