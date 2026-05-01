#!/bin/sh
set -eu

required_vars="
NGINX_SERVER_NAME
NGINX_SSL_CERT_FILENAME
NGINX_SSL_KEY_FILENAME
API_UPSTREAM_HOST
API_UPSTREAM_PORT
WEB_UPSTREAM_HOST
WEB_UPSTREAM_PORT
"

for name in $required_vars; do
  eval "value=\${$name:-}"

  if [ -z "$value" ]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
done

if [ ! -f "/etc/nginx/certs/$NGINX_SSL_CERT_FILENAME" ]; then
  echo "Missing certificate file: /etc/nginx/certs/$NGINX_SSL_CERT_FILENAME" >&2
  exit 1
fi

if [ ! -f "/etc/nginx/certs/$NGINX_SSL_KEY_FILENAME" ]; then
  echo "Missing key file: /etc/nginx/certs/$NGINX_SSL_KEY_FILENAME" >&2
  exit 1
fi

envsubst '
${NGINX_SERVER_NAME}
${NGINX_SSL_CERT_FILENAME}
${NGINX_SSL_KEY_FILENAME}
${API_UPSTREAM_HOST}
${API_UPSTREAM_PORT}
${WEB_UPSTREAM_HOST}
${WEB_UPSTREAM_PORT}
' < /opt/nginx/nginx.conf.template > /etc/nginx/nginx.conf
