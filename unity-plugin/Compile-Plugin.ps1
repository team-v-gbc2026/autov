param(
    [string]$EditorData = 'C:\Program Files\Unity\Hub\Editor\6000.0.44f1\Editor\Data',
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Fixture
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Fixture -PathType Leaf)) { throw "Fixture not found: $Fixture. Export fire-projectile from AutoV and pass its .avfx path with -Fixture." }
$fixturePath = (Resolve-Path -LiteralPath $Fixture).ProviderPath
$stage = Join-Path $env:TEMP ('autov-unity-compile-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$compiler = Join-Path $EditorData 'MonoBleedingEdge\lib\mono\msbuild\Current\bin\Roslyn\csc.exe'
$mono = Join-Path $EditorData 'MonoBleedingEdge\bin\mono.exe'
$framework = Join-Path $EditorData 'MonoBleedingEdge\lib\mono\4.8-api'
$references = @(Get-ChildItem $framework -Filter '*.dll') + @(Get-ChildItem "$framework\Facades" -Filter '*.dll') + @(Get-ChildItem "$EditorData\Managed\UnityEngine" -Filter 'UnityEngine*.dll')
$testReferences = $references
$references = @(Get-Item "$EditorData\NetStandard\ref\2.1.0\netstandard.dll") + @(Get-ChildItem "$EditorData\NetStandard\compat\2.1.0\shims\netfx" -Filter '*.dll') + @(Get-ChildItem "$EditorData\Managed\UnityEngine" -Filter 'UnityEngine*.dll')
$flags = @('/nologo', '/target:library', '/nostdlib+', '/nowarn:1701') + @($references | ForEach-Object { '/reference:' + $_.FullName })
$runtime = Join-Path $stage 'AutoV.AVFX.dll'
$runtimeArgs = $flags + @("/out:$runtime") + @(Get-ChildItem "$PSScriptRoot\com.autov.avfx\Runtime" -Filter '*.cs' | ForEach-Object FullName)
$runtimeArgs | ForEach-Object { '"' + $_ + '"' } | Set-Content "$stage\runtime.rsp"
& $mono $compiler "@$stage\runtime.rsp"
if ($LASTEXITCODE -ne 0) { throw 'Runtime compile failed' }
$editorRefs = @(Get-ChildItem "$EditorData\Managed" -Filter 'UnityEditor*.dll' | ForEach-Object { '/reference:' + $_.FullName })
$editorArgs = $flags + $editorRefs + @("/reference:$runtime", "/reference:$EditorData\Managed\Newtonsoft.Json.dll", "/out:$stage\AutoV.AVFX.Editor.dll") + @(Get-ChildItem "$PSScriptRoot\com.autov.avfx\Editor" -Filter '*.cs' | ForEach-Object FullName)
$editorArgs | ForEach-Object { '"' + $_ + '"' } | Set-Content "$stage\editor.rsp"
& $mono $compiler "@$stage\editor.rsp"
if ($LASTEXITCODE -ne 0) { throw 'Editor compile failed' }
Write-Output "C# compile passed against installed Unity assemblies: $stage"
$references = $testReferences
$testArgs = @('/nologo', '/target:exe', '/nostdlib+') + @($references | ForEach-Object { '/reference:' + $_.FullName }) + @("/reference:$EditorData\Managed\Newtonsoft.Json.dll", "/out:$stage\BundleTests.exe", "$PSScriptRoot\com.autov.avfx\Editor\AvfxBundle.cs", "$PSScriptRoot\tests\BundleTests.cs")
$testArgs | ForEach-Object { '"' + $_ + '"' } | Set-Content "$stage\tests.rsp"
& $mono $compiler "@$stage\tests.rsp"
if ($LASTEXITCODE -ne 0) { throw 'Bundle tests compile failed' }
Copy-Item "$EditorData\Managed\Newtonsoft.Json.dll" $stage
& $mono "$stage\BundleTests.exe" $fixturePath
if ($LASTEXITCODE -ne 0) { throw 'Bundle tests failed' }
