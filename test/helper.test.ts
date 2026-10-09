import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaults } from "../src/config.ts";
import { SYSTEM_SOUNDS } from "../src/types.ts";
import { windowsPaths } from "../src/launcher.ts";

const script = fileURLToPath(new URL("../src/windows-notify.ps1", import.meta.url));
const paths = process.platform === "win32" && ["x64", "arm64"].includes(process.arch) ? windowsPaths(process.env) : undefined;
function run(input: string) {
  return spawnSync(paths!.executable,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", script],
    { input, encoding: "utf8", env: paths!.env, shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 8192 });
}
function disabledPayload() {
  const event = defaults().events.completed;
  return { kind: "completed", toast: { ...event.toast, enabled: false }, sound: { ...event.sound, enabled: false } };
}
test("Windows PowerShell 可以解析固定 helper（不執行 helper）", { skip: !paths }, () => {
  const command = '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile([Console]::In.ReadToEnd(), [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { exit 1 }; Write-Output "OK"';
  const result = spawnSync(paths!.executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { input: script, encoding: "utf8", env: paths!.env, shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 8192 });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "OK");
});
test("helper 拒絕無效輸入，完整驗證後才允許任何 Toast 或音效", { skip: !paths }, () => {
  const base = disabledPayload();
  const invalid = ["", "{", "x".repeat(4097), "null", "[]", JSON.stringify({ kind: "completed", sound: true }),
    ...[
      { ...base, kind: "COMPLETED" }, { ...base, extra: "SECRET" },
      { ...base, toast: { ...base.toast, enabled: "false" } },
      { ...base, toast: { ...base.toast, message: "x".repeat(513) } },
      { ...base, toast: { ...base.toast, title: "" } },
      { ...base, toast: { ...base.toast, title: "x".repeat(129) } },
      { ...base, toast: { ...base.toast, message: "line\nline" } },
      { ...base, toast: { ...base.toast, message: "\u0000" } },
      { ...base, toast: { ...base.toast, message: "\ud800" } },
      { ...base, toast: { ...base.toast, message: "\uffff" } },
      { ...base, toast: { ...base.toast, path: "SECRET" } },
      { ...base, sound: { ...base.sound, source: { type: "system", name: "beep" } } },
      { ...base, sound: { ...base.sound, source: { type: "file", path: "SECRET.wav" } } },
      { ...base, sound: { ...base.sound, source: { type: "system" } } },
      { ...base, sound: { ...base.sound, source: { type: "system", name: "Beep", extra: "SECRET" } } },
    ].map(value => JSON.stringify(value))];
  // 所有完整 fixture 的通道皆關閉；即使驗證有回歸，也不會發通知。
  for (const [index, input] of invalid.entries()) {
    const result = run(input);
    assert.equal(result.status, 1, `必須拒絕無效 fixture ${index}`);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { code: "INPUT_INVALID", toast: false, sound: "failed" });
    assert.equal(result.stdout.includes("SECRET"), false);
    assert.equal(result.stderr, "");
  }
});
test("helper 接受 Unicode／XML 文字及所有系統音效名稱；關閉通道不執行 API", { skip: !paths }, () => {
  for (const name of SYSTEM_SOUNDS) {
    const request = disabledPayload();
    request.toast.title = 'Pi <tag> & "引號" 😀';
    request.toast.message = "$(Write-Output SECRET) 只是文字";
    request.sound.source.name = name;
    const result = run(JSON.stringify(request));
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { code: "OK", toast: false, sound: "disabled" });
    assert.equal(result.stdout.includes("SECRET"), false);
    assert.equal(result.stderr, "");
  }
  const request = disabledPayload();
  request.toast.title = "x".repeat(128);
  request.toast.message = "x".repeat(512);
  assert.equal(run(JSON.stringify(request)).status, 0);
  request.toast.title = "emoji 😀";
  request.toast.message = String.raw`literal \ud800`;
  assert.equal(run(JSON.stringify(request).replace("😀", String.raw`\ud83d\ude00`)).status, 0);
});
