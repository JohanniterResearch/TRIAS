# Caddy for the Portainer stack: the proxy-mode config is baked in instead of bind-mounted.
FROM caddy:2-alpine
COPY Caddyfile.proxy /etc/caddy/Caddyfile
