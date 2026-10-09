import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaults, loadConfig, type ConfigResult } from "./config.ts";
import { notifierArgumentCompletions, withNotifierCompletions } from "./completion.ts";
import { createWindowsBackend, windowsPaths, type Backend } from "./launcher.ts";
import { NotificationScheduler, systemClock, type Clock, type Submission } from "./scheduler.ts";
import { NotificationState } from "./state.ts";
import { KINDS, type NotificationKind } from "./types.ts";

export interface RuntimeOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  readConfig?: () => ConfigResult;
  backend?: () => Backend;
  clock?: Clock;
}
interface Session {
  context: ExtensionContext;
  state: NotificationState;
  scheduler?: NotificationScheduler;
  result: ConfigResult;
  backendCode: string;
  diagnostics: Set<string>;
  unsubscribe: Array<() => void>;
  disposed: boolean;
  lastWarning: number;
  testId: number;
}
const SUBMISSION_MESSAGES: Record<Submission["status"], string> = {
  submitted: "Windows 通知已提交；實際顯示與音效仍由 Windows 設定決定。",
  partial: "Windows 通知僅部分提交；請用 status 查看固定診斷碼。",
  disabled: "通知已停用，或目前不支援此環境／事件。",
  cancelled: "測試通知已取消。",
  dropped: "測試通知因佇列滿載而被丟棄。",
  expired: "測試通知已過期。",
  failed: "Windows 通知提交失敗；請用 status 查看固定診斷碼。",
};

