import { Resend } from 'resend';
import { devEmailOverride, emailFrom, resendApiKey } from './env';

const resend = resendApiKey ? new Resend(resendApiKey) : null;

/**
 * Centralized email delivery helper.
 *
 * No-op (with a log line) when no email provider is configured — auth flows
 * must never crash because email delivery is unavailable. In dev, emails are
 * redirected to `DEV_EMAIL_OVERRIDE` when set.
 */
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  if (!resend) {
    console.log(`[AUTH EMAIL][NO_PROVIDER] to=${to} subject=${subject}`);
    return;
  }
  const recipient = devEmailOverride ?? to;
  const effectiveSubject = devEmailOverride
    ? `[DEV → ${to}] ${subject}`
    : subject;
  const fromAddress = devEmailOverride
    ? `Ozon <onboarding@resend.dev>`
    : emailFrom;

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: recipient,
    subject: effectiveSubject,
    html,
  });

  if (error) {
    console.error('[Email Error]', {
      name: error.name,
      statusCode: error.statusCode,
      message: error.message,
      subject,
      recipient: recipient.includes('@') ? recipient.split('@')[1] : 'unknown',
    });
    throw error;
  } else if (devEmailOverride) {
    console.log(
      `[Email] Redirected from ${to} → ${recipient} | Subject: ${subject}`,
    );
  }
}