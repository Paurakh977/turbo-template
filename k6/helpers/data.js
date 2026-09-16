// k6/helpers/data.js
// Dynamic test data generators for notes, users, and audit logs.

export function randomString(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateNotePayload() {
  const id = randomString(6);
  return {
    title: `Load Test Note ${id} (VU: ${__VU || 1})`,
    content: `Automated content for load testing generated at ${new Date().toISOString()}.\nDetails: iteration ${__ITER || 0}, random key: ${randomString(12)}.`,
  };
}

export function generateUserPayload() {
  const id = `${Date.now()}_${randomString(4)}`;
  return {
    email: `k6_user_${id}@example.com`,
    password: `P@ssword_${randomString(8)}!`,
    name: `K6 User ${id}`,
  };
}

export function generateAuditPayload() {
  const actions = ['profile_updated', 'theme_changed', 'labs_toggled'];
  const action = actions[Math.floor(Math.random() * actions.length)];
  return {
    action,
    metadata: {
      client: 'k6-load-test',
      timestamp: Date.now(),
      theme: action === 'theme_changed' ? (Math.random() > 0.5 ? 'dark' : 'light') : undefined,
      feature: action === 'labs_toggled' ? 'ai-assist' : undefined,
    },
  };
}
