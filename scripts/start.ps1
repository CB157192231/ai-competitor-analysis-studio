[CmdletBinding()]
param(
    [int]$Port = 4173,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$nodePath = Join-Path $runtimeRoot 'node\bin\node.exe'
$modulePath = Join-Path $runtimeRoot 'node\node_modules'

if (-not (Test-Path -LiteralPath $nodePath)) {
    throw '未找到 Codex Desktop Node.js 运行时。请先启动/更新 Codex Desktop。'
}
if (-not (Test-Path -LiteralPath (Join-Path $modulePath '@oai\artifact-tool'))) {
    throw '未找到 PPTX 生成运行库 @oai/artifact-tool。请更新 Codex Desktop。'
}
if (-not (Test-Path -LiteralPath (Join-Path $modulePath 'docx'))) {
    throw '未找到 DOCX 生成运行库 docx。请更新 Codex Desktop。'
}

$junctionPath = Join-Path $projectRoot 'node_modules'
if (-not (Test-Path -LiteralPath $junctionPath)) {
    New-Item -ItemType Junction -Path $junctionPath -Target $modulePath | Out-Null
}

$env:PORT = $Port.ToString()
if (-not $NoBrowser) {
    $env:OPEN_BROWSER = '1'
}

Push-Location $projectRoot
try {
    & $nodePath 'server\server.mjs'
}
finally {
    Pop-Location
}
