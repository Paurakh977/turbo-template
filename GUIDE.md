# Setup Guide

This repository is designed to run entirely through Docker in both supported
modes:

- `dev`: hot reload behind the nginx HTTPS proxy
- `prod`: production-style containers behind the same nginx HTTPS proxy

The browser should always reach the app through nginx, not by opening the web
or API containers directly.

## Request Flow

```text
browser -> nginx (HTTPS) -> web
                        -> api
```

Routing:

- `/` goes to the Next.js app
- `/api/*` goes to the NestJS API
- HTTP redirects to HTTPS

## 1. Copy The Environment File

Create a local `.env` from the example:

```bash
cp .env.example .env
```

Key values:

- `NEXT_PUBLIC_API_URL=/api`
- `NEXT_ALLOWED_DEV_ORIGINS=https://localhost`
- `NGINX_SERVER_NAME=localhost`
- `NGINX_SSL_CERT_FILENAME=localhost.crt`
- `NGINX_SSL_KEY_FILENAME=localhost.key`

Notes:

- Keep `NEXT_PUBLIC_API_URL=/api` in both `dev` and `prod`
- `INTERNAL_API_URL` is provided by Compose for server-side calls from the web container to the API container
- `NEXT_ALLOWED_DEV_ORIGINS` is needed for the Next.js dev server because the browser reaches it through the HTTPS proxy
- `HOST`, `PORT`, `WEB_HOST`, and `WEB_PORT` are internal container bindings

## 2. Add TLS Certificates

Place the certificate and key in `nginx/certs/`.

Example:

- `nginx/certs/localhost.crt`
- `nginx/certs/localhost.key`

The filenames must match:

- `NGINX_SSL_CERT_FILENAME`
- `NGINX_SSL_KEY_FILENAME`

For local development, `mkcert` is recommended:

```bash
mkcert -key-file nginx/certs/localhost.key -cert-file nginx/certs/localhost.crt localhost 127.0.0.1 ::1
```

## 3. Run Development

Start the Docker development profile:

```bash
docker compose --profile dev up --build
```

This starts:

- `api-dev`
- `web-dev`
- `proxy-dev`

Open:

- `https://localhost`

Development behavior:

- Next.js runs with hot reload
- NestJS runs in watch mode
- nginx terminates TLS and proxies to both app containers

Stop it:

```bash
docker compose --profile dev down
```

## 4. Run Production

Start the production profile:

```bash
docker compose --profile prod up --build -d
```

This starts:

- `api`
- `web`
- `proxy`

Open:

- `https://localhost`

Stop it:

```bash
docker compose --profile prod down
```

## Troubleshooting

nginx fails on startup:

- Check that the cert files exist in `nginx/certs/`
- Check that the filenames match `.env`

Browser shows certificate warning:

- Trust the local certificate
- Regenerate the certificate for `localhost`

Next.js dev blocks requests:

- Verify `NEXT_ALLOWED_DEV_ORIGINS`
- Use the exact HTTPS origin you open in the browser

API calls fail:

- Keep `NEXT_PUBLIC_API_URL=/api`
- Access the app through the nginx HTTPS URL
