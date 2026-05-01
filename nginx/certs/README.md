Place your HTTPS certificate and key files in this directory.

The filenames must match `NGINX_SSL_CERT_FILENAME` and
`NGINX_SSL_KEY_FILENAME` in the root `.env` file. The same certificate
directory is mounted by both `proxy` and `proxy-dev`, so one local setup
works for production runs and Docker-based development with hot reload.

Example:

- `localhost.crt`
- `localhost.key`

For local development you can generate a trusted certificate with `mkcert`
or use any certificate authority your machine already trusts.

create a certificate for `localhost` with `mkcert`:

```bash
mkcert -cert-file localhost.crt -key-file localhost.key localhost
```