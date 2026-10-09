import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { defaults, parseConfig, type ConfigResult } from "../src/config.ts";
import type { NotificationPayload } from "../src/types.ts";
import type { Backend, LaunchResult } from "../src/launcher.ts";
import { registerNotifier } from "../src/runtime.ts";
import { FakeClock, flush } from "./clock.ts";

type Hook = (event: unknown, context: ExtensionContext) => unknown;
type GetCompletions = NonNullable<Parameters<ExtensionAPI["registerCommand"]>[1]["getArgumentCompletions"]>;
function harness(options: { mode?: string; platform?: NodeJS.Platform; result?: ConfigResult; slow?: boolean } = {}) {
  const clock = new FakeClock();
  const handlers = new Map<string, Hook[]>();
  const listeners = new Map<string, Set<(raw: unknown) => void>>();
  const messages: string[] = [];
  const calls: Array<{ kind: string; payload: NotificationPayload; signal: AbortSignal; resolve(result: LaunchResult): void }> = [];
  let command: (args: string, context: ExtensionCommandContext) => Promise<void>;
  let completions: GetCompletions;
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
    registerCommand(_name: string, spec: { handler: typeof command; getArgumentCompletions: GetCompletions }) {
      command = spec.handler;
      completions = spec.getArgumentCompletions;
    },
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
    complete: (prefix: string) => completions(prefix),
    tick: async (ms = 0) => { clock.advance(ms); await flush(); },
  };
}
test("指令參數補全涵蓋子指令、事件前綴及完整替換值，不啟動 backend", async () => {
  const h = harness();
  assert.deepEqual(await h.complete(""), [
    { value: "status", label: "status" }, { value: "reload", label: "reload" }, { value: "test", label: "test" },
  ]);
  assert.deepEqual(await h.complete("te"), [{ value: "test", label: "test" }]);
  assert.deepEqual(await h.complete("r"), [{ value: "reload", label: "reload" }]);
  assert.deepEqual(await h.complete("  st"), [{ value: "  status", label: "status" }]);
  assert.deepEqual(await h.complete("test "), ["permission", "question", "completed", "aborted", "failed"]
    .map(kind => ({ value: "test " + kind, label: kind })));
  assert.deepEqual(await h.complete("test c"), [{ value: "test completed", label: "completed" }]);
  assert.deepEqual(await h.complete(" test   q"), [{ value: " test   question", label: "question" }]);
  assert.equal(h.makeCount(), 0);
  assert.equal(h.calls.length, 0);
});
test("無效或過多的指令參數不補全；已啟動 session 的補全不產生通知", async () => {
  const h = harness();
  await h.hook("session_start");
  for (const prefix of ["unknown", "status ", "reload x", "test nope", "test completed ", "test completed x", "Test "])
    assert.equal(await h.complete(prefix), null);
  const suggestions = await h.complete("test co");
  assert.deepEqual(suggestions, [{ value: "test completed", label: "completed" }]);
  // 模擬 Pi 以 value 取代整段參數，不會遺失 test。
  const line = "/windows-notifier test co";
  const prefix = "test co";
  assert.equal(line.slice(0, -prefix.length) + suggestions![0].value, "/windows-notifier test completed");
  await h.tick();
  assert.equal(h.calls.length, 0);
  assert.equal(h.messages.length, 0);
  await h.hook("session_shutdown");
});
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
  assert.deepEqual(h.calls[0].payload.sound.source, { type: "system", name: "Question" });
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
test("檔案音效可以測試與 reload，但 status 不洩漏私人路徑", async () => {
  const makeConfig = (path: string) => parseConfig({ schemaVersion: 2,
    defaults: { sound: { source: { type: "file", path } } } });
  const h = harness({ result: makeConfig("C:/PRIVATE_USER/done.wav") });
  await h.hook("session_start");
  const pending = h.command("test");
  await h.tick();
  await pending;
  assert.deepEqual(h.calls[0].payload.sound.source, { type: "file", path: "C:/PRIVATE_USER/done.wav" });
  await h.command("status");
  assert.deepEqual(JSON.parse(h.messages.at(-1)!).events.completed.sound.source, { type: "file" });
  assert.equal(h.messages.join().includes("PRIVATE_USER"), false);
  h.setResult(makeConfig("D:/PRIVATE_USER/new.wav"));
  await h.command("reload");
  const next = h.command("test question");
  await h.tick();
  await next;
  assert.deepEqual(h.calls[1].payload.sound.source, { type: "file", path: "D:/PRIVATE_USER/new.wav" });
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
