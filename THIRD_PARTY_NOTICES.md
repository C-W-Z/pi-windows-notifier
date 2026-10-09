# 上游來源與授權

## pi-permission-windows-notifier

- 來源：https://github.com/zhangyu-ch/pi-permission-windows-notifier
- 參考：988decb1a28a38a6d5b8aa940ec2ceca22088c54
- 範圍：權限事件、WinRT DOM text node、固定 PowerShell AppID、系統音效及 Toast silent。
- 本 package 重寫執行檔定位、stdin 協定、資源限制、取消、設定與狀態機。沿用／改作片段保留以下原始 MIT 授權：

```text
MIT License

Copyright (c) 2026 Yu Zhang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 其他研究參考

- UniPi notify：https://github.com/Neuron-Mr-White/UniPi/tree/main/packages/notify，參考 6ac5da3。只參考事件／backend 分層概念，未複製程式碼或引入 UniPi core／node-notifier。
- pi-jingle：https://github.com/Git-Monke/pi-jingle，參考 7e265ce。只參考事件音效概念，未複製程式碼或音效，因為尚未確認其授權。
- Pi、permission system、RPIV／Lean、Plan mode 的 API／原始碼用於核對整合契約，不把第三方程式碼放入發布包。
