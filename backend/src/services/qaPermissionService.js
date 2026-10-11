import { assertStagingQaEnvironment } from './qaEnvironment.js';
import { assertDatabaseHealthy, inspectAccountSchema } from './accountProfileMigration.js';

export const QA_APPROVAL = 'qa-tester-staging';
export const QA_ACTIONS = Object.freeze(['enter', 'new_round', 'reset', 'five_wins', 'shot', 'score']);
const permissionsSql = `CREATE TABLE account_test_permissions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK(permission = 'qa_tester'),
  granted_at TEXT NOT NULL
)`;
const auditSql = `CREATE TABLE account_test_permission_audit (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('grant', 'revoke')),
  occurred_at TEXT NOT NULL
)`;
const normalize = sql => sql.replace(/\s+/g, ' ').trim();

export function prepareQaPermissions(db) {
  if (db.prepare(`SELECT 1 FROM sqlite_master WHERE tbl_name IN ('account_test_permissions', 'account_test_permission_audit')
    AND type != 'table' AND sql IS NOT NULL`).get()) throw new Error('Unknown QA permission schema; manual review required');
  for (const [name, sql] of [['account_test_permissions', permissionsSql], ['account_test_permission_audit', auditSql]]) {
    const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name);
    if (existing && normalize(existing.sql) !== normalize(sql)) throw new Error('Unknown QA permission schema; manual review required');
    if (!existing) db.exec(sql);
  }
}

export function hasQaPermission(db, settings, userId) {
  if (!settings.qaTestAccessEnabled) return false;
  assertStagingQaEnvironment(settings);
  return Boolean(db.prepare("SELECT 1 FROM account_test_permissions WHERE user_id=? AND permission='qa_tester'").get(userId));
}

/** Operator CLI only. There is deliberately no HTTP role-management endpoint. */
export function setQaPermission(db, settings, { userId, action, approval }) {
  assertStagingQaEnvironment(settings);
  if (approval !== QA_APPROVAL || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId ?? '') ||
      !['grant', 'revoke'].includes(action)) throw new Error('Explicit staging approval, UUID and grant/revoke required');
  db.transaction(() => {
    if (inspectAccountSchema(db) !== 'ready') throw new Error('Ready account schema required; this tool does not migrate');
    assertDatabaseHealthy(db);
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId)) throw new Error('Unknown staging user ID');
    prepareQaPermissions(db);
    const now = new Date().toISOString();
    if (action === 'grant') db.prepare("INSERT INTO account_test_permissions VALUES (?, 'qa_tester', ?) ON CONFLICT(user_id) DO NOTHING").run(userId, now);
    else db.prepare('DELETE FROM account_test_permissions WHERE user_id=?').run(userId);
    db.prepare('INSERT INTO account_test_permission_audit (user_id,action,occurred_at) VALUES (?,?,?)').run(userId, action, now);
    assertDatabaseHealthy(db);
  }).immediate();
  return { userId, permission: 'qa_tester', active: action === 'grant' };
}
