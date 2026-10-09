# pi-windows-notifier

Pi 的 Windows 本機通知 extension：需要授權、回答結構化問題，或整次模型回應結束時，提交右下角 Toast 並播放系統提示音。

**Windows-only、零額外 runtime dependencies、沒有網路通知。** 只觀察事件，不批准權限、不代答，也不改寫第三方工具。

- GitHub：[C-W-Z/pi-windows-notifier](https://github.com/C-W-Z/pi-windows-notifier)
- npm：[pi-windows-notifier](https://www.npmjs.com/package/pi-windows-notifier)

## 安裝

```bash
pi install npm:pi-windows-notifier
```

需要 Windows 10／11、64 位元 Node.js 22.19+（x64 或 arm64）、Pi 1.1.0+ 與 Windows PowerShell 5.1。僅支援互動式 TUI；RPC、print、JSON、非 Windows 與 32 位元 Node 環境會停用通知。舊版 Pi UI event API 不支援。

卸載：

```bash
pi remove npm:pi-windows-notifier
```

## 提醒事件

| 事件 | Toast 內容 | 提示音 |
|---|---|---|
| 權限詢問 | Pi：需要權限確認 | Exclamation |
| 結構化提問 | Pi：有問題等待回答 | Exclamation |
| 回應完成 | Pi：回應已完成 | Asterisk |
| 回應中止 | Pi：回應已中止 | Exclamation |
| 回應失敗 | Pi：回應失敗 | Exclamation |

- **權限**：監聽 `@gotgenes/pi-permission-system` 的 `permissions:ui_prompt`；自動 allow／deny、session approval 不提醒，支援轉送到父 session 的 subagent 詢問。
- **提問**：支援 `ask_user_question`（包含 RPIV Lean）與 `plan_mode_question`。同一 questionnaire 只提醒一次。
- **回應結束**：僅在 `agent_settled` 提醒。重試／續跑期間不提早通知；重試成功只報完成。單一工具失敗不代表整次模型回應失敗。
- 不辨識普通文字中的問句，也不提醒單純手動設定 UI。不論終端是否在前景都提醒。
- 權限與提問套件是可選整合來源，不是本 package 的 dependencies；沒有安裝它們時，回應結束通知仍可使用。

### 提問辨識邊界

Pi 的 UI 事件不含 toolCallId。只有恰好一個支援的提問工具正在執行，且沒有權限或已知不明 UI 佔用時，才會歸類為提問。歸屬不明時保守略過，並記錄 `UI_AMBIGUOUS`；不攔截第三方 UI。Pi 沒有提供足夠來源資訊以辨識所有並行 UI，因此不保證任意並行情況都能精確分類。

RPIV 的 `rpiv:ask-user:blocked` 是補充訊號，與共通 UI 事件共用去重。提問套件可能自行發出 terminal bell；若聽到額外聲響，請檢查該套件或終端的設定。

## 設定

設定檔位置：`~/.pi/agent/pi-windows-notifier/config.json`。不讀取專案設定，也不會自動建立或修改設定檔。檔案不存在時，所有通知與音效預設開啟：

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

只需提供想覆寫的欄位，例如讓完成通知靜音：

```json
{ "events": { "completed": { "sound": false } } }
```

`enabled` 是總開關；各事件的 `enabled` 控制該類通知，`sound` 控制是否播放提示音。設定會進行 runtime 型別驗證、拒絕未知欄位，大小上限為 16 KiB。讀取或驗證失敗時會停用通知並顯示固定診斷碼，不輸出設定內容。

修改設定後執行 `/windows-notifier reload` 重新載入。

## 指令

```text
/windows-notifier status
/windows-notifier reload
/windows-notifier test [permission|question|completed|aborted|failed]
```

`test` 不指定事件時使用 `completed`。**測試指令會顯示真實彈窗並播放音效**，且遵守設定開關、佇列及限流。`status` 顯示有效設定、backend 狀態、佇列與固定診斷碼，不含工作內容。

## 安全與資源限制

- 通知不含問題原文、命令、路徑、session 名稱、模型回答或錯誤原文；沒有 recap、遙測、外部通知服務或模型可呼叫的通知工具。
- PowerShell 使用啟動環境的 SystemRoot／windir 所解析出的絕對路徑，不從工作目錄或 PATH 搜尋執行檔；拒絕相對、UNC 與 device 路徑。
- 透過 `spawn`、`shell: false` 執行固定 helper。stdin 只有事件類型與音效開關，helper 再次驗證後才使用固定通知文字；不把動態資料拼接成 PowerShell 指令或 XML。
- child 環境採必要 Windows 欄位白名單，不傳遞整份 agent environment 或 API tokens。`-ExecutionPolicy Bypass` 僅套用於該 child，不會取得管理員權限，也不被視為安全邊界。
- 同時最多一個 helper、佇列上限 16、啟動間隔至少一秒、工作等待上限 30 秒；child timeout 為 10 秒，stdout／stderr 各限制 8 KiB。只終止本 extension 持有的 child，不依程序名稱關閉其他程序，也不無限重試。
- 決策、提問結束、新 run、reload、session 重建及 shutdown 會取消對應的待發通知。已顯示的 Toast 不撤回；helper 啟動與 Windows 提交之間仍存在取消競態。
- 不支援背景音樂、自訂音效檔、音量控制、遠端通知、定期催答或 Toast 點擊後的自動操作。

**威脅模型**：防護不可信專案內容與事件資料；假設 Windows 系統目錄、啟動 Pi 的 OS 環境與已安裝 package 可信。不防禦惡意同程序 extension、被竄改的 SystemRoot 或遭入侵的使用者帳號。Pi permission system 不是 extension 的 OS 沙盒。

## Windows 限制與排錯

Toast 使用固定 `Microsoft.Windows.PowerShell` AppID，因此通知來源可能顯示 PowerShell，通知內容會標示 Pi。Toast 本身設為靜音，系統提示音另外播放；不使用 NotifyIcon balloon、Console.Beep 或外部播放器 fallback。

Windows 勿擾、通知設定與系統音效方案有最終控制權。「已提交」不保證使用者一定看到彈窗或聽到聲音。Toast 與音效分別處理；一者失敗時仍會嘗試另一者，並以固定診斷碼回報。

常見診斷碼：

| 診斷碼 | 意義 |
|---|---|
| `CONFIG_INVALID`／`CONFIG_TOO_LARGE`／`CONFIG_READ_FAILED` | 修正全域設定後 reload |
| `ENV_UNSUPPORTED` | 目前不是支援的 Windows 64 位元 TUI 環境 |
| `BACKEND_UNAVAILABLE` | SystemRoot、PowerShell 或 helper 不可用 |
| `UI_AMBIGUOUS`／`TOOLS_LIMIT` | UI 歸屬不明或追蹤上限，保守略過 |
| `QUEUE_DROPPED` | 佇列滿載，通知被丟棄 |
| `HELPER_TIMEOUT`／`OUTPUT_LIMIT`／`LAUNCH_FAILED` | helper 超時、輸出超限或啟動失敗 |
| `TOAST_FAILED`／`SOUND_FAILED`／`BOTH_FAILED` | Windows Toast／音效提交失敗 |
| `INPUT_INVALID`／`INTERNAL_ERROR`／`HELPER_PROTOCOL` | helper 輸入或結果協定不符 |

自動通知錯誤最多每分鐘顯示一次固定 TUI 警告；詳細固定診斷碼可用 `status` 查看，不會顯示 PowerShell 原始錯誤輸出。

## 開發與驗證

```bash
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

測試使用 Node test runner、假時鐘、假 event bus 與 mock launcher。Windows 測試另檢查 PowerShell 語法與無效輸入路徑；一般 `npm test` 不會顯示 Toast 或播放音效。細節與已知限制見[驗證紀錄](docs/verification.md)。

## 授權與來源

MIT。上游來源及授權資訊見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
