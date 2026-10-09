export const KINDS = ["permission", "question", "completed", "aborted", "failed"] as const;
export type NotificationKind = (typeof KINDS)[number];
export type Outcome = "completed" | "aborted" | "error";
export const SYSTEM_SOUNDS = ["Asterisk", "Beep", "Exclamation", "Hand", "Question"] as const;
export type SystemSound = (typeof SYSTEM_SOUNDS)[number];
export const TITLE_LIMIT = 128;
export const MESSAGE_LIMIT = 512;
export interface ToastConfig { enabled: boolean; title: string; message: string }
export const SOUND_PATH_LIMIT = 1024;
export type SoundSource = { type: "system"; name: SystemSound } | { type: "file"; path: string };
export interface SoundConfig { enabled: boolean; source: SoundSource }
export interface NotificationPayload { kind: NotificationKind; toast: ToastConfig; sound: SoundConfig }
/** 限制單行 XML 文字；保留引號與 XML 字元，由 DOM 安全編碼。 */
export function validText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit &&
    !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufffe\uffff\ud800-\udfff]/u.test(value);
}
export function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
/** 僅接受一般磁碟上的絕對 WAV 路徑；不展開環境變數、家目錄或專案相對路徑。 */
export function validSoundPath(value: unknown): value is string {
  if (!validText(value, SOUND_PATH_LIMIT) || !/^[a-z]:[\\/]/iu.test(value) ||
      /[<>:"|?*]/u.test(value.slice(2)) || !/\.wav$/iu.test(value)) return false;
  return value.slice(3).split(/[\\/]/u).every(part => part.length > 0 && !/[. ]$/u.test(part) &&
    !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part));
}
export function validSoundSource(value: unknown): value is SoundSource {
  if (!isRecord(value)) return false;
  return value.type === "system"
    ? onlyKeys(value, ["type", "name"]) && SYSTEM_SOUNDS.includes(value.name as SystemSound)
    : value.type === "file" && onlyKeys(value, ["type", "path"]) && validSoundPath(value.path);
}
export function validPayload(value: unknown): value is NotificationPayload {
  if (!isRecord(value) || !onlyKeys(value, ["kind", "toast", "sound"]) ||
      !KINDS.includes(value.kind as NotificationKind) || !isRecord(value.toast) || !isRecord(value.sound)) return false;
  const { toast, sound } = value;
  return onlyKeys(toast, ["enabled", "title", "message"]) && typeof toast.enabled === "boolean" &&
    validText(toast.title, TITLE_LIMIT) && validText(toast.message, MESSAGE_LIMIT) &&
    onlyKeys(sound, ["enabled", "source"]) && typeof sound.enabled === "boolean" &&
    validSoundSource(sound.source) &&
    (toast.enabled || sound.enabled);
}
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
