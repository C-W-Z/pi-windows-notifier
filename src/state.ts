import { isRecord, safeId, type Diagnostic, type NotificationSink, type Outcome } from "./types.ts";

const QUESTION_TOOLS = new Set(["ask_user_question", "plan_mode_question"]);
interface Question { name: string; waiting: boolean; notified: boolean }

/** 純觀察狀態機：不回傳工具攔截結果、不保存 arguments 或訊息內容。 */
export class NotificationState {
  private sink: NotificationSink;
  private diagnose: Diagnostic;
  private seen = new Set<string>();
  private permissions = new Set<string>();
  private questions = new Map<string, Question>();
  private ui: { question?: string } | undefined;
  private rpivCall: string | undefined;
  private running = false;
  private generation = 0;
  private terminalKey: string | undefined;
  private assistantSeen = false;
  private outcome: Outcome | undefined;

  constructor(sink: NotificationSink, diagnose: Diagnostic = () => {}) {
    this.sink = sink;
    this.diagnose = diagnose;
  }
  permissionPrompt(raw: unknown): void {
    if (!isRecord(raw) || !safeId(raw.requestId)) { this.diagnose("EVENT_INVALID"); return; }
    const id = raw.requestId;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    this.permissions.add(id);
    if (this.permissions.size > 256) {
      const oldest = this.permissions.values().next().value!;
      this.permissions.delete(oldest);
      this.sink.cancel("permission:" + oldest);
    }
    this.sink.enqueue({ key: "permission:" + id, kind: "permission", valid: () => this.permissions.has(id) });
  }
  permissionDecision(raw: unknown): void {
    if (!isRecord(raw) || !safeId(raw.requestId)) return;
    this.permissions.delete(raw.requestId);
    this.sink.cancel("permission:" + raw.requestId);
  }
  toolStart(raw: unknown): void {
    if (!isRecord(raw) || typeof raw.toolName !== "string" || !QUESTION_TOOLS.has(raw.toolName)) return;
    if (!safeId(raw.toolCallId)) { this.diagnose("EVENT_INVALID"); return; }
    if (this.questions.has(raw.toolCallId)) return;
    if (this.questions.size >= 32) { this.diagnose("TOOLS_LIMIT"); return; }
    this.questions.set(raw.toolCallId, { name: raw.toolName, waiting: false, notified: false });
  }
  toolEnd(raw: unknown): void {
    if (!isRecord(raw) || !safeId(raw.toolCallId)) return;
    this.sink.cancel("question:" + raw.toolCallId);
    this.questions.delete(raw.toolCallId);
    if (this.rpivCall === raw.toolCallId) this.rpivCall = undefined;
  }
  private wait(id: string): void {
    const question = this.questions.get(id);
    if (!question) return;
    question.waiting = true;
    if (question.notified) return;
    question.notified = true;
    this.sink.enqueue({ key: "question:" + id, kind: "question",
      valid: () => this.questions.get(id) === question && question.waiting });
  }
  private stopWait(id: string): void {
    const question = this.questions.get(id);
    if (question) question.waiting = false;
    this.sink.cancel("question:" + id);
  }
  uiStart(): void {
    if (this.ui) {
      if (this.ui.question) this.stopWait(this.ui.question);
      if (this.rpivCall) this.stopWait(this.rpivCall);
      this.ui = {};
      this.diagnose("UI_AMBIGUOUS");
      return;
    }
    this.ui = {};
    if (this.permissions.size) return;
    if (this.questions.size !== 1) {
      if (this.questions.size > 1) this.diagnose("UI_AMBIGUOUS");
      return;
    }
    const id = this.questions.keys().next().value!;
    this.ui.question = id;
    this.wait(id);
  }
  uiEnd(): void {
    if (this.ui?.question) this.stopWait(this.ui.question);
    this.ui = undefined;
  }
  rpivBlocked(raw: unknown): void {
    if (!isRecord(raw) || typeof raw.active !== "boolean") return;
    if (!raw.active) {
      if (this.rpivCall) this.stopWait(this.rpivCall);
      this.rpivCall = undefined;
      return;
    }
    if (this.rpivCall) return;
    if (this.permissions.size || this.questions.size !== 1 ||
        (this.ui && !this.ui.question)) { this.diagnose("UI_AMBIGUOUS"); return; }
    const [id, question] = this.questions.entries().next().value!;
    if (question.name !== "ask_user_question") return;
    this.rpivCall = id;
    this.wait(id);
  }
  agentStart(): void {
    if (this.running) return; // retry／續跑仍屬於同一個邏輯 run。
    if (this.terminalKey) this.sink.cancel(this.terminalKey);
    this.terminalKey = undefined;
    this.running = true;
    this.generation++;
    this.assistantSeen = false;
    this.outcome = undefined;
  }
  messageEnd(raw: unknown): void {
    if (!this.running || !isRecord(raw) || !isRecord(raw.message) || raw.message.role !== "assistant") return;
    this.assistantSeen = true;
    this.outcome = raw.message.stopReason === "aborted" ? "aborted" :
      raw.message.stopReason === "error" ? "error" : "completed";
  }
  boundary(raw: unknown): void {
    if (!this.running || !isRecord(raw)) return;
    if (raw.outcome === "completed" || raw.outcome === "aborted" || raw.outcome === "error") {
      this.outcome = raw.outcome;
    }
  }
  settled(raw: unknown): void {
    if (!this.running || !isRecord(raw) || typeof raw.aborted !== "boolean") return;
    this.running = false;
    const kind = (raw.aborted || this.outcome === "aborted") && this.assistantSeen ? "aborted" :
      this.outcome === "error" ? "failed" : this.assistantSeen ? "completed" : undefined;
    if (!kind) return;
    const generation = this.generation;
    const key = "run:" + generation;
    this.terminalKey = key;
    this.sink.enqueue({ key, kind, valid: () => this.generation === generation && !this.running });
  }
  reset(): void {
    for (const id of this.permissions) this.sink.cancel("permission:" + id);
    for (const id of this.questions.keys()) this.sink.cancel("question:" + id);
    if (this.terminalKey) this.sink.cancel(this.terminalKey);
    this.seen.clear();
    this.permissions.clear();
    this.questions.clear();
    this.ui = undefined;
    this.rpivCall = undefined;
    this.running = false;
    this.assistantSeen = false;
    this.outcome = undefined;
    this.terminalKey = undefined;
    this.generation++;
  }
}
