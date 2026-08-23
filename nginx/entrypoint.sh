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

# ── Build real_ip config ──────────────────────────────────────────────────
# Direct mode (nothing in front of nginx): default 127.0.0.0/8 never matches a
# real client IP, so real_ip is a no-op and $remote_addr/$binary_remote_addr
# stay the true peer. For LB/CDN later, set NGINX_TRUSTED_PROXIES to the
# provider's CIDRs (space-separated) and nginx restores the real client IP.
TRUSTED="${NGINX_TRUSTED_PROXIES:-127.0.0.0/8}"
REAL_IP_HEADER="${NGINX_REAL_IP_HEADER:-X-Forwarded-For}"

: > /etc/nginx/realip.conf
for cidr in $TRUSTED; do
  echo "set_real_ip_from $cidr;" >> /etc/nginx/realip.conf
done
echo "real_ip_header $REAL_IP_HEADER;" >> /etc/nginx/realip.conf
echo "real_ip_recursive on;"          >> /etc/nginx/realip.conf

envsubst '
${NGINX_SERVER_NAME}
${NGINX_SSL_CERT_FILENAME}
${NGINX_SSL_KEY_FILENAME}
${API_UPSTREAM_HOST}
${API_UPSTREAM_PORT}
${WEB_UPSTREAM_HOST}
${WEB_UPSTREAM_PORT}
' < /opt/nginx/nginx.conf.template > /etc/nginx/nginx.conf
