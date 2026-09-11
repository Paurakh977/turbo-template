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

fail() {
  echo "Invalid environment: $1" >&2
  exit 1
}

assert_port() {
  # $1 = var name, $2 = value — TCP port 1-65535.
  case "$2" in
    '' | *[!0-9]* | [0-9][0-9][0-9][0-9][0-9][0-9]*)
      fail "$1 must be a TCP port number (1-65535), got: \"$2\"" ;;
  esac
  if [ "$2" -lt 1 ] || [ "$2" -gt 65535 ]; then
    fail "$1 must be a TCP port number (1-65535), got: \"$2\""
  fi
}

assert_hostname() {
  # $1 = var name, $2 = value — single DNS hostname. Allowlist keeps
  # nginx-special characters (spaces, semicolons, braces, $, quotes) from
  # ever reaching nginx.conf via envsubst.
  case "$2" in
    '' | *[!A-Za-z0-9.-]* | .* | *. | -* | *- | *..*)
      fail "$1 must be a valid hostname, got: \"$2\"" ;;
  esac
}

assert_server_names() {
  # $1 = var name, $2 = value — space-separated server_name list. Each entry
  # must be a hostname, "_" (nginx catch-all), or a "*." wildcard suffix.
  for token in $2; do
    case "$token" in
      '_') continue ;;
      '*.'*) rest="${token#\*.}" ;;
      *) rest="$token" ;;
    esac
    assert_hostname "$1" "$rest"
  done
}

assert_safe_filename() {
  # $1 = var name, $2 = value — bare filename inside /etc/nginx/certs/.
  # Rejects path separators and anything outside [A-Za-z0-9._-] so the
  # value can neither escape the directory nor inject config directives.
  case "$2" in
    '' | *[!A-Za-z0-9._-]*)
      fail "$1 must be a bare filename (letters, digits, dot, underscore, hyphen), got: \"$2\"" ;;
  esac
}

