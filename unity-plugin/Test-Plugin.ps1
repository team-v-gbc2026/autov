param(
    [string]$Unity = 'C:\Program Files\Unity\Hub\Editor\6000.0.44f1\Editor\Unity.exe',
    [string]$ReuseProject = '',
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Fixture
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Fixture -PathType Leaf)) { throw "Fixture not found: $Fixture. Export fire-projectile from AutoV and pass its .avfx path with -Fixture." }
$fixturePath = (Resolve-Path -LiteralPath $Fixture).ProviderPath
$stage = Join-Path $env:TEMP ('autov-unity-' + [guid]::NewGuid().ToString('N'))
if ($ReuseProject) {
    $resolved = [IO.Path]::GetFullPath($ReuseProject)
    if ([IO.Path]::GetDirectoryName($resolved) -ne [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') -or !([IO.Path]::GetFileName($resolved).StartsWith('autov-unity-'))) { throw 'Only an autoV temporary test project can be reused' }
    $stage = $resolved
}
New-Item -ItemType Directory -Path "$stage\Assets", "$stage\Packages", "$stage\ProjectSettings" -Force | Out-Null
New-Item -ItemType Directory -Path "$stage\Packages\com.autov.avfx" -Force | Out-Null
Copy-Item -Recurse -Force (Join-Path $PSScriptRoot 'com.autov.avfx\*') "$stage\Packages\com.autov.avfx"
Copy-Item -LiteralPath $fixturePath -Destination "$stage\Assets\fire-projectile.avfx"
'{"dependencies":{}}' | Set-Content -Encoding ASCII "$stage\Packages\manifest.json"
$log = "$stage\unity.log"
Write-Output "Test project: $stage"
$process = Start-Process -FilePath $Unity -ArgumentList @('-batchmode', '-quit', '-projectPath', $stage, '-executeMethod', 'AvfxSmokeTest.Run', '-logFile', $log) -PassThru -Wait
Get-Content $log -Tail 70
if ($process.ExitCode -ne 0 -or !(Select-String -Path $log -Pattern 'AUTOV_SMOKE_PASS' -Quiet)) { throw "Unity smoke check failed. See $log" }
Write-Output 'autoV Unity smoke check passed.'
