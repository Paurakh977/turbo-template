jest.mock('resend', () => {
  const mockSend = jest.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null });
  return {
    Resend: jest.fn().mockImplementation(() => ({
      emails: { send: mockSend },
    })),
  };
});

jest.mock('./env', () => ({
  get devEmailOverride() {
    return process.env.TEST_DEV_EMAIL_OVERRIDE ?? undefined;
  },
  get emailFrom() {
    return process.env.TEST_EMAIL_FROM ?? 'Test <test@example.com>';
  },
  get resendApiKey() {
    return process.env.TEST_RESEND_API_KEY ?? undefined;
  },
}));

jest.mock('@repo/observability', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

import { sendEmail } from './email-helpers';
import { Resend } from 'resend';

describe('sendEmail', () => {
  const mockSend = (
    Resend as unknown as jest.Mock
  ).mock.results[0]?.value?.emails?.send;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TEST_DEV_EMAIL_OVERRIDE;
    delete process.env.TEST_RESEND_API_KEY;
  });

  it('sends email via Resend when API key is configured', async () => {
    process.env.TEST_RESEND_API_KEY = 're_test_key';

    const mod = require('./email-helpers');
    const send = mod.sendEmail;

    await send({
      to: 'user@example.com',
      subject: 'Welcome',
      html: '<p>Hello</p>',
    });

    // Re-import to get fresh module with API key set
    const { Resend: FreshResend } = require('resend');
    const instance = FreshResend.mock.results[FreshResend.mock.results.length - 1].value;
    expect(instance.emails.send).toHaveBeenCalledWith({
      from: 'Test <test@example.com>',
      to: 'user@example.com',
      subject: 'Welcome',
      html: '<p>Hello</p>',
    });
  });

  it('redirects to DEV_EMAIL_OVERRIDE when set', async () => {
    process.env.TEST_RESEND_API_KEY = 're_test_key';
    process.env.TEST_DEV_EMAIL_OVERRIDE = 'dev@test.com';

    jest.resetModules();
    const mod = require('./email-helpers');

    await mod.sendEmail({
      to: 'real@user.com',
      subject: 'Test',
      html: '<p>Hi</p>',
    });

    const { Resend: R } = require('resend');
    const instance = R.mock.results[R.mock.results.length - 1].value;
    expect(instance.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'dev@test.com',
        subject: '[DEV → real@user.com] Test',
      }),
    );
  });

  it('no-ops when no API key is configured', async () => {
    delete process.env.TEST_RESEND_API_KEY;

    jest.resetModules();
    const mod = require('./email-helpers');
    const { createLogger } = require('@repo/observability');
    const loggerInstance = createLogger.mock.results[0].value;

    await mod.sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
    });

    expect(loggerInstance.info).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('[AUTH EMAIL][NO_PROVIDER]'),
      }),
    );
  });

  it('throws when Resend returns an error', async () => {
    process.env.TEST_RESEND_API_KEY = 're_test_key';

    jest.resetModules();
    const mod = require('./email-helpers');

    const { Resend: R } = require('resend');
    const errorInstance = R.mock.results[R.mock.results.length - 1].value;
    errorInstance.emails.send.mockResolvedValueOnce({
      error: { name: 'validation_error', statusCode: 422, message: 'Invalid' },
    });

    await expect(
      mod.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hi</p>',
      }),
    ).rejects.toEqual(
      expect.objectContaining({ name: 'validation_error' }),
    );
  });
});
