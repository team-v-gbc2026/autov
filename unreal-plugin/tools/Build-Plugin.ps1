param(
    [string]$EngineRoot = 'C:\Program Files\Epic Games\UE_5.6',
    [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
$source = Join-Path (Split-Path $PSScriptRoot -Parent) 'AutoVAVFX'
$stage = Join-Path ([IO.Path]::GetTempPath()) ('autov-unreal-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $stage 'AutoVAVFX') -Recurse
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $stage 'Package' }
$uat = Join-Path $EngineRoot 'Engine\Build\BatchFiles\RunUAT.bat'
if (-not (Test-Path $uat)) { throw "Unreal build tool not found: $uat" }
Write-Host "Building in $stage"
& $uat BuildPlugin "-Plugin=$stage\AutoVAVFX\AutoVAVFX.uplugin" "-Package=$OutputDirectory" -TargetPlatforms=Win64 -Rocket
if ($LASTEXITCODE -ne 0) { throw "Unreal plugin build failed with exit code $LASTEXITCODE. Build files retained at $stage" }
Write-Host "Plugin package: $OutputDirectory"
