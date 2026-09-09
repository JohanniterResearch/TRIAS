using System.Net;
using System.Net.Http.Json;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Controllers;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Ambulanzsystem.Tests;

public class EventScopeDeletionTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private AppDbContext Db(params IInterceptor[] interceptors)
    {
        using var scope = factory.Services.CreateScope();
        var connectionString = scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.GetConnectionString();
        return new(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention().AddInterceptors(interceptors).Options);
    }

    private static OperationScenesController Controller(AppDbContext db) => new(db, new AuditService(db))
    {
        ControllerContext = new() { HttpContext = new DefaultHttpContext() },
    };

    private sealed class BeforeDelete(Func<Task> action) : SaveChangesInterceptor
    {
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData data, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (data.Context!.ChangeTracker.Entries<OperationScene>().Any(e => e.State == EntityState.Deleted))
                await action();
            return result;
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AssignedAccount_BlocksDeletionWithoutExpandingScope(bool revoked)
    {
        await using var db = Db();
        var scene = new OperationScene { Name = "assigned-event" };
        var user = new User { Username = $"assigned-{Guid.NewGuid():N}", PasswordHash = "unused",
            Role = Role.Responder, AccountType = AccountType.Event, EventScene = scene,
            RevokedAt = revoked ? DateTime.UtcNow : null };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        var result = await Controller(db).Delete(scene.Id);
        Assert.IsType<ConflictObjectResult>(result);
        await using var verify = Db();
        Assert.Equal(scene.Id, (await verify.Users.FindAsync(user.Id))!.EventSceneId);
        Assert.True(await verify.OperationScenes.AnyAsync(s => s.Id == scene.Id));
    }

    [Fact]
    public async Task AssignmentAfterPrecheck_IsBlockedByForeignKeyAndReturnsConflict()
    {
        await using var setup = Db();
        var scene = new OperationScene { Name = "raced-event" };
        setup.OperationScenes.Add(scene);
        await setup.SaveChangesAsync();
        var user = new User { Username = $"raced-{Guid.NewGuid():N}", PasswordHash = "unused",
            Role = Role.Responder, AccountType = AccountType.Event, EventSceneId = scene.Id };
        await using var deleting = Db(new BeforeDelete(async () =>
        {
            await using var assigning = Db();
            assigning.Users.Add(user);
            await assigning.SaveChangesAsync();
        }));
        var result = await Controller(deleting).Delete(scene.Id);
        Assert.IsType<ConflictObjectResult>(result);
        await using var verify = Db();
        Assert.Equal(scene.Id, (await verify.Users.FindAsync(user.Id))!.EventSceneId);
        Assert.False(await verify.AuditLogs.AnyAsync(a => a.EntityType == "operation_scene" && a.EntityId == scene.Id));
    }

    [Fact]
    public async Task UnreferencedEvent_RemainsDeletable()
    {
        await using var db = Db();
        var scene = new OperationScene { Name = "empty-event" };
        db.OperationScenes.Add(scene);
        await db.SaveChangesAsync();
        Assert.IsType<NoContentResult>(await Controller(db).Delete(scene.Id));
        Assert.False(await db.OperationScenes.AnyAsync(s => s.Id == scene.Id));
    }

    [Fact]
    public async Task UnexpectedDatabaseFailure_IsNotReportedAsConflict()
    {
        await using var db = Db(new BeforeDelete(() => throw new DbUpdateException("unexpected failure")));
        var scene = new OperationScene { Name = "unexpected-failure" };
        db.OperationScenes.Add(scene);
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<DbUpdateException>(() => Controller(db).Delete(scene.Id));
    }

    [Theory]
    [InlineData(Role.Responder, "/api/user-login")]
    [InlineData(Role.Leitstelle, "/api/admin-login")]
    [InlineData(Role.Admin, "/api/admin-login")]
    public async Task OrphanedEventAccount_CannotLoginRefreshOrValidate(Role role, string loginPath)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = new User { Username = $"orphan-{Guid.NewGuid():N}",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("originalPassword1"), Role = role, AccountType = AccountType.Event };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        var oldAccess = scope.ServiceProvider.GetRequiredService<TokenService>().IssueUserToken(user);
        var oldRefresh = await scope.ServiceProvider.GetRequiredService<RefreshTokenService>().IssueAsync(user.Id);
        await db.SaveChangesAsync();
        var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync(loginPath,
            new { username = user.Username, password = "originalPassword1" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/refresh-token",
            new { refreshToken = oldRefresh.RawToken })).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", oldAccess.Token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/validate-token", null)).StatusCode);
        await db.Entry(user).ReloadAsync();
        Assert.Equal(AccountType.Event, user.AccountType);
        Assert.Null(user.EventSceneId);
    }
}
