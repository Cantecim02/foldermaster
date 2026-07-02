import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const activePaths = new Set();
let cleanupTimer = null;

export function markActiveFile(filePath) {
  if (!filePath) return () => {};
  const resolved = path.resolve(filePath);
  activePaths.add(resolved);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activePaths.delete(resolved);
  };
}

export function isActiveFile(filePath) {
  return activePaths.has(path.resolve(filePath));
}

export function createOperationTracker() {
  const releaseFns = [];
  const cleanupTargets = new Set();
  let closed = false;

  return {
    trackInput(filePath) {
      releaseFns.push(markActiveFile(filePath));
    },
    trackOutput(filePath) {
      const resolved = path.resolve(filePath);
      cleanupTargets.add(resolved);
      releaseFns.push(markActiveFile(resolved));
      return filePath;
    },
    keepOutput(filePath) {
      cleanupTargets.delete(path.resolve(filePath));
    },
    async close({ keepOutputs = false } = {}) {
      if (closed) return;
      closed = true;
      if (!keepOutputs) {
        await Promise.allSettled(
          [...cleanupTargets].map((target) => safeRemoveFile(target))
        );
      }
      for (const release of releaseFns.splice(0)) release();
      cleanupTargets.clear();
    }
  };
}

export async function safeRemoveFile(filePath) {
  if (!filePath) return;
  if (isActiveFile(filePath)) return;
  await rm(filePath, { force: true }).catch(() => {});
}

export async function cleanupExpiredFiles({
  dryRun = false,
  downloadDir = config.downloadDir,
  ttlMs = config.jobTtlMs,
  now = Date.now(),
  logger = console.log
} = {}) {
  await mkdir(downloadDir, { recursive: true });
  const root = path.resolve(downloadDir);
  const deleted = [];
  await cleanupDirectory(root, { root, ttlMs, now, dryRun, deleted, logger });
  return deleted;
}

export function startCleanupTimer() {
  if (cleanupTimer) return cleanupTimer;
  const intervalMs = Math.max(60 * 1000, Math.min(config.jobTtlMs, 10 * 60 * 1000));
  cleanupTimer = setInterval(() => {
    cleanupExpiredFiles().catch((error) => {
      console.warn(`[cleanup] failed: ${sanitizeMessage(error)}`);
    });
  }, intervalMs);
  cleanupTimer.unref?.();
  return cleanupTimer;
}

export function stopCleanupTimer() {
  if (!cleanupTimer) return;
  clearInterval(cleanupTimer);
  cleanupTimer = null;
}

async function cleanupDirectory(directory, options) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    options.logger(`[cleanup] cannot read ${safeRelative(options.root, directory)}: ${sanitizeMessage(error)}`);
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = path.join(directory, entry.name);
    if (!isPathInside(options.root, entryPath)) continue;

    if (entry.isDirectory()) {
      await cleanupDirectory(entryPath, options);
      await removeEmptyDirectory(entryPath);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isActiveFile(entryPath)) continue;

    let info;
    try {
      info = await stat(entryPath);
    } catch {
      continue;
    }

    if (options.now - info.mtimeMs < options.ttlMs) continue;
    const relative = safeRelative(options.root, entryPath);
    if (options.dryRun) {
      options.logger(`[cleanup] would delete ${relative} (${info.size} bytes)`);
    } else {
      await rm(entryPath, { force: true }).catch((error) => {
        options.logger(`[cleanup] cannot delete ${relative}: ${sanitizeMessage(error)}`);
      });
      options.logger(`[cleanup] deleted ${relative} (${info.size} bytes)`);
    }
    options.deleted.push(relative);
  }
}

async function removeEmptyDirectory(directory) {
  try {
    await rm(directory, { recursive: false, force: false });
  } catch {
    // Directory may still contain files, or permissions may prevent removal. Either case is safe to ignore.
  }
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function sanitizeMessage(error) {
  return error instanceof Error ? error.message.replaceAll(config.downloadDir, "<download-dir>") : String(error);
}
