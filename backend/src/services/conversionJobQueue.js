import { config } from "../config.js";
import { JobQueue } from "./jobQueue.js";

export const conversionQueue = new JobQueue({
  maxConcurrentJobs: config.maxConcurrentJobs,
  maxPendingJobs: config.maxPendingJobs
});
