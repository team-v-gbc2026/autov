param([string]$EngineRoot='C:\Program Files\Epic Games\UE_5.8',[string]$OutputDirectory)
$ErrorActionPreference='Stop'
if(!$OutputDirectory) { $OutputDirectory=Join-Path $PSScriptRoot 'Demo\Saved\Packaged' }
$projectPath=Join-Path $PSScriptRoot 'Demo\AutoVDemo.uproject'
& (Join-Path $EngineRoot 'Engine\Build\BatchFiles\RunUAT.bat') BuildCookRun "-project=$projectPath" -noP4 -platform=Win64 -clientconfig=Development -build -cook -stage -pak -archive "-archivedirectory=$OutputDirectory" -unattended -utf8output
if($LASTEXITCODE -ne 0) { throw "Packaging failed: $LASTEXITCODE" }
