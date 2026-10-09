# 本機 WAV 的獨立驗證與有界讀取；不執行路徑，也不使用 URL、COM 或外部播放器。
function Assert-SoundPath {
  param($Value)
  if ($Value -isnot [string] -or $Value.Length -gt 1024 -or
      $Value -notmatch '^[a-zA-Z]:[\\/]' -or $Value -notmatch '(?i)\.wav$' -or
      $Value -match '[\x00-\x1f\x7f-\x9f\u2028\u2029\ufffe\uffff]' -or
      $Value.Substring(2) -match '[<>:"|?*]') { throw "INPUT_INVALID" }
  [System.Xml.XmlConvert]::VerifyXmlChars($Value) | Out-Null
  foreach ($part in ($Value.Substring(3) -split '[\\/]')) {
    if ($part.Length -eq 0 -or $part -match '[. ]$' -or
        $part -match '(?i)^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)') { throw "INPUT_INVALID" }
  }
}

function Assert-Wave {
  param([byte[]]$Bytes)
  # 僅接受 RIFF PCM：mono／stereo、8／16 bit、8–48 kHz，最多五秒。
  if ($Bytes.Length -lt 44 -or $Bytes.Length -gt 5242880 -or
      [Text.Encoding]::ASCII.GetString($Bytes, 0, 4) -cne "RIFF" -or
      [Text.Encoding]::ASCII.GetString($Bytes, 8, 4) -cne "WAVE" -or
      [BitConverter]::ToUInt32($Bytes, 4) -ne $Bytes.Length - 8) { throw "SOUND_FAILED" }
  $offset = 12
  $rate = 0
  $alignment = 0
  $dataSize = 0
  $hasFormat = $false
  $hasData = $false
  while ($offset -lt $Bytes.Length) {
    if ($Bytes.Length - $offset -lt 8) { throw "SOUND_FAILED" }
    $tag = [Text.Encoding]::ASCII.GetString($Bytes, $offset, 4)
    $size = [long][BitConverter]::ToUInt32($Bytes, $offset + 4)
    $start = $offset + 8
    $end = $start + $size + ($size % 2)
    if ($end -gt $Bytes.Length) { throw "SOUND_FAILED" }
    if ($tag -ceq "fmt ") {
      if ($hasFormat -or ($size -ne 16 -and $size -ne 18)) { throw "SOUND_FAILED" }
      if ([BitConverter]::ToUInt16($Bytes, $start) -ne 1 -or
          ($size -eq 18 -and [BitConverter]::ToUInt16($Bytes, $start + 16) -ne 0)) { throw "SOUND_FAILED" }
      $channels = [BitConverter]::ToUInt16($Bytes, $start + 2)
      $sampleRate = [BitConverter]::ToUInt32($Bytes, $start + 4)
      $rate = [BitConverter]::ToUInt32($Bytes, $start + 8)
      $alignment = [BitConverter]::ToUInt16($Bytes, $start + 12)
      $bits = [BitConverter]::ToUInt16($Bytes, $start + 14)
      if (@(1, 2) -notcontains $channels -or @(8, 16) -notcontains $bits -or
          $sampleRate -lt 8000 -or $sampleRate -gt 48000 -or
          $alignment -ne $channels * ($bits / 8) -or $rate -ne $sampleRate * $alignment) { throw "SOUND_FAILED" }
      $hasFormat = $true
    } elseif ($tag -ceq "data") {
      if (-not $hasFormat -or $hasData -or $size -eq 0) { throw "SOUND_FAILED" }
      $dataSize = $size
      $hasData = $true
    }
    $offset = [int]$end
  }
  if (-not $hasFormat -or -not $hasData -or $dataSize % $alignment -ne 0 -or
      $dataSize -gt [long]$rate * 5) { throw "SOUND_FAILED" }
}

function Read-LocalWave {
  param([string]$Path)
  Assert-SoundPath $Path
  # 拒絕網路磁碟及每一層 reparse point，避免一般 junction／symlink 指向遠端。
  $fullPath = [IO.Path]::GetFullPath($Path)
  $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($fullPath))
  if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw "SOUND_FAILED" }
  # 由磁碟根目錄往下檢查，不能先存取可能經由 junction 指向遠端的完整路徑。
  $root = [IO.Path]::GetPathRoot($fullPath)
  $current = $root
  $parts = @("") + ($fullPath.Substring($root.Length) -split '\\')
  foreach ($part in $parts) {
    if ($part.Length -gt 0) { $current = [IO.Path]::Combine($current, $part) }
    $attributes = [IO.File]::GetAttributes($current)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($current -eq $fullPath -and ($attributes -band [IO.FileAttributes]::Directory) -ne 0)) { throw "SOUND_FAILED" }
  }
  $stream = $null
  try {
    # 開啟後不允許其他程序寫入或刪除；只從同一個 handle 讀入有界記憶體。
    $stream = [IO.FileStream]::new($fullPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($stream.Length -lt 44 -or $stream.Length -gt 5242880) { throw "SOUND_FAILED" }
    $bytes = New-Object byte[] ([int]$stream.Length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
      $count = $stream.Read($bytes, $offset, $bytes.Length - $offset)
      if ($count -eq 0) { throw "SOUND_FAILED" }
      $offset += $count
    }
    Assert-Wave $bytes
    # PowerShell 不可逐 byte 展開管線，保持 byte[] 型別。
    return ,$bytes
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
  }
}

function Play-LocalWave {
  param([string]$Path)
  $bytes = Read-LocalWave $Path
  $memory = $null
  $player = $null
  try {
    $memory = [IO.MemoryStream]::new($bytes, $false)
    $player = [System.Media.SoundPlayer]::new($memory)
    $player.Load()
    $player.PlaySync()
  } finally {
    if ($null -ne $player) { $player.Dispose() }
    if ($null -ne $memory) { $memory.Dispose() }
  }
}
