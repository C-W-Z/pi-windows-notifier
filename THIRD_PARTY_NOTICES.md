# Third-party notices

## pi-permission-windows-notifier

- Source: https://github.com/zhangyu-ch/pi-permission-windows-notifier
- Reference commit: `988decb1a28a38a6d5b8aa940ec2ceca22088c54`
- Referenced features: permission events, WinRT DOM text nodes, the fixed PowerShell AppID, system sounds, and silent toast audio.

This package rewrites executable resolution, the stdin protocol, resource limits, cancellation, configuration, and the state machine. The following original MIT notice is retained for reused or adapted portions:

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

## Other references

- [UniPi notify](https://github.com/Neuron-Mr-White/UniPi/tree/main/packages/notify), reference commit `6ac5da3`: consulted for event/backend separation. No code was copied, and neither UniPi core nor node-notifier is included.
- [pi-jingle](https://github.com/Git-Monke/pi-jingle), reference commit `7e265ce`: consulted for the idea of event-specific sounds. Its license was not confirmed during development, so no code or audio assets were copied. Custom WAV support, path validation, bounded PCM parsing, and tests were implemented independently using Windows/.NET APIs.
- Pi, pi-permission-system, RPIV/Lean, and Plan mode APIs and source were consulted to verify integration contracts. Their source code is not bundled in this package.
