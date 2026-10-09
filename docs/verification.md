# 驗證與已知限制

## 自動驗證

- TypeScript `tsc --noEmit` 與 Node test runner 通過；測試覆蓋設定驗證、權限與提問事件、回應狀態、去重取消、限流佇列、PowerShell launcher、資源清理與發布檔案清單。
- 設定測試涵蓋 schema v2 合併、舊格式相容、獨立通道、系統音效白名單、本機 WAV 路徑、自訂文字上限與 Unicode／XML 驗證；status 與錯誤提示不展示設定文字或檔案路徑。
- Windows 測試檢查兩個固定 PowerShell 腳本的語法、無效輸入，以及通道全關閉時的有效輸入；不呼叫 Toast 或音效 API。單通道成功／失敗結果由 mock launcher 驗證。
- WAV 測試使用自行合成的 PCM 資料，實際呼叫 helper 的讀取與驗證函式：mono／stereo、8／16 bit、五秒邊界、奇數 chunk padding、Unicode／引號／指令樣式檔名、超大／截斷／偽造格式、重複 chunks、缺失檔案、目錄與祖先 junction。這些測試不執行播放函式。
- 發布包以 npm pack dry-run 核對；僅包含套件 metadata、runtime 原始碼、PowerShell helper、文件及授權。

執行完整檢查：

```bash
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

## 實機驗證範圍

0.1.x Windows backend 的五類通知（permission、question、completed、aborted、failed）曾逐一送出，並經人工確認有 Toast 彈窗與提示音。

0.2.0 的自訂標題／訊息、Toast-only、sound-only 與新增系統音效選擇尚未完成實際可見／可聽驗收；不以舊版結果推論新 helper 已通過。

新增的自訂 WAV 播放尚未完成實際可聽驗收。手動驗收時，請在全域 config 的 `events.completed.sound.source` 設定 `{ "type": "file", "path": "C:/Sounds/done.wav" }`，使用符合限制的可信任檔案，reload 後執行 `/windows-notifier test completed`。另需確認 sound-only、檔案缺失時 Toast 仍送出，以及播放中 reload／shutdown 的取消行為。這些指令會產生實際通知與聲音。

這項 backend 驗證不等於所有 Pi 整合情境均已端到端驗收。以下項目仍需在實際使用環境確認：

- `pi-permission-system` 的 ask／轉送權限請求。
- RPIV Lean 與 Plan mode 的結構化問題，以及第三方 terminal bell 是否造成額外聲響。
- Pi 正常結束、中止、錯誤及自動重試／續跑時的通知分類。
- Windows 勿擾、通知停用、靜音設定下的行為。
- 不同 extension 載入順序及 reload 後的實際程序生命週期。

自動測試使用 mock event bus 與 mock launcher，不能替代上述真實 Pi 工作流程。Windows 可能抑制通知或音效；helper 回報提交成功不保證使用者一定看見或聽見。
