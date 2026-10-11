export type QaAction = 'enter' | 'new_round' | 'reset' | 'five_wins' | 'shot' | 'score';
export type QaGuard = (action: QaAction) => Promise<boolean>;
type Access = { userId: string; qaTester: boolean; environment: string; scope: string; leaseMs: number };

/** No persisted permissions: cached profile/email/flags never grant access. */
export class QaAccessController {
  private generation = 0;
  private expiresAt = 0;
  private connected = false;
  private terminated = false;
  constructor(private userId: string, private check: (action?: QaAction) => Promise<Access>,
    private changed: (allowed: boolean) => void, private clock = () => Date.now()) {}
  get allowed() { return this.connected && this.clock() < this.expiresAt; }
  invalidate() {
    this.generation++;
    this.expiresAt = 0;
    this.connected = false;
    this.changed(false);
  }
  dispose() { this.terminated = true; this.invalidate(); }
  expire() { if (!this.allowed && this.connected) this.invalidate(); }
  async verify(action?: QaAction) {
    if (this.terminated) return false;
    const generation = this.generation;
    const started = this.clock();
    try {
      const value = await this.check(action);
      if (generation !== this.generation) return false;
      if (value.userId !== this.userId || value.qaTester !== true || value.environment !== 'staging' ||
          value.scope !== 'file_basket_preview' || value.leaseMs !== 1500 || this.clock() - started >= value.leaseMs) {
        this.invalidate(); return false;
      }
      this.expiresAt = started + value.leaseMs;
      this.connected = true;
      this.changed(true);
      return true;
    } catch { if (generation === this.generation) this.invalidate(); return false; }
  }
  async run(action: QaAction, effect: () => void | Promise<void>) {
    const generation = this.generation;
    if (!this.allowed || !await this.verify(action) || generation !== this.generation || !this.allowed) return false;
    await effect();
    return true;
  }
}
