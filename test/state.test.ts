import assert from "node:assert/strict";
import { test } from "node:test";
import { NotificationState } from "../src/state.ts";
import type { NotificationJob } from "../src/types.ts";

function fixture() {
  const jobs: NotificationJob[] = [];
  const cancelled: string[] = [];
  const diagnostics: string[] = [];
  const state = new NotificationState({ enqueue: job => jobs.push(job), cancel: key => cancelled.push(key) },
    code => diagnostics.push(code));
  return { state, jobs, cancelled, diagnostics };
}
test("權限只處理 ask、去重、轉送與 decision 取消，不保存敏感欄位", () => {
  const { state, jobs, cancelled } = fixture();
  state.permissionDecision({ requestId: "auto-allow" });
  assert.equal(jobs.length, 0);
  state.permissionPrompt({ requestId: "r", value: "SECRET", forwarding: { requesterAgentName: "SECRET" } });
  state.permissionPrompt({ requestId: "r" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].valid(), true);
  assert.equal(JSON.stringify(jobs).includes("SECRET"), false);
  state.permissionDecision({ requestId: "r" });
  assert.equal(jobs[0].valid(), false);
  assert.ok(cancelled.includes("permission:r"));
});
test("事件 ID 長度限制及快取有界", () => {
  const { state, jobs } = fixture();
  state.permissionPrompt({ requestId: "x".repeat(257) });
  state.permissionPrompt({ requestId: "\n" });
  assert.equal(jobs.length, 0);
  for (let i = 0; i < 257; i++) state.permissionPrompt({ requestId: String(i) });
  assert.equal(jobs[0].valid(), false);
  state.permissionPrompt({ requestId: "256" });
  assert.equal(jobs.length, 257);
});
test("RPIV 與共通 UI 去重，多題多步 UI 只提醒一次", () => {
  const { state, jobs } = fixture();
  state.toolStart({ toolCallId: "q", toolName: "ask_user_question", args: { secret: "SECRET" } });
  state.rpivBlocked({ active: true });
  state.uiStart();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].valid(), true);
  state.uiEnd();
  state.rpivBlocked({ active: false });
  state.uiStart();
  assert.equal(jobs.length, 1);
  state.uiEnd();
  state.toolEnd({ toolCallId: "q" });
  assert.equal(jobs[0].valid(), false);
});
test("Plan mode 必須實際等待 UI，不把權限 UI 再分類為提問", () => {
  const { state, jobs } = fixture();
  state.toolStart({ toolCallId: "plan", toolName: "plan_mode_question" });
  assert.equal(jobs.length, 0);
  state.permissionPrompt({ requestId: "permission" });
  state.uiStart();
  assert.equal(jobs.length, 1);
  state.uiEnd();
  state.permissionDecision({ requestId: "permission" });
  state.uiStart();
  assert.equal(jobs[1].kind, "question");
  state.uiEnd();
});
test("手動 UI、無 UI、驗證失敗及不明並行 UI 不提醒", () => {
  const { state, jobs, diagnostics } = fixture();
  state.uiStart();
  state.toolStart({ toolCallId: "a", toolName: "ask_user_question" });
  state.rpivBlocked({ active: true });
  state.uiStart();
  assert.equal(jobs.length, 0);
  state.uiEnd();
  state.toolEnd({ toolCallId: "a" });
  state.toolStart({ toolCallId: "invalid", toolName: "plan_mode_question" });
  state.toolEnd({ toolCallId: "invalid" });
  state.toolStart({ toolCallId: "b", toolName: "plan_mode_question" });
  state.toolStart({ toolCallId: "c", toolName: "ask_user_question" });
  state.uiStart();
  state.rpivBlocked({ active: true });
  assert.equal(jobs.length, 0);
  assert.ok(diagnostics.includes("UI_AMBIGUOUS"));
});
test("重試／續跑只有 settled 發通知，最終結果優先", () => {
  const { state, jobs } = fixture();
  state.agentStart();
  state.messageEnd({ message: { role: "assistant", stopReason: "error", errorMessage: "SECRET" } });
  state.boundary({ outcome: "error" });
  state.agentStart();
  assert.equal(jobs.length, 0);
  state.messageEnd({ message: { role: "assistant", stopReason: "stop" } });
  state.boundary({ outcome: "completed" });
  state.settled({ aborted: false });
  state.settled({ aborted: false });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, "completed");
  state.agentStart();
  assert.equal(jobs[0].valid(), false);
  state.boundary({ outcome: "error" });
  state.settled({ aborted: false });
  assert.equal(jobs[1].kind, "failed");
});
test("Esc 優先於成功、空 run 不報成功、工具錯誤不等於模型失敗", () => {
  const { state, jobs } = fixture();
  state.agentStart();
  state.settled({ aborted: false });
  assert.equal(jobs.length, 0);
  state.agentStart();
  state.settled({ aborted: true });
  assert.equal(jobs.length, 0);
  state.agentStart();
  state.messageEnd({ message: { role: "toolResult", isError: true } });
  state.messageEnd({ message: { role: "assistant", stopReason: "stop" } });
  state.settled({ aborted: true });
  assert.equal(jobs[0].kind, "aborted");
  state.agentStart();
  state.messageEnd({ message: { role: "toolResult", isError: true } });
  state.messageEnd({ message: { role: "assistant", stopReason: "stop" } });
  state.settled({ aborted: false });
  assert.equal(jobs[1].kind, "completed");
});
test("重複或並行 UI 開始訊號取消尚未送出的提問，不猜測歸屬", () => {
  const { state, jobs, cancelled } = fixture();
  state.toolStart({ toolCallId: "q", toolName: "plan_mode_question" });
  state.uiStart();
  assert.equal(jobs[0].valid(), true);
  state.uiStart();
  assert.equal(jobs[0].valid(), false);
  assert.ok(cancelled.includes("question:q"));
});
test("reset 使舊事件失效且可重複呼叫", () => {
  const { state, jobs } = fixture();
  state.permissionPrompt({ requestId: "old" });
  state.toolStart({ toolCallId: "q", toolName: "ask_user_question" });
  state.reset();
  state.reset();
  assert.equal(jobs[0].valid(), false);
  state.permissionPrompt({ requestId: "old" });
  assert.equal(jobs.length, 2);
});
