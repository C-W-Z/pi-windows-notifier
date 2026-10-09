import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { KINDS } from "./types.ts";

export function notifierArgumentCompletions(prefix: string): AutocompleteItem[] | null {
  const leading = prefix.match(/^\s*/u)![0];
  const argument = prefix.slice(leading.length);
  if (!/\s/u.test(argument)) {
    const matches = ["status", "reload", "test"].filter(value => value.startsWith(argument));
    // status 與 test 還有下一層參數；補上空白，讓下一次 Tab 能直接補全。
    return matches.length ? matches.map(value => ({
      value: leading + value + (value === "test" || value === "status" ? " " : ""), label: value,
    })) : null;
  }
  const match = argument.match(/^(test|status)(\s+)(\S*)$/u);
  if (!match) return null;
  const values = match[1] === "test" ? KINDS : ["all"];
  const matches = values.filter(value => value.startsWith(match[3]));
  // Pi 會替換整段 argument prefix；必須保留子指令與空白。
  return matches.length ? matches.map(value => ({ value: leading + match[1] + match[2] + value, label: value })) : null;
}

/** 只接管本指令的參數，避免選單關閉後的 Tab 改走 Pi 的強制檔案補全。 */
export function withNotifierCompletions(current: AutocompleteProvider): AutocompleteProvider {
  const argumentPrefix = (lines: string[], cursorLine: number, cursorCol: number) =>
    cursorLine === 0 ? (lines[0] ?? "").slice(0, cursorCol).match(/^\s*\/windows-notifier (.*)$/u)?.[1] : undefined;
  return {
    triggerCharacters: current.triggerCharacters,
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const prefix = argumentPrefix(lines, cursorLine, cursorCol);
      if (prefix === undefined) return current.getSuggestions(lines, cursorLine, cursorCol, options);
      if (options.signal.aborted) return null;
      const items = notifierArgumentCompletions(prefix);
      return items ? { items, prefix } : null;
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      if (argumentPrefix(lines, cursorLine, cursorCol) !== undefined) return true;
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}
