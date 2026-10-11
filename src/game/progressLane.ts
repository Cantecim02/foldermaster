/** Capture the destination before awaiting storage/network; late results cannot cross lanes. */
export class ProgressLane {
  generation = 0;
  constructor(public key: string) {}
  select(key: string) { this.key = key; this.generation++; }
  capture() {
    const key = this.key, generation = this.generation;
    return { key, generation, current: () => generation === this.generation };
  }
}
