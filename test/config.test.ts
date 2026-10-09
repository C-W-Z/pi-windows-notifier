import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults, parseConfig, loadConfig, CONFIG_LIMIT } from "../src/config.ts";

test("預設與部分設定合併，不共用可變物件", () => {
  const result = parseConfig({ events: { question: { sound: false } } });
  assert.equal(result.ok, true);
  assert.equal(result.config.events.question.sound.enabled, false);
  assert.equal(result.config.events.permission.enabled, true);
  assert.equal(defaults().events.question.sound.enabled, true);
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
test("schema v2 內建預設、共用 defaults、事件覆寫依序合併", () => {
  const input = { schemaVersion: 2, defaults: { toast: { enabled: false, title: "共用標題" },
    sound: { source: { type: "system", name: "Beep" } } },
    events: { completed: { toast: { enabled: true, message: "完成了" },
      sound: { enabled: false, source: { type: "system", name: "Question" } } } } };
  const result = parseConfig(input);
  assert.equal(result.ok, true);
  assert.equal(result.config.events.permission.toast.enabled, false);
  assert.equal(result.config.events.permission.toast.title, "共用標題");
  assert.equal(result.config.events.permission.toast.message, "需要權限確認");
  assert.equal(result.config.events.completed.toast.enabled, true);
  assert.equal(result.config.events.completed.toast.title, "共用標題");
  assert.equal(result.config.events.completed.toast.message, "完成了");
  assert.equal(result.config.events.completed.sound.enabled, false);
  assert.equal(result.config.events.completed.sound.source.name, "Question");
  result.config.events.permission.sound.source.name = "Hand";
  assert.equal(result.config.events.question.sound.source.name, "Beep");
  assert.equal(input.defaults.sound.source.name, "Beep");
  assert.equal(defaults().events.completed.sound.source.name, "Asterisk");
});
test("舊格式只在記憶體轉換，不改變 event enabled 與 sound boolean 的原意", () => {
  const old = { enabled: false, events: { question: { enabled: false, sound: false }, completed: { sound: false } } };
  const before = JSON.stringify(old);
  const result = parseConfig(old);
  assert.equal(result.ok, true);
  assert.equal(result.config.schemaVersion, 2);
  assert.equal(result.config.enabled, false);
  assert.equal(result.config.events.question.enabled, false);
  assert.equal(result.config.events.question.toast.enabled, true);
  assert.equal(result.config.events.question.sound.enabled, false);
  assert.equal(JSON.stringify(old), before);
});
test("v2 拒絕混合格式、未知版本／欄位、不完整來源與檔案音效", () => {
  for (const value of [
    { schemaVersion: 1 }, { schemaVersion: "2" }, { defaults: {} },
    { schemaVersion: 2, defaults: { enabled: true } },
    { schemaVersion: 2, events: { completed: { sound: false } } },
    { schemaVersion: 2, defaults: { toast: { path: "SECRET" } } },
    { schemaVersion: 2, defaults: { sound: { enabled: "true" } } },
    { schemaVersion: 2, events: { completed: { sound: { source: { type: "file", path: "SECRET.wav" } } } } },
    ...[{ type: "system" }, { name: "Beep" }, { type: "system", name: "beep" },
      { type: "system", name: "Beep", path: "SECRET" }].map(source =>
      ({ schemaVersion: 2, defaults: { sound: { source } } })),
  ]) {
    assert.equal(parseConfig(value).ok, false);
    assert.equal(parseConfig(value).config.enabled, false);
  }
});
test("文字長度與 XML 字元驗證；引號、指令樣式文字與 emoji 都只是文字", () => {
  for (const text of ['<tag> & "quote" $(Get-Process)', "完成 😀"]) {
    const result = parseConfig({ schemaVersion: 2, defaults: { toast: { title: text, message: text } } });
    assert.equal(result.ok, true);
    assert.equal(result.config.events.question.toast.message, text);
  }
  assert.equal(parseConfig({ schemaVersion: 2, defaults: { toast: { title: "x".repeat(128), message: "x".repeat(512) } } }).ok, true);
  for (const toast of [{ title: "" }, { title: " " }, { title: "x".repeat(129) }, { message: "x".repeat(513) },
    { title: null }, { message: "line\nline" }, { message: "\u0000" }, { message: "\ud800" }, { message: "\uffff" }]) {
    assert.equal(parseConfig({ schemaVersion: 2, defaults: { toast } }).ok, false);
  }
});
test("雙語 README 的新舊 JSON 範例皆可解析，且預設範例等同內建行為", () => {
  for (const name of ["README.md", "README.zh-TW.md"]) {
    const document = readFileSync(new URL("../" + name, import.meta.url), "utf8");
    const examples = [...document.matchAll(/```json\n([\s\S]*?)\n```/gu)];
    assert.equal(examples.length, 5);
    for (const [, text] of examples) assert.equal(parseConfig(JSON.parse(text)).ok, true);
    assert.deepEqual(parseConfig(JSON.parse(examples[0][1])).config, defaults());
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
