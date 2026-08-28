import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateNoteDto,
  UpdateNoteDto,
  ListNotesQuery,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './note.dto';

describe('CreateNoteDto', () => {
  it('accepts valid title and content', async () => {
    const dto = plainToInstance(CreateNoteDto, {
      title: 'My Note',
      content: 'Some content here',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects missing title', async () => {
    const dto = plainToInstance(CreateNoteDto, { content: 'content' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'title')).toBe(true);
  });

  it('rejects empty title', async () => {
    const dto = plainToInstance(CreateNoteDto, { title: '', content: 'c' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'title')).toBe(true);
  });

  it('rejects title over 200 chars', async () => {
    const dto = plainToInstance(CreateNoteDto, {
      title: 'x'.repeat(201),
      content: 'c',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'title')).toBe(true);
  });

  it('accepts title at exactly 200 chars', async () => {
    const dto = plainToInstance(CreateNoteDto, {
      title: 'x'.repeat(200),
      content: 'c',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'title')).toBe(false);
  });

  it('rejects missing content', async () => {
    const dto = plainToInstance(CreateNoteDto, { title: 't' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects content over 5000 chars', async () => {
    const dto = plainToInstance(CreateNoteDto, {
      title: 't',
      content: 'x'.repeat(5001),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects non-string title', async () => {
    const dto = plainToInstance(CreateNoteDto, { title: 123, content: 'c' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'title')).toBe(true);
  });
});

describe('UpdateNoteDto', () => {
  it('accepts valid partial update', async () => {
    const dto = plainToInstance(UpdateNoteDto, { title: 'New Title' });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('accepts empty patch', async () => {
    const dto = plainToInstance(UpdateNoteDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('accepts both fields', async () => {
    const dto = plainToInstance(UpdateNoteDto, {
      title: 'New',
      content: 'New content',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects empty string title', async () => {
    const dto = plainToInstance(UpdateNoteDto, { title: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'title')).toBe(true);
  });

  it('rejects title over 200 chars', async () => {
    const dto = plainToInstance(UpdateNoteDto, { title: 'x'.repeat(201) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'title')).toBe(true);
  });
});

describe('ListNotesQuery', () => {
  it('accepts valid limit and offset', async () => {
    const dto = plainToInstance(ListNotesQuery, { limit: 50, offset: 10 });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('accepts empty query', async () => {
    const dto = plainToInstance(ListNotesQuery, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects limit below 1', async () => {
    const dto = plainToInstance(ListNotesQuery, { limit: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects limit above MAX_LIMIT (500)', async () => {
    const dto = plainToInstance(ListNotesQuery, { limit: 501 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects negative offset', async () => {
    const dto = plainToInstance(ListNotesQuery, { offset: -1 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'offset')).toBe(true);
  });

  it('rejects non-integer limit', async () => {
    const dto = plainToInstance(ListNotesQuery, { limit: 1.5 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });
});

describe('constants', () => {
  it('DEFAULT_LIMIT is 200', () => {
    expect(DEFAULT_LIMIT).toBe(200);
  });

  it('MAX_LIMIT is 500', () => {
    expect(MAX_LIMIT).toBe(500);
  });
});
