# 驗證紀錄

## 自動檢查

- 本機 Windows、Node.js 24.18.0；開發型別依賴 Pi 1.1.0。
- TypeScript noEmit 與 Node test runner 通過：32 個測試，0 失敗、0 跳過。
- extension 入口可由 Node TypeScript strip-types 匯入；factory 未在此檢查中執行。
- npm pack --dry-run 通過，發布清單為 13 個核准檔案，不產生／發布 tarball。
- Windows PowerShell 語法解析與無效輸入路徑已執行，不呼叫 Toast 或音效。
- mock 接線涵蓋 permission、RPIV／Lean、Plan mode 及完成／中止／失敗。
- 涵蓋去重、取消、不明 UI、重試／續跑、空 run、開關、最小 payload、cwd／PATH 污染防護、佇列／輸出上限、timeout、reload／shutdown 清理。
- 開發依賴使用 npm install --ignore-scripts；當次 npm audit 回報 0 個已知漏洞，不代表完整供應鏈或 OS 安全稽核。
- 發布包只允許 metadata、runtime 原始碼、固定 helper、README、驗證文件及授權，不含 node_modules、測試、設定或上游 checkout。

## 實機驗收狀態

已經使用者明確同意，透過正式 scheduler／backend 依序執行 permission、question、completed、aborted、failed 五種成功路徑。五次皆回傳 submitted／OK；使用者確認五種都有右下角彈窗與提示音。所有自有 child 等待 close 後結束，沒有安裝套件或變更 Windows／Pi 設定。

以下仍未完成實機端到端驗收：

1. 真實互動式 Pi 的 permission ask、RPIV Lean、Plan mode、正常結束、Esc 及模型失敗（目前為 mock 接線驗證）。
2. 第三方 terminal bell 是否造成額外聲響。
3. 勿擾／通知關閉／靜音行為。
4. 不同 extension 載入順序、reload、OS 程序監看及網路活動觀察（資源限制已由自動測試覆蓋）。

mock 通過不能替代以上場景；一般提交成功不代表保證送達。這次可見／可聽 backend 結果由使用者確認，不能推論所有 Windows 環境皆通過。未自動安裝到使用者 Pi、未變更通知設定、未發布 npm 或 push。
