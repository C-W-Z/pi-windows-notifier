# 驗證與已知限制

## 自動驗證

- TypeScript `tsc --noEmit` 與 Node test runner 通過；測試覆蓋設定驗證、權限與提問事件、回應狀態、去重取消、限流佇列、PowerShell launcher、資源清理與發布檔案清單。
- Windows 測試檢查固定 PowerShell helper 語法及無效輸入；不呼叫 Toast 成功路徑，也不播放系統音效。
- 發布包以 npm pack dry-run 核對；僅包含套件 metadata、runtime 原始碼、PowerShell helper、文件及授權。

執行完整檢查：

```bash
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

## 實機驗證範圍

Windows backend 的五類通知（permission、question、completed、aborted、failed）曾逐一送出，並經人工確認有 Toast 彈窗與提示音。

這項 backend 驗證不等於所有 Pi 整合情境均已端到端驗收。以下項目仍需在實際使用環境確認：

- `pi-permission-system` 的 ask／轉送權限請求。
- RPIV Lean 與 Plan mode 的結構化問題，以及第三方 terminal bell 是否造成額外聲響。
- Pi 正常結束、中止、錯誤及自動重試／續跑時的通知分類。
- Windows 勿擾、通知停用、靜音設定下的行為。
- 不同 extension 載入順序及 reload 後的實際程序生命週期。

自動測試使用 mock event bus 與 mock launcher，不能替代上述真實 Pi 工作流程。Windows 可能抑制通知或音效；helper 回報提交成功不保證使用者一定看見或聽見。
