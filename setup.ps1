$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

function Stop-Here($code) { Write-Host ""; Read-Host "按回车退出" | Out-Null; exit $code }

Write-Host ""
Write-Host "===== 晚寝签到助手 安装 =====" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path (Join-Path $ROOT 'node.exe'))) {
  Write-Host "[X] 缺少 node.exe" -ForegroundColor Red
  Stop-Here 1
}
Write-Host "[OK] node.exe" -ForegroundColor Green

if (-not (Test-Path (Join-Path $ROOT 'node_modules\playwright-core\package.json'))) {
  Write-Host "[X] 缺少 node_modules\playwright-core" -ForegroundColor Red
  Stop-Here 1
}
Write-Host "[OK] playwright-core" -ForegroundColor Green

$edge = @(
  "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) {
  Write-Host "[X] 没找到 Microsoft Edge，请先安装 Edge" -ForegroundColor Red
  Stop-Here 1
}
Write-Host "[OK] Edge" -ForegroundColor Green

Write-Host ""
Write-Host "请输入教务系统的账号和密码：" -ForegroundColor Yellow
$user = Read-Host "学号"
$pass = Read-Host "密码"
if ([string]::IsNullOrWhiteSpace($user) -or [string]::IsNullOrWhiteSpace($pass)) {
  Write-Host "[X] 账号或密码为空" -ForegroundColor Red
  Stop-Here 1
}

$cfg = [ordered]@{
  username = $user.Trim()
  password = $pass
  accuracy = 10
  headless = $true
}
($cfg | ConvertTo-Json) | Set-Content -Path (Join-Path $ROOT 'config.json') -Encoding UTF8
Write-Host "[OK] 已保存 config.json" -ForegroundColor Green

Write-Host ""
$go = Read-Host "现在登录测试一次？(Y/n)"
if ($go -ne 'n') {
  Write-Host "--- 测试开始 ---" -ForegroundColor Cyan
  & (Join-Path $ROOT 'node.exe') (Join-Path $ROOT 'sign-auto.mjs')
  Write-Host "--- 测试结束 ---" -ForegroundColor Cyan
  Write-Host "提示：如果提示「未到签到时间！」，说明账号密码和请求都正确，只是还没到 21:30。" -ForegroundColor Yellow
}

Write-Host ""
$reg = Read-Host "注册每天 21:32 / 21:45 / 22:00 自动签到？(Y/n)"
if ($reg -ne 'n') {
  $taskName = 'XSKQ-AutoSign'
  $psFile = Join-Path $ROOT 'run-sign.ps1'
  $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$psFile`""
  $t1 = New-ScheduledTaskTrigger -Daily -At '21:32'
  $t2 = New-ScheduledTaskTrigger -Daily -At '21:45'
  $t3 = New-ScheduledTaskTrigger -Daily -At '22:00'
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($t1,$t2,$t3) -Settings $settings -Description '晚寝自动签到' -Force | Out-Null
  Write-Host "[OK] 已注册计划任务 $taskName" -ForegroundColor Green
  Write-Host "     （电脑需要开机或睡眠，关机不会执行）" -ForegroundColor Gray
}

Write-Host ""
Write-Host "安装完成。日志在 logs\sign.log" -ForegroundColor Cyan
Stop-Here 0