import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LEGACY_SQL } from '../src/services/accountStoreSchema.js';
import { runAccountMigration } from '../src/services/accountMigrationRunner.js';
import { assertDatabaseHealthy, inspectAccountSchema, migrateAccountProfiles } from '../src/services/accountProfileMigration.js';

async function fixture(run, sql = LEGACY_SQL) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'editio-migration-safety-'));
  const file = path.join(root, 'synthetic.sqlite');
  const db = new Database(file);
  try {
    db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
    db.exec(sql);
    db.prepare(`INSERT INTO users (id,first_name,last_name,birth_date,email,password_hash,app_account_token,terms_version,privacy_version,accepted_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('id-a','Test','Fixture','1990-01-01','a@example.com','synthetic-hash',null,'terms','privacy','now','now','now');
    await run(db, { root, file, backup: path.join(root,'before.sqlite') });
  } finally { db.close(); await rm(root, { recursive:true, force:true }); }
}
const snapshot = db => ({ schema: db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name').all(), users: db.prepare('SELECT * FROM users ORDER BY id').all() });
const options = backup => ({ approval:'account-profile-v2', backupPath:backup });

test('production and development startup reject legacy schema before any preparation writes', async () => {
  await fixture(async (db,{file}) => {
    const before=snapshot(db);
    for (const mode of ['production','development']) {
      const result=spawnSync(process.execPath,['--input-type=module','-e',`import {initializeAccountStore} from './src/services/accountService.js'; await initializeAccountStore();`],{
        cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',
        env:{...process.env,NODE_ENV:mode,PUBLIC_BASE_URL:'https://api.example.com',DATABASE_PATH:file,MONETIZATION_ENABLED:'false'}
      });
      assert.notEqual(result.status,0); assert.match(result.stderr,/requires offline approval and verified backup/);
      assert.deepEqual(snapshot(db),before);
    }
  });
});

test('explicit approval is required and backup/source paths cannot be overwritten', async () => {
  await fixture(async(db,{file,backup})=>{
    const before=snapshot(db);
    assert.throws(()=>migrateAccountProfiles(db),/approval required/);
    await assert.rejects(runAccountMigration(db,{backupPath:backup}),/approval required/);
    await assert.rejects(runAccountMigration(db,options(file)),/separate absolute/);
    await writeFile(backup,'existing backup');
    await assert.rejects(runAccountMigration(db,options(backup)),/EEXIST/);
    assert.deepEqual(snapshot(db),before);
  });
});

test('Online Backup API includes committed WAL data and restores a valid pre-migration schema',async()=>{
  await fixture(async(db,{backup})=>{
    const before=snapshot(db);
    const result=await runAccountMigration(db,options(backup));
    assert.deepEqual(result,{migrated:true,backupVerified:true});
    assert.equal(inspectAccountSchema(db),'ready');assertDatabaseHealthy(db);
    const restored=new Database(backup,{readonly:true});
    try {assertDatabaseHealthy(restored);assert.deepEqual(snapshot(restored),before);assert.equal(inspectAccountSchema(restored),'legacy');}
    finally {restored.close();}
    const migrated=snapshot(db);
    await runAccountMigration(db,options(backup+'.second'));
    assert.deepEqual(snapshot(db),migrated);
  });
});

test('preparation and profile failure roll back together, including token allocation and indexes',async()=>{
  await fixture(async(db,{backup})=>{
    const before=snapshot(db);
    await assert.rejects(runAccountMigration(db,{...options(backup),makeUsername:()=>{throw Error('synthetic failure');}}),/synthetic failure/);
    assert.deepEqual(snapshot(db),before);assert.equal(db.pragma('foreign_keys',{simple:true}),1);
    await runAccountMigration(db,options(backup+'.retry'));assert.equal(inspectAccountSchema(db),'ready');
  });
});

for (const [name,change] of [
  ['VIEW','CREATE VIEW custom_profile AS SELECT id FROM users'],
  ['TRIGGER','CREATE TRIGGER custom_profile AFTER UPDATE ON users BEGIN SELECT 1; END'],
  ['INDEX','CREATE INDEX custom_profile ON users(first_name)'],
  ['disguised allowed INDEX','CREATE UNIQUE INDEX users_app_account_token_idx ON users(first_name)'],
  ['column','ALTER TABLE users ADD COLUMN custom_data TEXT'],
]) test(`unexpected ${name} fails before backup or schema mutation`,async()=>{
  await fixture(async(db,{backup})=>{
    db.exec(change);const before=snapshot(db);
    await assert.rejects(runAccountMigration(db,options(backup)),/manual migration review required/);
    assert.deepEqual(snapshot(db),before);await assert.rejects(access(backup));
  });
});

test('custom CHECK constraint with identical column names is rejected',async()=>{
  await fixture(async(db,{backup})=>{
    const before=snapshot(db);await assert.rejects(runAccountMigration(db,options(backup)),/manual migration review required/);
    assert.deepEqual(snapshot(db),before);
  },LEGACY_SQL.replace('first_name TEXT NOT NULL','first_name TEXT NOT NULL CHECK(length(first_name) > 0)'));
});

test('foreign_key_check failure blocks backup and migration',async()=>{
  await fixture(async(db,{backup})=>{
    db.pragma('foreign_keys = OFF');db.exec("CREATE TABLE child(user_id TEXT REFERENCES users(id)); INSERT INTO child VALUES ('missing')");db.pragma('foreign_keys = ON');
    const before=snapshot(db);await assert.rejects(runAccountMigration(db,options(backup)),/foreign_key_check failed/);
    assert.deepEqual(snapshot(db),before);await assert.rejects(access(backup));
  });
});

test('integrity_check failure blocks migration before writes',async()=>{
  await fixture(async(db,{backup})=>{
    const before=snapshot(db);const pragma=db.pragma.bind(db);
    db.pragma=(sql,...args)=>sql==='integrity_check'?[{integrity_check:'synthetic corruption'}]:pragma(sql,...args);
    await assert.rejects(runAccountMigration(db,options(backup)),/integrity_check failed/);
    assert.deepEqual(snapshot(db),before);await assert.rejects(access(backup));
  });
});

test('post-migration FK failure rolls back the rebuild and preparation',async()=>{
  await fixture(async(db)=>{
    const before=snapshot(db);
    assert.throws(()=>migrateAccountProfiles(db,undefined,{approval:'account-profile-v2',prepare:()=>db.exec("CREATE TABLE bad_child(user_id TEXT REFERENCES users(id)); INSERT INTO bad_child VALUES ('missing')")}),/foreign_key_check failed/);
    assert.deepEqual(snapshot(db),before);assert.equal(db.pragma('foreign_keys',{simple:true}),1);
  });
});

test('backup failure never modifies source or leaves a misleading successful backup',async()=>{
  await fixture(async(db,{backup})=>{
    const before=snapshot(db);db.backup=async()=>{throw Error('synthetic backup failure');};
    await assert.rejects(runAccountMigration(db,options(backup)),/backup failure/);assert.deepEqual(snapshot(db),before);await assert.rejects(access(backup));
  });
});

test('another writer during backup invalidates approval snapshot before migration',async()=>{
  await fixture(async(db,{file,backup})=>{
    const originalBackup=db.backup.bind(db);
    db.backup=async target=>{
      const result=await originalBackup(target);const writer=new Database(file);
      try {writer.exec("UPDATE users SET first_name='Changed' WHERE id='id-a'");} finally {writer.close();}
      return result;
    };
    await assert.rejects(runAccountMigration(db,options(backup)),/Database changed during backup/);
    assert.equal(inspectAccountSchema(db),'legacy');assert.equal(db.prepare('SELECT app_account_token FROM users').get().app_account_token,null);
  });
});
