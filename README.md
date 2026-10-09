# pi-windows-notifier

Pi 的 Windows 本機通知 extension：需要授權、回答結構化問題，或整次模型回應結束時，提交右下角 Toast 並播放系統提示音。

**Windows-only、零額外 runtime dependencies、沒有網路通知。** 只觀察事件，不批准權限、不代答，不改寫第三方工具。

## 環境與安裝

- Windows 10／11、64 位元 Node.js 22.19+（x64 或 arm64）。
- Pi 1.1.0+；開發型別檢查使用 1.1.0。舊版事件 API 不支援，沒有 fallback。
- 僅互動式 TUI。RPC、print、JSON、非 Windows、32 位元 Node 停用通知，載入不拋錯。
- 使用 Windows 內建 Windows PowerShell 5.1；不需要 ffplay、node-notifier 或另外下載 executable。

單次載入，不修改 Pi 設定：

```bash
pi -e D:/Pi/pi-windows-notifier
```

確認後，可自行安裝本地 package：

```bash
pi install D:/Pi/pi-windows-notifier
```

目前只有本地 repository，未發布 npm，也沒有自動安裝到你的 Pi。使用此 package 不需要安裝開發依賴；只有開發與測試才需要 `npm ci --ignore-scripts`。

## 提醒事件

| 事件 | Toast 標題／內容 | 提示音 |
|---|---|---|
| permission | Pi／需要權限確認 | Exclamation |
| question | Pi／有問題等待回答 | Exclamation |
| completed | Pi／回應已完成 | Asterisk |
| aborted | Pi／回應已中止 | Exclamation |
| failed | Pi／回應失敗 | Exclamation |

- **權限**：訂閱 `@gotgenes/pi-permission-system` 的 `permissions:ui_prompt`；自動 allow／deny、session approval 不提醒。支援轉送到父 session 的 subagent 詢問。
- **提問**：支援 `ask_user_question`（包含 RPIV Lean）與 `plan_mode_question`。追蹤工具執行及真正等待 UI 的訊號，一次 questionnaire 只提醒一次，不按題數重複。
- **回應結束**：僅在 `agent_settled` 發送。重試／續跑尚未結束時不報完成或失敗；重試成功只報完成，單一工具失敗不等於模型失敗。
- 不辨識普通文字中的問句，不提醒單純手動設定 UI。不論終端是否在前景都提醒。
- 提問與權限套件是可選整合來源，不是本 package 的 dependencies；沒有安裝時，回應結束通知仍可使用。

### 提問辨識邊界

Pi 的 UI 事件不含 toolCallId。只有恰好一個支援的提問工具正在執行，且沒有權限／已知不明 UI 佔用時才分類；不明時略過並記錄 `UI_AMBIGUOUS`，不攔截第三方 UI。另一個 UI 在提問 call 期間首次開啟時仍可能無法分辨，**不承諾任意並行 UI 的精確歸屬**。

`rpiv:ask-user:blocked` 是補充訊號，與共通 UI 共用去重。第三方套件可能自行發出 terminal bell；那不是本 package 的第二次音效，請使用該套件／終端自身的設定調整。

## 設定

唯一位置：`~/.pi/agent/pi-windows-notifier/config.json`。

不讀專案設定，不建立／自動修改檔案，不移植舊套件設定。沒有檔案時預設全部開啟：

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

可以只提供要修改的欄位，例如完成時靜音：

```json
{ "events": { "completed": { "sound": false } } }
```

總開關 `enabled` 與事件 `enabled` 控制提交；`sound` 只控制 package 音效。runtime 驗證所有欄位，拒絕未知欄位，檔案上限 16 KiB。讀取／解析／驗證失敗時 **fail closed**，停用通知並顯示固定診斷碼，不輸出原始設定。

修改後執行 `/windows-notifier reload`，取消舊工作並重新讀取，不寫設定。

## 指令

```text
/windows-notifier status
/windows-notifier reload
/windows-notifier test
/windows-notifier test permission
/windows-notifier test question
/windows-notifier test completed
/windows-notifier test aborted
/windows-notifier test failed
```

`test` 預設為 completed，**會產生真實彈窗與提示音**，與自動通知共用開關、佇列、限流，不能繞過 disabled。`status` 只顯示有效開關、backend 狀態、佇列／丟棄數與固定診斷碼，不含工作內容。

