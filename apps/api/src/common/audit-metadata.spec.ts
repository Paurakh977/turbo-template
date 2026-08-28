import { sanitizeAuditMetadata } from './audit-metadata';

describe('sanitizeAuditMetadata', () => {
  it('returns undefined when metadata is undefined', () => {
    expect(sanitizeAuditMetadata(undefined)).toBeUndefined();
  });

  it('returns undefined when metadata is null', () => {
    expect(sanitizeAuditMetadata(null as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it('removes performedViaImpersonation key', () => {
    const input = {
      noteId: 'n1',
      performedViaImpersonation: true,
    };
    expect(sanitizeAuditMetadata(input)).toEqual({ noteId: 'n1' });
  });

  it('removes impersonatedBy key', () => {
    const input = {
      action: 'role_changed',
      impersonatedBy: 'admin-9',
    };
    expect(sanitizeAuditMetadata(input)).toEqual({ action: 'role_changed' });
  });

  it('removes both server-owned keys', () => {
    const input = {
      noteId: 'n1',
      performedViaImpersonation: true,
      impersonatedBy: 'admin-9',
    };
    expect(sanitizeAuditMetadata(input)).toEqual({ noteId: 'n1' });
  });

  it('preserves all other keys', () => {
    const input = {
      noteId: 'n1',
      title: 'My Note',
      action: 'note_created',
    };
    expect(sanitizeAuditMetadata(input)).toEqual(input);
  });

  it('does not mutate the original metadata object', () => {
    const input = {
      noteId: 'n1',
      impersonatedBy: 'admin-9',
    };
    sanitizeAuditMetadata(input);
    expect(input).toEqual({ noteId: 'n1', impersonatedBy: 'admin-9' });
  });

  it('handles empty metadata object', () => {
    expect(sanitizeAuditMetadata({})).toEqual({});
  });

  it('handles metadata with only server-owned keys', () => {
    const input = {
      performedViaImpersonation: false,
      impersonatedBy: null,
    };
    expect(sanitizeAuditMetadata(input)).toEqual({});
  });
});
