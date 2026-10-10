// Phase 1: local preview only. Never pass this state to billing/conversion APIs.
export const roundIntervalMs = 24 * 60 * 60 * 1000;
export const maxAttempts = 3;
export type BasketProgress = {
  version: 1;
  points: number;
  previewCredits: number;
  round: { startedAt: number; attempts: number; won: boolean } | null;
};

export function emptyProgress(): BasketProgress {
  return { version: 1, points: 0, previewCredits: 0, round: null };
}

export function parseProgress(raw: string | null): BasketProgress {
  if (raw === null) return emptyProgress();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Invalid game progress");
  const state = value as BasketProgress;
  const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (state.version !== 1 || !integer(state.points) || state.points > 4 || !integer(state.previewCredits) ||
      (state.round !== null && (!state.round || !integer(state.round.startedAt) || state.round.startedAt === 0 ||
        !integer(state.round.attempts) || state.round.attempts < 1 || state.round.attempts > maxAttempts ||
        typeof state.round.won !== "boolean"))) {
    throw new Error("Invalid game progress");
  }
  return state;
}

export function roundReady(state: BasketProgress, now: number): boolean {
  return state.round === null || now - state.round.startedAt >= roundIntervalMs;
}

export function attemptsLeft(state: BasketProgress, now: number): number {
  if (roundReady(state, now)) return maxAttempts;
  return state.round?.won ? 0 : maxAttempts - (state.round?.attempts ?? 0);
}

/** Save before animation starts, so leaving/backgrounding cannot restore a used shot. */
export function beginAttempt(state: BasketProgress, now: number): BasketProgress | null {
  if (!Number.isSafeInteger(now) || now <= 0 || attemptsLeft(state, now) === 0) return null;
  const round = roundReady(state, now) ? { startedAt: now, attempts: 0, won: false } : state.round!;
  return { ...state, round: { ...round, attempts: round.attempts + 1 } };
}

export function awardHit(state: BasketProgress, roundStartedAt: number): BasketProgress {
  if (!state.round || state.round.startedAt !== roundStartedAt || state.round.won) return state;
  const points = state.points + 1;
  return {
    ...state, points: points % 5,
    previewCredits: state.previewCredits + (points >= 5 ? 1 : 0),
    round: { ...state.round, won: true }
  };
}
