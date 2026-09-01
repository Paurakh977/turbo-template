import { test, expect } from '../../fixtures/page.fixture';
import { NotesPage } from '../../pages/notes.page';
import { cookieFromStorageState } from '../../helpers/api.helper';
import { ApiClient } from '../../helpers/api.helper';
import { makeNote } from '../../factories/note.factory';
import { E2E_USERS } from '../../config/users';

function onlyNoteWriter() {
  const role = test.info().project.name;
  if (!['operator', 'admin', 'superadmin'].includes(role)) test.skip();
}

test.describe('Notes CRUD', () => {
  test('operator can create, edit and delete a note', async ({ page }) => {
    onlyNoteWriter();
    const notes = new NotesPage(page);
    await notes.goto();
    const note = makeNote();
    await notes.createNote(note.title, note.content);
    await notes.expectNoteVisible(note.title);

    const edited = makeNote();
    await notes.editNote(note.title, edited.title, edited.content);
    await notes.deleteNote(edited.title);
  });

  test('a plain user cannot create a note via the API', async () => {
    if (test.info().project.name !== 'user') test.skip();
    const cookie = cookieFromStorageState('user');
    const api = await ApiClient.create(cookie);
    const res = await api.createNote('x', 'y');
    expect(res.status).toBe(403);
    await api.close();
  });
});
