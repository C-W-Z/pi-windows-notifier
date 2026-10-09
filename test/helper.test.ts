import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { windowsPaths } from "../src/launcher.ts";

const script = fileURLToPath(new URL("../src/windows-notify.ps1", import.meta.url));
const paths = process.platform === "win32" && ["x64", "arm64"].includes(process.arch) ? windowsPaths(process.env) : undefined;
test("Windows PowerShell 可以解析固定 helper（不執行 helper）", { skip: !paths }, () => {
  const command = '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile([Console]::In.ReadToEnd(), [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { exit 1 }; Write-Output "OK"';
  const result = spawnSync(paths!.executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { input: script, encoding: "utf8", env: paths!.env, shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 8192 });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "OK");
});
test("helper 拒絕無效輸入，驗證失敗路徑不呼叫 Toast 或音效", { skip: !paths }, () => {
  // 全部 fixture 都沒有有效 kind；不執行任何會產生桌面通知的成功路徑。
  for (const input of ["", "{", "x".repeat(513), "null", "[]",
    '{"kind":"__invalid__","sound":true}',
    '{"kind":"__invalid__","sound":"true"}',
    '{"kind":"__invalid__","sound":false,"extra":"SECRET"}',
    '{"kind":"$(Write-Output SECRET) <xml>","sound":false}']) {
    const result = spawnSync(paths!.executable,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", script],
      { input, encoding: "utf8", env: paths!.env, shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 8192 });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { code: "INPUT_INVALID", toast: false, sound: "failed" });
    assert.equal(result.stdout.includes("SECRET"), false);
  }
});
