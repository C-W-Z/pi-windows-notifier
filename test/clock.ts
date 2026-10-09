import type { Clock } from "../src/scheduler.ts";

/** 測試用單調時鐘，不實際等待，也不產生桌面通知。 */
export class FakeClock implements Clock {
  private time = 0;
  private next = 1;
  private timers = new Map<number, { at: number; fn(): void }>();
  now(): number { return this.time; }
  set(fn: () => void, delay: number): number {
    const id = this.next++;
    this.timers.set(id, { at: this.time + delay, fn });
    return id;
  }
  clear(handle: unknown): void { this.timers.delete(handle as number); }
  advance(ms: number): void {
    const target = this.time + ms;
    while (true) {
      const next = [...this.timers.entries()].filter(([, item]) => item.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].fn();
    }
    this.time = target;
  }
  count(): number { return this.timers.size; }
}
export async function flush(): Promise<void> { for (let i = 0; i < 6; i++) await Promise.resolve(); }
