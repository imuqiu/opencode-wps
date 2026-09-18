# WPS-AI 三机部署工具

当前状态：部署工具已实现；稳定版本必须先由 primary 发布，再执行本机安装。

## 已实现

- 严格解析和原子写入 `machine.env`；
- 创建和验证公共同步根 `ROOT_ID.txt`；
- 根据脚本位置、本机配置或显式参数识别不同盘符的同步根；
- 校验 `stable-version.txt`、release manifest 和公共文件 SHA-256；
- 拒绝 manifest 绝对路径和 `..` 路径穿越；
- 只读检查 Windows、WPS、Git、Node/npm、OpenCode 和端口；
- 只读检查本机 Runtime、OpenCode 配置、MCP、WPS Add-in 和 Launcher；
- 同时兼容 Windows PowerShell 5.1 与 PowerShell 7；
- 中文、空格和不同盘符路径测试。

## 已实现的部署事务

- primary 发布 `deploy/`、`custom/`、release manifest 和稳定 commit；
- 按完整 SHA 克隆到 staging，安装依赖并构建 MCP；
- 更新前备份 OpenCode 配置、WPS Add-in 注册文件和计划任务；
- 更新切换前停止旧 OpenCode/Launcher，安装后必须通过 Launcher 健康检查；
- 调用官方安装器完成 Add-in、MCP、Skills、Agents 和 Launcher 安装；
- 按本机策略临时注入 `manual/auto` 权限模式和允许写入根；
- 失败时恢复配置、计划任务和上一 runtime；
- 精确卸载受管 MCP、公共文件、Add-in 和注册项；
- 默认保留 `machine.env`、日志和备份。

## 当前入口

### 0. 新电脑准备系统依赖

先安装并登录 WPS，关联同一个云端同步文件夹。随后运行：

```powershell
.\bootstrap-dependencies.ps1
```

脚本只补装缺失的 Git for Windows、Node.js LTS 和官方 `opencode-ai` npm 包；已存在的组件不会被重复安装。它不会代替 WPS 登录、会员设备授权或同步文件夹关联。

### 1. 家里电脑初始化公共同步根

先在 WPS 客户端中建立或关联一个空的 `WPS-AI` 同步文件夹，再运行：

```powershell
.\initialize-sync-root.ps1 -Path 'D:\WPS同步\WPS-AI'
```

如果目标目录已经有文件但尚无 `ROOT_ID.txt`，脚本会停止。确认目录无误后才使用：

```powershell
.\initialize-sync-root.ps1 -Path 'D:\WPS同步\WPS-AI' -InitializeExisting
```

这一步只需在权威云端目录执行一次。其余电脑应等待 WPS 同步同一个 `ROOT_ID.txt`，不能分别初始化出不同 ID。

### 2. 每台电脑生成本机配置

```powershell
.\initialize-machine.ps1 `
  -WpsSyncRoot 'E:\我的云文档\WPS-AI' `
  -DeviceName 'OFFICE-PC' `
  -DeviceRole secondary
```

家里发布电脑使用 `-DeviceRole primary`。默认写入 `C:\WPS-AI\machine.env`，该文件禁止放入 GitHub 或 WPS 同步目录。

### 3. 运行只读预检

```powershell
.\preflight.ps1 -WpsSyncRoot 'E:\我的云文档\WPS-AI'
```

也可以运行 `preflight.cmd`。退出码 `3` 表示系统依赖缺失，`5` 表示同步根或发布包尚未完整同步。

### 4. 运行只读健康检查

```powershell
.\health-check.ps1
```

在正式安装完成前，Runtime、MCP、Add-in 和计划任务显示失败属于预期结果。

### 5. 开发测试

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
pwsh.exe -NoProfile -File .\tests\run-tests.ps1
```

### 6. primary 发布稳定版本

确保 `my-deploy` 已提交并推送、工作树干净，然后运行：

```powershell
.\publish-stable.ps1
```

脚本最后才替换 `versions\stable-version.txt`。其他电脑只有在 manifest 和全部文件哈希通过后才会安装。

### 7. 安装、更新、修复和卸载

```powershell
.\install.ps1
.\update.ps1
.\repair.ps1
.\uninstall.ps1 -WhatIf
```

首次运行卸载应先带 `-WhatIf` 查看精确目标。只有明确需要删除 `C:\WPS-AI` 本机状态时才使用 `-PurgeLocalState`；该参数也不会删除 WPS 云同步目录。

## 安全说明

- 所有 PowerShell 文件使用 UTF-8 with BOM，以兼容 Windows PowerShell 5.1 的中文解析；
- 初始化脚本拒绝磁盘根目录；
- 已存在的 `machine.env` 默认不覆盖；
- 当前预检和健康检查不会修改注册表、计划任务或现有 WPS/OpenCode 配置；
- 请勿把 Codex 自带的 Git/Node 路径当作系统运行环境。
