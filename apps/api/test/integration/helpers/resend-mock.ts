/**
 * Mock of the `resend` SDK for the strict integration suite.
 * Records sent emails on globalThis.__sentEmails so tests can extract
 * verification / password-reset tokens without a real inbox or network call.
 */
class MockResendEmails {
  async send(opts: { to: string; html: string }) {
    const store =
      (globalThis as unknown as { __sentEmails?: { to: string; html: string }[] })
        .__sentEmails ??
      ((globalThis as unknown as { __sentEmails: { to: string; html: string }[] }).__sentEmails =
        []);
    store.push({ to: opts.to, html: opts.html });
    return { data: { id: 'mock-email' }, error: null };
  }
}

export class Resend {
  emails = new MockResendEmails();
}