assert_ipv4_cidr() {
  # $1 = "addr[/prefix]" (prefix already split by caller when present).
  addr="$1"
  prefix=""
  case "$addr" in
    */*) prefix="${addr#*/}"; addr="${addr%%/*}" ;;
  esac
  rest="$addr."
  count=0
  while [ -n "$rest" ]; do
    octet="${rest%%.*}"
    rest="${rest#*.}"
    count=$((count + 1))
    case "$octet" in
      '' | *[!0-9]* | [0-9][0-9][0-9][0-9]*)
        fail "NGINX_TRUSTED_PROXIES entry \"$1\" is not a valid IPv4 CIDR" ;;
    esac
    if [ "$octet" -gt 255 ]; then
      fail "NGINX_TRUSTED_PROXIES entry \"$1\" is not a valid IPv4 CIDR"
    fi
  done
  if [ "$count" -ne 4 ]; then
    fail "NGINX_TRUSTED_PROXIES entry \"$1\" is not a valid IPv4 CIDR"
  fi
  if [ -n "$prefix" ]; then
    case "$prefix" in
      '' | *[!0-9]* | [0-9][0-9][0-9]*)
        fail "NGINX_TRUSTED_PROXIES entry \"$1\" has an invalid prefix length" ;;
    esac
    if [ "$prefix" -gt 32 ]; then
      fail "NGINX_TRUSTED_PROXIES entry \"$1\" has an invalid prefix length"
    fi
  fi
}

assert_trusted_proxies() {
  # Space-separated IPv4/IPv6 CIDRs or bare IPs. Charset check first blocks
  # any nginx-directive injection; IPv4 entries are then strictly validated.
  for entry in $1; do
    case "$entry" in
      '' | *[!0-9a-fA-F:./]*)
        fail "NGINX_TRUSTED_PROXIES entry \"$entry\" contains invalid characters" ;;
    esac
    case "$entry" in
      *:*)
        # IPv6 literal with optional /prefix — shape-checked only
        # (charset above already rules out injection; nginx rejects the
        # rest at startup with a clear error).
        ;;
      *)
        assert_ipv4_cidr "$entry" ;;
    esac
  done
}

# ── Value-format validation ───────────────────────────────────────────────
# These values are injected RAW into nginx.conf (envsubst/sed). A malformed
# value (NGINX_CONN_LIMIT=hello, a hostname with a semicolon, a CIDR with
# shell metacharacters) yields a broken or — worse — attacker-influenced
# proxy config. Fail fast here with a clear message instead of crash-looping
# nginx or misrouting traffic.
assert_server_names "NGINX_SERVER_NAME" "$NGINX_SERVER_NAME"
assert_safe_filename "NGINX_SSL_CERT_FILENAME" "$NGINX_SSL_CERT_FILENAME"
assert_safe_filename "NGINX_SSL_KEY_FILENAME" "$NGINX_SSL_KEY_FILENAME"
assert_hostname "API_UPSTREAM_HOST" "$API_UPSTREAM_HOST"
assert_port "API_UPSTREAM_PORT" "$API_UPSTREAM_PORT"
assert_hostname "WEB_UPSTREAM_HOST" "$WEB_UPSTREAM_HOST"
assert_port "WEB_UPSTREAM_PORT" "$WEB_UPSTREAM_PORT"

if [ ! -f "/etc/nginx/certs/$NGINX_SSL_CERT_FILENAME" ]; then
  echo "Missing certificate file: /etc/nginx/certs/$NGINX_SSL_CERT_FILENAME" >&2
  exit 1
fi

if [ ! -f "/etc/nginx/certs/$NGINX_SSL_KEY_FILENAME" ]; then
  echo "Missing key file: /etc/nginx/certs/$NGINX_SSL_KEY_FILENAME" >&2
  exit 1
fi

# ── Default env vars ────────────────────────────────────────────────────────
NGINX_CONN_LIMIT="${NGINX_CONN_LIMIT:-20}"

# Numeric before sed injects it into `limit_conn` — "hello" would otherwise
# crash nginx, and metacharacters could break out of the directive.
case "$NGINX_CONN_LIMIT" in
  '' | *[!0-9]* | [0-9][0-9][0-9][0-9][0-9][0-9][0-9]*)
    fail "NGINX_CONN_LIMIT must be a whole number (1-100000), got: \"$NGINX_CONN_LIMIT\"" ;;
esac
if [ "$NGINX_CONN_LIMIT" -lt 1 ] || [ "$NGINX_CONN_LIMIT" -gt 100000 ]; then
  fail "NGINX_CONN_LIMIT must be a whole number (1-100000), got: \"$NGINX_CONN_LIMIT\""
fi

# ── Build real_ip config ──────────────────────────────────────────────────
# Direct mode (nothing in front of nginx): default 127.0.0.0/8 never matches a
# real client IP, so real_ip is a no-op and $remote_addr/$binary_remote_addr
# stay the true peer. For LB/CDN later, set NGINX_TRUSTED_PROXIES to the
# provider's CIDRs (space-separated) and nginx restores the real client IP.
TRUSTED="${NGINX_TRUSTED_PROXIES:-127.0.0.0/8}"
REAL_IP_HEADER="${NGINX_REAL_IP_HEADER:-X-Forwarded-For}"

# These land verbatim in realip.conf (`set_real_ip_from` / `real_ip_header`),
# so validate before writing: a hostile value here rewrites client-IP
# handling and silently corrupts every rate-limit bucket.
assert_trusted_proxies "$TRUSTED"
case "$REAL_IP_HEADER" in
  '' | -* | *[!A-Za-z0-9-]*)
    fail "NGINX_REAL_IP_HEADER must be a valid header name, got: \"$REAL_IP_HEADER\"" ;;
esac

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
${NGINX_CONN_LIMIT}
' < /opt/nginx/nginx.conf.template > /etc/nginx/nginx.conf

sed -i "s/NGINX_CONN_LIMIT_PLACEHOLDER/${NGINX_CONN_LIMIT}/g" /etc/nginx/nginx.conf
