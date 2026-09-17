param(
    [Parameter(Mandatory=$true)][string]$PackageDirectory,
    [Parameter(Mandatory=$true)][string]$Fixture,
    [string]$EngineRoot = 'C:\Program Files\Epic Games\UE_5.6',
    [switch]$WithGPU
)
$ErrorActionPreference = 'Stop'
$stage = Join-Path ([IO.Path]::GetTempPath()) ('autov-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $stage 'Plugins') | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\tests\Smoke.uproject') -Destination $stage
Copy-Item -LiteralPath $PackageDirectory -Destination (Join-Path $stage 'Plugins\AutoVAVFX') -Recurse
$editor = Join-Path $EngineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$arguments = @((Join-Path $stage 'Smoke.uproject'), '-unattended', '-nosplash', '-stdout', '-FullStdOutLogOutput', "-AVFXFixture=$Fixture", '-ExecCmds=Automation RunTests AutoV.AVFX', '-TestExit=Automation Test Queue Empty')
if ($WithGPU) { $arguments += '-RenderOffscreen' } else { $arguments += '-NullRHI' }
Write-Host "Test project: $stage"
& $editor @arguments
if ($LASTEXITCODE -ne 0) { throw "Unreal tests failed with exit code $LASTEXITCODE. Logs retained at $stage\Saved\Logs" }
