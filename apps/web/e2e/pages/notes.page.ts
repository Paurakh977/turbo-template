import { Page, expect } from '@playwright/test';
import { ROUTES } from '../config/routes';

export class NotesPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto(ROUTES.notes);
  }

  private noteItem(title: string) {
    return this.page.getByTestId('note-item').filter({ hasText: title });
  }

  async openCreate() {
    await this.page.getByTestId('note-create-open').click();
  }

  async fillCreateForm(title: string, content: string) {
    await this.page.locator('#note-create-title').fill(title);
    await this.page.locator('#note-create-content').fill(content);
  }

  async submitCreate() {
    await this.page.getByRole('button', { name: 'Create' }).click();
  }

  async createNote(title: string, content: string) {
    await this.openCreate();
    await this.fillCreateForm(title, content);
    await this.submitCreate();
  }

  async expectNoteVisible(title: string) {
    await expect(this.noteItem(title)).toBeVisible();
  }

  async openEdit(title: string) {
    await this.noteItem(title)
      .getByRole('button', { name: 'Edit' })
      .click();
  }

  async editFields(title: string, content: string) {
    await this.page
      .locator('[data-testid="note-edit-title"], [id^="note-edit-title"], #note-edit-title')
      .first()
      .fill(title);
    await this.page
      .locator('[data-testid="note-edit-content"], [id^="note-edit-content"], #note-edit-content')
      .first()
      .fill(content);
  }

  async saveEdit() {
    await this.page.getByTestId('note-save').click();
  }

  async editNote(title: string, newTitle: string, newContent: string) {
    await this.openEdit(title);
    await this.editFields(newTitle, newContent);
    await this.saveEdit();
    await this.expectNoteVisible(newTitle);
  }

  async deleteNote(title: string) {
    const deleteBtn = this.noteItem(title).getByRole('button', { name: 'Delete' });
    const isVisible = await deleteBtn.isVisible().catch(() => false);
    if (isVisible) {
      await deleteBtn.click();
      await this.page
        .getByRole('dialog')
        .getByRole('button', { name: /delete/i })
        .click();
      await expect(this.noteItem(title)).toHaveCount(0);
    }
  }
}
