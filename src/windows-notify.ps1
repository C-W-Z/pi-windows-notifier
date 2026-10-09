# 固定 helper：只接受已驗證的通道設定與靜態文字，不接受任意命令或音效路徑。
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Write-Result {
  param([string]$Code, [bool]$Toast, [string]$Sound)
  [Console]::Out.WriteLine((@{ code = $Code; toast = $Toast; sound = $Sound } | ConvertTo-Json -Compress))
}
function Assert-Keys {
  param($Value, [string[]]$Keys)
  if ($Value -isnot [pscustomobject]) { throw "INPUT_INVALID" }
  $names = @($Value.PSObject.Properties.Name)
  if ($names.Count -ne $Keys.Count) { throw "INPUT_INVALID" }
  foreach ($name in $names) {
    if ($Keys -cnotcontains $name) { throw "INPUT_INVALID" }
  }
}
function Assert-Text {
  param($Value, [int]$Limit)
  if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt $Limit -or
      $Value -match '[\x00-\x1f\x7f-\x9f\u2028\u2029\ufffe\uffff]') { throw "INPUT_INVALID" }
  # 同時拒絕未配對的 UTF-16 surrogate；合法 emoji 可保留。
  [System.Xml.XmlConvert]::VerifyXmlChars($Value) | Out-Null
}

function Assert-JsonSurrogates {
  param([string]$Value)
  # ConvertFrom-Json 會把未配對的 surrogate 換成 replacement character；先檢查原始 JSON escape。
  foreach ($match in [regex]::Matches($Value, '"(?:[^"\\]|\\.)*"')) {
    $text = $match.Value
    for ($i = 1; $i -lt $text.Length - 1; $i++) {
      if ($text[$i] -cne '\') { continue }
      if ($text[$i + 1] -cne 'u') { $i++; continue }
      $code = [Convert]::ToInt32($text.Substring($i + 2, 4), 16)
      if ($code -ge 0xd800 -and $code -le 0xdbff) {
        if ($i + 12 -gt $text.Length - 1 -or $text.Substring($i + 6, 2) -cne '\u') { throw "INPUT_INVALID" }
        $low = [Convert]::ToInt32($text.Substring($i + 8, 4), 16)
        if ($low -lt 0xdc00 -or $low -gt 0xdfff) { throw "INPUT_INVALID" }
        $i += 11
      } elseif ($code -ge 0xdc00 -and $code -le 0xdfff) {
        throw "INPUT_INVALID"
      } else { $i += 5 }
    }
  }
}

try {
  $buffer = New-Object char[] 4097
  $size = 0
  while ($size -lt $buffer.Length) {
    $count = [Console]::In.Read($buffer, $size, $buffer.Length - $size)
    if ($count -eq 0) { break }
    $size += $count
  }
  if ($size -eq 0 -or $size -gt 4096) { throw "INPUT_INVALID" }
  $json = -join $buffer[0..($size - 1)]
  Assert-JsonSurrogates $json
  $inputData = $json | ConvertFrom-Json
  Assert-Keys $inputData @("kind", "toast", "sound")
  if ($inputData.kind -isnot [string] -or
      @("permission", "question", "completed", "aborted", "failed") -cnotcontains $inputData.kind) { throw "INPUT_INVALID" }
  Assert-Keys $inputData.toast @("enabled", "title", "message")
  if ($inputData.toast.enabled -isnot [bool]) { throw "INPUT_INVALID" }
  Assert-Text $inputData.toast.title 128
  Assert-Text $inputData.toast.message 512
  Assert-Keys $inputData.sound @("enabled", "source")
  if ($inputData.sound.enabled -isnot [bool]) { throw "INPUT_INVALID" }
  Assert-Keys $inputData.sound.source @("type", "name")
  if ($inputData.sound.source.type -cne "system" -or $inputData.sound.source.type -isnot [string] -or
      $inputData.sound.source.name -isnot [string] -or
      @("Asterisk", "Beep", "Exclamation", "Hand", "Question") -cnotcontains $inputData.sound.source.name) { throw "INPUT_INVALID" }
}
catch {
  Write-Result "INPUT_INVALID" $false "failed"
  exit 1
}

$toastOk = $false
$soundStatus = "disabled"
if ($inputData.toast.enabled) {
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
      [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $nodes = $xml.GetElementsByTagName("text")
    $nodes.Item(0).AppendChild($xml.CreateTextNode($inputData.toast.title)) | Out-Null
    $nodes.Item(1).AppendChild($xml.CreateTextNode($inputData.toast.message)) | Out-Null
    $audio = $xml.CreateElement("audio")
    $audio.SetAttribute("silent", "true")
    $xml.DocumentElement.AppendChild($audio) | Out-Null
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Microsoft.Windows.PowerShell")
    $notifier.Show($toast)
    $toastOk = $true
  }
  catch { $toastOk = $false }
}

if ($inputData.sound.enabled) {
  try {
    # 固定 switch 不使用反射、動態 member access 或外部播放器。
    switch -CaseSensitive ($inputData.sound.source.name) {
      "Asterisk" { [System.Media.SystemSounds]::Asterisk.Play() }
      "Beep" { [System.Media.SystemSounds]::Beep.Play() }
      "Exclamation" { [System.Media.SystemSounds]::Exclamation.Play() }
      "Hand" { [System.Media.SystemSounds]::Hand.Play() }
      "Question" { [System.Media.SystemSounds]::Question.Play() }
    }
    $soundStatus = "played"
    # Play 非同步；有界等待不保證聲音實際送達，也不建立其他播放器。
    Start-Sleep -Milliseconds 750
  }
  catch { $soundStatus = "failed" }
}

$toastFailed = $inputData.toast.enabled -and -not $toastOk
$soundFailed = $inputData.sound.enabled -and $soundStatus -eq "failed"
$code = if ($toastFailed) {
  if ($soundFailed) { "BOTH_FAILED" } else { "TOAST_FAILED" }
} else {
  if ($soundFailed) { "SOUND_FAILED" } else { "OK" }
}
Write-Result $code $toastOk $soundStatus
if ($code -eq "OK") { exit 0 } else { exit 1 }
