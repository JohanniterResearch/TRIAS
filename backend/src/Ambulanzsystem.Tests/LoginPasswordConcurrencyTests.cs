using System.Data.Common;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Controllers;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Xunit;

namespace Ambulanzsystem.Tests;

public class LoginPasswordConcurrencyTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private const string OldPassword = "originalPassword1";
    private const string NewPassword = "changedPassword2";

    private sealed class ReadBarrier(bool lockQuery = false) : DbCommandInterceptor
    {
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData data,
            DbDataReader result, CancellationToken cancellationToken = default)
        {
            if (!lockQuery && command.CommandText.Contains("username") && !command.CommandText.Contains("FOR UPDATE")
                && !Reached.Task.IsCompleted)
            {
                Reached.TrySetResult();
                await Release.Task.WaitAsync(TimeSpan.FromSeconds(15));
            }
            return result;
        }
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData data, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (lockQuery && command.CommandText.Contains("FOR UPDATE")) Reached.TrySetResult();
            return ValueTask.FromResult(result);
        }
    }

    private sealed class LoginSaveBarrier(bool fail = false) : SaveChangesInterceptor
    {
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData data,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (fail && data.Context!.ChangeTracker.Entries<RefreshToken>().Any(e => e.State == EntityState.Added))
                throw new InvalidOperationException("Injected credential persistence failure.");
            if (!fail && !Reached.Task.IsCompleted)
            {
                Reached.TrySetResult();
                await Release.Task.WaitAsync(TimeSpan.FromSeconds(15));
            }
            return result;
        }
    }

    private AppDbContext Db(params IInterceptor[] interceptors)
    {
        using var scope = factory.Services.CreateScope();
        return new(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.GetConnectionString())
            .UseSnakeCaseNamingConvention().AddInterceptors(interceptors).Options);
    }

    private RefreshTokenService Refresh(AppDbContext db) => new(db, factory.Services.GetRequiredService<IOptions<JwtOptions>>());
    private AuthController Login(AppDbContext db) => new(db, factory.Services.GetRequiredService<TokenService>(),
        Refresh(db), new AuditService(db), factory.Services.GetRequiredService<MetricsService>(),
        factory.Services.GetRequiredService<IConfiguration>(), factory.Services.GetRequiredService<IHostEnvironment>());
    private UsersController PasswordChange(AppDbContext db, User user) => new(db, Refresh(db), new AuditService(db))
    {
        ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()), new Claim(TokenTypes.ClaimType, TokenTypes.User)], "test")) } },
    };
    private async Task<User> CreateUser()
    {
        await using var db = Db();
        var user = new User { Username = $"login-race-{Guid.NewGuid():N}", PasswordHash = BCrypt.Net.BCrypt.HashPassword(OldPassword), Role = Role.Responder };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    [Fact]
    public async Task PasswordChangeWins_OldPasswordLoginReadsCurrentCredentialsUnderLock()
    {
        var user = await CreateUser();
        var barrier = new ReadBarrier();
        await using var loginDb = Db(barrier);
        var pendingLogin = Login(loginDb).UserLogin(new(user.Username, OldPassword));
        await barrier.Reached.Task.WaitAsync(TimeSpan.FromSeconds(15));
        try
        {
            await using var changeDb = Db();
            Assert.IsType<NoContentResult>(await PasswordChange(changeDb, user).ChangePassword(new(user.Username, OldPassword, NewPassword)));
        }
        finally { barrier.Release.TrySetResult(); }
        Assert.IsType<UnauthorizedObjectResult>(await pendingLogin);
        await using var verify = Db();
        Assert.False(await verify.RefreshTokens.AnyAsync(t => t.UserId == user.Id));
        Assert.Null((await verify.Users.FindAsync(user.Id))!.LastLoginTime);
    }

    [Fact]
    public async Task LoginWins_PasswordChangeInvalidatesEveryIssuedCredential()
    {
        var user = await CreateUser();
        var saving = new LoginSaveBarrier();
        var locking = new ReadBarrier(lockQuery: true);
        await using var loginDb = Db(saving);
        await using var changeDb = Db(locking);
        var pendingLogin = Login(loginDb).UserLogin(new(user.Username, OldPassword));
        await saving.Reached.Task.WaitAsync(TimeSpan.FromSeconds(15));
        var pendingChange = PasswordChange(changeDb, user).ChangePassword(new(user.Username, OldPassword, NewPassword));
        try { await locking.Reached.Task.WaitAsync(TimeSpan.FromSeconds(15)); }
        finally { saving.Release.TrySetResult(); }
        var response = Assert.IsType<UserLoginResponse>(Assert.IsType<OkObjectResult>(await pendingLogin).Value);
        Assert.IsType<NoContentResult>(await pendingChange);
        await using var verify = Db();
        var current = (await verify.Users.FindAsync(user.Id))!;
        var token = new JwtSecurityTokenHandler().ReadJwtToken(response.token);
        Assert.NotEqual(current.SecurityStamp, token.Claims.Single(c => c.Type == TokenTypes.SecurityStampClaimType).Value);
        Assert.All(await verify.RefreshTokens.Where(t => t.UserId == user.Id).ToListAsync(), t => Assert.True(t.IsRevoked));
        Assert.Null(await Refresh(verify).RotateAsync(response.refreshToken));
    }

    [Fact]
    public async Task LoginPersistenceFailure_RollsBackTimestampsCredentialsAndAudit()
    {
        var user = await CreateUser();
        await using var db = Db(new LoginSaveBarrier(fail: true));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Login(db).UserLogin(new(user.Username, OldPassword)));
        await using var verify = Db();
        var unchanged = (await verify.Users.FindAsync(user.Id))!;
        Assert.Null(unchanged.FirstLoginTime);
        Assert.Null(unchanged.LastLoginTime);
        Assert.False(await verify.RefreshTokens.AnyAsync(t => t.UserId == user.Id));
        Assert.False(await verify.AuditLogs.AnyAsync(a => a.ActorId == user.Id && a.Action == "login"));
    }
}
