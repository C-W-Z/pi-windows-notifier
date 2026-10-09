/** TypeScript 與 PowerShell 共用的路徑驗證案例，不使用真實使用者路徑。 */
export const validPaths = [String.raw`C:\Sounds\done.wav`, "D:/音效/完成 😀.WAV",
  String.raw`C:\Sounds\it's $(Write-Output PRIVATE); [done].wav`, "C:/" + "x".repeat(1017) + ".wav"];
export const invalidPaths: unknown[] = [null, 1, "", "done.wav", "./done.wav", "~/done.wav", "%USERPROFILE%/done.wav",
  "C:done.wav", "/done.wav", String.raw`\\server\share\done.wav`, String.raw`\\?\C:\done.wav`,
  String.raw`\\.\pipe\done.wav`, "https://example.test/done.wav", "file:///C:/done.wav",
  "C:/Sounds/done.mp3", "C:/Sounds/done.wav.exe", "C:/Sounds/done.wav:stream.wav", "C:/Sounds/*.wav",
  "C:/Sounds/../done.wav", "C:/Sounds/./done.wav", "C:/Sounds//done.wav", "C:/Sounds /done.wav",
  "C:/Sounds./done.wav", "C:/CON.wav", "C:/con.txt/done.wav", "C:/NUL/done.wav", "C:/COM1.wav", "C:/LPT².wav",
  "C:/bad\n/done.wav", "C:/bad\u0000/done.wav", "C:/bad\ud800/done.wav", "C:/bad\uffff/done.wav",
  "C:/" + "x".repeat(1018) + ".wav"];

/** 測試自行合成的 PCM WAV，不取用上游音效資產。 */
export function wave(options: { seconds?: number; channels?: number; bits?: number; sampleRate?: number } = {}): Buffer {
  const { seconds = 0.01, channels = 1, bits = 8, sampleRate = 8000 } = options;
  const alignment = channels * bits / 8;
  const size = Math.round(sampleRate * seconds) * alignment;
  const bytes = Buffer.alloc(44 + size + size % 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * alignment, 28);
  bytes.writeUInt16LE(alignment, 32);
  bytes.writeUInt16LE(bits, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(size, 40);
  return bytes;
}
