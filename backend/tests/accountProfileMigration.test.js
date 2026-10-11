import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { generateUsername, insertProfile, migrateAccountProfiles as migrate, PROFILE_MIGRATION_APPROVAL } from '../src/services/accountProfileMigration.js';
const migrateAccountProfiles = (db, generator) => migrate(db, generator, { approval: PROFILE_MIGRATION_APPROVAL });
function legacy() {
 const db = new Database(':memory:'); db.pragma('foreign_keys = ON');
 db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, birth_date TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, app_account_token TEXT UNIQUE,
 subscription_status TEXT NOT NULL DEFAULT 'free', subscription_expire_date TEXT, terms_version TEXT NOT NULL,
 privacy_version TEXT NOT NULL, accepted_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 INSERT INTO users VALUES ('id-a','Ada','Lovelace','1990-12-10','a@example.com','hash-a','apple-token-a','premium','2099-01-01','terms','privacy','now','now','now');
 INSERT INTO users VALUES ('id-b','Grace','Hopper','1990-12-09','b@example.com','hash-b','apple-token-b','free',NULL,'terms','privacy','now','now','now');
 CREATE TABLE account_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE);
 INSERT INTO account_sessions VALUES ('session-hash','id-a');
 CREATE TABLE conversion_history (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE);
 INSERT INTO conversion_history VALUES ('history-a','id-a');
 CREATE TABLE entitlements (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL);
 INSERT INTO entitlements VALUES ('entitlement-a','id-a');`); return db;
}
const name = n => `user-${String(n).padStart(32, '0')}`;
test('migration preserves credentials, sessions, history, subscription links and remains idempotent', () => {
 const db = legacy(); try {
 const original = db.prepare('SELECT * FROM users ORDER BY id').all(); migrateAccountProfiles(db);
 const migrated = db.prepare('SELECT * FROM users ORDER BY id').all();
 for (let i = 0; i < original.length; i++) for (const key of Object.keys(original[i])) assert.equal(migrated[i][key], original[i][key], key);
 assert.notEqual(migrated[0].username, migrated[1].username); assert.match(migrated[0].username, /^user-[a-f0-9]{32}$/);
 assert.notEqual(migrated[0].username, migrated[0].id); assert.notEqual(migrated[0].username, migrated[0].app_account_token);
 migrateAccountProfiles(db, () => { throw new Error('Must not regenerate'); }); assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), migrated);
 assert.equal(db.prepare('SELECT token_hash FROM account_sessions').get().token_hash, 'session-hash');
 assert.equal(db.prepare('SELECT user_id FROM conversion_history').get().user_id, 'id-a'); assert.equal(db.prepare('SELECT user_id FROM entitlements').get().user_id, 'id-a');
 assert.deepEqual(db.pragma('foreign_key_check'), []); assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
 for (const c of db.pragma('table_info(users)').filter(c => ['first_name','last_name','birth_date'].includes(c.name))) assert.equal(c.notnull, 0);
 db.prepare('DELETE FROM users WHERE id=?').run('id-a'); assert.equal(db.prepare('SELECT count(*) n FROM account_sessions').get().n, 0);
 assert.equal(db.prepare('SELECT count(*) n FROM conversion_history').get().n, 0); assert.equal(db.prepare('SELECT user_id FROM entitlements').get().user_id, null);
 } finally { db.close(); }
});
test('migration collision retry and exhaustion rollback are atomic', () => {
 const db = legacy(); let n = 0; try { migrateAccountProfiles(db, () => name(++n < 3 ? 1 : 2)); assert.equal(n, 3); } finally { db.close(); }
 const rollback = legacy(); const before = rollback.prepare('SELECT * FROM users').all(); try {
 assert.throws(() => migrateAccountProfiles(rollback, () => name(1)), /Username migration failed/); assert.deepEqual(rollback.prepare('SELECT * FROM users').all(), before);
 assert.equal(rollback.prepare('SELECT count(*) n FROM account_sessions').get().n, 1); assert.equal(rollback.pragma('foreign_keys', { simple: true }), 1);
 assert.equal(rollback.prepare("SELECT name FROM sqlite_master WHERE name='users_profile_v2'").get(), undefined);
 } finally { rollback.close(); }
});
test('registration retries username collisions only; email remains UNIQUE', () => {
 const db = legacy(); try {
 migrateAccountProfiles(db, (() => { let n=0; return () => name(++n); })());
 const user = { id:'id-c', firstName:null, lastName:null, birthDate:null, email:'c@example.com', passwordHash:'hash', appAccountToken:'token-c', termsVersion:'terms', privacyVersion:'privacy', acceptedAt:'now', createdAt:'now', updatedAt:'now', ageAttestedAt:'now', ageAttestedMinimum:13, ageAttestationSource:'declaration' };
 let n=0; assert.equal(insertProfile(db,user,()=>name(++n < 3 ? 1 : 3)),name(3)); assert.equal(n,3);
 assert.equal(db.prepare('SELECT birth_date FROM users WHERE id=?').get('id-c').birth_date,null);
 assert.throws(()=>insertProfile(db,{...user,id:'id-d',appAccountToken:'token-d',email:'A@EXAMPLE.COM'},()=>name(4)), /users.email/);
 assert.throws(()=>insertProfile(db,{...user,id:'id-e',appAccountToken:'token-e',email:'e@example.com'},()=>name(1)), /Username allocation failed/);
 assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,3);
 } finally { db.close(); }
});
test('custom schema fails safely for manual review', () => {
 for (const change of ['ALTER TABLE users ADD COLUMN future_data TEXT','CREATE TRIGGER custom_update AFTER UPDATE ON users BEGIN SELECT 1; END','CREATE INDEX custom_index ON users(first_name)']) {
 const db=legacy(); try { db.exec(change); assert.throws(()=>migrateAccountProfiles(db),/manual migration review required/); assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,2); } finally { db.close(); }
 }
});
test('username is a random 128-bit identifier',()=> {const names=new Set(Array.from({length:100},generateUsername));assert.equal(names.size,100);for(const value of names)assert.match(value,/^user-[a-f0-9]{32}$/);});
