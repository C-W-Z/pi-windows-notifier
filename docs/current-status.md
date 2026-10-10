# 目前狀態

最後核對：2026-10-10。程式碼基準：main 的 `753dbda`；這是本次文件建立前的基準，不代表最新 commit 永遠相同。

本文件統一記錄當前能力、驗證範圍與結果、已知限制及待完成驗收，不是逐次工作日誌。架構見 [程式碼架構](architecture.md)。

## 快速摘要

- npm 上目前版本為 **0.3.0**，對應 git tag `v0.3.0`。
- 已具備完整的本機 Windows 通知路徑：五類事件 → 狀態機 → 限流／取消 → PowerShell → Toast／sound。
- 後續重點是補齊實機與端到端驗收；目前沒有已確認的下一個功能實作目標。

## 已實作

| 項目 | 當前行為 |
|---|---|
| 五類通知 | permission、question、completed、aborted、failed |
| 權限整合 | 觀察 pi-permission-system 的 prompt／decision，依 requestId 去重與取消，支援轉送請求 |
| 提問整合 | RPIV／Lean 的 ask_user_question 與 Plan mode 的 plan_mode_question；依 tool 與 UI 等待訊號保守辨識 |
| 回應最終分類 | 等 agent_settled 才通知，避免 retry／續跑中途報完成；無 assistant 的單純中止不通知 |
| 設定 | schema v2、共用 defaults／事件覆寫、舊格式記憶體相容、新舊全域路徑優先順序、無效設定 fail closed |
| 通道與內容 | Toast／sound 獨立開關、自訂靜態文字、系統音效白名單與本機 WAV；completed 預設 Hand |
| 程序與取消 | 單一 helper、有界佇列、等待事件優先、限流、TTL、timeout、reload／shutdown 串行清理 |
| 指令 | status 摘要、status all 明細、reload、test [event]、連續 Tab 與參數前綴補全 |
| 隱私與安全 | 不帶出 session 內容；status／診斷不列自訂文字與路徑；固定 helper、stdin JSON、最小環境與嚴格協定 |
| 發布範圍 | 精確 pack 白名單，不包含 docs、測試或開發設定 |

## 驗證狀態

### 自動驗證

2026-10-10 在 Windows、Node.js `v24.18.0`、npm `11.16.0` 執行：

- npm run verify：TypeScript 檢查通過；**71 個測試通過，0 失敗、0 skipped**。

測試範圍與證據界線：

- 設定：schema v2 合併、舊格式相容、獨立通道、系統音效白名單、本機 WAV 路徑、文字上限與 Unicode／XML 驗證；status 與錯誤提示不展示設定文字或路徑。
- 事件與排程：權限／提問辨識、最終回應分類、去重取消、限流佇列、launcher 協定與資源清理。多數使用 mock event bus、backend 或假時鐘，不等同真實 Pi 工作流程。
- 補全：連續 Tab、參數前綴與既有 provider 行為。
- Windows helper：實際檢查兩個 PowerShell 腳本的語法、無效輸入、通道全關閉時的有效輸入，以及缺失 WAV 的固定失敗結果；不顯示 Toast 或播放音效。單通道成功／失敗與部分成功由 mock launcher 驗證。
- WAV：自行合成 PCM fixtures，實際呼叫讀取與驗證函式；涵蓋 mono／stereo、8／16 bit、五秒邊界、奇數 chunk padding、Unicode／引號／指令樣式檔名、超大／截斷／偽造格式、重複 chunks、缺失檔案、目錄及祖先 junction。這些測試不執行播放函式。
- 發布：npm pack dry-run 核對精確清單，僅包含 package metadata、runtime TS、PowerShell helpers、雙語 README 與授權文件。

一般測試不顯示 Toast 或播放音效；自動測試與 helper 提交成功均不能證明使用者實際看見或聽見。

重現檢查：

```bash
npm ci --ignore-scripts
npm run verify
npm pack --dry-run --ignore-scripts
```

