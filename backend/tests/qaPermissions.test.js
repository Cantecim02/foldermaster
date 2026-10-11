import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import express from 'express';
import { PROFILE_SQL } from '../src/services/accountStoreSchema.js';
import { assertStagingQaEnvironment, assertStagingQaStorage } from '../src/services/qaEnvironment.js';
import { setQaPermission, prepareQaPermissions, hasQaPermission } from '../src/services/qaPermissionService.js';
import { assertDatabaseHealthy } from '../src/services/accountProfileMigration.js';

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'editio-qa-permissions-')));
Object.assign(process.env, { NODE_ENV: 'production', APP_ENV: 'staging', QA_TEST_ACCESS_ENABLED: 'true', STAGING_ROOT: root,
  DATABASE_PATH: path.join(root, 'data', 'synthetic.sqlite'), DOWNLOAD_DIR: path.join(root, 'files'), PUBLIC_BASE_URL: 'https://stage.example.com',
  PORT: '4101', BIND_HOST: '127.0.0.1', MONETIZATION_ENABLED: 'false' });
const { config } = await import('../src/config.js');
const { initializeAccountStore, closeAccountStore, getAccountDatabase } = await import('../src/services/accountService.js');
const { accountRoutes } = await import('../src/routes/accountRoutes.js');
const backendRoot = path.resolve(import.meta.dirname, '..');
const userId = '11111111-1111-4111-8111-111111111111';
const operation = { userId, action: 'grant', approval: 'qa-tester-staging' };
const seed = db => db.prepare(`INSERT INTO users (id,email,password_hash,username,terms_version,privacy_version,accepted_at,created_at,updated_at)
  VALUES (?, 'synthetic@example.com', 'synthetic-hash', 'user-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 't', 'p', 'now', 'now', 'now')`).run(userId);

test('only isolated explicit staging config allows QA; flags, production and default paths fail closed', () => {
  assert.doesNotThrow(() => assertStagingQaEnvironment(config));
  for (const change of [{ appEnvironment: 'production' }, { appEnvironment: 'development' }, { qaTestAccessEnabled: false },
    { port: 4000 }, { bindHost: '0.0.0.0' }, { monetizationEnabled: true }, { stagingRoot: '' },
    { publicBaseUrl: 'https://api.editioapp.com:8443' }, { publicBaseUrl: 'http://stage.example.com' },
    { databasePath: path.join(root, '..', 'production.sqlite') }, { downloadDir: path.join(root, '..', 'production-files') },
    { databasePath: path.join(root, 'files', 'synthetic.sqlite') }, { downloadDir: path.join(root, 'data', 'files') },
    { downloadDir: root }]) {
    assert.throws(() => assertStagingQaEnvironment({ ...config, ...change }));
  }
});

test('operator assignment uses ID, explicit approval, audit and cascade; cannot grant admin or change account/balance', () => {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); db.exec(PROFILE_SQL); seed(db);
  const before = db.prepare('SELECT * FROM users').all();
  for (const change of [{ approval: '' }, { userId: 'synthetic@example.com' }, { action: 'admin' }, { userId: '22222222-2222-4222-8222-222222222222' }]) {
    assert.throws(() => setQaPermission(db, config, { ...operation, ...change }));
  }
  setQaPermission(db, config, operation); setQaPermission(db, config, operation);
  assert.equal(hasQaPermission(db, config, userId), true);
  assert.equal(hasQaPermission(db, { ...config, qaTestAccessEnabled: false }, userId), false);
  assert.deepEqual(db.prepare('SELECT * FROM users').all(), before);
  assert.equal(db.prepare('SELECT count(*) n FROM account_test_permissions').get().n, 1);
  setQaPermission(db, config, { ...operation, action: 'revoke' });
  assert.equal(hasQaPermission(db, config, userId), false);
  assert.equal(db.prepare('SELECT count(*) n FROM account_test_permission_audit').get().n, 3);
  db.exec('DELETE FROM users');
  assert.equal(db.prepare('SELECT count(*) n FROM account_test_permission_audit').get().n, 0);
  assertDatabaseHealthy(db); db.close();
});

test('staging storage rejects symlinks/junctions before database access or file cleanup', async () => {
  assert.doesNotThrow(() => assertStagingQaStorage({ ...config, stagingRoot: root + path.sep }));
  const other = await realpath(await mkdtemp(path.join(os.tmpdir(), 'editio-other-synthetic-')));
  const link = path.join(root, 'linked');
  try {
    await symlink(other, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => assertStagingQaStorage({ ...config, databasePath: path.join(link, 'not-opened.sqlite') }), /symlink\/junction/);
    assert.throws(() => assertStagingQaStorage({ ...config, downloadDir: link }), /symlink\/junction/);
  } finally { await rm(link, { force: true }); await rm(other, { recursive: true, force: true }); }
});

