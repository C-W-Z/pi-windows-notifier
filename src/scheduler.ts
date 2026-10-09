import type { Config } from "./config.ts";
import type { Backend, LaunchResult } from "./launcher.ts";
import type { Diagnostic, NotificationJob } from "./types.ts";

export interface Clock {
  now(): number;
  set(fn: () => void, delay: number): unknown;
  clear(handle: unknown): void;
}
export const systemClock: Clock = {
  now: () => performance.now(),
  set: (fn, delay) => { const timer = setTimeout(fn, delay); timer.unref(); return timer; },
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
export interface Submission {
  status: "submitted" | "partial" | "disabled" | "cancelled" | "dropped" | "expired" | "failed";
  code?: string;
}
interface Pending {
  job: NotificationJob;
  created: number;
  resolve(result: Submission): void;
}
export const QUEUE_LIMIT = 16;
export const MIN_INTERVAL = 1_000;
export const QUEUE_TTL = 30_000;
const waiting = (job: NotificationJob) => job.kind === "permission" || job.kind === "question";

/** 單一 helper、有界佇列、過期取消；所有 promise 都以固定狀態結束，不外洩原始錯誤。 */
export class NotificationScheduler {
  private backend: Backend;
  private config: () => Config;
  private diagnose: Diagnostic;
  private clock: Clock;
  private queue: Pending[] = [];
  private timer: unknown;
  private lastStart = -Infinity;
  private active: { key: string; abort: AbortController; finished: Promise<void> } | undefined;
  private closed = false;
  dropped = 0;

  constructor(backend: Backend, config: () => Config, diagnose: Diagnostic = () => {}, clock: Clock = systemClock) {
    this.backend = backend;
    this.config = config;
    this.diagnose = diagnose;
    this.clock = clock;
  }
  private enabled(job: NotificationJob): boolean {
    const config = this.config();
    const event = config.events[job.kind];
    return !this.closed && this.backend.available && config.enabled && event.enabled && (event.toast.enabled || event.sound.enabled);
  }
  private valid(job: NotificationJob): boolean {
    try { return job.valid(); } catch { return false; }
  }
  enqueue(job: NotificationJob): void { void this.submit(job); }
  submit(job: NotificationJob): Promise<Submission> {
    if (!this.enabled(job)) return Promise.resolve({ status: "disabled" });
    if (!this.valid(job)) return Promise.resolve({ status: "cancelled" });
    if (this.queue.some(item => item.job.key === job.key) || this.active?.key === job.key) {
      return Promise.resolve({ status: "cancelled" });
    }
    this.prune();
    if (this.queue.length >= QUEUE_LIMIT) {
      const index = this.queue.findIndex(item => !waiting(item.job));
      const [removed] = this.queue.splice(index < 0 ? 0 : index, 1);
      removed.resolve({ status: "dropped" });
      this.dropped++;
      this.diagnose("QUEUE_DROPPED");
    }
    const result = new Promise<Submission>(resolve => this.queue.push({ job, created: this.clock.now(), resolve }));
    this.wake();
    return result;
  }
  cancel(key: string): void {
    this.queue = this.queue.filter(item => {
      if (item.job.key !== key) return true;
      item.resolve({ status: "cancelled" });
      return false;
    });
    if (this.active?.key === key) this.active.abort.abort();
    if (!this.queue.length && this.timer !== undefined) {
      this.clock.clear(this.timer);
      this.timer = undefined;
    }
  }
  private prune(): void {
    const now = this.clock.now();
    this.queue = this.queue.filter(item => {
      if (now - item.created >= QUEUE_TTL) { item.resolve({ status: "expired" }); return false; }
      if (!this.enabled(item.job)) { item.resolve({ status: "disabled" }); return false; }
      if (!this.valid(item.job)) { item.resolve({ status: "cancelled" }); return false; }
      return true;
    });
  }
  private wake(): void {
    if (this.closed || this.active || this.timer !== undefined || !this.queue.length) return;
    this.timer = this.clock.set(() => { this.timer = undefined; this.start(); },
      Math.max(0, this.lastStart + MIN_INTERVAL - this.clock.now()));
  }
  private start(): void {
    if (this.closed || this.active) return;
    this.prune();
    if (!this.queue.length) return;
    const index = this.queue.findIndex(item => waiting(item.job));
    const [item] = this.queue.splice(index < 0 ? 0 : index, 1);
    const abort = new AbortController();
    const active = { key: item.job.key, abort, finished: Promise.resolve() };
    this.active = active;
    this.lastStart = this.clock.now();
    active.finished = this.deliver(item, abort.signal).finally(() => {
      if (this.active === active) this.active = undefined;
      this.wake();
    });
  }
  private async deliver(item: Pending, signal: AbortSignal): Promise<void> {
    let result: LaunchResult;
    try {
      const event = this.config().events[item.job.kind];
      result = await this.backend.launch({ kind: item.job.kind, toast: { ...event.toast },
        sound: { enabled: event.sound.enabled, source: { ...event.sound.source } } }, signal);
    }
    catch { result = { code: "LAUNCH_FAILED", toast: false, sound: "failed" }; }
    if (signal.aborted || result.code === "CANCELLED") { item.resolve({ status: "cancelled" }); return; }
    if (result.code !== "OK") this.diagnose(result.code);
    item.resolve({
      status: result.code === "OK" ? "submitted" : result.toast || result.sound === "played" ? "partial" : "failed",
      code: result.code,
    });
  }
  status(): { queued: number; active: boolean; dropped: number } {
    return { queued: this.queue.length, active: !!this.active, dropped: this.dropped };
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer !== undefined) { this.clock.clear(this.timer); this.timer = undefined; }
    for (const item of this.queue) item.resolve({ status: "cancelled" });
    this.queue = [];
    this.active?.abort.abort();
    await this.active?.finished;
  }
}
