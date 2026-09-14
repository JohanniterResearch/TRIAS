using Ambulanzsystem.Api.Config;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Ambulanzsystem.Tests;

// S5 production config dry-run, automated (previously verified only by hand against a
// container): startup must fail fast on missing prod secrets and on dev-login left enabled.
public class StartupValidationTests
{
    private sealed class FakeEnv(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "test";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private static IConfiguration Config(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.ToDictionary(v => v.Key, v => (string?)v.Value))
            .Build();

    private static readonly (string, string) ValidConnection = ("ConnectionStrings:Default", "Host=x;Database=x");
    private static readonly (string, string) ValidSecret = ("Jwt:Secret", new string('s', 32));

    [Fact]
    public void Production_WithAllRequiredValues_Passes()
    {
        var config = Config(ValidConnection, ValidSecret,
            ("Bootstrap:AdminPassword", "12345678"), ("PLS_ALLOWED_ORIGINS", "https://a.example"),
            ("BACKUP_EXPECTED_DEPLOYMENT_ID", "stable-deployment-id"));

        StartupValidation.Validate(config, new FakeEnv(Environments.Production));
    }

    [Theory]
    [InlineData("Bootstrap:AdminPassword")]
    [InlineData("PLS_ALLOWED_ORIGINS")]
    [InlineData("BACKUP_EXPECTED_DEPLOYMENT_ID")]
    public void Production_MissingRequiredValue_Throws(string omittedKey)
    {
        var values = new List<(string, string)>
        {
            ValidConnection, ValidSecret,
            ("Bootstrap:AdminPassword", "12345678"), ("PLS_ALLOWED_ORIGINS", "https://a.example"),
            ("BACKUP_EXPECTED_DEPLOYMENT_ID", "stable-deployment-id"),
        };
        values.RemoveAll(v => v.Item1 == omittedKey);

        var ex = Assert.Throws<InvalidOperationException>(
            () => StartupValidation.Validate(Config(values.ToArray()), new FakeEnv(Environments.Production)));
        Assert.Contains(omittedKey, ex.Message);
    }

    [Fact]
    public void Production_WithDevLoginEnabled_Throws()
    {
        var config = Config(ValidConnection, ValidSecret,
            ("Bootstrap:AdminPassword", "12345678"), ("PLS_ALLOWED_ORIGINS", "https://a.example"),
            ("Features:EnableDevLogin", "true"));

        Assert.Throws<InvalidOperationException>(
            () => StartupValidation.Validate(config, new FakeEnv(Environments.Production)));
    }

    [Fact]
    public void ShortJwtSecret_Throws_InAnyEnvironment()
    {
        var config = Config(ValidConnection, ("Jwt:Secret", "too-short"));

        Assert.Throws<InvalidOperationException>(
            () => StartupValidation.Validate(config, new FakeEnv(Environments.Development)));
    }

    [Fact]
    public void Development_WithoutProdSecrets_Passes()
    {
        StartupValidation.Validate(Config(ValidConnection, ValidSecret), new FakeEnv(Environments.Development));
    }

    [Theory]
    [InlineData("")]
    [InlineData("       ")]
    [InlineData("1234567")]
    public void Production_WithBlankOrShortBootstrapPassword_Throws(string password)
    {
        var config = Config(ValidConnection, ValidSecret,
            ("Bootstrap:AdminPassword", password), ("PLS_ALLOWED_ORIGINS", "https://a.example"));

        var ex = Assert.Throws<InvalidOperationException>(
            () => StartupValidation.Validate(config, new FakeEnv(Environments.Production)));
        Assert.Contains("Bootstrap:AdminPassword", ex.Message);
    }
}
