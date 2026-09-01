import { test, expect } from '../../fixtures/page.fixture';

test.describe('Health checks', () => {
  test('GET /api/health/live returns ok', async ({ api }) => {
    const res = await api.healthLive();
    expect(res.status).toBe(200);
    expect(res.body?.status ?? res.body?.ok).toBeTruthy();
  });

  test('GET /api/health/ready returns ok', async ({ api }) => {
    const res = await api.healthReady();
    expect(res.status).toBe(200);
    expect(res.body?.status ?? res.body?.ok).toBeTruthy();
  });
});
