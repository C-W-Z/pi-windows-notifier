import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord, validPayload, type NotificationPayload } from "./types.ts";

export const HELPER_TIMEOUT = 10_000;
export const OUTPUT_LIMIT = 8 * 1024;
export type LaunchCode = "OK" | "TOAST_FAILED" | "SOUND_FAILED" | "BOTH_FAILED" |
  "INPUT_INVALID" | "INTERNAL_ERROR" | "BACKEND_UNAVAILABLE" | "LAUNCH_FAILED" |
  "HELPER_TIMEOUT" | "OUTPUT_LIMIT" | "HELPER_PROTOCOL" | "CANCELLED";
export interface LaunchResult {
  code: LaunchCode;
  toast: boolean;
  sound: "played" | "disabled" | "failed";
}
export interface Backend {
  available: boolean;
  code: string;
  launch(payload: NotificationPayload, signal: AbortSignal): Promise<LaunchResult>;
}
const SCRIPT = fileURLToPath(new URL("./windows-notify.ps1", import.meta.url));
const ENV_KEYS = ["SystemRoot", "windir", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "USERNAME", "USERDOMAIN"];
const HELPER_CODES = new Set(["OK", "TOAST_FAILED", "SOUND_FAILED", "BOTH_FAILED", "INPUT_INVALID", "INTERNAL_ERROR"]);

