import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { defaults, parseConfig, type ConfigResult } from "../src/config.ts";
import type { NotificationPayload } from "../src/types.ts";
import type { Backend, LaunchResult } from "../src/launcher.ts";
import { registerNotifier } from "../src/runtime.ts";
import { FakeClock, flush } from "./clock.ts";

type Hook = (event: unknown, context: ExtensionContext) => unknown;
function harness(options: { mode?: string; platform?: NodeJS.Platform; result?: ConfigResult; slow?: boolean } = {}) {
  const clock = new FakeClock();
  const handlers = new Map<string, Hook[]>();
  const listeners = new Map<string, Set<(raw: unknown) => void>>();
  const messages: string[] = [];
  const calls: Array<{ kind: string; payload: NotificationPayload; signal: AbortSignal; resolve(result: LaunchResult): void }> = [];
  let command: (args: string, context: ExtensionCommandContext) => Promise<void>;
  let makeCount = 0;
  let result: ConfigResult = options.result ?? { ok: true, config: defaults() };
  const context = { mode: options.mode ?? "tui", hasUI: !["print", "json"].includes(options.mode ?? "tui"),
    ui: { notify: (message: string) => messages.push(message) } } as unknown as ExtensionContext;
  const api = {
    on(name: string, handler: Hook) {
      const items = handlers.get(name) ?? [];
      handlers.set(name, [...items, handler]);
      return () => { handlers.set(name, items); };
    },
    events: {
      on(channel: string, handler: (raw: unknown) => void) {
        const set = listeners.get(channel) ?? new Set();
        set.add(handler); listeners.set(channel, set);
        return () => { set.delete(handler); };
      },
    },
    registerCommand(_name: string, spec: { handler: typeof command }) { command = spec.handler; },
  } as unknown as ExtensionAPI;
  const backend: Backend = { available: true, code: "OK", launch: (payload, signal) => new Promise(resolve => {
    calls.push({ kind: payload.kind, payload, signal, resolve });
    if (!options.slow) resolve({ code: "OK", toast: payload.toast.enabled, sound: payload.sound.enabled ? "played" : "disabled" });
  }) };
  registerNotifier(api, { platform: options.platform ?? "win32", arch: "x64", clock, readConfig: () => result,
    backend: () => { makeCount++; return backend; } });
  return {
    clock, calls, messages, listeners,
    makeCount: () => makeCount,
    setResult: (next: ConfigResult) => { result = next; },
    hook: async (name: string, event: unknown = {}) => {
      const returns = [];
      for (const handler of handlers.get(name) ?? []) returns.push(await handler(event, context));
      return returns;
    },
    bus: (channel: string, raw: unknown) => { for (const fn of listeners.get(channel) ?? []) fn(raw); },
    command: (args: string) => command(args, context as ExtensionCommandContext),
    tick: async (ms = 0) => { clock.advance(ms); await flush(); },
  };
}
test("factory 不啟動 backend，session 重建與 shutdown 不累積 listener 或 timer", async () => {
  const h = harness();
  assert.equal(h.makeCount(), 0);
  for (let i = 0; i < 5; i++) {
    await h.hook("session_start");
    assert.equal([...h.listeners.values()].reduce((n, set) => n + set.size, 0), 3);
  }
  h.bus("permissions:ui_prompt", { requestId: "q" });
  await h.hook("session_shutdown");
  await h.hook("session_shutdown");
  await h.tick();
  assert.equal(h.calls.length, 0);
  assert.equal([...h.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  assert.equal(h.clock.count(), 0);
});
test("permission、RPIV／Lean 與 Plan mode 接線，所有觀察 handler 不回傳修改", async () => {
  const h = harness();
  await h.hook("session_start");
  h.bus("permissions:ui_prompt", { requestId: "p", command: "SECRET" });
  await h.hook("ui_prompt_start");
  await h.tick();
  assert.equal(h.calls[0].kind, "permission");
  h.bus("permissions:decision", { requestId: "p" });
  await h.hook("ui_prompt_end");
  await h.hook("tool_execution_start", { toolCallId: "q", toolName: "ask_user_question", args: { secret: "SECRET" } });
  h.bus("rpiv:ask-user:blocked", { active: true });
  await h.hook("ui_prompt_start");
  await h.tick(1_000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].kind, "question");
  h.bus("rpiv:ask-user:blocked", { active: false });
  await h.hook("ui_prompt_end");
  await h.hook("tool_execution_end", { toolCallId: "q" });
  await h.hook("tool_execution_start", { toolCallId: "plan", toolName: "plan_mode_question" });
  await h.hook("ui_prompt_start");
  await h.tick(1_000);
  assert.equal(h.calls[2].kind, "question");
  await h.hook("ui_prompt_end");
  await h.hook("tool_execution_end", { toolCallId: "plan" });
  await h.hook("agent_start");
  const message = await h.hook("message_end", { message: { role: "assistant", stopReason: "stop", content: "SECRET" } });
  const boundary = await h.hook("agent_before_settle", { outcome: "completed" });
  assert.deepEqual(message, [undefined]);
  assert.deepEqual(boundary, [undefined]);
  await h.hook("agent_settled", { aborted: false });
  await h.tick(1_000);
  assert.equal(h.calls[3].kind, "completed");
  await h.command("status");
  assert.equal(h.messages.join().includes("SECRET"), false);
  await h.hook("session_shutdown");
});
test("RPC／print／JSON／非 Windows 不通知也不建立 backend", async () => {
  for (const options of [{ mode: "rpc" }, { mode: "print" }, { mode: "json" }, { platform: "linux" as const }]) {
    const h = harness(options);
    await h.hook("session_start");
    h.bus("permissions:ui_prompt", { requestId: "p" });
    await h.hook("agent_start");
    await h.hook("message_end", { message: { role: "assistant", stopReason: "stop" } });
    await h.hook("agent_settled", { aborted: false });
    await h.tick();
    await h.command("test");
    assert.equal(h.calls.length, 0);
    assert.equal(h.makeCount(), 0);
    await h.hook("session_shutdown");
  }
});
test("無效設定 fail closed，test 不繞過開關；reload 清除舊事件", async () => {
  const h = harness({ result: { ok: false, code: "CONFIG_INVALID", config: { ...defaults(), enabled: false } } });
  await h.hook("session_start");
  h.bus("permissions:ui_prompt", { requestId: "p" });
  await h.command("test");
  assert.equal(h.calls.length, 0);
  assert.equal(h.messages.filter(message => message.includes("CONFIG_INVALID")).length, 1);
  h.setResult({ ok: true, config: defaults() });
  await h.command("reload");
  h.bus("permissions:ui_prompt", { requestId: "pending" });
  await h.command("reload");
  await h.tick();
  assert.equal(h.calls.length, 0);
  const testPromise = h.command("test failed");
  await h.tick();
  await testPromise;
  assert.equal(h.calls[0].kind, "failed");
  assert.ok(h.messages.some(message => message.includes("已提交")));
  await h.command("test $(SECRET)");
  assert.equal(h.messages.join().includes("SECRET"), false);
  await h.hook("session_shutdown");
});
test("自訂文字可送達 backend，但 status、警告及 test 結果不展示設定文字", async () => {
  const h = harness({ result: parseConfig({ schemaVersion: 2, defaults: {
    toast: { enabled: false, title: "PRIVATE_TITLE", message: "PRIVATE_MESSAGE" },
    sound: { source: { type: "system", name: "Question" } },
  } }) });
  await h.hook("session_start");
  const pending = h.command("test permission");
  await h.tick();
  await pending;
  assert.equal(h.calls[0].payload.toast.title, "PRIVATE_TITLE");
  assert.equal(h.calls[0].payload.toast.message, "PRIVATE_MESSAGE");
  assert.equal(h.calls[0].payload.sound.source.name, "Question");
  await h.command("status");
  assert.equal(h.messages.join().includes("PRIVATE_"), false);
  const status = JSON.parse(h.messages.at(-1)!);
  assert.equal(status.events.permission.toast.enabled, false);
  assert.equal(status.schemaVersion, 2);
  h.setResult(parseConfig({ schemaVersion: 2, defaults: { toast: { title: "PRIVATE_TITLE", message: 42 } } }));
  await h.command("reload");
  await h.command("status");
  assert.equal(h.messages.join().includes("PRIVATE_"), false);
  await h.hook("session_shutdown");
});
test("同時 reload 會等待舊 helper close，不能提前建立第二個 backend", async () => {
  const h = harness({ slow: true });
  await h.hook("session_start");
  h.bus("permissions:ui_prompt", { requestId: "active" });
  await h.tick();
  const a = h.command("reload");
  const b = h.command("reload");
  await flush();
  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.makeCount(), 1);
  h.calls[0].resolve({ code: "CANCELLED", toast: false, sound: "failed" });
  await Promise.all([a, b]);
  assert.equal(h.makeCount(), 3);
  assert.equal([...h.listeners.values()].reduce((n, set) => n + set.size, 0), 3);
  await h.hook("session_shutdown");
});
