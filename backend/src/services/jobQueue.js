import { HttpError } from "../utils/httpError.js";

export class JobQueue {
  constructor({ maxConcurrentJobs, maxPendingJobs }) {
    this.maxConcurrentJobs = maxConcurrentJobs;
    this.maxPendingJobs = maxPendingJobs;
    this.activeJobs = 0;
    this.pendingJobs = [];
    this.controllers = new Set();
  }

  run(task, { signal } = {}) {
    if (signal?.aborted) {
      return Promise.reject(cancelledError());
    }

    return new Promise((resolve, reject) => {
      const queuedJob = {
        run: () => {
          signal?.removeEventListener("abort", onAbort);
          this.start(task, signal).then(resolve, reject);
        },
        reject
      };

      const onAbort = () => {
        this.pendingJobs = this.pendingJobs.filter((job) => job !== queuedJob);
        reject(cancelledError());
      };

      if (this.activeJobs < this.maxConcurrentJobs) {
        queuedJob.run();
        return;
      }

      if (this.pendingJobs.length >= this.maxPendingJobs) {
        reject(new HttpError(503, "Server is busy. Please try again shortly.", { code: "SERVER_BUSY" }));
        return;
      }

      signal?.addEventListener("abort", onAbort, { once: true });
      this.pendingJobs.push(queuedJob);
    });
  }

  async start(task, upstreamSignal) {
    this.activeJobs += 1;
    const controller = new AbortController();
    this.controllers.add(controller);
    const onAbort = () => controller.abort(upstreamSignal.reason);
    upstreamSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      return await task({ signal: controller.signal });
    } finally {
      upstreamSignal?.removeEventListener("abort", onAbort);
      this.controllers.delete(controller);
      this.activeJobs = Math.max(0, this.activeJobs - 1);
      this.drain();
    }
  }

  drain() {
    while (this.activeJobs < this.maxConcurrentJobs && this.pendingJobs.length > 0) {
      const next = this.pendingJobs.shift();
      next.run();
    }
  }

  cancelPending(reason = cancelledError()) {
    const pending = this.pendingJobs.splice(0);
    for (const job of pending) job.reject(reason);
  }

  cancelActive(reason = cancelledError()) {
    for (const controller of this.controllers) controller.abort(reason);
  }

  async waitForIdle(timeoutMs = 5000) {
    const startedAt = Date.now();
    while (this.activeJobs > 0 && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.activeJobs === 0;
  }
}

export function cancelledError() {
  return new HttpError(499, "Request was cancelled.", { code: "REQUEST_CANCELLED", expose: false });
}
