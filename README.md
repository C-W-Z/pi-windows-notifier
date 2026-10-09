# pi-windows-notifier

[English](README.md) | [繁體中文](README.zh-TW.md)

Get a Windows notification when Pi needs your attention—or when it's finished responding. The extension shows a toast and plays a system sound for permission requests, structured questions, and completed, interrupted, or failed responses, even while you're looking at another window.

Notifications stay on your machine and only tell you what happened. They don't include your questions, commands, file paths, or Pi's replies. The extension doesn't approve permissions or answer questions for you.

[GitHub](https://github.com/C-W-Z/pi-windows-notifier) · [npm](https://www.npmjs.com/package/pi-windows-notifier)

## Install

```bash
pi install npm:pi-windows-notifier
```

Start a new Pi session after installing. You don't need a config file to get started—all five notification types and their sounds are enabled by default.

You'll need:

- Windows 10 or 11.
- 64-bit Node.js 22.19 or newer (x64 or arm64).
- Pi 1.1.0 or newer.
- Windows PowerShell 5.1, included with Windows.

The extension only sends notifications in Pi's interactive terminal UI. It stays inactive in RPC, print, and JSON modes, on other operating systems, and with 32-bit Node.js. It doesn't support older Pi versions without the required UI events.

To uninstall:

```bash
pi remove npm:pi-windows-notifier
```

## When it notifies you

| Event | When you get a notification | Windows sound |
|---|---|---|
| `permission` | Pi needs you to review a permission request | Exclamation |
| `question` | A supported question tool is waiting for your answer | Exclamation |
| `completed` | Pi has finished responding | Asterisk |
| `aborted` | The response was interrupted | Exclamation |
| `failed` | The response ended in an error | Exclamation |

The toast title is **Pi**. Notification text and the extension's command messages are currently in Traditional Chinese; there isn't a language setting yet.

Permission notifications work with `@gotgenes/pi-permission-system`, including requests forwarded from a subagent to its parent session. Requests that are automatically allowed or denied, or covered by an existing session approval, don't trigger a notification.

Question notifications work with `ask_user_question` (including RPIV Lean) and `plan_mode_question`. One questionnaire gets one notification, not one per question. Ordinary questions written in a model's reply and manually opened settings dialogs don't count.

Response notifications wait until Pi has actually settled. They don't fire halfway through an automatic retry or continuation, and a failed tool call on its own doesn't count as a failed response.

Permission and question packages are optional. You don't have to install them to get response notifications.

### A note about question detection

Pi's UI events don't say which tool opened a dialog. This extension only classifies a UI wait as a question when exactly one supported question tool is running and no permission prompt or known unrelated UI is occupying the wait. If the signals are ambiguous, it skips the notification and records `UI_AMBIGUOUS` rather than guessing.

This can't reliably identify every possible combination of overlapping dialogs. RPIV's `rpiv:ask-user:blocked` event provides an additional signal and shares the same deduplication logic.

Some question packages also ring the terminal bell themselves. If you hear an extra sound, check that package's settings or your terminal's bell settings.

## Settings

To change the defaults, create `~/.pi/agent/pi-windows-notifier/config.json`. On Windows, that's `.pi\agent\pi-windows-notifier\config.json` inside your user home folder.

The extension doesn't create or edit this file for you, and it doesn't read project-level settings. If the file doesn't exist, it uses these defaults:

```json
{
  "enabled": true,
  "events": {
    "permission": { "enabled": true, "sound": true },
    "question": { "enabled": true, "sound": true },
    "completed": { "enabled": true, "sound": true },
    "aborted": { "enabled": true, "sound": true },
    "failed": { "enabled": true, "sound": true }
  }
}
```

You only need to include the values you want to change. For example, to keep completion toasts but turn off their sound:

```json
{ "events": { "completed": { "sound": false } } }
```

The top-level `enabled` switch controls everything. Each event's `enabled` switch controls both its toast and sound; `sound` only controls its sound.

After editing the file, run `/windows-notifier reload`. Unknown fields, invalid values, unreadable files, and files larger than 16 KiB disable notifications until you fix the settings and reload. Error messages won't print the file's contents.

## Commands

Run these inside Pi:

```text
/windows-notifier status
/windows-notifier reload
/windows-notifier test
/windows-notifier test permission
```

- `status` shows the active settings, backend status, queue counters, and diagnostic codes—not your session content.
- `reload` reads the config again and cancels old notification work.
- `test` sends a completion notification by default. You can also choose `permission`, `question`, `completed`, `aborted`, or `failed`.

**Tests produce real notifications and sounds.** They follow the same switches, queue limits, and rate limits as automatic notifications, so they won't override a disabled event.

## Privacy and process safety

This extension uses Windows' built-in notification and sound APIs through a fixed PowerShell script. You don't need a separate notification server or audio player. There are no network notifications, telemetry, or custom sound files.

- PowerShell is located using an absolute path under the startup environment's `SystemRoot` or `windir`, never the project directory or `PATH`.
- The helper runs without a shell. It receives only an event type and a sound switch, validates both, and builds the toast from fixed strings. It doesn't interpolate your content into PowerShell commands or XML.
- The child process gets a limited set of Windows environment variables, not Pi's full environment or API tokens. `-ExecutionPolicy Bypass` applies only to that child; it doesn't grant administrator access or change permanent settings. Execution Policy isn't treated as a security boundary.
- Only one helper runs at a time. The queue holds at most 16 notifications, launches are at least a second apart, queued work expires after 30 seconds, and the helper has a 10-second timeout. stdout and stderr are each capped at 8 KiB. Permission requests and questions take priority over response notifications.
- It only attempts to stop its own child process, never every process with the same name. If Windows refuses to stop that process, new helpers wait for it to close instead of piling up.
- Decisions, finished questions, new runs, reloads, session changes, and shutdown cancel the relevant old work. A toast already shown can't be taken back, and cancellation can race with submission to Windows.

These safeguards assume that Windows' system directories, Pi's startup environment, and installed packages are trustworthy. They don't protect against a malicious extension running in the same process or a compromised user account. Pi's permission system doesn't sandbox extensions at the OS level.

## If a notification doesn't appear

Windows still has the final say. Do Not Disturb, notification settings, your sound scheme, and muted audio can suppress a toast or sound even after the API accepts it.

The sender may appear as **PowerShell** because the extension uses the `Microsoft.Windows.PowerShell` AppID. The toast itself says **Pi**. Toast audio is disabled and the system sound is played separately to avoid a duplicate sound from this backend. If one fails, the other is still attempted. There is no fallback notification or audio player.

Use `/windows-notifier status` to check these codes:

| Code | What to check |
|---|---|
| `CONFIG_INVALID` / `CONFIG_TOO_LARGE` / `CONFIG_READ_FAILED` | Fix the global config file, then reload |
| `ENV_UNSUPPORTED` | Use a supported Windows 64-bit interactive Pi session |
| `BACKEND_UNAVAILABLE` | Check that the Windows paths, PowerShell, and helper are available |
| `UI_AMBIGUOUS` / `TOOLS_LIMIT` | A UI wait couldn't be identified safely, or tracking hit its limit |
| `QUEUE_DROPPED` | The queue was full and a notification was dropped |
| `HELPER_TIMEOUT` / `OUTPUT_LIMIT` / `LAUNCH_FAILED` | The helper timed out, produced too much output, or couldn't run |
| `TOAST_FAILED` / `SOUND_FAILED` / `BOTH_FAILED` | Windows rejected the toast, sound, or both |
| `INPUT_INVALID` / `INTERNAL_ERROR` / `HELPER_PROTOCOL` | Check the package installation and helper protocol |

Automatic errors show at most one terminal warning per minute. Status uses fixed diagnostic codes rather than raw PowerShell error output.

## Development

```bash
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

Tests use a fake clock, event bus, and launcher. On Windows, they also check PowerShell syntax and invalid input handling. Normal `npm test` runs don't show toasts or play sounds. See the [verification notes (繁體中文)](docs/verification.md) for the test scope and remaining checks.

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream credits and license notices.
