namespace Ambulanzsystem.Api.Middleware;

// NFR-SEC baseline headers. HSTS is added separately via app.UseHsts() (prod-only, ASP.NET default).
public static class SecurityHeadersMiddleware
{
    // Angular injects component <style> tags, hence 'unsafe-inline' for styles only; scripts stay
    // strict (the build disables critical-CSS inlining, which needs an inline onload handler).
    // Map tiles come from OSM; QR codes and the signature pad use data: URLs.
    private const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; " +
        "worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

    public static IApplicationBuilder UseAmbulanzsystemSecurityHeaders(this IApplicationBuilder app)
    {
        return app.Use(async (context, next) =>
        {
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["X-Frame-Options"] = "DENY";
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            context.Response.Headers["Permissions-Policy"] = "camera=(self), geolocation=(self), microphone=()";
            context.Response.Headers["Content-Security-Policy"] = ContentSecurityPolicy;
            await next();
        });
    }
}
