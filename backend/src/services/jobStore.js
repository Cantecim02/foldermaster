import { config } from "../config.js";

const jobs = new Map();

export function createJob(job) {
  jobs.set(job.id, {
    ...job,
    status: "queued",
    progress: 0,
    stage: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

export function updateJob(id, patch) {
  const current = getJob(id);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  jobs.set(id, next);
  return next;
}

export function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - Date.parse(job.createdAt) > config.jobTtlMs) {
      jobs.delete(id);
    }
  }
}
