[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$nodePath = Join-Path $runtimeRoot 'node\bin\node.exe'
$modulePath = Join-Path $runtimeRoot 'node\node_modules'
$junctionPath = Join-Path $projectRoot 'node_modules'
if (-not (Test-Path -LiteralPath $junctionPath)) {
    New-Item -ItemType Junction -Path $junctionPath -Target $modulePath | Out-Null
}

Push-Location $projectRoot
try {
    & $nodePath --test 'tests\*.test.mjs'
}
finally {
    Pop-Location
}
