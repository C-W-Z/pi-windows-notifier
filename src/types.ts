export const KINDS = ["permission", "question", "completed", "aborted", "failed"] as const;
export type NotificationKind = (typeof KINDS)[number];
export type Outcome = "completed" | "aborted" | "error";
export interface NotificationJob {
  key: string;
  kind: NotificationKind;
  /** 送出前重新確認事件仍有效，不保留工作內容。 */
  valid(): boolean;
}
export interface NotificationSink {
  enqueue(job: NotificationJob): void;
  cancel(key: string): void;
}
export type Diagnostic = (code: string) => void;
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}
