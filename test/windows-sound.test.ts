import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { windowsPaths } from "../src/launcher.ts";
import { wave } from "./sound-fixtures.ts";

const script = fileURLToPath(new URL("../src/windows-sound.ps1", import.meta.url));
const paths = process.platform === "win32" && ["x64", "arm64"].includes(process.arch) ? windowsPaths(process.env) : undefined;
/** 只呼叫驗證與讀取函式，不呼叫 Play-LocalWave 或任何音效 API。 */
function checkFiles(files: string[]): Array<{ ok: boolean; size: number }> {
  const command = `
    Set-StrictMode -Version Latest
    $ErrorActionPreference = "Stop"
    [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    . $request.script
    $results = @(foreach ($path in $request.files) {
      try { $bytes = Read-LocalWave $path; @{ ok = $true; size = $bytes.Length } }
      catch { @{ ok = $false; size = 0 } }
    })
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $results -Compress))
  `;
  const result = spawnSync(paths!.executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { input: JSON.stringify({ script, files }), encoding: "utf8", env: paths!.env, shell: false,
      windowsHide: true, timeout: 15_000, maxBuffer: 8192 });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout.trim());
}

test("WAV 有界讀取與 PCM 驗證，支援空白、引號、Unicode 與指令樣式檔名", { skip: !paths }, () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-notifier-wave-"));
  try {
    const extendedFormat = Buffer.concat([wave().subarray(0, 36), Buffer.alloc(2), wave().subarray(36)]);
    extendedFormat.writeUInt32LE(extendedFormat.length - 8, 4);
    extendedFormat.writeUInt32LE(18, 16);
    const metadata = Buffer.concat([wave().subarray(0, 36), Buffer.from([74, 85, 78, 75, 3, 0, 0, 0, 1, 2, 3, 0]), wave().subarray(36)]);
    metadata.writeUInt32LE(metadata.length - 8, 4);
    const valid = [wave(), wave({ channels: 2, bits: 16, sampleRate: 48000 }), wave({ seconds: 5 }),
      wave({ seconds: 0.010125 }), extendedFormat, metadata];
    const files = valid.map((bytes, index) => {
      const path = join(dir, `it's $(PRIVATE); 完成 😀 ${index}.wav`);
      writeFileSync(path, bytes);
      return path;
    });
    assert.deepEqual(checkFiles(files), valid.map(bytes => ({ ok: true, size: bytes.length })));
  } finally { rmSync(dir, { recursive: true }); }
});

test("拒絕不存在、資料夾、超大、截斷、偽造與過長音效，不播放或 fallback", { skip: !paths }, () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-notifier-bad-wave-"));
  try {
    const forged = (offset: number, value: number, length: 2 | 4 = 4) => {
      const bytes = wave();
      if (length === 2) bytes.writeUInt16LE(value, offset); else bytes.writeUInt32LE(value, offset);
      return bytes;
    };
    const duplicateFormat = Buffer.concat([wave(), wave().subarray(12, 36)]);
    duplicateFormat.writeUInt32LE(duplicateFormat.length - 8, 4);
    const duplicateData = Buffer.concat([wave(), wave().subarray(36)]);
    duplicateData.writeUInt32LE(duplicateData.length - 8, 4);
    const fixtures = [Buffer.from("not a WAV"), Buffer.alloc(5242881), wave().subarray(0, 43),
      forged(4, 0), forged(16, 0xffffffff), forged(20, 3, 2), forged(22, 3, 2), forged(24, 96000),
      forged(28, 0), forged(32, 0, 2), forged(34, 24, 2), forged(40, 0), forged(40, 0xffffffff),
      wave({ seconds: 5.01 }), duplicateFormat, duplicateData];
    const files = fixtures.map((bytes, index) => {
      const path = join(dir, `${index}.wav`);
      writeFileSync(path, bytes);
      return path;
    });
    const directory = join(dir, "directory.wav");
    mkdirSync(directory);
    files.push(join(dir, "missing.wav"), directory);
    assert.deepEqual(checkFiles(files), files.map(() => ({ ok: false, size: 0 })));
  } finally { rmSync(dir, { recursive: true }); }
});

test("拒絕祖先 junction，避免連結導向其他位置", { skip: !paths }, () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-notifier-junction-"));
  const target = join(dir, "target");
  const link = join(dir, "link");
  try {
    mkdirSync(target);
    writeFileSync(join(target, "done.wav"), wave());
    symlinkSync(target, link, "junction");
    assert.deepEqual(checkFiles([join(link, "done.wav")]), [{ ok: false, size: 0 }]);
  } finally { rmSync(dir, { recursive: true }); }
});
