import Database from 'better-sqlite3';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { assertStagingQaEnvironment } from '../src/services/qaEnvironment.js';
import { setQaPermission } from '../src/services/qaPermissionService.js';

try {
  const { config } = await import('../src/config.js');
  const args = process.argv.slice(2);
  const values = {};
  if (args.length !== 8) throw new Error('Expected --database --user-id --action --approve');
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--database', '--user-id', '--action', '--approve'].includes(key) || key in values) throw new Error('Invalid or duplicate argument');
    values[key] = args[i + 1];
  }
  assertStagingQaEnvironment(config); // Reject before opening a DB, including production/default config.
  const file = values['--database'];
  if (!path.isAbsolute(file) || path.resolve(file) !== config.databasePath) throw new Error('Explicit configured staging database required');
  const root = realpathSync(config.stagingRoot);
  const realFile = realpathSync(file);
  const relative = path.relative(root, realFile);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || realFile !== path.resolve(file)) throw new Error('Database symlink/junction or outside staging root');
  const db = new Database(file, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
    console.log(JSON.stringify(setQaPermission(db, config, { userId: values['--user-id'], action: values['--action'], approval: values['--approve'] })));
  } finally { db.close(); }
} catch {
  console.error('QA permission update rejected. Check isolated staging configuration, explicit database, user UUID and approval.');
  process.exitCode = 1; // Do not echo environment values, account data or DB contents.
}
