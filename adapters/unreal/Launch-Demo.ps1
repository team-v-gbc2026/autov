param([string]$EngineRoot='C:\Program Files\Epic Games\UE_5.8',[string]$CaptureDirectory)
$ErrorActionPreference='Stop'
$projectPath=Join-Path $PSScriptRoot 'Demo\AutoVDemo.uproject'
$editorPath=Join-Path $EngineRoot 'Engine\Binaries\Win64\UnrealEditor.exe'
$launchArgs=@(('"'+$projectPath+'"'),'-game','-windowed','-ResX=1280','-ResY=720','-nosplash')
if($CaptureDirectory) { $launchArgs+=('-AutoVCapture="'+[IO.Path]::GetFullPath($CaptureDirectory)+'"'); $launchArgs+='-unattended' }
Start-Process -FilePath $editorPath -ArgumentList $launchArgs
