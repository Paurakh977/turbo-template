import { Resend } from 'resend';
import { createLogger } from '@repo/observability';
import { devEmailOverride, emailFrom, resendApiKey } from './env';

const resend = resendApiKey ? new Resend(resendApiKey) : null;
const logger = createLogger('auth:email');

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
    logger.info({
      msg: `[AUTH EMAIL][NO_PROVIDER] subject=${subject}`,
      domain: to.includes('@') ? to.split('@')[1] : 'unknown',
    });
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
    logger.error({
      err: error,
      name: error.name,
      statusCode: error.statusCode,
      message: error.message,
      subject,
      recipientDomain: recipient.includes('@')
        ? recipient.split('@')[1]
        : 'unknown',
      msg: '[Email Error] Failed to send email',
    });
    throw error;
  } else if (devEmailOverride) {
    logger.info({
      msg: `[Email] Redirected email delivery`,
      subject,
      recipientDomain: recipient.includes('@')
        ? recipient.split('@')[1]
        : 'unknown',
    });
  }
}