import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closeDatabase } from '../src/db.js';
import { closeRedis } from '../src/redis.js';

const app = createApp();

after(async () => {
  await Promise.allSettled([closeRedis(), closeDatabase()]);
});

test('health endpoint reports database and redis status', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.service, 'minchat');
  assert.equal(res.body.checks.database, 'ok');
  assert.equal(res.body.checks.redis, 'ok');
  assert.equal(typeof res.body.maintenance.active, 'boolean');
});

test('unknown API endpoints return a structured 404', async () => {
  const res = await request(app).get('/api/this-route-does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('API responses carry baseline security headers', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['x-request-id']);
});

test('malformed JSON is rejected with INVALID_JSON', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .set('Origin', 'http://localhost:5050')
    .send('{"identifier":');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
});

test('protected admin routes require a session', async () => {
  const res = await request(app).get('/api/admin/stats').set('Origin', 'http://localhost:5050');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('registration validation rejects weak passwords before any write', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .set('Content-Type', 'application/json')
    .set('Origin', 'http://localhost:5050')
    .send({
      username: 'test_widget',
      email: 'widget@example.com',
      password: 'short',
      displayName: 'Widget'
    });
  assert.equal(res.status, 400);
  assert.ok(['VALIDATION_ERROR', 'WEAK_PASSWORD'].includes(res.body.error.code));
  assert.ok(res.headers['set-cookie'] === undefined);
});
