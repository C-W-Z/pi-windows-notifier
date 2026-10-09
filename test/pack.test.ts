import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("npm 發布 dry-run 僅包含核准的 runtime、文件與授權", { skip: !process.env.npm_execpath }, () => {
  const result = spawnSync(process.execPath,
    [process.env.npm_execpath!, "pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024 });
  assert.equal(result.status, 0);
  const [pack] = JSON.parse(result.stdout);
  assert.equal(pack.name, "pi-windows-notifier");
  const files = pack.files.map((file: { path: string }) => file.path).sort();
  assert.deepEqual(files, ["LICENSE", "README.md", "README.zh-TW.md", "THIRD_PARTY_NOTICES.md", "docs/verification.md",
    "package.json", "src/completion.ts", "src/config.ts", "src/index.ts", "src/launcher.ts", "src/runtime.ts",
    "src/scheduler.ts", "src/state.ts", "src/types.ts", "src/windows-notify.ps1", "src/windows-sound.ps1"].sort());
});
