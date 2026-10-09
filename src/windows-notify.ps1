# 固定 helper：stdin 僅接受事件 enum 與音效開關，不接受任意訊息或命令。
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Write-Result {
  param([string]$Code, [bool]$Toast, [string]$Sound)
  [Console]::Out.WriteLine((@{ code = $Code; toast = $Toast; sound = $Sound } | ConvertTo-Json -Compress))
}

try {
  $buffer = New-Object char[] 513
  $size = 0
  while ($size -lt $buffer.Length) {
    $count = [Console]::In.Read($buffer, $size, $buffer.Length - $size)
    if ($count -eq 0) { break }
    $size += $count
  }
  if ($size -gt 512) { throw "INPUT_INVALID" }
  $inputData = (-join $buffer[0..($size - 1)]) | ConvertFrom-Json
  $names = @($inputData.PSObject.Properties.Name)
  if ($names.Count -ne 2 -or -not ($names -contains "kind") -or -not ($names -contains "sound") -or
      $inputData.kind -isnot [string] -or $inputData.sound -isnot [bool]) { throw "INPUT_INVALID" }
  $messages = @{
    permission = "需要權限確認"
    question = "有問題等待回答"
    completed = "回應已完成"
    aborted = "回應已中止"
    failed = "回應失敗"
  }
  # PowerShell hashtable 預設不區分大小寫，先以 case-sensitive 比較鎖定 enum。
  if (-not (@("permission", "question", "completed", "aborted", "failed") -ccontains $inputData.kind)) {
    throw "INPUT_INVALID"
  }
}
catch {
  Write-Result "INPUT_INVALID" $false "failed"
  exit 1
}

$toastOk = $false
$soundStatus = "disabled"
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $nodes = $xml.GetElementsByTagName("text")
  $nodes.Item(0).AppendChild($xml.CreateTextNode("Pi")) | Out-Null
  $nodes.Item(1).AppendChild($xml.CreateTextNode($messages[$inputData.kind])) | Out-Null
  $audio = $xml.CreateElement("audio")
  $audio.SetAttribute("silent", "true")
  $xml.DocumentElement.AppendChild($audio) | Out-Null
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Microsoft.Windows.PowerShell")
  $notifier.Show($toast)
  $toastOk = $true
}
catch { $toastOk = $false }

if ($inputData.sound) {
  try {
    if ($inputData.kind -ceq "completed") { [System.Media.SystemSounds]::Asterisk.Play() }
    else { [System.Media.SystemSounds]::Exclamation.Play() }
    $soundStatus = "played"
    # Play 非同步；有界等待不保證聲音實際送達，也不建立其他播放器。
    Start-Sleep -Milliseconds 750
  }
  catch { $soundStatus = "failed" }
}

$code = if ($toastOk) {
  if ($soundStatus -eq "failed") { "SOUND_FAILED" } else { "OK" }
} else {
  if ($soundStatus -eq "failed") { "BOTH_FAILED" } else { "TOAST_FAILED" }
}
Write-Result $code $toastOk $soundStatus
if ($code -eq "OK") { exit 0 } else { exit 1 }
