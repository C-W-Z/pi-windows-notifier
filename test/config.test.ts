import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults, parseConfig, loadConfig, CONFIG_LIMIT } from "../src/config.ts";

test("預設與部分設定合併，不共用可變物件", () => {
  const result = parseConfig({ events: { question: { sound: false } } });
  assert.equal(result.ok, true);
  assert.equal(result.config.events.question.sound, false);
  assert.equal(result.config.events.permission.enabled, true);
  assert.equal(defaults().events.question.sound, true);
});
test("未知欄位與錯型設定 fail closed", () => {
  for (const value of [null, [], true, { enabled: "true" }, { server: "https://example.test" },
    { events: { other: {} } }, { events: { question: null } }, { events: { question: { sound: 1 } } },
    { events: { question: { text: "secret" } } }]) {
    const result = parseConfig(value);
    assert.equal(result.ok, false);
    assert.equal(result.config.enabled, false);
  }
});
test("讀取有界檔案，不存在使用預設，錯誤停用", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-notifier-config-"));
  const path = join(dir, "config.json");
  try {
    assert.equal(loadConfig(path).config.enabled, true);
    writeFileSync(path, "{");
    assert.equal(loadConfig(path).ok, false);
    writeFileSync(path, " ".repeat(CONFIG_LIMIT + 1));
    assert.deepEqual(loadConfig(path).ok, false);
    assert.equal(loadConfig(path).config.enabled, false);
    writeFileSync(path, JSON.stringify({ enabled: false }));
    assert.equal(loadConfig(path).config.enabled, false);
    assert.equal(loadConfig(dir).ok, false);
  } finally { rmSync(dir, { recursive: true }); } // 僅清理此測試自行產生的暫存目錄。
});
