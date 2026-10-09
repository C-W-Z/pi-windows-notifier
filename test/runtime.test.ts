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
  const providers: Parameters<ExtensionContext["ui"]["addAutocompleteProvider"]>[0][] = [];
  let makeCount = 0;
  let result: ConfigResult = options.result ?? { ok: true, config: defaults() };
  const context = { mode: options.mode ?? "tui", hasUI: !["print", "json"].includes(options.mode ?? "tui"),
    ui: { notify: (message: string) => messages.push(message),
      addAutocompleteProvider: (factory: typeof providers[number]) => providers.push(factory) } } as unknown as ExtensionContext;
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
    clock, calls, messages, listeners, providers,
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
    { value: "status ", label: "status" }, { value: "reload", label: "reload" }, { value: "test ", label: "test" },
  ]);
  assert.deepEqual(await h.complete("te"), [{ value: "test ", label: "test" }]);
  assert.deepEqual(await h.complete("r"), [{ value: "reload", label: "reload" }]);
  assert.deepEqual(await h.complete("  st"), [{ value: "  status ", label: "status" }]);
  assert.deepEqual(await h.complete("status "), ["detail", "all"]
    .map(value => ({ value: "status " + value, label: value })));
  assert.deepEqual(await h.complete("status d"), [{ value: "status detail", label: "detail" }]);
  assert.deepEqual(await h.complete(" status   a"), [{ value: " status   all", label: "all" }]);
  assert.deepEqual(await h.complete("test "), ["permission", "question", "completed", "aborted", "failed"]
    .map(kind => ({ value: "test " + kind, label: kind })));
  assert.deepEqual(await h.complete("test c"), [{ value: "test completed", label: "completed" }]);
  assert.deepEqual(await h.complete(" test   q"), [{ value: " test   question", label: "question" }]);
  assert.equal(h.makeCount(), 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.providers.length, 0);
});
test("無效或過多的指令參數不補全；已啟動 session 的補全不產生通知", async () => {
  const h = harness();
  await h.hook("session_start");
  for (const prefix of ["unknown", "status nope", "status detail ", "status all x", "reload x", "test nope", "test completed ", "test completed x", "Test "])
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
test("TUI session 安裝補全 wrapper，設定 reload 不重複安裝", async () => {
  const h = harness();
  await h.hook("session_start");
  assert.equal(h.providers.length, 1);
  await h.command("reload");
  assert.equal(h.providers.length, 1);
  assert.equal(h.calls.length, 0);
  await h.hook("session_shutdown");
});
test("status 與空參數顯示簡潔摘要；detail 與 all 顯示相同的安全明細", async () => {
  const h = harness();
  await h.hook("session_start");
  await h.command("status");
  const summary = h.messages.at(-1)!;
  assert.equal(summary, [
    "Windows notifier 狀態", "總開關：開啟", "Backend：OK", "事件設定：5 / 5 開啟",
    "佇列：等待 0 · 丟棄 0", "Helper：閒置", "診斷：無", "",
    "查看明細：/windows-notifier status detail",
  ].join("\n"));
  await h.command("  ");
  assert.equal(h.messages.at(-1), summary);
  await h.command(" status   detail ");
  const detail = h.messages.at(-1)!;
  assert.match(detail, /設定版本：2/u);
  for (const kind of ["permission", "question", "completed", "aborted", "failed"])
    assert.match(detail, new RegExp(`${kind}\\s+事件：開啟  彈窗：開啟`, "u"));
  assert.match(detail, /音效：開啟（Hand）/u);
  assert.match(detail, /音效：開啟（Exclamation）/u);
  assert.equal(detail.includes("查看明細"), false);
  await h.command("status all");
  assert.equal(h.messages.at(-1), detail);
  assert.equal(h.calls.length, 0);
  await h.hook("session_shutdown");
});
test("status 明細區分總開關、事件與通道設定，不暗示停用事件仍會通知", async () => {
  const h = harness({ result: parseConfig({ schemaVersion: 2, enabled: false, events: {
    permission: { enabled: false, toast: { enabled: false }, sound: { enabled: false } },
    question: { sound: { enabled: false } },
  } }) });
  await h.hook("session_start");
  await h.command("status detail");
  const detail = h.messages.at(-1)!;
  assert.match(detail, /總開關：關閉/u);
  assert.match(detail, /事件設定：4 \/ 5 開啟/u);
  assert.match(detail, /設定值；實際通知仍受總開關與 backend 限制/u);
  assert.match(detail, /permission\s+事件：關閉  彈窗：關閉\n\s+音效：關閉（Exclamation）/u);
  assert.match(detail, /question\s+事件：開啟  彈窗：開啟\n\s+音效：關閉（Exclamation）/u);
  await h.hook("session_shutdown");
});
test("未啟動、不支援環境與無效設定的 status 仍可讀且保留診斷碼", async () => {
  const h = harness();
  await h.command("status");
  assert.match(h.messages.at(-1)!, /Backend：NOT_STARTED/u);
  assert.match(h.messages.at(-1)!, /事件設定：尚未載入/u);
  assert.match(h.messages.at(-1)!, /佇列：不可用\nHelper：不可用/u);
  await h.command("status detail");
  assert.match(h.messages.at(-1)!, /設定版本：尚未載入/u);
  assert.equal(h.makeCount(), 0);
  const unsupported = harness({ platform: "linux" });
  await unsupported.hook("session_start");
  await unsupported.command("status all");
  assert.match(unsupported.messages.at(-1)!, /Backend：ENV_UNSUPPORTED/u);
  assert.match(unsupported.messages.at(-1)!, /佇列：不可用/u);
  await unsupported.hook("session_shutdown");
  const invalid = harness({ result: { ok: false, code: "CONFIG_INVALID", config: { ...defaults(), enabled: false } } });
  await invalid.hook("session_start");
  await invalid.command("status");
  assert.match(invalid.messages.at(-1)!, /總開關：關閉/u);
  assert.match(invalid.messages.at(-1)!, /診斷：CONFIG_INVALID/u);
  await invalid.hook("session_shutdown");
});
test("status 顯示執行中 helper、等待與丟棄計數，讀取本身不提交通知", async () => {
  const h = harness({ slow: true });
  await h.hook("session_start");
  h.bus("permissions:ui_prompt", { requestId: "active" });
  await h.tick();
  for (let i = 0; i < 18; i++) h.bus("permissions:ui_prompt", { requestId: `pending-${i}` });
  await h.command("status");
  assert.match(h.messages.at(-1)!, /佇列：等待 16 · 丟棄 2/u);
  assert.match(h.messages.at(-1)!, /Helper：執行中/u);
  assert.match(h.messages.at(-1)!, /診斷：QUEUE_DROPPED/u);
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve({ code: "SOUND_FAILED", toast: true, sound: "failed" });
  await flush();
  await h.command("status");
  assert.match(h.messages.at(-1)!, /診斷：QUEUE_DROPPED、SOUND_FAILED/u);
  await h.hook("session_shutdown");
});
test("未知或過多的 status 參數顯示用法，不回顯輸入或提交通知", async () => {
  const h = harness();
  await h.hook("session_start");
  for (const args of ["status PRIVATE_INPUT", "status detail extra", "status all extra"]) {
    await h.command(args);
    assert.match(h.messages.at(-1)!, /^用法：\/windows-notifier status \[detail\|all\]/u);
  }
  assert.equal(h.messages.join().includes("PRIVATE_INPUT"), false);
  assert.equal(h.calls.length, 0);
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
    assert.equal(h.providers.length, options.mode === undefined ? 1 : 0);
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
  await h.command("status detail");
  assert.match(h.messages.at(-1)!, /permission\s+事件：開啟  彈窗：關閉/u);
  assert.match(h.messages.at(-1)!, /音效：開啟（Question）/u);
  assert.match(h.messages.at(-1)!, /設定版本：2/u);
  await h.command("status all");
  assert.equal(h.messages.join().includes("PRIVATE_"), false);
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
  for (const args of ["status detail", "status all"]) {
    await h.command(args);
    assert.match(h.messages.at(-1)!, /音效：開啟（WAV 檔案）/u);
  }
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
