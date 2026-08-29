import nock from 'nock';

export interface CapturedEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Intercepts outbound Resend API calls and records the sent emails so tests
 * can extract verification / password-reset tokens without a real inbox.
 */
export function installResendMock(): { emails: CapturedEmail[] } {
  const emails: CapturedEmail[] = [];
  nock.cleanAll();
  nock('https://api.resend.com')
    .persist()
    .post('/emails')
    .reply(200, (_uri, body: unknown) => {
      const b = (body ?? {}) as {
        to?: string | string[];
        subject?: string;
        html?: string;
        text?: string;
      };
      emails.push({
        to: Array.isArray(b.to) ? b.to[0] : (b.to ?? ''),
        subject: b.subject ?? '',
        html: b.html ?? '',
        text: b.text,
      });
      return { id: 'mock-email-id' };
    });
  return { emails };
}

/** Extracts a `?token=` value from an email body (link query param). */
export function extractToken(content: string): string {
  const match = content.match(/[?&]token=([^"'&>\s]+)/);
  if (!match) {
    throw new Error(`Could not extract token from email content: ${content.slice(0, 200)}`);
  }
  return decodeURIComponent(match[1]);
}

/** Finds the most recent captured email sent to a given address. */
export function emailTo(emails: CapturedEmail[], to: string): CapturedEmail | undefined {
  return [...emails].reverse().find((e) => e.to === to);
}
