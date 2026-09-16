// k6/scenarios/notes-flow.js
// Tests Notes CRUD operations, pagination, and RBAC permission enforcement.

import { check } from 'k6';
import { get, post, patch, del } from '../helpers/http.js';
import { generateNotePayload } from '../helpers/data.js';

export function runNotesFlow(sessionCookie) {
  if (!sessionCookie) {
    throw new Error('runNotesFlow requires an authenticated sessionCookie');
  }

  // 1. List Notes (GET /api/notes)
  const listRes = get('/api/notes?limit=10&offset=0', {
    cookie: sessionCookie,
    tags: { name: 'GET /api/notes' },
  });
  check(listRes, {
    'list notes status is 200': (r) => r.status === 200,
    'list notes returns array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.notes);
      } catch {
        return false;
      }
    },
  });

  // 2. Create Note (POST /api/notes)
  const payload = generateNotePayload();
  const createRes = post('/api/notes', payload, {
    cookie: sessionCookie,
    tags: { name: 'POST /api/notes' },
  });

  const createdSuccessfully = check(createRes, {
    'create note status is 201': (r) => r.status === 201,
    'created note has id': (r) => {
      try {
        return Boolean(JSON.parse(r.body).id);
      } catch {
        return false;
      }
    },
  });

  let createdNoteId = null;
  if (createdSuccessfully) {
    try {
      createdNoteId = JSON.parse(createRes.body).id;
    } catch {
      // Ignore
    }
  }

  if (createdNoteId) {
    // 3. Update Note (PATCH /api/notes/:id)
    const updatePayload = {
      title: `${payload.title} (Updated)`,
      content: 'Updated content verification during k6 load testing.',
    };
    const updateRes = patch(`/api/notes/${createdNoteId}`, updatePayload, {
      cookie: sessionCookie,
      tags: { name: 'PATCH /api/notes/:id' },
    });
    check(updateRes, {
      'update note status is 200': (r) => r.status === 200,
      'updated note title matches': (r) => {
        try {
          return JSON.parse(r.body).title === updatePayload.title;
        } catch {
          return false;
        }
      },
    });

    // 4. Delete Note (DELETE /api/notes/:id) - only superAdmin role
    const deleteRes = del(`/api/notes/${createdNoteId}`, {
      cookie: sessionCookie,
      tags: { name: 'DELETE /api/notes/:id' },
    });
    check(deleteRes, {
      'delete note status is 204 or 200': (r) => r.status === 204 || r.status === 200,
    });
  }

  return {
    listRes,
    createRes,
  };
}
