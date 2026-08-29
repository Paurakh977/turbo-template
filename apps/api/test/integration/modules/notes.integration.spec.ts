import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@repo/database';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import {
  USER_FIXTURES,
  seedBaseUsers,
} from '../fixtures/users';
import { registerUserViaApi, loginUserViaApi } from '../helpers/auth';

const TEST_PASSWORD = 'TestPassword123!';

describe('NotesModule (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await truncateAllTables();
    await clearTestRedis();
    app = await createTestApp();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await disconnectTestRedis();
  });

  beforeEach(async () => {
    await truncateAllTables();
    await clearTestRedis();
    await seedBaseUsers();
  });

  describe('POST /api/notes', () => {
    it('returns 401 without a session', async () => {
      await request(app.getHttpServer())
        .post('/api/notes')
        .send({ title: 'Test', content: 'Content' })
        .expect(401);
    });

    it('creates a note for an authenticated user', async () => {
      // Register a fresh user via Better Auth
      const email = `notes-test-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'Notes Tester', 'operator');
      expect(signup.status).toBe(200);

      const res = await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: 'My Note', content: 'My Content' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.title).toBe('My Note');
      expect(res.body.content).toBe('My Content');
      expect(res.body).toHaveProperty('authorId');
      expect(res.body).toHaveProperty('createdAt');
      expect(res.body).toHaveProperty('updatedAt');
      expect(res.body).toHaveProperty('author');
    });

    it('rejects empty title', async () => {
      const email = `notes-validation-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'Validator', 'operator');

      await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: '', content: 'Content' })
        .expect(400);
    });

    it('rejects empty content', async () => {
      const email = `notes-validation2-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'Validator', 'operator');

      await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: 'Title', content: '' })
        .expect(400);
    });

    it('rejects title exceeding 200 characters', async () => {
      const email = `notes-length-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'LongTitle', 'operator');

      await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: 'x'.repeat(201), content: 'Content' })
        .expect(400);
    });

    it('rejects content exceeding 5000 characters', async () => {
      const email = `notes-length2-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'LongContent', 'operator');

      await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: 'Title', content: 'x'.repeat(5001) })
        .expect(400);
    });
  });

  describe('GET /api/notes', () => {
    it('returns 401 without a session', async () => {
      await request(app.getHttpServer())
        .get('/api/notes')
        .expect(401);
    });

    it('returns notes for the authenticated user', async () => {
      const email = `notes-list-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'Lister', 'operator');

      // Create a note first
      await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: 'Listed Note', content: 'Listed Content' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/notes')
        .set('Cookie', signup.cookie!)
        .expect(200);

      expect(res.body).toHaveProperty('notes');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('limit');
      expect(res.body).toHaveProperty('offset');
      expect(Array.isArray(res.body.notes)).toBe(true);
      expect(res.body.notes.length).toBeGreaterThanOrEqual(1);
    });

    it('supports pagination via limit and offset', async () => {
      const email = `notes-page-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'Pager', 'operator');

      // Create 3 notes
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/notes')
          .set('Cookie', signup.cookie!)
          .send({ title: `Page Note ${i}`, content: `Content ${i}` })
          .expect(201);
      }

      const page1 = await request(app.getHttpServer())
        .get('/api/notes?limit=2&offset=0')
        .set('Cookie', signup.cookie!)
        .expect(200);

      expect(page1.body.notes.length).toBe(2);
      expect(page1.body.total).toBe(3);

      const page2 = await request(app.getHttpServer())
        .get('/api/notes?limit=2&offset=2')
        .set('Cookie', signup.cookie!)
        .expect(200);

      expect(page2.body.notes.length).toBe(1);
    });
  });

  describe('PATCH /api/notes/:id', () => {
    it('updates a note owned by the user', async () => {
      const email = `notes-update-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'Updater', 'operator');

      const createRes = await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: 'Original', content: 'Original Content' })
        .expect(201);

      const noteId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .patch(`/api/notes/${noteId}`)
        .set('Cookie', signup.cookie!)
        .send({ title: 'Updated Title' })
        .expect(200);

      expect(res.body.title).toBe('Updated Title');
      expect(res.body.content).toBe('Original Content');
    });

    it('returns 400 for empty patch (both title and content empty/whitespace)', async () => {
      const email = `notes-empty-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'EmptyPatch', 'operator');

      const createRes = await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: 'Original', content: 'Original Content' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/notes/${createRes.body.id}`)
        .set('Cookie', signup.cookie!)
        .send({ title: '   ', content: '   ' })
        .expect(400);
    });

    it('returns 404 for non-existent note', async () => {
      const email = `notes-notfound-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'NotFound', 'operator');

      await request(app.getHttpServer())
        .patch('/api/notes/non-existent-id')
        .set('Cookie', signup.cookie!)
        .send({ title: 'Updated' })
        .expect(404);
    });
  });

  describe('DELETE /api/notes/:id', () => {
    it('deletes a note', async () => {
      const email = `notes-delete-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'Deleter', 'superAdmin');

      const createRes = await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: 'To Delete', content: 'Delete me' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/notes/${createRes.body.id}`)
        .set('Cookie', signup.cookie!)
        .expect(204);

      // Verify it's gone
      await request(app.getHttpServer())
        .get('/api/notes')
        .set('Cookie', signup.cookie!)
        .expect(200)
        .then((res) => {
          expect(res.body.notes.find((n: { id: string }) => n.id === createRes.body.id)).toBeUndefined();
        });
    });

    it('returns 404 for non-existent note', async () => {
      const email = `notes-delnotfound-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'DelNotFound', 'superAdmin');

      await request(app.getHttpServer())
        .delete('/api/notes/non-existent-id')
        .set('Cookie', signup.cookie!)
        .expect(404);
    });
  });
});
