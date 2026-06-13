# SSH 免密登录 + 自动隧道配置指南

## 已完成步骤

1. 生成本地 ed25519 密钥对：`C:\Users\86188\.ssh\id_ed25519_alibaba`
2. 公钥已部署到阿里云服务器 `~/.ssh/authorized_keys`
3. 免密登录测试通过

## 还需手动完成的步骤

### 1. 配置 SSH Config（实现 `ssh alibaba` 一键登录）

由于系统权限限制，无法自动写入 `C:\Users\86188\.ssh\config`，请手动创建该文件并添加以下内容：

```
Host alibaba
    HostName 8.138.101.146
    Port 14950
    User root
    IdentityFile ~/.ssh/id_ed25519_alibaba
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 60
    ServerAliveCountMax 3
    ExitOnForwardFailure yes
```

### 2. 设置 Windows 开机自动启动 SSH 隧道

**方法一：启动文件夹（推荐）**

1. 按 `Win + R`，输入 `shell:startup`，回车
2. 将 `scripts\start-ssh-tunnel.vbs` 的快捷方式复制到该文件夹
3. 重启电脑后，SSH 隧道会自动在后台运行

**方法二：任务计划程序（更稳定）**

1. 按 `Win + R`，输入 `taskschd.msc`，回车
2. 右侧点击 "创建基本任务"
3. 名称：`SSH Tunnel Auto Start`
4. 触发器：选择 "当我登录时"
5. 操作：选择 "启动程序"
6. 程序路径：`wscript.exe`
7. 参数：`"D:\figma-like-whiteboard\scripts\start-ssh-tunnel.vbs"`
8. 完成

### 3. 测试自动重连

双击运行 `scripts\ssh-tunnel.bat`，你会看到一个最小化的 cmd 窗口：
- 显示连接状态
- 断开时自动重连（5秒间隔）
- 永不断线

### 4. 完整工作流

开机 -> Windows 登录 -> SSH 隧道自动建立（后台最小化 cmd）-> 启动你的 server -> 画图 -> 下班

## 文件说明

| 文件 | 用途 |
|------|------|
| `scripts/ssh-tunnel.bat` | SSH 自动重连脚本 |
| `scripts/start-ssh-tunnel.vbs` | Windows 开机启动器（隐藏窗口） |
| `scripts/SSH_SETUP_README.md` | 本说明文件 |
