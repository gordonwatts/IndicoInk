$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$iconPath = Join-Path $root 'assets\icons\indicoink-light.png'
$outputPath = Join-Path $root 'assets\installer\indicoink-install.gif'

New-Item -ItemType Directory -Force (Split-Path -Parent $outputPath) | Out-Null

$width = 268
$height = 167
$frameCount = 1
$frames = @()
$icon = [System.Drawing.Image]::FromFile($iconPath)

try {
  for ($frameIndex = 0; $frameIndex -lt $frameCount; $frameIndex++) {
    $frame = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($frame)
    try {
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
      $graphics.Clear([System.Drawing.Color]::White)

      $iconBox = New-Object System.Drawing.Rectangle(22, 20, 64, 64)
      $graphics.DrawImage($icon, $iconBox)

      $titleFont = New-Object System.Drawing.Font('Segoe UI Semibold', 22, [System.Drawing.FontStyle]::Bold)
      $bodyFont = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Regular)
      $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(28, 47, 76))
      $mutedBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(91, 106, 127))
      $graphics.DrawString('IndicoInk', $titleFont, $brush, 99, 24)
      $graphics.DrawString('Installing...', $bodyFont, $mutedBrush, 101, 57)

      $track = New-Object System.Drawing.Rectangle(22, 121, 224, 10)
      $trackBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(226, 233, 243))
      $fillBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(31, 124, 236))
      $graphics.FillRectangle($trackBrush, $track)

      $fillWidth = 112
      $graphics.FillRectangle($fillBrush, 22, 121, $fillWidth, 10)

      $titleFont.Dispose()
      $bodyFont.Dispose()
      $brush.Dispose()
      $mutedBrush.Dispose()
      $trackBrush.Dispose()
      $fillBrush.Dispose()
    } finally {
      $graphics.Dispose()
    }
    $frames += $frame
  }

  $frames[0].Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Gif)
} finally {
  foreach ($frame in $frames) {
    $frame.Dispose()
  }
  $icon.Dispose()
}

Write-Output "Created $outputPath"
