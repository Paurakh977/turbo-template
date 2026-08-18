# Docker HTTPS Setup Guide

This repository runs both the Next.js web app and the NestJS API behind an
HTTPS nginx reverse proxy in both supported modes:

- `dev`: Docker-based development with hot reload
- `prod`: production-like Docker deployment

The browser-facing entrypoint is always nginx. You do not access the app
containers directly from the browser.

## Architecture

```text
browser -> nginx (HTTPS) -> web container
                        -> api container
```

Routing rules:

- `/` and all non-API routes go to the Next.js app
- `/api/*` goes to the NestJS API
- HTTP on `PROXY_HTTP_PORT` redirects to HTTPS on `PROXY_HTTPS_PORT`

## Prerequisites

- Docker Desktop with Compose support
- A local `.env` file copied from `.env.example`
- TLS certificate and key files placed in `nginx/certs/`

## Initial Setup

1. Copy the example environment file.

```bash
cp .env.example .env
```

2. Open `.env` and adjust values if needed.

Recommended local defaults:

- `HOST=0.0.0.0`
- `PORT=3001`
- `WEB_HOST=0.0.0.0`
- `WEB_PORT=3000`
- `NEXT_PUBLIC_API_URL=/api`
- `NEXT_ALLOWED_DEV_ORIGINS=https://localhost`
- `PROXY_HTTP_PORT=80`
- `PROXY_HTTPS_PORT=443`
- `NGINX_SERVER_NAME=localhost`
- `NGINX_SSL_CERT_FILENAME=localhost.crt`
- `NGINX_SSL_KEY_FILENAME=localhost.key`

3. Put your TLS certificate files in `nginx/certs/`.

The filenames must match the two nginx TLS variables from `.env`.

Example:

- `nginx/certs/localhost.crt`
- `nginx/certs/localhost.key`

4. Trust the certificate locally if you want a clean browser experience.

For local development, [`mkcert`](https://github.com/FiloSottile/mkcert) is a
good option.

Example with `mkcert`:

```bash
mkcert -key-file nginx/certs/localhost.key -cert-file nginx/certs/localhost.crt localhost 127.0.0.1 ::1
```

## Environment Notes

- `NEXT_PUBLIC_API_URL` should stay `/api` when traffic always goes through nginx.
- `INTERNAL_API_URL` is injected by Docker Compose so the web container can reach the API container directly for server-side fetches.
- `NEXT_ALLOWED_DEV_ORIGINS` is required for `dev` because Next.js is reached through the HTTPS proxy.
- The same certificate directory is used by both `proxy` and `proxy-dev`.
- `HOST`, `PORT`, `WEB_HOST`, and `WEB_PORT` are container-facing bindings, not browser URLs.

## Development

Start the full Docker development stack with hot reload:

```bash
docker compose --profile dev up --build
```

Services started:

- `api-dev`
- `web-dev`
- `proxy-dev`

Open the app at:

- `https://localhost`

What to expect:

- Code changes under `apps/` and `packages/` are mounted into the containers
- Next.js runs in dev mode with hot reload
- NestJS runs in watch mode
- nginx remains the only browser-facing entrypoint

Stop the dev stack:

```bash
docker compose --profile dev down
```

Rebuild from scratch if dependencies or Dockerfiles change:

```bash
docker compose --profile dev up --build --force-recreate
```

## Production

Start the production profile:

```bash
docker compose --profile prod up --build -d
```

Services started:

- `api`
- `web`
- `proxy`

Open the app at:

- `https://localhost`

Stop the production stack:

```bash
docker compose --profile prod down
```

## Logs And Debugging

Follow all logs:

```bash
docker compose --profile dev logs -f
```

Check proxy logs:

```bash
docker compose logs -f proxy-dev
```

Check production proxy logs:

```bash
docker compose logs -f proxy
```

## Common Issues

Certificate file missing:

- Ensure the files exist in `nginx/certs/`
- Ensure the filenames match `.env`

Browser shows TLS warning:

- Trust the local certificate authority or certificate
- Regenerate the cert for `localhost` if the hostname does not match

Next.js dev server blocks requests:

- Ensure `NEXT_ALLOWED_DEV_ORIGINS` exactly matches the external HTTPS origin
- For local use this is usually `https://localhost`

API calls fail in the browser:

- Keep `NEXT_PUBLIC_API_URL=/api`
- Make sure nginx is running and the browser is using the HTTPS proxy URL

## Useful Commands

Lint the monorepo:

```bash
pnpm run lint
```

Build the monorepo outside Docker if needed:

```bash
pnpm run build
```

Run tests:

```bash
pnpm run test
pnpm run test:e2e
```
