' ============================================================
' SSH 隧道自动启动脚本
' 功能：Windows 登录后自动在后台启动 SSH 隧道，最小化运行
' ============================================================

Option Explicit

Dim WshShell, strCmd, strProjectDir

' 获取项目目录（脚本所在目录的父目录）
strProjectDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\scripts\"))

' 构建启动命令：最小化窗口运行 bat
strCmd = "cmd /c start /min """" " & strProjectDir & "scripts\ssh-tunnel.bat"""

Set WshShell = CreateObject("WScript.Shell")

' 运行命令，窗口最小化
WshShell.Run strCmd, 2, False

Set WshShell = Nothing
