param([string]$Unity = 'C:\Program Files\Unity\Hub\Editor\6000.0.44f1\Editor\Unity.exe')
$ErrorActionPreference = 'Stop'
$stage = Join-Path $env:TEMP ('autov-unity-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path "$stage\Assets", "$stage\Packages", "$stage\ProjectSettings" -Force | Out-Null
Copy-Item -Recurse (Join-Path $PSScriptRoot 'com.autov.avfx') "$stage\Packages\com.autov.avfx"
'{"dependencies":{}}' | Set-Content -Encoding UTF8 "$stage\Packages\manifest.json"
$log = "$stage\unity.log"
Write-Output "Test project: $stage"
$process = Start-Process -FilePath $Unity -ArgumentList @('-batchmode', '-quit', '-projectPath', $stage, '-executeMethod', 'AvfxSmokeTest.Run', '-logFile', $log) -PassThru -Wait
Get-Content $log -Tail 70
if ($process.ExitCode -ne 0 -or !(Select-String -Path $log -Pattern 'AUTOV_SMOKE_PASS' -Quiet)) { throw "Unity smoke check failed. See $log" }
Write-Output 'autoV Unity smoke check passed.'
