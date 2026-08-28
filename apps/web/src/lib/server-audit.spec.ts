jest.mock('server-only', () => ({}));
jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Headers()),
}));
jest.mock('./server/internal-api', () => ({
  callInternalApi: jest.fn(),
}));

import { createServerAuditLog } from './server-audit';
import { callInternalApi } from './server/internal-api';

describe('createServerAuditLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls callInternalApi with correct params', async () => {
    (callInternalApi as jest.Mock).mockResolvedValue(undefined);
    await createServerAuditLog({
      action: 'profile_updated',
      metadata: { field: 'name' },
    });
    expect(callInternalApi).toHaveBeenCalledWith(
      '/api/audit-logs',
      expect.objectContaining({
        method: 'POST',
        body: { action: 'profile_updated', metadata: { field: 'name' } },
      }),
    );
  });

  it('defaults metadata to empty object', async () => {
    (callInternalApi as jest.Mock).mockResolvedValue(undefined);
    await createServerAuditLog({ action: 'theme_changed' });
    expect(callInternalApi).toHaveBeenCalledWith(
      '/api/audit-logs',
      expect.objectContaining({
        body: { action: 'theme_changed', metadata: {} },
      }),
    );
  });

  it('does not throw when callInternalApi fails', async () => {
    (callInternalApi as jest.Mock).mockRejectedValue(
      new Error('network error'),
    );
    await expect(
      createServerAuditLog({ action: 'profile_updated' }),
    ).resolves.toBeUndefined();
  });

  it('forwards requestHeaders when provided', async () => {
    (callInternalApi as jest.Mock).mockResolvedValue(undefined);
    const headers = new Headers();
    headers.set('cookie', 'session=abc');
    await createServerAuditLog({
      action: 'labs_toggled',
      requestHeaders: headers,
    });
    expect(callInternalApi).toHaveBeenCalledWith(
      '/api/audit-logs',
      expect.objectContaining({
        requestHeaders: headers,
      }),
    );
  });
});
