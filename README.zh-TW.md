# pi-windows-notifier

[English](README.md) | [繁體中文](README.zh-TW.md)

不用一直盯著 Pi。需要你確認權限、回答問題，或模型回應結束時，這個 extension 會跳出 Windows 通知並播放提示音。就算你正在看別的視窗，也會提醒。

通知只告訴你發生了什麼事，不會帶出問題、命令、檔案路徑或模型回答，也不會替你批准權限或回答問題。所有提醒都在本機處理。

[GitHub](https://github.com/C-W-Z/pi-windows-notifier) · [npm](https://www.npmjs.com/package/pi-windows-notifier)

## 安裝

```bash
pi install npm:pi-windows-notifier
```

安裝後開一個新的 Pi session 就能使用，不用先寫設定檔。五種通知和提示音預設都會開啟。

需要的環境：

- Windows 10 或 11。
- 64 位元 Node.js 22.19 以上，支援 x64 和 arm64。
- Pi 1.1.0 以上。
- Windows 內建的 Windows PowerShell 5.1。

只在 Pi 的互動式終端介面啟用。RPC、print、JSON 模式、其他作業系統和 32 位元 Node.js 都不會發通知。缺少必要 UI 事件的舊版 Pi 不支援。

移除套件：

```bash
pi remove npm:pi-windows-notifier
```

## 什麼時候會提醒？

| 事件 | 通知內容 | Windows 提示音 |
|---|---|---|
| `permission` | 需要權限確認 | Exclamation |
| `question` | 有問題等待回答 | Exclamation |
| `completed` | 回應已完成 | Asterisk |
| `aborted` | 回應已中止 | Exclamation |
| `failed` | 回應失敗 | Exclamation |

彈窗標題是 **Pi**。目前通知文字和指令提示都是繁體中文，還沒有語言切換設定。

**權限提醒**搭配 `@gotgenes/pi-permission-system` 使用，也支援從 subagent 轉送到父 session 的權限請求。自動允許、自動拒絕，或已經有 session approval 的請求不會提醒。

**問題提醒**支援 `ask_user_question`（包含 RPIV Lean）和 `plan_mode_question`。一份問卷只提醒一次，不會每一題都響。模型在一般文字回答裡寫的問句，以及你手動打開的設定介面，不算這裡的提問。

**回應結束提醒**會等 Pi 真正結束這次回應才發送，不會在自動重試或續跑途中提早報完成。單一工具出錯，也不等於整次模型回應失敗。

權限和提問套件都是可選的；沒有安裝它們，仍然可以收到回應結束提醒。

### 提問辨識的限制

Pi 的 UI 事件沒有說明是哪個工具開了視窗。因此，只有恰好一個支援的提問工具正在執行，而且沒有權限提示或已知的其他 UI 佔用時，才會把等待畫面的訊號當成提問。資訊不明確就略過，並記錄 `UI_AMBIGUOUS`，不硬猜來源。

這個做法無法精確辨識所有重疊視窗的情況。RPIV 的 `rpiv:ask-user:blocked` 會提供額外訊號，並和共通 UI 事件一起去重。

有些提問套件本身也會發出 terminal bell。如果聽到額外的聲音，請檢查該套件或終端的提示音設定。

## 設定

想改預設行為時，請自行建立 `~/.pi/agent/pi-windows-notifier/config.json`。在 Windows 上，就是使用者家目錄裡的 `.pi\agent\pi-windows-notifier\config.json`。

套件不會替你建立或修改這個檔案，也不讀專案內的設定。沒有設定檔時，使用以下預設值：

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

只要寫想改的欄位就好。例如保留完成彈窗，但不要播放提示音：

```json
{ "events": { "completed": { "sound": false } } }
```

最外層的 `enabled` 是總開關。每個事件的 `enabled` 控制該類彈窗與音效，`sound` 則只控制音效。

修改後執行 `/windows-notifier reload`。如果有未知欄位、值的型別不對、檔案無法讀取或超過 16 KiB，通知會先停用；修正後再 reload 即可。錯誤提示不會印出設定檔內容。

## 指令

在 Pi 裡執行：

```text
/windows-notifier status
/windows-notifier reload
/windows-notifier test
/windows-notifier test permission
```

- `status`：查看目前設定、backend 狀態、佇列計數和診斷碼，不會顯示 session 內容。
- `reload`：重新讀取設定，取消舊的通知工作。
- `test`：預設測試完成通知，也能指定 `permission`、`question`、`completed`、`aborted` 或 `failed`。

**測試會真的跳通知、播放音效。** 和自動通知一樣，它會遵守開關、佇列與限流，不會強行送出已停用的事件。

## 隱私與程序安全

套件透過固定的 PowerShell 腳本呼叫 Windows 內建通知和音效 API，不用另外裝通知服務或播放器。沒有網路通知、遙測或自訂音效檔。

- PowerShell 使用啟動環境的 `SystemRoot`／`windir` 下的絕對路徑，不從專案目錄或 `PATH` 搜尋。
- helper 不透過 shell 執行，只接收事件類型與音效開關。驗證後使用固定文字建立通知，不把工作內容拼進 PowerShell 命令或 XML。
- 子程序只拿到必要的 Windows 環境變數，不繼承 Pi 的完整環境或 API tokens。`-ExecutionPolicy Bypass` 只作用於該子程序，不會取得管理員權限或改動永久設定，也不把 Execution Policy 當成安全邊界。
- 同時最多一個 helper，佇列最多 16 筆，啟動至少間隔一秒。工作等待超過 30 秒會過期，helper 的 timeout 是 10 秒，stdout 和 stderr 各限制 8 KiB。權限和提問比回應結束通知優先。
- 只嘗試終止自己建立的子程序，不會按名稱關閉其他程序。如果 Windows 不允許終止，就等它結束，不會繼續堆出新的 helper。
- 權限決策、問題結束、新回應、reload、session 切換和 shutdown 都會取消相關舊工作。已經顯示的 Toast 無法收回，取消和提交給 Windows 之間仍可能發生競態。

這些防護假設 Windows 系統目錄、Pi 啟動環境和已安裝套件可信。它們無法防禦同程序裡的惡意 extension，或已遭入侵的使用者帳號。Pi permission system 並不是 extension 的 OS 沙盒。

## 沒看到通知怎麼辦？

Windows 仍然有最終決定權。勿擾模式、通知設定、系統音效方案和靜音，都可能讓已提交的通知沒有彈出或沒有聲音。

因為使用 `Microsoft.Windows.PowerShell` AppID，通知來源可能顯示 **PowerShell**，但彈窗本身會寫 **Pi**。Toast 自帶的音效關閉，提示音另外播放，避免這個 backend 自己重複響兩次。彈窗和音效分開處理，一個失敗仍會嘗試另一個；沒有備用通知方式或播放器。

可以用 `/windows-notifier status` 查看診斷碼：

| 診斷碼 | 意義或處理方式 |
|---|---|
| `CONFIG_INVALID`／`CONFIG_TOO_LARGE`／`CONFIG_READ_FAILED` | 修正全域設定檔後 reload |
| `ENV_UNSUPPORTED` | 請使用支援的 Windows 64 位元 Pi 互動式介面 |
| `BACKEND_UNAVAILABLE` | 檢查 Windows 路徑、PowerShell 和 helper 是否可用 |
| `UI_AMBIGUOUS`／`TOOLS_LIMIT` | 無法安全辨識 UI 來源，或追蹤已達上限 |
| `QUEUE_DROPPED` | 佇列已滿，有通知被丟棄 |
| `HELPER_TIMEOUT`／`OUTPUT_LIMIT`／`LAUNCH_FAILED` | helper 超時、輸出過多或啟動失敗 |
| `TOAST_FAILED`／`SOUND_FAILED`／`BOTH_FAILED` | Windows 彈窗、音效或兩者提交失敗 |
| `INPUT_INVALID`／`INTERNAL_ERROR`／`HELPER_PROTOCOL` | 檢查套件安裝與 helper 協定 |

自動通知錯誤最多每分鐘顯示一次終端警告。診斷只使用固定代碼，不會帶出 PowerShell 原始錯誤內容。

## 開發

```bash
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

測試使用假時鐘、event bus 和 launcher。Windows 上也會檢查 PowerShell 語法與無效輸入。一般 `npm test` 不會跳彈窗或播放音效；測試範圍與仍需確認的項目見[驗證紀錄](docs/verification.md)。

## 授權

MIT。上游來源和授權聲明見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
