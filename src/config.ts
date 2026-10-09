import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KINDS, isRecord, type NotificationKind } from "./types.ts";

export interface EventConfig { enabled: boolean; sound: boolean }
export interface Config {
  enabled: boolean;
  events: Record<NotificationKind, EventConfig>;
}
export type ConfigResult =
  | { ok: true; config: Config }
  | { ok: false; code: "CONFIG_INVALID" | "CONFIG_TOO_LARGE" | "CONFIG_READ_FAILED"; config: Config };

export function defaults(): Config {
  return { enabled: true, events: Object.fromEntries(KINDS.map(kind =>
    [kind, { enabled: true, sound: true }])) as Config["events"] };
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
export function parseConfig(value: unknown): ConfigResult {
  const config = defaults();
  const invalid = (): ConfigResult => ({ ok: false, code: "CONFIG_INVALID", config: { ...defaults(), enabled: false } });
  if (!isRecord(value) || !onlyKeys(value, ["enabled", "events"])) return invalid();
  if (Object.hasOwn(value, "enabled")) {
    if (typeof value.enabled !== "boolean") return invalid();
    config.enabled = value.enabled;
  }
  if (Object.hasOwn(value, "events")) {
    if (!isRecord(value.events) || !onlyKeys(value.events, KINDS)) return invalid();
    for (const kind of KINDS) {
      if (!Object.hasOwn(value.events, kind)) continue;
      const item = value.events[kind];
      if (!isRecord(item) || !onlyKeys(item, ["enabled", "sound"])) return invalid();
      for (const field of ["enabled", "sound"] as const) {
        if (!Object.hasOwn(item, field)) continue;
        if (typeof item[field] !== "boolean") return invalid();
        config.events[kind][field] = item[field];
      }
    }
  }
  return { ok: true, config };
}
export const CONFIG_LIMIT = 16 * 1024;
export function configPath(): string {
  return join(homedir(), ".pi", "agent", "pi-windows-notifier", "config.json");
}
export function loadConfig(path = configPath()): ConfigResult {
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, config: defaults() };
    return { ok: false, code: "CONFIG_READ_FAILED", config: { ...defaults(), enabled: false } };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
