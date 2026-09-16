// k6/helpers/http.js
// Custom HTTP wrapper providing W3C traceparent context propagation,
// consistent tagging, and header normalization across all k6 scenarios.

import http from 'k6/http';
import { BASE_URL, DEFAULT_HEADERS } from '../config.js';

/**
 * Generates a pseudo-random hex string of the specified length.
 * k6 runs in an ES5.1/Goja environment where crypto.randomUUID may not be globally available.
 */
function randomHex(length) {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Generates a valid W3C traceparent header:
 * Format: 00-{32-char-trace-id}-{16-char-span-id}-01
 */
export function generateTraceparent() {
  const traceId = randomHex(32);
  const spanId = randomHex(16);
  return `00-${traceId}-${spanId}-01`;
}

/**
 * Builds request params with traceparent, session cookie, and metric tags.
 */
export function buildParams(options = {}) {
  const { cookie, tags = {}, headers = {} } = options;
  
  const mergedHeaders = Object.assign({}, DEFAULT_HEADERS, headers);
  
  // Inject W3C traceparent if not explicitly passed
  if (!mergedHeaders.traceparent) {
    mergedHeaders.traceparent = generateTraceparent();
  }

  if (cookie) {
    mergedHeaders.Cookie = cookie;
  }

  return {
    headers: mergedHeaders,
    tags: tags,
  };
}

export function get(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const params = buildParams(options);
  return http.get(url, params);
}

export function post(endpoint, body, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const params = buildParams(options);
  return http.post(url, payload, params);
}

export function patch(endpoint, body, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const params = buildParams(options);
  return http.patch(url, payload, params);
}

export function del(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const params = buildParams(options);
  return http.del(url, null, params);
}
