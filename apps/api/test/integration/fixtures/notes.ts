import { db } from '@repo/database';

export type FixtureNote = {
  id: string;
  title: string;
  content: string;
  authorId: string;
};

/**
 * Creates a note fixture in the database.
 */
export async function createNoteFixture(
  overrides: Partial<FixtureNote> & { authorId: string },
): Promise<FixtureNote> {
  const note: FixtureNote = {
    id: `fixture-note-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    title: 'Fixture Note',
    content: 'Fixture content',
    ...overrides,
  };

  await db.note.create({
    data: {
      id: note.id,
      title: note.title,
      content: note.content,
      authorId: note.authorId,
    },
  });

  return note;
}

/**
 * Creates multiple note fixtures for a given author.
 */
export async function createNoteFixtures(
  authorId: string,
  count: number,
): Promise<FixtureNote[]> {
  const notes: FixtureNote[] = [];
  for (let i = 0; i < count; i++) {
    notes.push(
      await createNoteFixture({
        id: `fixture-note-${authorId}-${i}`,
        title: `Note ${i}`,
        content: `Content ${i}`,
        authorId,
      }),
    );
  }
  return notes;
}
