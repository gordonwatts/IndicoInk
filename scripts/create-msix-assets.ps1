$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repositoryRoot 'assets/icons/indicoink-light.png'
$outputDirectory = Join-Path $repositoryRoot 'assets/msix'

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "MSIX icon source was not found: $sourcePath"
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)

try {
  foreach ($asset in @(
    @{ Name = 'icon.png'; Size = 256 },
    @{ Name = 'Square44x44Logo.png'; Size = 44 },
    @{ Name = 'Square150x150Logo.png'; Size = 150 }
  )) {
    $bitmap = [System.Drawing.Bitmap]::new($asset.Size, $asset.Size)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($sourceImage, 0, 0, $asset.Size, $asset.Size)
      } finally {
        $graphics.Dispose()
      }
      $outputPath = Join-Path $outputDirectory $asset.Name
      $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output "$outputPath ($($asset.Size)x$($asset.Size))"
    } finally {
      $bitmap.Dispose()
    }
  }
} finally {
  $sourceImage.Dispose()
}
