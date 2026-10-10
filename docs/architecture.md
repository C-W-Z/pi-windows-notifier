# 程式碼架構

這份文件是維護者與 coding agent 的程式碼索引，不取代實作。進度與待辦見 [目前狀態](current-status.md)，使用方式見 [繁體中文 README](../README.zh-TW.md)。

## 系統定位與資料流

這是 Windows 上的 Pi extension，只觀察事件並提醒，不批准權限、不回答問題、不修改 agent 的執行結果。沒有額外 runtime dependencies；使用 Pi API、Node.js built-ins、Windows PowerShell 5.1 與 Windows／.NET API。

```text
package.json 的 pi.extensions
  → src/index.ts（default export）
  → runtime.ts（註冊事件、建立 session、指令與診斷）
      ├─ config.ts → 正規化後的 Config
      ├─ completion.ts → 指令參數補全
      └─ Pi lifecycle／UI／tool 事件、extension event bus
          → state.ts → NotificationJob { key, kind, valid() }
          → scheduler.ts（開關、去重、優先權、限流、取消）
          → launcher.ts（設定快照 → stdin JSON）
          → windows-notify.ps1
              ├─ Windows Toast（DOM text node，關閉內建音效）
              └─ 系統音效／windows-sound.ps1 的本機 WAV
          ← stdout JSON { code, toast, sound } + exit code
          ← Submission／固定診斷碼 → status 或終端提示
```

狀態機只保留識別碼、布林狀態與 outcome，不保留工具 arguments 或訊息內容。通知 payload 僅含事件類型與經驗證的通道設定；自訂固定文字與 WAV 路徑來自全域設定，不從 session 擷取。

## 模組與測試對照

| 模組 | 責任與主要入口 | 相關測試 |
|---|---|---|
| [index.ts](../src/index.ts) | 將 registerNotifier 匯出為 Pi extension factory | runtime |
| [runtime.ts](../src/runtime.ts) | session 生命週期、事件接線、環境資格、status／reload／test、診斷 | [runtime.test.ts](../test/runtime.test.ts) |
| [state.ts](../src/state.ts) | NotificationState：權限／提問去重與取消、邏輯 run 的最終分類 | [state.test.ts](../test/state.test.ts) |
| [config.ts](../src/config.ts) | defaults、parseConfig、loadConfig：嚴格 schema、合併、全域檔案讀取 | [config.test.ts](../test/config.test.ts) |
| [types.ts](../src/types.ts) | 五類事件、設定／payload 型別、文字與音效路徑驗證 | config、launcher |
| [scheduler.ts](../src/scheduler.ts) | NotificationScheduler：有界佇列、執行前再驗證、單一 helper、Submission | [scheduler.test.ts](../test/scheduler.test.ts) |
| [launcher.ts](../src/launcher.ts) | windowsPaths、createWindowsBackend：固定程序啟動、協定驗證、timeout／abort | [launcher.test.ts](../test/launcher.test.ts) |
| [windows-notify.ps1](../src/windows-notify.ps1) | 重驗 stdin、Toast／sound 獨立提交、固定 JSON 結果 | [helper.test.ts](../test/helper.test.ts) |
| [windows-sound.ps1](../src/windows-sound.ps1) | 本機固定磁碟／reparse point 檢查、有界 WAV 讀取、PCM 驗證與播放 | [windows-sound.test.ts](../test/windows-sound.test.ts) |
| [completion.ts](../src/completion.ts) | 子指令／參數補全與 autocomplete provider wrapper，保留其他補全行為 | [completion.test.ts](../test/completion.test.ts)、runtime |

測試輔助：[clock.ts](../test/clock.ts) 提供假時鐘，[sound-fixtures.ts](../test/sound-fixtures.ts) 合成 PCM WAV 與路徑 fixtures；[pack.test.ts](../test/pack.test.ts) 檢查 npm pack 的精確檔案清單。

## 事件接線與分類

| 來源 | 狀態機入口 | 規則 |
|---|---|---|
| permissions:ui_prompt／permissions:decision | permissionPrompt／permissionDecision | 依 requestId 去重；決策後取消。自動批准／拒絕不因 decision 單獨產生通知 |
| tool_execution_start／tool_execution_end | toolStart／toolEnd | 只追蹤 ask_user_question、plan_mode_question；工具結束取消 |
| ui_prompt_start／ui_prompt_end | uiStart／uiEnd | 恰好一個支援工具且無待決權限時才辨識提問；重疊訊號不猜來源 |
| rpiv:ask-user:blocked | rpivBlocked | 為 RPIV 提供額外等待訊號，與 UI 訊號共用去重 |
| agent_start | agentStart | 建立邏輯 run；尚未 settled 的 retry／續跑仍算同一 run |
| message_end | messageEnd | 只記錄 assistant 是否出現與 stopReason，不保留文字 |
| turn_end／agent_before_settle | boundary | 更新 outcome，不在此發送結束通知 |
| agent_settled | settled | 最終分類與單次提交；下一個 run 使舊通知失效 |