/** 僅信任啟動 Pi 的 OS 環境；專案設定與 PATH 不能參與執行檔定位。 */
export function windowsPaths(env: NodeJS.ProcessEnv): { executable: string; env: NodeJS.ProcessEnv } | undefined {
  const get = (key: string): string | undefined => {
    const actual = Object.keys(env).find(item => item.toLowerCase() === key.toLowerCase());
    return actual ? env[actual] : undefined;
  };
  const root = get("SystemRoot") ?? get("windir");
  if (!root || !/^[a-z]:[\\/]/iu.test(root) || /[<>:"|?*\u0000-\u001f]/u.test(root.slice(2))) return undefined;
  const clean = win32.normalize(root);
  if (!win32.isAbsolute(clean) || clean.startsWith("\\\\")) return undefined;
  const result: NodeJS.ProcessEnv = {};
  for (const key of ENV_KEYS) {
    const value = get(key);
    if (value !== undefined) result[key] = value;
  }
  result.SystemRoot = clean;
  result.windir = clean;
  return { executable: win32.join(clean, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), env: result };
}
function failed(code: LaunchCode): LaunchResult { return { code, toast: false, sound: "failed" }; }
function parseResult(output: Buffer, exitCode: number | null, payload: NotificationPayload): LaunchResult {
  try {
    const parsed: unknown = JSON.parse(output.toString("utf8").trim());
    if (!isRecord(parsed) || Object.keys(parsed).length !== 3 ||
        typeof parsed.code !== "string" || !HELPER_CODES.has(parsed.code) || typeof parsed.toast !== "boolean" ||
        typeof parsed.sound !== "string" || !["played", "disabled", "failed"].includes(parsed.sound)) return failed("HELPER_PROTOCOL");
    const code = parsed.code as LaunchCode;
    const audio = parsed.sound as LaunchResult["sound"];
    if (["INPUT_INVALID", "INTERNAL_ERROR"].includes(code)) {
      return !parsed.toast && audio === "failed" && exitCode === 1 ? failed(code) : failed("HELPER_PROTOCOL");
    }
    if ((!payload.toast.enabled && parsed.toast) ||
        (payload.sound.enabled ? audio === "disabled" : audio !== "disabled")) return failed("HELPER_PROTOCOL");
    const toastFailed = payload.toast.enabled && !parsed.toast;
    const soundFailed = payload.sound.enabled && audio === "failed";
    const expected = toastFailed ? (soundFailed ? "BOTH_FAILED" : "TOAST_FAILED") : (soundFailed ? "SOUND_FAILED" : "OK");
    if (code !== expected || exitCode !== (code === "OK" ? 0 : 1)) return failed("HELPER_PROTOCOL");
    return { code, toast: parsed.toast, sound: audio };
  } catch { return failed("HELPER_PROTOCOL"); }
}
export interface BackendOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  scriptPath?: string;
  isFile?: (path: string) => boolean;
  spawnProcess?: (file: string, args: string[], options: SpawnOptions) => ChildProcess;
  timeoutMs?: number;
}
export function createWindowsBackend(options: BackendOptions = {}): Backend {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const paths = windowsPaths(options.env ?? process.env);
  const script = options.scriptPath ?? SCRIPT;
  const isFile = options.isFile ?? (path => { try { return statSync(path).isFile(); } catch { return false; } });
  const available = platform === "win32" && ["x64", "arm64"].includes(arch) &&
    !!paths && isFile(paths.executable) && isFile(script);
  const spawnProcess = options.spawnProcess ?? spawn;
  const code = available ? "OK" : "BACKEND_UNAVAILABLE";
  return {
    available, code,
    launch(payload, signal) {
      if (!validPayload(payload)) return Promise.resolve(failed("INPUT_INVALID"));
      // 再建立白名單快照，避免呼叫方中途修改設定或額外傳入事件內容。
      const request: NotificationPayload = { kind: payload.kind, toast: { ...payload.toast },
        sound: { enabled: payload.sound.enabled, source: { ...payload.sound.source } } };
      if (!available || !paths) return Promise.resolve(failed("BACKEND_UNAVAILABLE"));
      if (signal.aborted) return Promise.resolve(failed("CANCELLED"));
      return new Promise(resolve => {
        let child: ChildProcess;
        try {
          child = spawnProcess(paths.executable,
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", script],
            { shell: false, windowsHide: true, cwd: dirname(script), env: { ...paths.env }, stdio: ["pipe", "pipe", "pipe"] });
        } catch { resolve(failed("LAUNCH_FAILED")); return; }
        let reason: LaunchCode | undefined;
        let output = Buffer.alloc(0);
        let stderrSize = 0;
        let done = false;
        const stop = (code: LaunchCode) => {
          if (reason || done) return;
          reason = code;
          // Windows 的 kill 只作用於這個 ChildProcess，不搜尋或終止其他同名程序。
          try { child.kill(); } catch { /* 保留有界輸出並等待 close，不允許再啟動第二個 helper。 */ }
        };
        const onAbort = () => stop("CANCELLED");
        const timer = setTimeout(() => stop("HELPER_TIMEOUT"), options.timeoutMs ?? HELPER_TIMEOUT);
        timer.unref();
        signal.addEventListener("abort", onAbort, { once: true });
        const finish = (result: LaunchResult) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(result);
        };
        child.on("error", () => {
          reason ??= "LAUNCH_FAILED";
          // spawn 失敗會有 close；等待它以免提前釋放單一 helper 的配額。
        });
        child.stdout?.on("data", (chunk: Buffer | string) => {
          if (reason) return;
          const bytes = Buffer.from(chunk);
          if (output.length + bytes.length > OUTPUT_LIMIT) { stop("OUTPUT_LIMIT"); return; }
          output = Buffer.concat([output, bytes]);
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
          if (reason) return;
          stderrSize += Buffer.byteLength(chunk);
          if (stderrSize > OUTPUT_LIMIT) stop("OUTPUT_LIMIT");
          // 不保存或展示 PowerShell 的原始錯誤文字。
        });
        child.once("close", exitCode => finish(reason ? failed(reason) : parseResult(output, exitCode, request)));
        child.stdin?.on("error", () => stop("LAUNCH_FAILED"));
        child.stdout?.on("error", () => stop("LAUNCH_FAILED"));
        child.stderr?.on("error", () => stop("LAUNCH_FAILED"));
        try { child.stdin?.end(JSON.stringify(request)); }
        catch { stop("LAUNCH_FAILED"); }
        if (signal.aborted) onAbort();
      });
    },
  };
}
