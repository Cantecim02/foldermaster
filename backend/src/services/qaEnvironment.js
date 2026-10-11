import path from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

export function assertStagingQaEnvironment(settings) {
  const root = settings.stagingRoot;
  const within = target => {
    if (!root || !path.isAbsolute(root) || path.parse(root).root === root) return false;
    const relative = path.relative(root, target);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  };
  const dataDir = path.dirname(settings.databasePath);
  const overlaps = (parent, child) => {
    const relative = path.relative(parent, child);
    return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };
  const host = new URL(settings.publicBaseUrl).hostname.toLowerCase();
  if (settings.appEnvironment !== 'staging' || settings.qaTestAccessEnabled !== true ||
      settings.monetizationEnabled || settings.port === 4000 || settings.bindHost !== '127.0.0.1' ||
      !settings.publicBaseUrl.startsWith('https://') ||
      ['api.editioapp.com', 'editioapp.com', 'www.editioapp.com'].includes(host) ||
      !within(settings.databasePath) || !within(settings.downloadDir) ||
      overlaps(dataDir, settings.downloadDir) || overlaps(settings.downloadDir, dataDir)) {
    throw new Error('QA access requires isolated staging root, HTTPS, loopback, separate port and disabled monetization');
  }
}

/** Reject symlinks/junctions before opening a staging DB or cleaning download files. */
export function assertStagingQaStorage(settings) {
  assertStagingQaEnvironment(settings);
  const root = path.resolve(settings.stagingRoot);
  const realRoot = realpathSync(root);
  const sameRoot = process.platform === 'win32' ? realRoot.toLowerCase() === root.toLowerCase() : realRoot === root;
  if (!sameRoot || !lstatSync(root).isDirectory()) throw new Error('Existing canonical private staging root required');
  for (const target of [settings.databasePath, settings.downloadDir]) {
    let cursor = root;
    // Walk from root using relative components: Windows path casing cannot trap an upward loop.
    for (const part of path.relative(root, target).split(path.sep)) {
      cursor = path.join(cursor, part);
      try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('QA storage symlink/junction forbidden'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