/** factory 只註冊 API；程序、timer 與 event bus 訂閱皆屬於啟動後的 session。 */
export function registerNotifier(pi: ExtensionAPI, options: RuntimeOptions = {}): void {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  // 僅捕捉必要 OS 環境，不保留 agent 的完整環境或 API token。
  const environment = windowsPaths(process.env)?.env ?? {};
  const makeBackend = options.backend ?? (() => createWindowsBackend({ env: environment, platform, arch }));
  const readConfig = options.readConfig ?? loadConfig;
  const clock = options.clock ?? systemClock;
  let session: Session | undefined;
  let lifecycle = Promise.resolve();
  // reload／session start／shutdown 必須串行，避免前一個 helper 尚未 close 就建立新 session。
  const transition = (action: () => Promise<void>) => {
    const next = lifecycle.then(action);
    lifecycle = next.catch(() => {});
    return next;
  };

  const diagnose = (target: Session, code: string) => {
    if (target.disposed) return;
    if (target.diagnostics.size < 32) target.diagnostics.add(code);
    const now = clock.now();
    try {
      if (target.context.mode !== "tui" || !target.context.hasUI || now - target.lastWarning < 60_000) return;
      target.lastWarning = now;
      target.context.ui.notify(`Windows notifier：${code}。可用 /windows-notifier status 查看狀態。`, "warning");
    } catch { /* session 更換時的 stale context／UI 不影響 agent。 */ }
  };
  const stop = async () => {
    const previous = session;
    session = undefined;
    if (!previous) return;
    previous.disposed = true;
    for (const unsubscribe of previous.unsubscribe) { try { unsubscribe(); } catch {} }
    previous.unsubscribe = [];
    previous.state.reset();
    await previous.scheduler?.close();
  };
  const start = async (context: ExtensionContext) => {
    await stop();
    let result: ConfigResult;
    try { result = readConfig(); }
    catch { result = { ok: false, code: "CONFIG_READ_FAILED", config: { ...defaults(), enabled: false } }; }
    const eligible = platform === "win32" && ["x64", "arm64"].includes(arch) && context.mode === "tui" && context.hasUI;
    let backend: Backend | undefined;
    try { if (eligible) backend = makeBackend(); } catch { /* 不展示 backend 原始錯誤。 */ }
    const target: Session = {
      context, state: undefined!, result, backendCode: eligible ? backend?.code ?? "BACKEND_UNAVAILABLE" : "ENV_UNSUPPORTED",
      diagnostics: new Set(), unsubscribe: [], disposed: false, lastWarning: -Infinity, testId: 0,
    };
    const scheduler = backend && eligible
      ? new NotificationScheduler(backend, () => target.result.config, code => diagnose(target, code), clock) : undefined;
    target.scheduler = scheduler;
    target.state = new NotificationState(scheduler ?? { enqueue() {}, cancel() {} }, code => diagnose(target, code));
    session = target;
    if (!result.ok) diagnose(target, result.code);
    if (eligible && !backend?.available) diagnose(target, "BACKEND_UNAVAILABLE");
    if (!eligible) return;
    const listen = (channel: string, handler: (raw: unknown) => void) => {
      target.unsubscribe.push(pi.events.on(channel, raw => {
        if (target.disposed || session !== target) return;
        try { handler(raw); } catch { diagnose(target, "EVENT_INVALID"); }
      }));
    };
    listen("permissions:ui_prompt", raw => target.state.permissionPrompt(raw));
    listen("permissions:decision", raw => target.state.permissionDecision(raw));
    listen("rpiv:ask-user:blocked", raw => target.state.rpivBlocked(raw));
  };
  const observe = (handler: (state: NotificationState) => void) => {
    const target = session;
    if (!target || target.disposed || target.backendCode === "ENV_UNSUPPORTED") return;
    try { handler(target.state); } catch { diagnose(target, "EVENT_INVALID"); }
  };
  pi.on("session_start", async (_event, context) => {
    if (context.mode === "tui" && context.hasUI) context.ui.addAutocompleteProvider(withNotifierCompletions);
    await transition(() => start(context));
  });
  pi.on("session_shutdown", async () => { await transition(stop); });
  pi.on("tool_execution_start", event => { observe(state => state.toolStart(event)); });
  pi.on("tool_execution_end", event => { observe(state => state.toolEnd(event)); });
  pi.on("ui_prompt_start", () => { observe(state => state.uiStart()); });
  pi.on("ui_prompt_end", () => { observe(state => state.uiEnd()); });
  pi.on("agent_start", () => { observe(state => state.agentStart()); });
  pi.on("message_end", event => { observe(state => state.messageEnd(event)); });
  pi.on("turn_end", event => { observe(state => state.boundary(event)); });
  pi.on("agent_before_settle", event => { observe(state => state.boundary(event)); });
  pi.on("agent_settled", event => { observe(state => state.settled(event)); });

  pi.registerCommand("windows-notifier", {
    description: "Windows 通知：status、reload、test [permission|question|completed|aborted|failed]",
    getArgumentCompletions: notifierArgumentCompletions,
    handler: async (args, context) => {
      const parts = args.trim().split(/\s+/u);
      if (parts.length === 1 && parts[0] === "reload") {
        await transition(() => start(context));
        context.ui.notify("Windows notifier 設定已重新載入；請用 status 查看有效狀態。", "info");
        return;
      }
      const target = session;
      if (!args.trim() || parts.length === 1 && parts[0] === "status") {
        const status = {
          backend: target?.backendCode ?? "NOT_STARTED",
          enabled: target?.result.config.enabled ?? false,
          schemaVersion: target?.result.config.schemaVersion,
          // 自訂文字與檔案路徑只送入 helper；status 不展示可能含敏感資訊的設定。
          events: target ? Object.fromEntries(KINDS.map(kind => {
            const event = target.result.config.events[kind];
            return [kind, { enabled: event.enabled, toast: { enabled: event.toast.enabled },
              sound: { enabled: event.sound.enabled, source: event.sound.source.type === "system"
                ? { ...event.sound.source } : { type: "file" } } }];
          })) : undefined,
          ...target?.scheduler?.status(),
          diagnostics: [...(target?.diagnostics ?? [])],
        };
        context.ui.notify(JSON.stringify(status), "info");
        return;
      }
      if (parts[0] === "test" && parts.length <= 2 &&
          (parts[1] === undefined || KINDS.includes(parts[1] as NotificationKind))) {
        if (!target?.scheduler || target.disposed) {
          context.ui.notify(SUBMISSION_MESSAGES.disabled, "warning");
          return;
        }
        const result = await target.scheduler.submit({ key: "test:" + ++target.testId,
          kind: (parts[1] ?? "completed") as NotificationKind,
          valid: () => session === target && !target.disposed });
        // reload／session 切換後不再使用已失效的 command context。
        if (session === target && !target.disposed) context.ui.notify(SUBMISSION_MESSAGES[result.status],
          result.status === "submitted" ? "info" : "warning");
        return;
      }
      context.ui.notify("用法：/windows-notifier status | reload | test [permission|question|completed|aborted|failed]", "warning");
    },
  });
}
