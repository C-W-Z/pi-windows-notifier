import assert from "node:assert/strict";
import { test } from "node:test";
import { CombinedAutocompleteProvider, Editor, type AutocompleteProvider, type TUI } from "@earendil-works/pi-tui";
import { notifierArgumentCompletions, withNotifierCompletions } from "../src/completion.ts";

const options = () => ({ signal: new AbortController().signal, force: true });
const baseProvider = () => new CombinedAutocompleteProvider([
  { name: "windows-notifier", getArgumentCompletions: notifierArgumentCompletions },
], process.cwd());

function editorHarness(wrap = withNotifierCompletions) {
  const identity = (text: string) => text;
  const editor = new Editor({ requestRender() {} } as unknown as TUI, {
    borderColor: identity,
    selectList: { selectedPrefix: identity, selectedText: identity, description: identity,
      scrollInfo: identity, noMatch: identity },
  });
  editor.setAutocompleteProvider(wrap(baseProvider()));
  let submitted = 0;
  editor.onSubmit = () => { submitted++; };
  return {
    editor,
    submitted: () => submitted,
    // 讓真實 Editor 的非同步補全請求完成，不存取其 private state。
    key: async (key: string) => {
      editor.handleInput(key);
      await new Promise<void>(resolve => setImmediate(resolve));
    },
  };
}

test("實際連續 Tab：指令名稱 → 子指令 → 事件，不需插入空白或觸發通知", async () => {
  const h = editorHarness();
  h.editor.setText("/windows-not");
  await h.key("\t");
  await h.key("\t");
  assert.equal(h.editor.getText(), "/windows-notifier ");
  assert.equal(h.editor.isShowingAutocomplete(), false);
  await h.key("\t");
  assert.equal(h.editor.isShowingAutocomplete(), true);
  await h.key("\x1b[B");
  await h.key("\x1b[B");
  await h.key("\t");
  assert.equal(h.editor.getText(), "/windows-notifier test ");
  await h.key("\t");
  assert.equal(h.editor.isShowingAutocomplete(), true);
  await h.key("\t");
  assert.equal(h.editor.getText(), "/windows-notifier test permission");
  assert.equal(h.submitted(), 0);
});

test("實際連續 Tab：status all 明細，不需手動插入空白", async () => {
  const h = editorHarness();
  h.editor.setText("/windows-notifier st");
  await h.key("\t");
  assert.equal(h.editor.getText(), "/windows-notifier status ");
  await h.key("\t");
  assert.equal(h.editor.getText(), "/windows-notifier status all");
  h.editor.setText("/windows-notifier status a");
  await h.key("\t");
  assert.equal(h.editor.getText(), "/windows-notifier status all");
  assert.equal(h.submitted(), 0);
});

test("選單關閉後 Tab 仍可補前綴，並保留游標後方文字及既有空白", async () => {
  const provider = withNotifierCompletions(baseProvider());
  const line = "  /windows-notifier  test   co 後方文字";
  const cursorCol = line.indexOf(" 後方文字");
  const suggestions = await provider.getSuggestions([line], 0, cursorCol, options());
  assert.deepEqual(suggestions, {
    prefix: " test   co", items: [{ value: " test   completed", label: "completed" }],
  });
  assert.deepEqual(provider.applyCompletion([line], 0, cursorCol, suggestions!.items[0], suggestions!.prefix), {
    lines: ["  /windows-notifier  test   completed 後方文字"], cursorLine: 0,
    cursorCol: "  /windows-notifier  test   completed".length,
  });
  const h = editorHarness();
  h.editor.setText("/windows-notifier te");
  await h.key("\t");
  assert.equal(h.editor.getText(), "/windows-notifier test ");
  await h.key("\t");
  assert.equal(h.editor.isShowingAutocomplete(), true);
  await h.key("\x1b");
  assert.equal(h.editor.isShowingAutocomplete(), false);
  await h.key("\t");
  assert.equal(h.editor.isShowingAutocomplete(), true);
});

test("無效參數與取消的請求不改走檔案補全", async () => {
  const current = baseProvider();
  current.getSuggestions = async () => { assert.fail("不應呼叫檔案補全"); };
  current.shouldTriggerFileCompletion = () => false;
  const provider = withNotifierCompletions(current);
  for (const argument of ["unknown", "status nope", "status d", "status detail", "status detail ", "status all x", "reload x", "test nope", "test completed ", "test completed x"]) {
    const line = "/windows-notifier " + argument;
    assert.equal(provider.shouldTriggerFileCompletion!([line], 0, line.length), true);
    assert.equal(await provider.getSuggestions([line], 0, line.length, options()), null);
  }
  const line = "/windows-notifier test c";
  const controller = new AbortController();
  controller.abort();
  assert.equal(await provider.getSuggestions([line], 0, line.length, { signal: controller.signal, force: true }), null);
});

test("其他指令、檔案、第二行及補全觸發字元維持原 provider 行為", async () => {
  const calls: unknown[][] = [];
  const current: AutocompleteProvider = {
    triggerCharacters: ["#"],
    async getSuggestions(...args) { calls.push(args); return null; },
    applyCompletion(...args) {
      calls.push(args);
      return { lines: args[0], cursorLine: args[1], cursorCol: args[2] };
    },
    shouldTriggerFileCompletion(...args) { calls.push(args); return false; },
  };
  const provider = withNotifierCompletions(current);
  assert.deepEqual(provider.triggerCharacters, ["#"]);
  for (const lines of [["/other test "], ["@src/"], ["/windows-notifier-extra "],
    ["/windows-not"], ["文字 /windows-notifier test "], ["文字", "/windows-notifier test "]]) {
    const row = lines.length - 1;
    const col = lines[row].length;
    const request = options();
    await provider.getSuggestions(lines, row, col, request);
    assert.deepEqual(calls.pop(), [lines, row, col, request]);
    assert.equal(provider.shouldTriggerFileCompletion!(lines, row, col), false);
    assert.deepEqual(calls.pop(), [lines, row, col]);
  }
  const item = { value: "other", label: "other" };
  provider.applyCompletion(["/ot"], 0, 3, item, "/ot");
  assert.deepEqual(calls.pop(), [["/ot"], 0, 3, item, "/ot"]);
});
