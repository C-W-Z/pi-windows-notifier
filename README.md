# pi-windows-notifier

[Pi package page](https://pi.dev/packages/pi-windows-notifier) · [GitHub](https://github.com/C-W-Z/pi-windows-notifier) · [npm](https://www.npmjs.com/package/pi-windows-notifier)

[English](README.md) | [繁體中文](README.zh-TW.md)

**Built for Windows. Zero dependencies. Customizable, security-first notifications and alert sounds for [Pi](https://pi.dev).**

Get a Windows notification when Pi needs your attention—or when it's finished responding. Shows a toast and plays a system sound or your own WAV file for permission requests, structured questions, and completed responses, even while you're looking at another window.

**No need to use in WSL。**

Notifications stay on your machine. They don't pull questions, commands, file paths, or Pi's replies from your session; you can set your own static notification text. The extension doesn't approve permissions or answer questions for you.

Uses Pi-provided APIs, Node.js built-ins, and the built-in Windows notification and sound APIs—no extra notification library or external audio player to install. The design avoids risky patterns present in many other similar plugins. See [Privacy and process safety](#privacy-and-process-safety) for the protections and their limits.

## Preview

![](docs/preview.zh-TW.png)

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
| `completed` | Pi has finished responding | Hand |
| `aborted` | The response was interrupted | Exclamation |
| `failed` | The response ended in an error | Exclamation |

The default toast title is **Pi**, and default messages are in English. You can change the title and message for each event in your config. Command messages are still in Traditional Chinese; there isn't a language switch.

Permission notifications work with [`@gotgenes/pi-permission-system`](https://pi.dev/packages/@gotgenes/pi-permission-system), including requests forwarded from a subagent to its parent session. Requests that are automatically allowed or denied, or covered by an existing session approval, don't trigger a notification.

Question notifications work with [`@juicesharp/rpiv-ask-user-question`](https://pi.dev/packages/@juicesharp/rpiv-ask-user-question) (including [`@ssk_dev/rpiv-ask-user-question-lean`](https://pi.dev/packages/@ssk_dev/rpiv-ask-user-question-lean)) and [`@narumitw/pi-plan-mode`](https://pi.dev/packages/@narumitw/pi-plan-mode). One questionnaire gets one notification, not one per question. Ordinary questions written in a model's reply and manually opened settings dialogs don't count.

Response notifications wait until Pi has actually settled. They don't fire halfway through an automatic retry or continuation, and a failed tool call on its own doesn't count as a failed response.

Permission and question packages are optional. You don't have to install them to get response notifications.

### A note about question detection

Pi's UI events don't say which tool opened a dialog. This extension only classifies a UI wait as a question when exactly one supported question tool is running and no permission prompt or known unrelated UI is occupying the wait. If the signals are ambiguous, it skips the notification and records `UI_AMBIGUOUS` rather than guessing.

This can't reliably identify every possible combination of overlapping dialogs. RPIV's `rpiv:ask-user:blocked` event provides an additional signal and shares the same deduplication logic.

Some question packages also ring the terminal bell themselves. If you hear an extra sound, check that package's settings or your terminal's bell settings.

## Settings

To change the defaults, create `~/.pi/agent/extensions/pi-windows-notifier/config.json`. On Windows, that's `.pi\agent\extensions\pi-windows-notifier\config.json` inside your user home folder. The extension doesn't create or edit this file, and it doesn't read project-level settings.

The new path takes priority. Only when it doesn't exist does the extension read the old `~/.pi/agent/pi-windows-notifier/config.json`; the two files aren't merged. An invalid or unreadable new file disables notifications instead of falling back. To move your settings, place your existing config at the new path and reload. The extension won't move or rewrite either file.

### Complete config

This example includes the system-sound fields and all five events; file sounds are shown separately below. You can copy it as a starting point, but **you only need to keep the fields you want to change**, along with `schemaVersion: 2`. Each event overrides the shared message below, so the example behaves like the built-in defaults.

```json
{
  "schemaVersion": 2,
  "enabled": true,
  "defaults": {
    "toast": {
      "enabled": true,
      "title": "Pi",
      "message": "Pi needs your attention."
    },
    "sound": {
      "enabled": true,
      "source": {
        "type": "system",
        "name": "Exclamation"
      }
    }
  },
  "events": {
    "permission": {
      "enabled": true,
      "toast": { "enabled": true, "title": "Pi", "message": "Permission approval needed" },
      "sound": { "enabled": true, "source": { "type": "system", "name": "Exclamation" } }
    },
    "question": {
      "enabled": true,
      "toast": { "enabled": true, "title": "Pi", "message": "Waiting for your answer" },
      "sound": { "enabled": true, "source": { "type": "system", "name": "Exclamation" } }
    },
    "completed": {
      "enabled": true,
      "toast": { "enabled": true, "title": "Pi", "message": "Response complete" },
      "sound": { "enabled": true, "source": { "type": "system", "name": "Hand" } }
    },
    "aborted": {
      "enabled": true,
      "toast": { "enabled": true, "title": "Pi", "message": "Response interrupted" },
      "sound": { "enabled": true, "source": { "type": "system", "name": "Exclamation" } }
    },
    "failed": {
      "enabled": true,
      "toast": { "enabled": true, "title": "Pi", "message": "Response failed" },
      "sound": { "enabled": true, "source": { "type": "system", "name": "Exclamation" } }
    }
  }
}
```

### Fields and override rules

Settings are applied in this order: **built-in event defaults → shared `defaults` → individual `events.<event>` settings**. Omitted fields inherit the previous layer. For example, `defaults.toast.message` supplies one message for all events unless an event sets its own message; omit it to keep the built-in event-specific messages.

| Field | What it does |
|---|---|
| `schemaVersion` | Set to `2` for this format |
| `enabled` | Master switch; `false` turns all notifications off |
| `defaults` | Shared `toast` and `sound` settings; there is no `defaults.enabled` |
| `events.<event>` | Overrides for `permission`, `question`, `completed`, `aborted`, or `failed` |
| `events.<event>.enabled` | Turns that entire event on or off |
| `toast.enabled` | Turns the toast on or off |
| `toast.title` | Static notification title |
| `toast.message` | Static notification message |
| `sound.enabled` | Turns the sound on or off |
| `sound.source.type` | `"system"` for Windows sound events, or `"file"` for a local WAV |
| `sound.source.name` | Required for `"system"`: `Asterisk`, `Beep`, `Exclamation`, `Hand`, or `Question`; case-sensitive |
| `sound.source.path` | Required for `"file"`: an absolute local WAV path, up to 1024 UTF-16 code units |

The `toast` and `sound` fields can appear under either `defaults` or an individual event. **The complete example explicitly sets every event field, so changing `defaults` alone won't change those overrides.** Remove the corresponding event fields if you want them to inherit shared settings. When setting `sound.source`, include `type` and either `name` (system) or `path` (file), never both; it replaces the source as a whole.

- **Toast only**: set `sound.enabled` to `false` and `toast.enabled` to `true`.
- **Sound only**: set `toast.enabled` to `false` and `sound.enabled` to `true`.
- If both channels are off, no helper starts. Event settings can override shared channel switches, but can't override a disabled master or event switch.

Without a config file, all events and channels are enabled, the title is Pi, and messages are in English. Completion uses Hand; the other events use Exclamation.

### Text and sound limits

Text is used exactly as written—there are no templates or substitutions from your session. Titles can contain up to 128 UTF-16 code units and messages up to 512; an emoji may count as two. Both must be nonblank, single-line strings without control characters or invalid XML characters. Your text appears in Windows notifications, so don't put secrets in it. It isn't shown by `status` or error messages.

Sound names select **Windows system sound events**, not separate audio files bundled with the package. The sound you hear depends on your Windows sound scheme: different events can use the same sound, or have no sound assigned. You can review or change these mappings in the Windows Sound settings; changes also affect other apps using those events. Choosing a file source changes only this extension, not your Windows sound scheme.

### Custom WAV sounds

For example, use your own sound when a response completes:

```json
{
  "schemaVersion": 2,
  "events": {
    "completed": {
      "sound": {
        "source": { "type": "file", "path": "C:/Users/you/Sounds/done.wav" }
      }
    }
  }
}
```

Use the same `sound.source` object under `defaults` to share a file across events, or choose different files for each event. Remove existing event-specific sources if you want them to inherit `defaults`.

> The format, path, size, and duration limits are deliberate safety trade-offs: they keep file access and playback bounded without external codec/player selection or network audio sources. This extension favors short notification sounds over a general-purpose media player.
- Supply an absolute path on a local **fixed drive**, such as `C:/Sounds/done.wav`. Forward slashes work and avoid JSON backslash escaping; with backslashes, write `C:\Sounds\done.wav` as `"C:\\Sounds\\done.wav"` in JSON.
- Relative paths, `~`, environment-variable expansion, URLs, UNC paths, mapped network drives, device paths, alternate data streams, and reparse points (including ancestor junctions/symlinks) are not supported.
- Files must be RIFF PCM WAV: mono or stereo, 8- or 16-bit, 8–48 kHz, at most **5 seconds** and **5 MiB**. MP3, compressed WAV, and WAV extensible are not supported. Renaming an MP3 to `.wav` won't work.
- There is no per-sound volume setting, looping, external player, or bundled audio. Use audio you trust and have permission to use.
- Paths are validated on reload; files are read and checked only when an enabled sound is actually submitted. A missing, unreadable, unsupported, or oversized file returns `SOUND_FAILED`; the toast is still attempted. There is no fallback to a system sound.
- File paths are sent to the fixed helper through stdin, not command arguments, and aren't printed by `status` or error messages.

### Apply changes and older configs

After editing the file, run `/reload` or `/windows-notifier reload`. Unknown fields, unsupported versions or sound sources, invalid values, unreadable files, and files larger than 16 KiB disable notifications until you fix the settings and reload. Error messages won't print the file's contents.

The old unversioned format, with a boolean such as `events.completed.sound: false`, still works and is converted in memory without rewriting your file. New channel objects require `schemaVersion: 2`; don't mix old sound booleans with v2 objects.

## Commands

Run these inside Pi. After `/windows-notifier `, press **Tab** to show `status`, `reload`, or `test`, use **↑/↓** to choose, then press **Tab** to accept. Completing `test` adds a space automatically, so you can keep pressing **Tab** to show and accept an event name without typing a space. Partial prefixes such as `test co` also work.

```text
/windows-notifier status
/windows-notifier reload
/windows-notifier test
/windows-notifier test permission
```

- `status` shows channel switches, sound choices, backend status, queue counters, and diagnostic codes—not your custom text, file paths, or session content.
- `reload` reads the config again and cancels old notification work.
- `test` sends a completion notification by default. You can also choose `permission`, `question`, `completed`, `aborted`, or `failed`.

**Tests produce real notifications and sounds.** They follow the same switches, queue limits, and rate limits as automatic notifications, so they won't override a disabled event.

## FAQ

### Why aren't notifications showing up?

Windows still has the final say. Do Not Disturb, notification settings, your sound scheme, and muted audio can suppress a toast or sound even after the API accepts it.

The sender may appear as **PowerShell** because the extension uses the `Microsoft.Windows.PowerShell` AppID. The toast title defaults to **Pi**, or the title you choose. Toast audio is disabled and the selected sound is played separately to avoid a duplicate sound from this backend. If one fails, the other is still attempted. There is no fallback notification or audio player.

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

## Privacy and process safety

This extension uses Windows' built-in notification and sound APIs through a fixed PowerShell script. You don't need a separate notification server or audio player. There are no network notifications, telemetry, downloads, or bundled sound files.

Several feature restrictions are intentional security decisions, not just platform limitations. The safeguards below address command injection, executable lookup hijacking, accidental credential exposure, network-path access, unbounded process creation, and interference with unrelated applications. They are not a guarantee that the extension is vulnerability-free.

- To reduce executable lookup hijacking, PowerShell is located using an absolute path under the startup environment's `SystemRoot` or `windir`, never the project directory or `PATH`.
- To avoid command/XML injection from config values, the helper runs without a shell. It receives only the event type, validated channel settings (including a local WAV path when configured), and static config text through stdin. Text is inserted using DOM text nodes, not interpolated into PowerShell commands or XML. No session content is passed to it.
- To reduce accidental credential exposure, the child process gets a limited set of Windows environment variables, not Pi's full environment or API tokens. `-ExecutionPolicy Bypass` applies only to that child; it doesn't grant administrator access or change permanent settings. Execution Policy isn't treated as a security boundary.
- WAV files are checked for local-drive paths and reparse points, read into size-limited memory, and validated before playback through `System.Media.SoundPlayer`. Playback stays in the same helper and is covered by its timeout and cancellation. File checks are not a sandbox against an attacker concurrently changing filesystem paths.
- To limit process storms and resource consumption, only one helper runs at a time. The queue holds at most 16 notifications, launches are at least a second apart, queued work expires after 30 seconds, and the helper has a 10-second timeout. stdout and stderr are each capped at 8 KiB. Permission requests and questions take priority over response notifications.
- To avoid terminating unrelated applications, it only attempts to stop its own child process, never every process with the same name. If Windows refuses to stop that process, new helpers wait for it to close instead of piling up.
- Decisions, finished questions, new runs, reloads, session changes, and shutdown cancel the relevant old work. A toast already shown can't be taken back, and cancellation can race with submission to Windows.

These safeguards assume that Windows' system directories, Pi's startup environment, and installed packages are trustworthy. They don't protect against a malicious extension running in the same process or a compromised user account. Pi's permission system doesn't sandbox extensions at the OS level.

## Development

```bash
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

Tests use a fake clock, event bus, and launcher. On Windows, they also check PowerShell syntax, invalid input handling, PCM WAV validation, bounded file reads, and junction rejection. Normal `npm test` runs don't show toasts or play sounds. See the [verification notes (繁體中文)](docs/verification.md) for the test scope and remaining checks.

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream credits and license notices.
