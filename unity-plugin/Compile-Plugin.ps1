param([string]$EditorData = 'C:\Program Files\Unity\Hub\Editor\6000.0.44f1\Editor\Data')
$ErrorActionPreference = 'Stop'
$stage = Join-Path $env:TEMP ('autov-unity-compile-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$compiler = Join-Path $EditorData 'MonoBleedingEdge\lib\mono\msbuild\Current\bin\Roslyn\csc.exe'
$mono = Join-Path $EditorData 'MonoBleedingEdge\bin\mono.exe'
$framework = Join-Path $EditorData 'MonoBleedingEdge\lib\mono\4.8-api'
$references = @(Get-ChildItem $framework -Filter '*.dll') + @(Get-ChildItem "$framework\Facades" -Filter '*.dll') + @(Get-ChildItem "$EditorData\Managed\UnityEngine" -Filter 'UnityEngine*.dll')
$flags = @('/nologo', '/target:library', '/nostdlib+') + @($references | ForEach-Object { '/reference:' + $_.FullName })
$runtime = Join-Path $stage 'AutoV.AVFX.dll'
$runtimeArgs = $flags + @("/out:$runtime") + @(Get-ChildItem "$PSScriptRoot\com.autov.avfx\Runtime" -Filter '*.cs' | ForEach-Object FullName)
$runtimeArgs | ForEach-Object { '"' + $_ + '"' } | Set-Content "$stage\runtime.rsp"
& $mono $compiler "@$stage\runtime.rsp"
if ($LASTEXITCODE -ne 0) { throw 'Runtime compile failed' }
$editorRefs = @(Get-ChildItem "$EditorData\Managed" -Filter 'UnityEditor*.dll' | ForEach-Object { '/reference:' + $_.FullName })
$editorArgs = $flags + $editorRefs + @("/reference:$runtime", "/out:$stage\AutoV.AVFX.Editor.dll") + @(Get-ChildItem "$PSScriptRoot\com.autov.avfx\Editor" -Filter '*.cs' | ForEach-Object FullName)
$editorArgs | ForEach-Object { '"' + $_ + '"' } | Set-Content "$stage\editor.rsp"
& $mono $compiler "@$stage\editor.rsp"
if ($LASTEXITCODE -ne 0) { throw 'Editor compile failed' }
Write-Output "C# compile passed against installed Unity assemblies: $stage"
