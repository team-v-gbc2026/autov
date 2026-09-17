param([string]$EngineRoot='C:\Program Files\Epic Games\UE_5.8')
$ErrorActionPreference='Stop'
$projectPath=Join-Path $PSScriptRoot 'Demo\AutoVDemo.uproject'
& (Join-Path $EngineRoot 'Engine\Build\BatchFiles\Build.bat') AutoVDemoEditor Win64 Development "-Project=$projectPath" -WaitMutex -NoHotReloadFromIDE
if($LASTEXITCODE -ne 0) { throw "Unreal build failed: $LASTEXITCODE" }
