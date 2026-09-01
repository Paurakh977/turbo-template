import { APIRequestContext, request as apiRequest } from '@playwright/test';
import { E2E } from '../config/playwright.env';
import { STORAGE_STATE_FILE } from '../config/users';
import { readFileSync } from 'node:fs';

export function cookieFromStorageState(role: string): string {
  const state = JSON.parse(
    readFileSync(STORAGE_STATE_FILE(role as never), 'utf-8'),
  );
  const cookie = state.cookies?.find(
    (c: { name: string }) =>
      c.name === E2E.authCookieName ||
      c.name.includes('better-auth.session_token'),
  );
  return cookie ? `${cookie.name}=${cookie.value}` : '';
}

/**
 * Thin client for exercising the real API tier *through nginx* (never
 * bypassing it). All requests originate from the runner and traverse the proxy
 * exactly like the browser would.
 */
export class ApiClient {
  constructor(
    private readonly ctx: APIRequestContext,
    private readonly cookie = '',
  ) {}

  static async create(cookie = ''): Promise<ApiClient> {
    const ctx = await apiRequest.newContext({
      baseURL: E2E.baseURL,
      extraHTTPHeaders: { Origin: E2E.appURL },
      ignoreHTTPSErrors: true,
    });
    return new ApiClient(ctx, cookie);
  }

  private async req(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any; headers: Record<string, string> }> {
    const res = await this.ctx.fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      data: body ? JSON.stringify(body) : undefined,
    });
    const headers: Record<string, string> = {};
    res.headersArray().forEach((h) => {
      headers[h.name.toLowerCase()] = h.value;
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* no body */
    }
    return { status: res.status(), body: json, headers };
  }

  get(path: string) {
    return this.req('GET', path);
  }
  post(path: string, body?: unknown) {
    return this.req('POST', path, body);
  }
  patch(path: string, body?: unknown) {
    return this.req('PATCH', path, body);
  }
  del(path: string, body?: unknown) {
    return this.req('DELETE', path, body);
  }

  // ── Notes ──────────────────────────────────────────────────────────────
  listNotes() {
    return this.get('/api/notes');
  }
  createNote(title: string, content: string) {
    return this.post('/api/notes', { title, content });
  }
  updateNote(id: string, title: string, content: string) {
    return this.patch(`/api/notes/${id}`, { title, content });
  }
  deleteNote(id: string) {
    return this.del(`/api/notes/${id}`);
  }

  // ── Admin (Better Auth) ──────────────────────────────────────────────────
  setRole(userId: string, role: string[]) {
    return this.post('/api/auth/admin/set-role', { userId, role });
  }
  banUser(userId: string, banReason = 'E2E ban') {
    return this.post('/api/auth/admin/ban-user', { userId, banReason });
  }
  unbanUser(userId: string) {
    return this.post('/api/auth/admin/unban-user', { userId });
  }
  impersonateUser(userId: string) {
    return this.post('/api/auth/admin/impersonate-user', { userId });
  }
  stopImpersonating() {
    return this.post('/api/auth/admin/stop-impersonating', {});
  }
  revokeSessions(userId: string) {
    return this.post('/api/auth/admin/revoke-user-sessions', { userId });
  }
  removeUser(userId: string) {
    return this.post('/api/auth/admin/remove-user', { userId });
  }

  // ── Audit ────────────────────────────────────────────────────────────────
  listAuditLogs(q?: string, action?: string, page = 1) {
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set('q', q);
    if (action && action !== 'all') params.set('action', action);
    return this.get(`/api/admin/audit-logs?${params.toString()}`);
  }

  // ── Health ───────────────────────────────────────────────────────────────
  healthLive() {
    return this.get('/api/health/live');
  }
  healthReady() {
    return this.get('/api/health/ready');
  }

  async close() {
    await this.ctx.dispose();
  }
}
