import { validate } from 'class-validator';
import { plainToInstance, TransformFnParams } from 'class-transformer';
import { RecordAuditDto, ListAuditQuery } from './audit.controller';

describe('RecordAuditDto', () => {
  it('accepts valid action from allowlist', async () => {
    const dto = plainToInstance(RecordAuditDto, {
      action: 'profile_updated',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('accepts theme_changed action', async () => {
    const dto = plainToInstance(RecordAuditDto, { action: 'theme_changed' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('accepts labs_toggled action', async () => {
    const dto = plainToInstance(RecordAuditDto, { action: 'labs_toggled' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('accepts valid metadata', async () => {
    const dto = plainToInstance(RecordAuditDto, {
      action: 'profile_updated',
      metadata: { field: 'name', oldValue: 'A', newValue: 'B' },
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('accepts missing metadata', async () => {
    const dto = plainToInstance(RecordAuditDto, {
      action: 'profile_updated',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects action not in allowlist', async () => {
    const dto = plainToInstance(RecordAuditDto, {
      action: 'super_admin_action',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'action')).toBe(true);
  });

  it('rejects empty action', async () => {
    const dto = plainToInstance(RecordAuditDto, { action: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'action')).toBe(true);
  });

  it('rejects missing action', async () => {
    const dto = plainToInstance(RecordAuditDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'action')).toBe(true);
  });

  it('rejects non-object metadata', async () => {
    const dto = plainToInstance(RecordAuditDto, {
      action: 'profile_updated',
      metadata: 'not-an-object',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'metadata')).toBe(true);
  });
});

describe('ListAuditQuery', () => {
  it('accepts empty query', async () => {
    const dto = plainToInstance(ListAuditQuery, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('accepts valid page number', async () => {
    const dto = plainToInstance(ListAuditQuery, { page: 5 });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('accepts valid q and action', async () => {
    const dto = plainToInstance(ListAuditQuery, {
      q: 'test search',
      action: 'note_created',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('truncates q to 100 chars via Transform', async () => {
    const longString = 'x'.repeat(200);
    const dto = plainToInstance(ListAuditQuery, { q: longString });
    expect(dto.q).toBe('x'.repeat(100));
  });

  it('truncates action to 64 chars via Transform', async () => {
    const longAction = 'a'.repeat(128);
    const dto = plainToInstance(ListAuditQuery, { action: longAction });
    expect(dto.action).toBe('a'.repeat(64));
  });

  it('rejects page below 1', async () => {
    const dto = plainToInstance(ListAuditQuery, { page: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });

  it('rejects page above 10000', async () => {
    const dto = plainToInstance(ListAuditQuery, { page: 10001 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });

  it('rejects non-integer page', async () => {
    const dto = plainToInstance(ListAuditQuery, { page: 1.5 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });
});
