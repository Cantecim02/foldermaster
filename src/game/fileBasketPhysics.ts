export type Point = { x: number; y: number };
export type Shot = Point & { vx: number; vy: number; time: number; remainder: number; entered: boolean; scored: boolean; done: boolean };

export const court = Object.freeze({
  width: 360, height: 520, floor: 484, radius: 18, gravity: 650,
  launch: { x: 70, y: 432 }, rim: { left: 232, right: 294, y: 208, radius: 4 },
  board: { x: 310, top: 140, bottom: 235 }, netDepth: 32
});

/** Drag toward the desired flight direction; limit velocity independently of screen size. */
export function velocityForDrag(dx: number, dy: number): Point {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  const x = dx * 3.2;
  const y = Math.min(0, dy * 3.2);
  const magnitude = Math.hypot(x, y);
  const scale = magnitude > 640 ? 640 / magnitude : 1;
  return { x: x * scale, y: y * scale };
}

export function createShot(velocity: Point): Shot {
  return { ...court.launch, vx: velocity.x, vy: velocity.y, time: 0, remainder: 0, entered: false, scored: false, done: false };
}

/** Fixed small steps prevent tunnelling through the rim, even after a slow display frame. */
export function advanceShot(shot: Shot, seconds: number): Shot {
  let next = { ...shot };
  let remaining = shot.remainder + (Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, 0.1)) : 0);
  const dt = 1 / 240;
  while (remaining + 1e-10 >= dt && !next.done) {
    next = step(next, dt);
    remaining -= dt;
  }
  next.remainder = Math.max(0, remaining);
  return next;
}

function step(shot: Shot, dt: number): Shot {
  const next = { ...shot, time: shot.time + dt };
  next.x += shot.vx * dt;
  next.y += shot.vy * dt + court.gravity * dt * dt / 2;
  next.vy += court.gravity * dt;
  let collided = false;

  // A circular collision envelope surrounds the visible file icon.
  for (const x of [court.rim.left, court.rim.right]) {
    const dx = next.x - x;
    const dy = next.y - court.rim.y;
    const distance = Math.hypot(dx, dy);
    const radius = court.radius + court.rim.radius;
    if (distance < radius) {
      const nx = distance > 0 ? dx / distance : -1;
      const ny = distance > 0 ? dy / distance : 0;
      const dot = next.vx * nx + next.vy * ny;
      next.x = x + nx * radius;
      next.y = court.rim.y + ny * radius;
      if (dot < 0) {
        next.vx -= 1.65 * dot * nx;
        next.vy -= 1.65 * dot * ny;
      }
      collided = true;
    }
  }
  if (next.y + court.radius > court.board.top && next.y - court.radius < court.board.bottom &&
      Math.abs(next.x - court.board.x) < court.radius + 3) {
    const side = shot.x < court.board.x ? -1 : 1;
    next.x = court.board.x + side * (court.radius + 3);
    next.vx = side * Math.abs(next.vx) * 0.65;
    collided = true;
  }

  const crossingX = (y: number) => shot.x + (next.x - shot.x) * (y - shot.y) / (next.y - shot.y);
  const inside = (x: number) => x > court.rim.left + court.radius + court.rim.radius &&
    x < court.rim.right - court.radius - court.rim.radius;
  if (collided) next.entered = false;
  if (!collided && next.vy > 0 && shot.y < court.rim.y && next.y >= court.rim.y) {
    next.entered = inside(crossingX(court.rim.y));
  }
  if (next.entered && !inside(next.x)) next.entered = false;
  const exitY = court.rim.y + court.netDepth;
  if (next.entered && next.vy > 0 && shot.y < exitY && next.y >= exitY && inside(crossingX(exitY))) {
    next.scored = true;
    next.done = true;
  }
  if (next.y + court.radius >= court.floor || next.x < -40 || next.x > court.width + 40 || next.time >= 5) {
    next.done = true;
  }
  return next;
}

export function predictShot(velocity: Point): Point[] {
  const points: Point[] = [];
  let shot = createShot(velocity);
  for (let i = 0; i < 45 && !shot.done; i += 1) {
    shot = advanceShot(shot, 0.055);
    points.push({ x: shot.x, y: shot.y });
  }
  return points;
}
