# Run with: pwsh -NoProfile -File .\scripts\test-powerpoint-conversion.ps1 -InputPath C:\path\to\slides.pptx
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$InputPath,

  [Parameter(Position = 1)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'PowerPoint conversion smoke tests require Windows.'
}

$resolvedInputPath = (Resolve-Path -LiteralPath $InputPath).Path
if (-not $OutputPath) {
  $OutputPath = Join-Path (Split-Path -Parent $resolvedInputPath) "$([IO.Path]::GetFileNameWithoutExtension($resolvedInputPath)).smoke-test.pdf"
}

$resolvedOutputPath = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $resolvedOutputPath) {
  Remove-Item -LiteralPath $resolvedOutputPath -Force
}

$powerPoint = $null
$presentation = $null
try {
  Write-Host 'Opening PowerPoint...'
  $powerPoint = New-Object -ComObject PowerPoint.Application
  # Some Office builds reject hiding the PowerPoint application window.
  $presentation = $powerPoint.Presentations.Open(
    $resolvedInputPath,
    [Microsoft.Office.Core.MsoTriState]::msoTrue,
    [Microsoft.Office.Core.MsoTriState]::msoFalse,
    [Microsoft.Office.Core.MsoTriState]::msoFalse
  )
  Write-Host 'Saving PDF...'
  $presentation.SaveAs($resolvedOutputPath, 32)
}
catch {
  throw "PowerPoint conversion smoke test failed: $($_.Exception.Message)"
}
finally {
  if ($presentation -ne $null) { $presentation.Close() }
  if ($powerPoint -ne $null) { $powerPoint.Quit() }
}

if (-not (Test-Path -LiteralPath $resolvedOutputPath -PathType Leaf)) {
  throw "PowerPoint did not create the expected PDF: $resolvedOutputPath"
}

$header = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($resolvedOutputPath)[0..4])
if ($header -ne '%PDF-') {
  throw "PowerPoint created an invalid PDF: $resolvedOutputPath"
}

Write-Host "PowerPoint conversion smoke test passed: $resolvedOutputPath"