test('unexpected QA schema fails with transaction rollback and leaves user records unchanged', () => {
  const db = new Database(':memory:'); db.exec(PROFILE_SQL); seed(db);
  db.exec('CREATE TABLE account_test_permissions (user_id TEXT, permission TEXT)');
  const schema = db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
  assert.throws(() => setQaPermission(db, config, operation), /Unknown QA permission schema/);
  assert.deepEqual(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), schema);
  db.close();
});

test('custom QA trigger cannot use an operator grant to modify user data', () => {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); db.exec(PROFILE_SQL); seed(db);
  prepareQaPermissions(db);
  db.exec(`CREATE TRIGGER unexpected_qa_grant AFTER INSERT ON account_test_permissions
    BEGIN UPDATE users SET password_hash = 'changed' WHERE id = NEW.user_id; END`);
  const before = db.prepare('SELECT * FROM users').all();
  assert.throws(() => prepareQaPermissions(db), /Unknown QA permission schema/);
  assert.throws(() => setQaPermission(db, config, operation), /Custom VIEW\/TRIGGER/);
  assert.deepEqual(db.prepare('SELECT * FROM users').all(), before);
  assert.equal(db.prepare('SELECT count(*) n FROM account_test_permissions').get().n, 0);
  db.close();
});

test('HTTP permission and action checks deny standard/spoofed users, observe CLI revoke, preserve sessions/history/billing', async () => {
  await initializeAccountStore();
  const app = express(); app.use(express.json()); app.use('/auth', accountRoutes);
  app.use((error, req, res, next) => res.status(error.name === 'ZodError' ? 400 : error.status ?? 500).json({ code: error.code }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, token, body, method = body ? 'POST' : 'GET') => fetch(base + '/auth' + route, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {})
  });
  try {
    const input = { email: 'qa@example.com', password: 'SecurePass123', acceptedTerms: true, ageConfirmed: true, minimumAge: 13 };
    assert.equal((await request('/register', null, { ...input, permissions: { qaTester: true } })).status, 400);
    const registered = await (await request('/register', null, input)).json();
    const id = registered.user.id, token = registered.session.token;
    assert.equal(registered.user.permissions.qaTester, false);
    assert.equal((await request('/qa-access')).status, 401);
    assert.equal((await (await request('/qa-access', token)).json()).qaTester, false);
    assert.equal((await request('/qa-access', token, { action: 'reset', userId: id })).status, 400);
    assert.equal((await request('/qa-access', token, { action: 'reset' })).status, 403);
    assert.equal((await request('/permissions', token, { permission: 'qa_tester' })).status, 404);
    const db = getAccountDatabase();
    db.exec("CREATE TABLE synthetic_billing(user_id TEXT REFERENCES users(id), balance INTEGER); CREATE TABLE synthetic_history(user_id TEXT REFERENCES users(id), label TEXT)");
    db.prepare('INSERT INTO synthetic_billing VALUES (?,42)').run(id); db.prepare("INSERT INTO synthetic_history VALUES (?, 'fixture')").run(id);
    const snapshot = () => ({ users: db.prepare('SELECT * FROM users').all(), sessions: db.prepare('SELECT * FROM account_sessions').all(),
      billing: db.prepare('SELECT * FROM synthetic_billing').all(), history: db.prepare('SELECT * FROM synthetic_history').all() });
    const before = snapshot();
    const cli = (action, env = process.env, approval = 'qa-tester-staging') => spawnSync(process.execPath,
      ['scripts/set-qa-tester.js', '--database', config.databasePath, '--user-id', id, '--action', action, '--approve', approval],
      { cwd: backendRoot, env, encoding: 'utf8' });
    assert.equal(cli('grant', process.env, 'wrong').status, 1);
    assert.equal(cli('grant', { ...process.env, APP_ENV: 'production' }).status, 1);
    assert.equal(cli('grant').status, 0);
    assert.equal((await (await request('/me', token)).json()).user.permissions.qaTester, true);
    for (const action of ['enter', 'new_round', 'reset', 'five_wins', 'shot', 'score']) assert.equal((await request('/qa-access', token, { action })).status, 200);
    assert.equal((await request('/qa-access', token, { action: 'reset_conversion_quota' })).status, 400);
    assert.deepEqual(snapshot(), before);
    assert.equal(cli('revoke').status, 0);
    assert.equal((await request('/qa-access', token, { action: 'reset' })).status, 403);
    assert.equal((await (await request('/me', token)).json()).user.permissions.qaTester, false);
    await request('/logout', token, undefined, 'POST');
    assert.equal((await request('/qa-access', token)).status, 401);
    assertDatabaseHealthy(db);
  } finally { await new Promise(resolve => server.close(resolve)); closeAccountStore(); await rm(root, { recursive: true, force: true }); }
});
