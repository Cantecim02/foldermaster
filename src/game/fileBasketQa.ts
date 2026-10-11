import { awardHit, beginAttempt, emptyProgress, type BasketProgress } from './fileBasketRules';
export const qaStorageKey = 'editio.fileBasket.qa.v1';
export function qaNewRound(progress: BasketProgress): BasketProgress { return { ...progress, round: null }; }
export function qaFiveWins(progress: BasketProgress, now: number): BasketProgress {
  let next = progress;
  for (let i = 0; i < 5; i++) {
    next = beginAttempt(qaNewRound(next), now + i)!;
    next = awardHit(next, now + i);
  }
  return next;
}
export { emptyProgress as qaReset };
