# Stop-LocalRedis.ps1
# One-shot admin script: stop & disable the local Windows Redis service
# so that SSH tunnel can bind 127.0.0.1:6379 for the Baota Redis tunnel.
#
# USAGE: Right-click -> "Run with PowerShell" (Administrator)
#        Or: Start-Process powershell -Verb RunAs -ArgumentList '-File', $PSCommandPath

# Self-elevate if not already admin
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $arg = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
    Start-Process powershell -Verb RunAs -ArgumentList $arg
    exit
}

$serviceName = 'Redis'

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Disabling local Windows Redis service " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Find the redis-server process(es)
$procs = Get-Process -Name redis-server -ErrorAction SilentlyContinue
if ($procs) {
    Write-Host "[1/4] Found redis-server process(es):" -ForegroundColor Yellow
    $procs | Format-Table Id, ProcessName, StartTime -AutoSize | Out-String | Write-Host
} else {
    Write-Host "[1/4] No redis-server process running." -ForegroundColor Green
}

# 2. Stop the service
Write-Host "[2/4] Stopping service '$serviceName'..." -ForegroundColor Yellow
try {
    Stop-Service -Name $serviceName -Force -ErrorAction Stop
    Write-Host "       Service stopped." -ForegroundColor Green
} catch {
    Write-Host "       Stop-Service failed: $_" -ForegroundColor Red
    Write-Host "       Trying sc.exe stop..." -ForegroundColor Yellow
    & sc.exe stop $serviceName 2>&1 | Out-String | Write-Host
}

Start-Sleep -Seconds 2

# 3. Kill any remaining redis-server processes
$procs = Get-Process -Name redis-server -ErrorAction SilentlyContinue
if ($procs) {
    Write-Host "[3/4] Killing remaining redis-server process(es)..." -ForegroundColor Yellow
    $procs | ForEach-Object {
        try {
            taskkill /F /PID $_.Id 2>&1 | Out-String | Write-Host
        } catch {
            Write-Host "       taskkill failed on PID $($_.Id): $_" -ForegroundColor Red
        }
    }
} else {
    Write-Host "[3/4] No remaining redis-server process." -ForegroundColor Green
}

# 4. Disable the service so it won't auto-start on next boot
Write-Host "[4/4] Disabling service auto-start..." -ForegroundColor Yellow
try {
    Set-Service -Name $serviceName -StartupType Disabled -ErrorAction Stop
    Write-Host "       Service startup type = Disabled." -ForegroundColor Green
} catch {
    Write-Host "       Set-Service failed: $_" -ForegroundColor Red
    Write-Host "       Trying sc.exe config..." -ForegroundColor Yellow
    & sc.exe config $serviceName start= disabled 2>&1 | Out-String | Write-Host
}

Start-Sleep -Seconds 1

# Final check
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Final status                                " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$svc = Get-Service $serviceName -ErrorAction SilentlyContinue
if ($svc) {
    $svc | Select-Object Name, Status, StartType | Format-Table -AutoSize | Out-String | Write-Host
} else {
    Write-Host "Service '$serviceName' not found (already removed?)." -ForegroundColor Green
}
$remaining = Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "Port 6379 still bound by:" -ForegroundColor Yellow
    $remaining | Format-Table LocalAddress, LocalPort, OwningProcess -AutoSize | Out-String | Write-Host
} else {
    Write-Host "Port 6379 is FREE. Ready for SSH tunnel." -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. You can close this window." -ForegroundColor Cyan
Read-Host "Press Enter to exit"