## 安全與資源限制

- 通知不含問題原文、命令、路徑、session 名稱、模型回答或錯誤原文。沒有 recap、遙測、外部通知服務或模型可呼叫的通知工具。
- SystemRoot／windir 僅來自啟動 OS 環境；拒絕相對、UNC、device 路徑，PowerShell 使用絕對路徑，不搜尋 cwd／PATH。
- `spawn` 不開 shell，使用固定 package cwd／腳本、`-NoProfile`、`-NonInteractive`、`-STA`。child environment 僅允許必要 Windows 路徑欄位，不繼承整份 agent environment 或 API tokens。
- stdin 僅含事件 enum 與音效 boolean；helper 再驗證，從固定字串表生成 DOM text node，不拼接 XML／PowerShell，不使用 Invoke-Expression。
- `-ExecutionPolicy Bypass` 只限該 child；不取得管理員權限、不更改永久設定，也不把 Execution Policy 當安全邊界。
- 最多一個 helper、佇列上限 16、啟動至少間隔一秒、等待上限 30 秒。權限／提問優先；滿載先丟棄最舊回應結束項目，否則丟棄最舊等待項目。
- child timeout 10 秒，stdout／stderr 各最多 8 KiB；只終止自有 child，不按名稱殺程序，不無限重試。若 OS 拒絕終止，等待 close，寧可暫停後續通知，不啟動第二個 helper。
- 決策、問題結束、新 run、reload、session 重建及 shutdown 取消相應舊工作。已展示的 Toast 不撤回；程序啟動與 Windows 提交仍有取消競態。
- 不支援背景音樂、自訂音效／音量、遠端通知、定期催答或點擊 Toast 後的自動操作。

**威脅模型**：防護不可信專案內容與事件資料；假設 Windows 系統目錄、啟動 OS 環境與安裝的 package 可信。不防禦惡意同程序 extension、被竄改的 SystemRoot 或遭入侵帳號。Pi permission system 不是 extension 的 OS 沙盒。

## Windows 限制與排錯

使用固定 `Microsoft.Windows.PowerShell` AppID，不寫 registry 或捷徑，來源可能顯示 **PowerShell**，文字標示 Pi。Toast 音效 silent，SystemSounds 分開播放，避免 backend 自己重複播放；沒有 NotifyIcon balloon、Console.Beep 或外部播放器 fallback。

勿擾、Windows／PowerShell 通知設定、系統音效方案與靜音有最終控制權。**「已提交」不保證看見彈窗或聽到聲音**；played 只表示音效 API 呼叫成功。Toast 失敗仍嘗試音效，部分成功會如實回報。

| 診斷碼 | 意義 |
|---|---|
| CONFIG_INVALID／CONFIG_TOO_LARGE／CONFIG_READ_FAILED | 修正全域設定後 reload |
| ENV_UNSUPPORTED | 目前不是支援的 Windows 64 位元 TUI |
| BACKEND_UNAVAILABLE | SystemRoot／PowerShell／helper 不可用 |
| UI_AMBIGUOUS／TOOLS_LIMIT | 歸屬不明或追蹤上限，保守略過 |
| QUEUE_DROPPED | 滿載丟棄 |
| HELPER_TIMEOUT／OUTPUT_LIMIT／LAUNCH_FAILED | 超時、輸出超限或啟動失敗 |
| TOAST_FAILED／SOUND_FAILED／BOTH_FAILED | Windows 提交／音效失敗 |
| INPUT_INVALID／INTERNAL_ERROR／HELPER_PROTOCOL | helper 協定不符，檢查安裝完整性 |

自動錯誤最多每分鐘一次固定 TUI 警告，累計診斷在 status，不顯示原始 stderr。

## 開發與驗證

```bash
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

Node test runner 搭配假時鐘、假 event bus 與 mock launcher。Windows 額外執行 PowerShell 語法解析及無效輸入路徑，**一般 npm test 不發 Toast、不播放音效**。成功路徑的可見通知驗收另行確認，詳見 [驗證紀錄](docs/verification.md)。

MIT；來源與上游授權見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。上游 checkout 位於 package 外部，不發布；沒有複製 pi-jingle 程式或音效，沒有引入 UniPi core。
