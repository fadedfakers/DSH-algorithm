<#
  课程环境一键装置 —— 学生端
  ================================================================
  你在公开仓里，这个脚本把剩下的事全做完：
    1. 检查 / 安装 DSH
    2. 从本仓自带的 tarball 安装「课程问题池」面板插件
    3. 指引你配置自己的 API Key（key 只存你本机，不经过老师）
    4. 启动 dsh web

  用法（在本仓根目录打开 PowerShell）：
      powershell -ExecutionPolicy Bypass -File .\install.ps1

  想先看看会做什么、不实际改动：
      powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun

  关于权限：脚本不下载任何第三方代码，只调用 npm / dsh。
  插件包就是本仓内的 panel/dsh-course-panel-*.tgz，你可以自己解开检查。
#>

[CmdletBinding()]
param(
  [switch]$DryRun,          # 只显示将要执行的操作，不做任何改动
  [string]$Profile = 'web'  # DSH profile 名，默认 web
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say  { param([string]$m) Write-Host $m }
function Ok   { param([string]$m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn { param([string]$m) Write-Host "  [注意] $m" -ForegroundColor Yellow }
function Bad  { param([string]$m) Write-Host "  [失败] $m" -ForegroundColor Red }
function Step { param([string]$m) Write-Host "`n== $m ==" -ForegroundColor Cyan }

function Have { param([string]$cmd) return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Say ""
Say "  深度学习课程 · 环境一键装置"
Say "  ------------------------------------------------------------"
Say "  仓库：$RepoRoot"
if ($DryRun) { Warn "DryRun 模式：只显示操作，不做任何改动" }

# ── 1. Node.js ────────────────────────────────────────────────
Step "1/4  检查 Node.js"
if (Have node) {
  $nodeVer = (& node --version) -replace '^v',''
  $major = [int]($nodeVer -split '\.')[0]
  if ($major -ge 20) { Ok "node v$nodeVer" }
  else {
    Bad "node v$nodeVer 太旧，DSH 需要 >= 20"
    Say "        请到 https://nodejs.org 装 LTS 版后重跑本脚本"
    exit 1
  }
} else {
  Bad "没找到 node"
  Say "        请先安装 Node.js（https://nodejs.org，选 LTS），然后重开终端重跑"
  exit 1
}

# ── 2. DSH ───────────────────────────────────────────────────
Step "2/4  检查 DSH"
$dshCmd = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dshCmd) {
  # 全局装过、但当前 PATH 还没刷新时，也去常见位置找一下，避免重复安装
  $cands = @(
    (Join-Path $env:APPDATA 'npm\dsh.cmd'),
    (Join-Path $env:LOCALAPPDATA 'pnpm\dsh.cmd'),
    (Join-Path $env:ProgramFiles 'nodejs\dsh.cmd')
  )
  foreach ($c in $cands) { if (Test-Path $c) { $dshCmd = [pscustomobject]@{ Source = $c }; break } }
}
if ($dshCmd) {
  Ok "dsh 已安装（$($dshCmd.Source)）"
} else {
  Warn "没找到 dsh，需要安装 @deepseek-ai/dsh"
  if ($DryRun) {
    Say "        [DryRun] 将执行：npm i -g @deepseek-ai/dsh"
  } else {
    Say "        执行：npm i -g @deepseek-ai/dsh"
    & npm i -g '@deepseek-ai/dsh'
    if ($LASTEXITCODE -ne 0) { Bad "安装失败，请把上面的报错发到 issue"; exit 1 }
    # 全局安装后当前会话的 PATH 可能还没刷新
    $env:PATH = "$env:PATH;$env:APPDATA\npm"
    $dshCmd = Get-Command dsh -ErrorAction SilentlyContinue
    if (-not $dshCmd) {
      Warn "dsh 装好了但当前终端还找不到它"
      Say "        请关掉这个窗口、重新打开一个终端，再跑一次本脚本"
      exit 0
    }
    Ok "dsh 安装完成"
  }
}

# ── 3. 面板插件 ───────────────────────────────────────────────
Step "3/4  安装「课程问题池」面板插件"
$panelDir = Join-Path $RepoRoot 'panel'
$tgz = Get-ChildItem $panelDir -Filter 'dsh-course-panel-*.tgz' -ErrorAction SilentlyContinue |
       Sort-Object Name -Descending | Select-Object -First 1
if (-not $tgz) {
  Bad "在 $panelDir 里找不到 dsh-course-panel-*.tgz"
  Say "        这个文件应该随仓库一起 clone 下来。请确认你 clone 完整，或重新 clone。"
  exit 1
}
Ok "插件包：$($tgz.Name)（$([math]::Round($tgz.Length/1KB,1)) KB）"

if ($DryRun) {
  Say "        [DryRun] 将执行：dsh plugin --profile $Profile add `"$($tgz.FullName)`""
} else {
  Say "        执行：dsh plugin --profile $Profile add <tarball>"
  & dsh plugin --profile $Profile add $tgz.FullName
  if ($LASTEXITCODE -ne 0) {
    Bad "插件安装失败"
    Say "        常见原因：pnpm 没装。可先执行：npm i -g pnpm"
    Say "        然后把上面的完整报错发到 issue。"
    exit 1
  }
  Ok "插件已装入 profile「$Profile」"
}

# ── 4. 你自己的 API Key ───────────────────────────────────────
Step "4/4  配置你自己的模型 API Key"
$cred = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'
if (Test-Path $cred) {
  Ok "已找到 $cred"
  Say "        （脚本不读取也不修改它）"
  Say ""
  Say "  直接启动："
  Say "        dsh web"
  Say ""
  Say "  浏览器打开它给出的地址，侧栏底部会出现「课程问题池」图标。"
} else {
  Warn "还没有配置 API Key"
  Say ""
  Say "  面板的 AI 答疑需要你自己的模型账号。请按下面两步做："
  Say ""
  Say "    (1) 先跑一次 dsh，它会引导你配置 provider 与 API Key："
  Say "            dsh"
  Say "        key 会写进 $cred"
  Say ""
  Say "    (2) 配好后再跑："
  Say "            dsh web"
  Say ""
  Warn "你的 Key 只存在你本机，不经过老师的服务器，老师看不到它。"
  Warn "问一次消耗的是你自己账号的额度。"
}

Say ""
Say "  ------------------------------------------------------------"
Say "  接下来怎么用："
Say "    · 顶部「章节」→ 切第一/二/三章"
Say "    · 「课件」→ 框选一块（公式/截图）直接提问"
Say "    · 「教案」→ 拖选一段文字后提问"
Say "    · 「作业批改」→ 左侧点课时 → 上传代码 → 按教案初筛"
Say ""
Say "  提问请走本仓 Issues（模板：课程提问）。细则见 docs/学生端接入.md"
Say ""
if ($DryRun) { Warn "以上是 DryRun，什么都没改。去掉 -DryRun 真正执行。" }
