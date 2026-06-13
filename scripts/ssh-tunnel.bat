@echo off
title SSH Tunnel - Alibaba Cloud

REM ============================================================
REM SSH tunnel auto-reconnect script with port forwarding
REM - Forwards local ports 27017 (MongoDB) and 6379 (Redis)
REM   from server's 127.0.0.1 to your local machine
REM - Auto-reconnects on disconnect (5s interval)
REM - Press Ctrl+C to exit
REM ============================================================

:RECONNECT
echo.
echo ========================================
echo  [%date% %time%]
echo  Connecting to Alibaba Cloud (8.138.101.146:14950)...
echo  Port forwarding: 27017 (MongoDB), 6379 (Redis)
echo ========================================

ssh -i "%USERPROFILE%\.ssh\id_ed25519_alibaba" -L 27017:127.0.0.1:27017 -L 6379:127.0.0.1:6379 -p 14950 -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new root@8.138.101.146

set SSH_EXIT=%ERRORLEVEL%

echo.
echo ========================================
echo  [%date% %time%]
echo  Tunnel closed. Exit code: %SSH_EXIT%
echo  Reconnecting in 5 seconds... (Press Ctrl+C to stop)
echo ========================================
echo.

timeout /t 5 /nobreak >nul
goto RECONNECT
