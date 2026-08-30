[CmdletBinding()]
param(
    [int]$Port = 4173,
    [switch]$NoBrowser
)

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$startScript = Join-Path $root 'scripts\start.ps1'
if (-not (Test-Path -LiteralPath $startScript)) {
    throw "未找到本地工具启动脚本：$startScript"
}
& $startScript -Port $Port -NoBrowser:$NoBrowser