已有依賴時可直接執行 verify 與 pack dry-run。非 Windows 環境會略過 Windows 專用測試；直接呼叫 Node test runner、未透過 npm 時也可能略過 pack test，應檢查 skipped 數量。

### 已記錄的實機結果

以下沿用既有人工驗收紀錄，不是本次重新驗收：

- 0.1.x Windows backend 的五類通知曾逐一送出，人工確認有 Toast 彈窗與提示音。
- 自訂 WAV 播放已有實際可聽驗收；原紀錄未註明驗收版本與環境，不補推。
- 自 0.2.0 記錄為待驗收的 Toast-only、sound-only，目前仍未記錄實際可見／可聽結果。舊版通過不代表目前 helper 或所有 Pi 情境已通過。

本次文件整理未觸發實際通知、播放音效或執行新的端到端驗收。

## 待完成驗收

以下是驗收待辦，不是已確認 bug，也不是已授權的外部操作：

- [ ] 確認目前 helper 的 Toast-only 與 sound-only 實際可見／可聽結果。
- [ ] 確認 WAV 缺失時，已啟用的 Toast 仍實際送出；目前 mock／安全 helper 測試不能替代此驗收。
- [ ] 確認 WAV 播放期間 reload／shutdown 的取消與程序清理。
- [ ] 在真實 pi-permission-system 工作流程驗證 ask 與 subagent 轉送請求。
- [ ] 在 RPIV Lean／Plan mode 驗證結構化問題、去重與第三方 terminal bell。
- [ ] 在真實 Pi 驗證正常完成、中止、錯誤、自動 retry／續跑的最終通知分類。
- [ ] 確認 Windows 勿擾、停用通知、靜音與音效方案下的行為。
- [ ] 確認不同 extension 載入順序與 reload 後的實際程序生命週期。

實機測試會產生通知與聲音，執行前須取得使用者確認；驗收後更新本文件，記錄版本、環境、情境與結果。

## 已知限制與刻意不支援

- 僅 Windows 10／11、64-bit Node.js ≥22.19、Pi ≥1.1.0、Windows PowerShell 5.1 與互動式 TUI；RPC、print、JSON、其他 OS 與 32-bit 不啟用通知。
- UI 事件無工具來源，提問辨識無法涵蓋所有並行／重疊視窗；模糊時略過。一般文字問句與手動設定 UI 不視為提問。
- Windows API 接受不保證使用者看見／聽見；Toast 來源可能顯示 PowerShell，已送出的 Toast 無法收回。
- 設定只讀全域檔案，不自動建立／搬移／寫回；沒有文字模板、整體語言切換或 session 內容通知。
- WAV 限本機固定磁碟與短 PCM 格式；不支援 MP3、網路來源、reparse point、外部播放器、個別音量、loop 或 fallback。
- 程序隔離與路徑驗證有明確信任前提，不是惡意 extension 或已入侵帳號的 sandbox。

## 後續任務定位與維護

建議先讀本文件，再讀架構，按下列索引核對相關實作，不必每次通讀全部程式碼：

- 事件辨識／去重／結果分類：state 及 state tests，再看 runtime 接線。
- 設定／預設音效／相容性：config、types 與 config tests；同步核對雙語 README 範例。
- status／指令／補全：runtime、completion 與對應 tests。
- 排程／取消／程序安全：scheduler、launcher 與對應 tests；涉及實際 API 時再看 PowerShell helpers。
- WAV：windows-sound、types、helper／windows-sound tests。
- 發布：package.json、pack test 與本文件的驗證狀態；不要因新增維護文件而擴大 npm 發布清單。

功能、限制、驗證範圍或結果改變時更新本文件；模組責任、資料流或安全邊界改變時更新 architecture.md。文件與實作不一致時以程式碼與實際驗證為準，並修正文件。避免複製大段實作或記錄 secrets、私人設定與 session 內容。
