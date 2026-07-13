namespace Ambulanzsystem.Api.Middleware;

// NFR-SEC baseline headers. HSTS is added separately via app.UseHsts() (prod-only, ASP.NET default).
public static class SecurityHeadersMiddleware
{
    public static IApplicationBuilder UseAmbulanzsystemSecurityHeaders(this IApplicationBuilder app)
    {
        return app.Use(async (context, next) =>
        {
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["X-Frame-Options"] = "DENY";
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            await next();
        });
    }
}
