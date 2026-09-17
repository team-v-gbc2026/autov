param([Parameter(Mandatory=$true)][string]$BundlesRoot,[string]$EngineRoot='C:\Program Files\Epic Games\UE_5.8')
$ErrorActionPreference='Stop'
$projectPath=Join-Path $PSScriptRoot 'Demo\AutoVDemo.uproject'
$editorPath=Join-Path $EngineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
foreach($case in @(@('fire-projectile','Fire'),@('shield','Shield'))) {
    $manifestPath=Join-Path $BundlesRoot ($case[0]+'\effect.avfx.json')
    if(!(Test-Path -LiteralPath $manifestPath)) { throw "Missing bundle: $manifestPath" }
    & $editorPath $projectPath -run=AutoVImport "-Bundle=$manifestPath" "-Destination=/Game/AutoV/$($case[1])" -unattended -nullrhi -nosplash
    if($LASTEXITCODE -ne 0) { throw "Import failed: $($case[0]) ($LASTEXITCODE)" }
}
