import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KINDS, TITLE_LIMIT, MESSAGE_LIMIT, isRecord, onlyKeys, validText, validSoundSource,
  type NotificationKind, type ToastConfig, type SoundConfig } from "./types.ts";

export interface EventConfig { enabled: boolean; toast: ToastConfig; sound: SoundConfig }
/** 解析後的有效設定；defaults 已合併至各事件，不保留重複設定來源。 */
export interface Config {
  schemaVersion: 2;
  enabled: boolean;
  events: Record<NotificationKind, EventConfig>;
}
export type ConfigResult =
  | { ok: true; config: Config }
  | { ok: false; code: "CONFIG_INVALID" | "CONFIG_TOO_LARGE" | "CONFIG_READ_FAILED"; config: Config };

const MESSAGES: Record<NotificationKind, string> = {
  permission: "Permission approval needed", question: "Waiting for your answer", completed: "Response complete",
  aborted: "Response interrupted", failed: "Response failed",
};
export function defaults(): Config {
  return { schemaVersion: 2, enabled: true, events: Object.fromEntries(KINDS.map(kind =>
    [kind, { enabled: true, toast: { enabled: true, title: "Pi", message: MESSAGES[kind] },
      sound: { enabled: true, source: { type: "system", name: kind === "completed" ? "Hand" : "Exclamation" } } }])) as Config["events"] };
}
function applyChannels(target: EventConfig, value: Record<string, unknown>): boolean {
  if (Object.hasOwn(value, "toast")) {
    const toast = value.toast;
    if (!isRecord(toast) || !onlyKeys(toast, ["enabled", "title", "message"])) return false;
    if (Object.hasOwn(toast, "enabled")) {
      if (typeof toast.enabled !== "boolean") return false;
      target.toast.enabled = toast.enabled;
    }
    for (const field of ["title", "message"] as const) {
      if (!Object.hasOwn(toast, field)) continue;
      const text = toast[field];
      if (!validText(text, field === "title" ? TITLE_LIMIT : MESSAGE_LIMIT)) return false;
      target.toast[field] = text;
    }
  }
  if (Object.hasOwn(value, "sound")) {
    const sound = value.sound;
    if (!isRecord(sound) || !onlyKeys(sound, ["enabled", "source"])) return false;
    if (Object.hasOwn(sound, "enabled")) {
      if (typeof sound.enabled !== "boolean") return false;
      target.sound.enabled = sound.enabled;
    }
    if (Object.hasOwn(sound, "source")) {
      const source = sound.source;
      if (!validSoundSource(source)) return false;
      // source 作為完整單位覆寫，不合併不同來源類型的欄位。
      target.sound.source = { ...source };
    }
  }
  return true;
}
export function parseConfig(value: unknown): ConfigResult {
  const config = defaults();
  const invalid = (): ConfigResult => ({ ok: false, code: "CONFIG_INVALID", config: { ...defaults(), enabled: false } });
  if (!isRecord(value)) return invalid();
  const legacy = !Object.hasOwn(value, "schemaVersion");
  if (!onlyKeys(value, legacy ? ["enabled", "events"] : ["schemaVersion", "enabled", "defaults", "events"]) ||
      !legacy && value.schemaVersion !== 2) return invalid();
  if (Object.hasOwn(value, "enabled")) {
    if (typeof value.enabled !== "boolean") return invalid();
    config.enabled = value.enabled;
  }
  if (!legacy && Object.hasOwn(value, "defaults")) {
    if (!isRecord(value.defaults) || !onlyKeys(value.defaults, ["toast", "sound"])) return invalid();
    for (const kind of KINDS) if (!applyChannels(config.events[kind], value.defaults)) return invalid();
  }
  if (Object.hasOwn(value, "events")) {
    if (!isRecord(value.events) || !onlyKeys(value.events, KINDS)) return invalid();
    for (const kind of KINDS) {
      if (!Object.hasOwn(value.events, kind)) continue;
      const item = value.events[kind];
      if (!isRecord(item) || !onlyKeys(item, legacy ? ["enabled", "sound"] : ["enabled", "toast", "sound"])) return invalid();
      const target = config.events[kind];
      if (Object.hasOwn(item, "enabled")) {
        if (typeof item.enabled !== "boolean") return invalid();
        target.enabled = item.enabled;
      }
      if (legacy) {
        if (Object.hasOwn(item, "sound")) {
          if (typeof item.sound !== "boolean") return invalid();
          target.sound.enabled = item.sound;
        }
      } else if (!applyChannels(target, item)) return invalid();
    }
  }
  return { ok: true, config };
}
export const CONFIG_LIMIT = 16 * 1024;
export function configPath(): string {
  return join(homedir(), ".pi", "agent", "extensions", "pi-windows-notifier", "config.json");
}
/** 預設先讀新位置，只有檔案不存在才讀舊位置；明確傳入路徑時不讀取其他使用者設定。 */
export function loadConfig(path?: string, fallbackPath?: string): ConfigResult {
  const primary = path ?? configPath();
  const legacy = fallbackPath ?? (path === undefined
    ? join(homedir(), ".pi", "agent", "pi-windows-notifier", "config.json") : undefined);
  return readConfig(primary) ?? (legacy ? readConfig(legacy) : undefined) ?? { ok: true, config: defaults() };
}
function readConfig(path: string): ConfigResult | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    if (!fstatSync(fd).isFile()) throw new Error("not a file");
    const buffer = Buffer.alloc(CONFIG_LIMIT + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > CONFIG_LIMIT) return { ok: false, code: "CONFIG_TOO_LARGE", config: { ...defaults(), enabled: false } };
    try { return parseConfig(JSON.parse(buffer.subarray(0, size).toString("utf8"))); }
    catch { return { ok: false, code: "CONFIG_INVALID", config: { ...defaults(), enabled: false } }; }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return { ok: false, code: "CONFIG_READ_FAILED", config: { ...defaults(), enabled: false } };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