最終分類：有 assistant 訊息且中止時為 aborted；否則 error outcome 為 failed；其餘有 assistant 訊息者為 completed。沒有 assistant 且沒有 error 的空 run（包括直接 Esc 中止）不通知。單一 toolResult 的錯誤不直接分類成整次回應失敗。

提問每個 toolCallId 最多提醒一次，不按題數或 UI 步數重複提醒。UI 事件缺少工具來源，無法涵蓋所有並行視窗；模糊時略過並記錄 UI_AMBIGUOUS。

## Session 與取消生命週期

- factory 只註冊 API 並捕捉必要 OS 環境，不啟動 helper、timer 或 event bus 訂閱。
- session_start 安裝 TUI 補全 wrapper，並建立設定、backend、scheduler、state；Windows x64／arm64 且 `mode === "tui"`、hasUI 才啟用通知。
- start、設定 reload、shutdown 透過同一條 Promise chain 串行，先清掉舊 session，再建立新的 session。
- 清理時先標記 disposed、取消 event bus 訂閱、reset state，再 close scheduler；等待自建 child 的 close，不提前釋放單一 helper 配額。
- /windows-notifier reload 重建通知 session，不重複安裝補全 wrapper。/reload 則由 Pi 重載 extension runtime。
- 權限決策、UI／工具等待結束、新 run、reload、session 切換或 shutdown 都可能取消工作。已提交的 Toast 無法收回，取消與 Windows 提交仍可能有競態。

## 設定與提交契約

- 全域新位置：`~/.pi/agent/extensions/pi-windows-notifier/config.json`；僅新檔不存在時才讀舊位置 `~/.pi/agent/pi-windows-notifier/config.json`。不合併兩份檔案、不讀專案設定、不寫回設定。
- 設定檔上限 16 KiB；未知欄位、錯型、未知版本或讀取失敗採 fail closed，停用通知。無檔案時使用內建預設。
- schema v2 依序合併「內建事件預設 → defaults → events」；sound.source 整組取代，不逐欄混合來源。舊版未帶 schemaVersion 的 boolean sound 格式只在記憶體轉換。
- 總開關、事件開關與至少一個通道開關都需成立。預設五事件皆開、Toast 與 sound 皆開；completed 用 Hand，其餘用 Exclamation。
- state 產生 NotificationJob，scheduler 保存 key、kind、valid callback，不保存 session 內容；提交與出佇列時檢查有效性及設定，launch 時取通道快照。
- helper 結果與 exit code 必須一致；Toast 和 sound 分別回報。scheduler 將結果轉為 submitted／partial／failed 等固定狀態，不自動重試。
- status 是安全摘要，status all 才提供事件明細；不顯示自訂文字或 WAV 路徑。診斷集合最多 32 種，終端警告最多每分鐘一次。

## 資源上限與安全邊界

| 限制 | 實作位置／意義 |
|---|---|
| 權限去重與待決集合各最多 256 筆；提問工具最多 32 個 | state；避免無界事件追蹤 |
| 等待佇列最多 16 筆；啟動間隔至少 1 秒；等待 30 秒過期 | scheduler；permission／question 優先，滿載先丟非等待類通知 |
| 同時最多一個 helper；timeout 10 秒；stdout／stderr 各最多 8 KiB | launcher；只終止自建 child，不搜尋同名程序 |
| 標題 128、訊息 512、WAV 路徑 1024 UTF-16 code units | types 與 helper 重驗；靜態單行文字，不做模板展開 |
| helper stdin 最多 4096 字元 | windows-notify；完整驗證後才提交任何通道 |
| WAV 最多 5 MiB、5 秒、mono／stereo、8／16 bit、8–48 kHz RIFF PCM | windows-sound；先有界讀入記憶體，再同步播放 |

PowerShell 取自啟動環境的 SystemRoot／windir 絕對路徑，不用 PATH；固定 -File、shell: false、固定工作目錄、最小環境白名單。文字與音效路徑只經 stdin，Toast 使用 DOM text node，不拼接指令或 XML。Toast 內建音效關閉，另播提示音，兩通道失敗互不阻止。

WAV 只接受本機固定磁碟，拒絕 UNC、device path、alternate data streams 與各層 reparse point；不展開環境變數或家目錄，無外部播放器、網路音訊或 fallback。路徑檢查不是抵抗同時更換路徑的 sandbox；此設計仍信任 OS、啟動環境與已安裝套件，無法隔離同程序惡意 extension。

## 開發與發布形態

- TypeScript ESM，使用 .ts imports；Pi 直接載入來源，不產生 dist。
- npm run check 使用 tsc --noEmit；npm test 使用 Node strip-types 與內建 test runner；npm run verify 串接兩者。
- package.json 的 files 白名單只包含 runtime TS、兩個 PowerShell helper、雙語 README 與授權文件；package.json 由 npm 納入。
- docs、測試與開發設定只留在 repository，不隨 npm 套件發布。更改發布範圍時，須同步核對 pack test。
