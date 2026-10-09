import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaults, parseConfig, loadConfig, configPath, CONFIG_LIMIT } from "../src/config.ts";

test("預設與部分設定合併，不共用可變物件", () => {
  const result = parseConfig({ events: { question: { sound: false } } });
  assert.equal(result.ok, true);
  assert.equal(result.config.events.question.sound.enabled, false);
  assert.equal(result.config.events.permission.enabled, true);
  assert.equal(defaults().events.question.sound.enabled, true);
});
test("內建、空設定與舊設定的未覆寫訊息均為英文，自訂文字保持不變", () => {
  const expected = {
    permission: "Permission approval needed", question: "Waiting for your answer", completed: "Response complete",
    aborted: "Response interrupted", failed: "Response failed",
  };
  for (const config of [defaults(), parseConfig({}).config, parseConfig({ events: { completed: { sound: false } } }).config,
    parseConfig({ schemaVersion: 2 }).config]) {
    for (const kind of Object.keys(expected) as Array<keyof typeof expected>) {
      assert.equal(config.events[kind].toast.title, "Pi");
      assert.equal(config.events[kind].toast.message, expected[kind]);
    }
  }
  const custom = parseConfig({ schemaVersion: 2, events: { question: { toast: { message: "請回答問題" } } } });
  assert.equal(custom.config.events.question.toast.message, "請回答問題");
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
  assert.equal(result.config.events.permission.toast.message, "Permission approval needed");
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
test("雙語 README 的完整設定涵蓋所有欄位與五種事件，且等同內建行為", () => {
  for (const name of ["README.md", "README.zh-TW.md"]) {
    const document = readFileSync(new URL("../" + name, import.meta.url), "utf8");
    const examples = [...document.matchAll(/```json\n([\s\S]*?)\n```/gu)];
    assert.equal(examples.length, 1);
    const input = JSON.parse(examples[0][1]);
    assert.equal(input.schemaVersion, 2);
    assert.equal(input.enabled, true);
    const assertChannels = (value: typeof input.defaults) => {
      assert.deepEqual(Object.keys(value.toast).sort(), ["enabled", "message", "title"]);
      assert.deepEqual(Object.keys(value.sound).sort(), ["enabled", "source"]);
      assert.deepEqual(Object.keys(value.sound.source).sort(), ["name", "type"]);
    };
    assertChannels(input.defaults);
    assert.deepEqual(Object.keys(input.events).sort(), Object.keys(defaults().events).sort());
    for (const event of Object.values(input.events) as Array<typeof input.defaults>) {
      assert.equal(event.enabled, true);
      assertChannels(event);
    }
    const result = parseConfig(input);
    assert.equal(result.ok, true);
    assert.deepEqual(result.config, defaults());
  }
});
test("預設設定路徑位於全域 extensions 的套件目錄", () => {
  assert.equal(configPath(), join(homedir(), ".pi", "agent", "extensions", "pi-windows-notifier", "config.json"));
});
test("新位置優先且不合併舊設定；不存在才相容舊位置，不建立或改寫檔案", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-notifier-paths-"));
  const primary = join(dir, "new.json");
  const legacy = join(dir, "old.json");
  try {
    assert.deepEqual(loadConfig(primary, legacy), { ok: true, config: defaults() });
    for (const text of [
      JSON.stringify({ enabled: false, events: { completed: { sound: false } } }),
      JSON.stringify({ schemaVersion: 2, defaults: { toast: { title: "舊位置" } } }),
    ]) {
      writeFileSync(legacy, text);
      assert.deepEqual(loadConfig(primary, legacy), parseConfig(JSON.parse(text)));
      assert.equal(readFileSync(legacy, "utf8"), text);
      assert.equal(existsSync(primary), false);
    }
    writeFileSync(primary, JSON.stringify({ schemaVersion: 2, enabled: false }));
    assert.equal(loadConfig(primary, legacy).config.enabled, false);
    assert.equal(loadConfig(primary, legacy).config.events.completed.toast.title, "Pi");
    // 新檔即使沒有覆寫欄位，也不從舊檔合併。
    writeFileSync(primary, "{}");
    assert.deepEqual(loadConfig(primary, legacy), { ok: true, config: defaults() });
    assert.equal(readFileSync(primary, "utf8"), "{}");
    assert.equal(readFileSync(legacy, "utf8"), JSON.stringify({ schemaVersion: 2, defaults: { toast: { title: "舊位置" } } }));
  } finally { rmSync(dir, { recursive: true }); } // 僅清理此測試自行產生的暫存目錄。
});
test("新位置有錯誤不改讀舊檔；舊位置有錯誤同樣停用通知", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-notifier-path-errors-"));
  const primary = join(dir, "new.json");
  const legacy = join(dir, "old.json");
  try {
    writeFileSync(legacy, "{}");
    for (const [text, code] of [
      ["{", "CONFIG_INVALID"],
      [JSON.stringify({ schemaVersion: 2, unknown: true }), "CONFIG_INVALID"],
      [" ".repeat(CONFIG_LIMIT + 1), "CONFIG_TOO_LARGE"],
    ]) {
      writeFileSync(primary, text);
      const result = loadConfig(primary, legacy);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, code);
      assert.equal(result.config.enabled, false);
    }
    const unreadable = loadConfig(dir, legacy);
    assert.equal(unreadable.ok, false);
    if (!unreadable.ok) assert.equal(unreadable.code, "CONFIG_READ_FAILED");
    assert.equal(unreadable.config.enabled, false);
    writeFileSync(legacy, "{");
    const invalidLegacy = loadConfig(join(dir, "missing.json"), legacy);
    assert.equal(invalidLegacy.ok, false);
    if (!invalidLegacy.ok) assert.equal(invalidLegacy.code, "CONFIG_INVALID");
    assert.equal(invalidLegacy.config.enabled, false);
    assert.equal(readFileSync(legacy, "utf8"), "{");
  } finally { rmSync(dir, { recursive: true }); } // 僅清理此測試自行產生的暫存目錄。
});
test("讀取有界檔案，不存在使用預設，錯誤停用", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-notifier-config-"));
  const path = join(dir, "config.json");
  try {
    assert.equal(loadConfig(path).config.enabled, true);
    assert.equal(loadConfig(path).config.events.completed.toast.message, "Response complete");
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
