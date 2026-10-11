import type { AccountDeletionResult } from "./authService";

/** UI success follows the server result, never a subsequent device cleanup error. */
export async function finishDeletedAccount(result: AccountDeletionResult, callbacks: {
  clearUi: () => void;
  onSuccess: () => void;
  endSession: () => Promise<void>;
  onCleanupPending: () => void;
}) {
  callbacks.clearUi();
  callbacks.onSuccess();
  let pending = result.deviceCleanupPending;
  try { await callbacks.endSession(); } catch { pending = true; }
  if (pending) callbacks.onCleanupPending();
}
