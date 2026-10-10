import { advanceShot, court, createShot, predictShot, velocityForDrag } from "../src/game/fileBasketPhysics";
import type { Shot } from "../src/game/fileBasketPhysics";
import { attemptsLeft, awardHit, beginAttempt, emptyProgress, parseProgress, roundIntervalMs } from "../src/game/fileBasketRules";

let checks = 0;
function assert(condition: unknown, message: string): asserts condition {
  checks += 1;
  if (!condition) throw new Error(message);
}
function finish(shot: Shot): Shot {
  for (let i = 0; i < 1500 && !shot.done; i += 1) shot = advanceShot(shot, 1 / 240);
  return shot;
}
const downward = { ...createShot({ x: 0, y: 110 }), x: 263, y: 185 };
assert(finish(downward).scored, "A centred downward passage through both net planes must score");
assert(!advanceShot(downward, 0.05).scored, "Entering the opening alone must not score");
assert(!finish({ ...downward, x: court.rim.left }).scored, "Rim collision must not score");
assert(!finish({ ...downward, y: 218 }).scored, "Entering from below/side must not score");
assert(!advanceShot({ ...downward, y: 235, vy: -220 }, 0.1).scored, "Upward crossing must not score");
const rimHit = advanceShot({ ...downward, x: court.rim.left, y: 185, vy: 200 }, 0.1);
assert(rimHit.vy < 0, "Rim must bounce the file upward");
const boardHit = advanceShot({ ...downward, x: 290, y: 170, vx: 300, vy: 0 }, 0.07);
assert(boardHit.vx < 0, "Backboard must reflect horizontal velocity");
assert(finish(createShot({ x: 0, y: 0 })).done, "Gravity must end a miss on the floor");
const velocity = velocityForDrag(10000, -10000);
assert(Math.hypot(velocity.x, velocity.y) <= 640.001, "Power must be capped");
assert(velocityForDrag(10, 200).y === 0, "Downward drag must not create an upward shot");
assert(velocityForDrag(NaN, 1).x === 0, "Non-finite gesture input must be safe");
const previewVelocity = velocityForDrag(50, -165);
const predicted = predictShot(previewVelocity);
const firstStep = advanceShot(createShot(previewVelocity), 0.055);
assert(predicted[0].x === firstStep.x && predicted[0].y === firstStep.y, "Prediction must use the same solver as flight");
// Prove that the launch position and power cap allow a real full-court basket.
let reachable = false;
for (let vx = 120; vx <= 250 && !reachable; vx += 2) {
  for (let vy = -600; vy <= -450 && !reachable; vy += 2) {
    if (Math.hypot(vx, vy) <= 640) reachable = finish(createShot({ x: vx, y: vy })).scored;
  }
}
assert(reachable, "The configured court must be winnable with an allowed launch velocity");
assert(finish(createShot({ x: 131, y: -620 })).scored, "A clean full-court arc must score");
for (const fps of [30, 60, 120]) {
  let shot = createShot({ x: 131, y: -620 });
  while (!shot.done) shot = advanceShot(shot, 1 / fps);
  assert(shot.scored, `A clean basket must remain a basket at ${fps} FPS`);
}

const now = 1000000;
let progress = emptyProgress();
assert(attemptsLeft(progress, now) === 3, "New round must have three shots");
progress = beginAttempt(progress, now)!;
assert(progress.round?.startedAt === now && attemptsLeft(progress, now) === 2, "First shot must consume a shot and start the clock");
progress = beginAttempt(progress, now + 1)!;
progress = beginAttempt(progress, now + 2)!;
assert(beginAttempt(progress, now + 3) === null, "Fourth attempt must be blocked");
assert(attemptsLeft(progress, now + roundIntervalMs - 1) === 0, "Cooldown must last the full 24 hours");
assert(attemptsLeft(progress, now + roundIntervalMs) === 3, "New round must unlock exactly at 24 hours");
assert(attemptsLeft(progress, now - 1) === 0, "Rolling the local clock backward must not unlock a round");
progress = awardHit(progress, now);
assert(progress.points === 1 && progress.round?.won, "A win must add one point and close the round");
assert(awardHit(progress, now) === progress, "Duplicate win must be idempotent");
assert(awardHit(progress, now + 1) === progress, "Stale/different round win must be ignored");
const failedRound = beginAttempt(progress, now + roundIntervalMs)!;
assert(failedRound.points === 1, "Beginning another round must preserve earlier hit points");
assert(beginAttempt(beginAttempt(failedRound, now + roundIntervalMs + 1)!, now + roundIntervalMs + 2)!.points === 1,
  "Three missed shots must preserve earlier hit points");
for (let n = 1; n < 5; n += 1) {
  const time = now + roundIntervalMs * n;
  progress = beginAttempt(progress, time)!;
  progress = awardHit(progress, time);
}
assert(progress.points === 0 && progress.previewCredits === 1, "Five hits must create one preview credit");
progress = beginAttempt(progress, now + roundIntervalMs * 5)!;
progress = beginAttempt(progress, now + roundIntervalMs * 5 + 1)!;
progress = beginAttempt(progress, now + roundIntervalMs * 5 + 2)!;
assert(progress.previewCredits === 1, "A failed round must preserve earned credits");
assert(parseProgress(JSON.stringify(progress)).previewCredits === 1, "Earned preview credit must survive reload");
let invalidRejected = false;
try { parseProgress('{"version":1,"points":99,"previewCredits":0,"round":null}'); } catch { invalidRejected = true; }
assert(invalidRejected, "Invalid saved state must not be accepted");
assert(parseProgress(null).points === 0, "Missing save must start fresh");
console.log(`File Basket: ${checks} physics and reward-rule checks passed.`);
