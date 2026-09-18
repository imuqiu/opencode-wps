# WPS + opencode-wps 三机统一部署：第二阶段实施设计

> 状态：设计基线（尚未执行安装）
> 目标平台：三台 Windows 电脑
> 设计优先级：简单 > 稳定 > 可恢复 > 自动化 > 功能数量

## 1. 设计结论

采用“WPS 同步公共内容、GitHub 管理代码版本、本机目录承载运行状态”的三层结构：

```text
GitHub origin/my-deploy
        │ 家里电脑测试、生成发布包
        ▼
WPS 同步文件夹中的 WPS-AI
        │ WPS 将同一云目录同步到三台电脑
        ▼
三台电脑各自的本地 WPS-AI 目录
        │ 安装/更新时复制已校验的公共内容
        ▼
WPS Add-in + OpenCode + WPS MCP
```

这里明确利用了 WPS 同步文件夹的核心能力：虽然三台电脑的绝对路径不同，但关联的是同一个云端目录，因此在同步完成后，公共目录的文件内容一致。

本机运行目录不是另一套公共源，而是公共源在该电脑上的“已安装快照”。这样做解决的是运行稳定性、更新事务和回滚问题，不是否定 WPS 的同步能力。

## 2. 设计边界

### 本阶段包含

- 三机目录、配置和文件所有权规范；
- WPS 同步根识别与一致性校验；
- GitHub Fork、稳定 commit 和公共发布包设计；
- 安装、更新、同步公共配置、修复、回滚、卸载流程；
- WPS Add-in、MCP、OpenCode、Skills、Agents、Prompts、Templates 的部署接口；
- 日志、备份、安全和验收规范。

### 本阶段不包含

- GUI 安装器；
- NAS、数据库或额外常驻同步服务；
- 自动追踪 GitHub 最新版；
- 将 API Key、Token 或运行日志放入 WPS 云；
- 深度修改 opencode-wps 核心代码；
- 无人值守地同时写入同一个 Office 文件。

## 3. 三个权威源

| 内容 | 权威源 | 复制目标 | 允许谁修改 |
|---|---|---|---|
| 官方项目代码 | `upstream/main` | `origin/main` | 官方仓库 |
| 部署逻辑和自定义文本资源 | `origin/my-deploy` | WPS 公共发布包、本机 runtime | 家里工作电脑经 Git 提交修改 |
| 稳定发布指针 | WPS `versions/stable-version.txt` | 各机本地 state | 家里工作电脑在验收后发布 |
| 日常 Office 文档和模板 | WPS 同步目录 | 三机各自同步目录 | 遵守单写者规则的任一电脑 |
| 本机路径、端口和策略 | `C:\WPS-AI\machine.env` | 不复制 | 对应电脑 |
| 密钥、Cookie、会话、日志 | 本机用户环境或本机目录 | 不复制 | 对应电脑和应用 |

关键规则：同一类文件只能有一个权威源。GitHub 中的自定义配置先经测试发布到 WPS；不得在三台电脑分别手改已安装副本。

## 4. WPS 同步目录设计

三台电脑关联同一个云端 `WPS-AI`，但本地路径可以分别是：

```text
家里：   D:\WPS同步\WPS-AI
办公室： E:\我的云文档\WPS-AI
笔记本： C:\Users\<用户>\Documents\WPS同步\WPS-AI
```

云端公共根的最终结构：

```text
WPS-AI\
├─ ROOT_ID.txt
├─ common\
│  ├─ skills\
│  ├─ agents\
│  ├─ prompts\
│  ├─ templates\
│  └─ config\
├─ scripts\
│  ├─ install.cmd
│  ├─ update.cmd
│  ├─ repair.cmd
│  ├─ uninstall.cmd
│  └─ deploy\                 # PowerShell 实现及公共模块
├─ versions\
│  ├─ stable-version.txt
│  ├─ releases\
│  │  └─ <commit>.manifest.json
│  └─ packages\               # 可选；仅在 GitHub 下载不稳定时使用
├─ docs\
│  └─ deployment-notes.md
└─ jobs\
   ├─ inbox\
   ├─ working\
   ├─ output\
   └─ failed\
```

### 4.1 `ROOT_ID.txt`

内容为一次生成后永久不变的 UUID，例如：

```text
WPS_AI_ROOT_ID=4b3f7280-2f79-4d5f-a8ab-61f49b20b5ec
SCHEMA=1
```

用途：

- 首次安装时记录到本机 state；
- 后续更新确认脚本当前看到的是原来的同步根；
- 防止用户选中另一个同名 `WPS-AI` 文件夹；
- 三机验收时确认关联的是同一个云端目录。

### 4.2 如何自动识别不同的本机路径

正常入口是用户直接运行 `%WPS_SYNC_ROOT%\scripts\install.cmd`。CMD 可通过 `%~dp0` 得到自身所在目录，向上一级即可推导 `WPS_SYNC_ROOT`，因此正常情况下无需让用户浏览选择路径。

仅当脚本被复制到同步根之外时，按以下顺序处理：

1. 读取已有 `C:\WPS-AI\machine.env`；
2. 接受命令行参数 `-WpsSyncRoot`；
3. 扫描有限候选目录并寻找合法 `ROOT_ID.txt`；
4. 仍无法唯一识别时才要求用户选择一次。

不扫描整块磁盘，不依据中文目录名猜测，不写死盘符。

### 4.3 “同步完成”的可验证定义

WPS 同步保证公共目录在三台电脑之间传播，但脚本不能仅凭“文件存在”假定当前瞬间已完全同步。部署层采用以下门禁：

1. `ROOT_ID.txt` 可完整读取且与本机已登记 ID 一致；
2. `stable-version.txt` 格式完整；
3. 对应 `<commit>.manifest.json` 已存在；
4. manifest 中列出的每个公共文件均存在；
5. 每个文件的 SHA-256 与 manifest 一致；
6. 连续两次读取稳定清单内容一致后才开始更新。

这把“同步文件夹最终内容一致”转化为安装程序可验证的“当前本机公共发布包完整一致”。若校验失败，脚本只提示等待 WPS 同步，不修改现有安装。

### 4.4 云端禁止内容

```text
.git\
node_modules\
dist\
machine.env
.env*
*.key
secrets\
logs\
cache\
backups\
state\
*.log
*.old
docinfo.cache.json
proofread-sessions\
```

## 5. 每台电脑的本机结构

```text
C:\WPS-AI\
├─ machine.env
├─ runtime\
│  └─ opencode-wps\           # checkout 到稳定完整 SHA
├─ managed\
│  ├─ current\                # 已校验公共内容快照
│  └─ staging\                # 更新临时区
├─ backups\
│  └─ <timestamp>-<commit>\
├─ logs\
│  └─ deploy-YYYYMMDD.log
└─ state\
   ├─ installation.json
   ├─ managed-files.json
   ├─ last-good.json
   └─ lock
```

系统/应用目标位置仍遵守官方约定：

```text
%APPDATA%\kingsoft\wps\jsaddons\opencode-wps_
%USERPROFILE%\.config\opencode\opencode.json
%USERPROFILE%\.config\opencode\agents\
%USERPROFILE%\.config\opencode\plugins\
%USERPROFILE%\.config\opencode\skills\
%USERPROFILE%\.opencode\agents\
%USERPROFILE%\.opencode\skills\
```

Skills 在项目安装器和当前 OpenCode 文档中的路径存在差异。首版部署器采用兼容模式：只对部署器拥有的 Skill 名称同时发布到两个候选位置，并由健康检查实际验证 discovery；不得镜像删除用户自己的 Skills。

## 6. `machine.env` 设计

初始字段：

```dotenv
CONFIG_SCHEMA=1
WPS_SYNC_ROOT=E:\我的云文档\WPS-AI
WPS_SYNC_ROOT_ID=4b3f7280-2f79-4d5f-a8ab-61f49b20b5ec
DEVICE_NAME=OFFICE-PC
DEVICE_ROLE=secondary
RUNTIME_ROOT=C:\WPS-AI\runtime
LOCAL_PORT=14096
LAUNCHER_PORT=14097
BACKUP_PROXY_PORT=14098
PERMISSION_MODE=manual
```

约束：

- UTF-8 编码，一行一个 `KEY=VALUE`；
- 首版不支持行内注释、变量展开或执行表达式；
- PowerShell 按文本解析，禁止通过 `Invoke-Expression` 加载；
- 未知字段保留但警告；重复字段、非法键名和关键字段缺失均停止；
- `DEVICE_ROLE` 仅允许 `primary` 或 `secondary`；
- 只有 `primary` 允许执行稳定版本晋级；
- 文件只对当前用户和 Administrators 可读写；
- 不存 API Key、Token、Cookie。

建议优先把模型密钥放到受支持的系统凭据存储或用户级环境变量。部署日志必须对疑似密钥字段脱敏。

## 7. GitHub 和稳定版本设计

### 7.1 远端和分支

```text
upstream = https://github.com/lnxsun/opencode-wps.git
origin   = https://github.com/<用户账号>/opencode-wps.git

origin/main       与 upstream/main 同步，不放个人定制
origin/my-deploy  部署脚本和 custom 内容
```

暂不创建 `stable` 分支。稳定发布由不可变的完整 commit SHA 表示。

### 7.2 稳定清单

`versions/stable-version.txt`：

```text
SCHEMA=1
VERSION=1.9.17
COMMIT=<40位 origin/my-deploy commit SHA>
BRANCH=my-deploy
MANIFEST_SHA256=<对应 release manifest 的 SHA-256>
PUBLISHED_AT=2026-09-13T12:00:00+08:00
PUBLISHED_BY=HOME-PC
```

更新器必须验证：

- SHA 是 40 位十六进制；
- commit 能从 `origin/my-deploy` 获取；
- commit 属于 `origin/my-deploy` 历史；
- checkout 后 `package.json` 版本与 `VERSION` 相符；
- release manifest 哈希正确；
- 目标 SHA 与本机当前 SHA 不同时才更新。

### 7.3 公共发布 manifest

`versions/releases/<commit>.manifest.json` 至少包含：

```json
{
  "schema": 1,
  "commit": "<40-char-sha>",
  "createdAt": "2026-09-13T12:00:00+08:00",
  "files": [
    {
      "source": "common/skills/wps-ai-example/SKILL.md",
      "targetClass": "opencode-skill",
      "sha256": "<sha256>",
      "size": 1234
    }
  ]
}
```

manifest 是部署器管理文件的唯一清单。更新和卸载只操作清单中的目标，不对整个用户目录做镜像删除。

### 7.4 发布顺序

家里电脑按以下顺序发布到 WPS 同步目录：

1. 在 GitHub 完成并推送 `my-deploy` commit；
2. 在家里电脑从该完整 SHA 做全套验收；
3. 生成公共文件及 SHA-256 manifest；
4. 先写临时文件，再原子改名为 `<commit>.manifest.json`；
5. 等待公共文件和 manifest 完成 WPS 同步；
6. 最后替换 `stable-version.txt`。

稳定指针永远最后发布，防止其他电脑看到新版本指针却看不到完整发布包。

## 8. 脚本分层

WPS 根中的四个 `.cmd` 仅作为用户入口，负责定位 PowerShell 脚本、设置退出码和保留窗口。实际逻辑统一在 PowerShell 中：

```text
deploy\
├─ install.ps1
├─ update.ps1
├─ repair.ps1
├─ uninstall.ps1
├─ sync-common.ps1
├─ health-check.ps1
├─ publish-stable.ps1
└─ lib\
   ├─ Config.psm1
   ├─ Discovery.psm1
   ├─ Integrity.psm1
   ├─ GitRuntime.psm1
   ├─ Backup.psm1
   ├─ OpenCodeConfig.psm1
   ├─ WpsAddon.psm1
   └─ Logging.psm1
```

所有改变状态的脚本支持 `-WhatIf`；普通用户流程不要求 PowerShell 执行策略永久放宽，而由入口使用单次 `-ExecutionPolicy Bypass -File`。脚本不得下载并直接执行未校验的远程代码。

## 9. 首次安装事务

`install.cmd` 的完整流程：

```text
定位同步根
  → 校验 ROOT_ID 和发布包完整性
  → 预检 Windows/WPS/Git/Node/npm/OpenCode/端口
  → 创建并验证 machine.env
  → 获取稳定 commit 到 runtime staging
  → npm ci + build
  → 备份已有目标配置
  → 调用/包装官方安装逻辑
  → 发布公共资源的本机快照
  → 建立或修复 OpenCode MCP 配置
  → 建立 Launcher 计划任务
  → 运行健康检查
  → 成功：登记 last-good
  → 失败：恢复备份并保留诊断日志
```

### 9.1 预检失败原则

预检阶段只读。以下任一条件不满足时，不创建计划任务、不改注册文件、不覆盖配置：

- 非受支持 Windows；
- WPS 未找到或版本不满足最低要求；
- 系统用户会话无法找到 Git、Node/npm 或 OpenCode；
- 所需端口被不相关进程占用；
- WPS 发布包未同步完整；
- `C:\WPS-AI` 无法安全创建；
- 已有安装正在运行或 lock 未释放。

注意：Codex 自带 Node 不算系统依赖，计划任务必须能在普通登录会话中找到运行时。

### 9.2 配置修改原则

- 修改 `opencode.json` 前完整备份；
- 只增改部署器拥有的 MCP 键和明确字段；
- 保留其他 provider、MCP、权限和用户配置；
- JSON 解析失败时停止，绝不以空模板覆盖；
- WPS Add-in 目录按官方产物重建，但先备份注册文件；
- 计划任务名称沿用 `OpenCodeLauncher`，并校验其命令指向当前稳定 runtime。

## 10. 更新事务

办公室电脑和笔记本只执行用户主动触发的 `update.cmd`：

1. 读取本机配置和当前 `last-good`；
2. 校验 WPS 同步根及稳定发布包；
3. 若目标 commit 等于当前 commit，改为执行轻量健康检查；
4. 把目标 commit checkout 到 staging，不在现有 runtime 上直接 pull；
5. 在 staging 执行依赖安装、构建和静态检查；
6. 备份配置、插件注册、计划任务定义和当前版本；
7. 停止旧 Launcher；
8. 切换 runtime 并发布公共资源；
9. 重装/修复 WPS Add-in 和 MCP 配置；
10. 启动 Launcher 并运行健康检查；
11. 全部通过后更新 `last-good.json`；
12. 任一步失败则切回上一 runtime、恢复配置和计划任务。

不使用 `git pull` 直接改变生产工作树；不因 WPS 同步到新清单而自动安装。

## 11. 公共内容同步设计

`sync-common.ps1` 的职责是把已校验公共发布包复制为本机可运行快照：

- 输入：`WPS_SYNC_ROOT`、release manifest；
- staging：`C:\WPS-AI\managed\staging\<commit>`；
- 输出：OpenCode Skills/Agents/Commands，以及本地模板目录；
- 校验：复制前后均计算 SHA-256；
- 切换：完整成功后再将 staging 晋级为 current；
- 所有权：写入 `managed-files.json`；
- 清理：只删除上一清单中由部署器拥有、且新清单明确移除的文件；
- 冲突：如果目标文件存在但不属于部署器，停止并报告，不覆盖。

自定义资源统一使用名称前缀，例如 `wps-ai-`，尽量避免和官方、用户资源同名。

公共 Prompts 若 OpenCode 当前版本没有独立标准目录，则由部署器转换为带命名空间的 Commands 或 Skill 资源；转换产物保留源文件哈希，便于审计。

## 12. 修复、回滚和卸载

### 12.1 `repair.cmd`

修复不升级版本，默认针对当前 `last-good`：

- 重新校验系统依赖和端口；
- 验证 runtime commit 和构建产物；
- 重装缺失或损坏的 WPS Add-in；
- 修复 `publish.xml`、`jsplugins.xml`、`authaddin.json`；
- 修复 MCP 配置的受管字段；
- 修复 Skills/Agents/Plugins 的受管文件；
- 修复 `OpenCodeLauncher` 计划任务；
- 验证 Launcher `/health`、MCP 启动和 WPS COM；
- 若当前 runtime 无法修复，恢复上一份成功快照。

### 12.2 自动回滚触发

以下任一项在更新后失败即触发回滚：

- Launcher 无法启动或健康接口失败；
- MCP 入口文件不存在/无法启动；
- OpenCode 配置变成无效 JSON；
- WPS Add-in 核心文件或注册条目缺失；
- 目标 commit、版本或公共文件哈希不符。

WPS 当前是否打开不作为静默强退理由。需要关闭 WPS 才能完成替换时，脚本提示用户关闭并安全退出。

### 12.3 `uninstall.cmd`

卸载范围仅限部署器拥有的内容：

- 停止部署器创建的 Launcher；
- 删除部署器创建的计划任务；
- 删除 opencode-wps Add-in 受管目录和注册项；
- 从 OpenCode 配置移除部署器拥有的 MCP 键；
- 删除 `managed-files.json` 中登记的公共副本；
- 默认保留 `machine.env`、日志和最近一次备份；
- `-PurgeLocalState` 才删除 `C:\WPS-AI` 的剩余本机状态。

卸载绝不删除 WPS 同步目录，不删除 GitHub Fork，不删除用户自己的 OpenCode 配置或 Skills。

## 13. 健康检查设计

统一输出：

```text
[OK] WPS              12.1.0.x
[OK] 同步根           ROOT_ID 匹配，发布包哈希通过
[OK] 稳定版本         1.9.17 / <commit-short>
[OK] 本机 Runtime     commit 与稳定清单一致
[OK] OpenCode         可执行文件与配置有效
[OK] MCP              入口存在，可启动
[OK] WPS Add-in       文件与三项注册配置有效
[OK] Launcher         计划任务存在，14097 健康
[OK] 公共配置         27/27 文件哈希匹配
[WARN] WPS COM        WPS 未打开，跳过在线连接测试
```

退出码：

| 退出码 | 含义 |
|---:|---|
| 0 | 全部必要检查通过 |
| 1 | 有警告，但核心功能可用 |
| 2 | 配置或公共文件不一致 |
| 3 | 依赖缺失 |
| 4 | WPS Add-in/MCP/Launcher 故障 |
| 5 | 同步发布包不完整，等待 WPS 同步 |
| 10 | 未处理异常，详情见日志 |

健康检查默认只读；`repair.cmd` 才允许修改状态。

## 14. WPS 文档与自动化作业规则

WPS 同步对日常文档的价值应充分利用：三机均可在各自本地同步路径打开相同的 Office 文件，不需要通过部署器复制这些业务文档。

批处理采用目录状态机：

```text
jobs\inbox\<job-id>
    → jobs\working\<DEVICE_NAME>\<job-id>
    → jobs\output\<job-id>
    或 jobs\failed\<job-id>
```

规则：

- 输入原件只读，输出写新目录；
- 一次作业只允许一台电脑认领；
- 同一文档只允许一个 WPS COM 写者；
- 作业结果先输出、同步、人工验收，再替换正式文件；
- 不把临时锁、缓存、日志和会话 JSON 放入云端；
- 多机同时离线编辑同一文件可能生成冲突副本，部署器不得自动删除副本。

## 15. 日志、备份和保留策略

- 部署日志：`C:\WPS-AI\logs`，默认保留 30 天；
- 更新快照：至少保留最近 2 个成功版本和 1 个失败现场；
- 配置备份：包含 OpenCode 配置、WPS Add-in 注册文件、计划任务定义、runtime commit、managed manifest；
- 不备份 API Key 明文到 WPS 云；
- 日志不记录完整环境变量，不打印 Cookie/Token；
- WPS 云的版本历史和回收站用于业务文档误改恢复；
- 本机部署备份用于软件更新失败恢复，两者互补，不互相替代。

## 16. 并发与锁

每个改变状态的脚本启动时创建 `C:\WPS-AI\state\lock`，内容包括 PID、启动时间、设备名和操作名。

- 同一电脑一次只允许一个 install/update/repair/uninstall；
- PID 存活时拒绝第二个操作；
- PID 不存在且锁超时，允许显式清理陈旧锁；
- WPS 云中的稳定发布只允许 `DEVICE_ROLE=primary` 执行；
- 发布时额外创建短期 `versions\PUBLISHING.json`，完成或失败后移除；
- secondary 发现 `PUBLISHING.json` 时不更新。

## 17. 实施文件清单

下一步在个人 Fork 的 `my-deploy` 分支新增：

```text
deploy\
├─ install.cmd
├─ update.cmd
├─ repair.cmd
├─ uninstall.cmd
├─ machine.env.example
├─ install.ps1
├─ update.ps1
├─ repair.ps1
├─ uninstall.ps1
├─ sync-common.ps1
├─ health-check.ps1
├─ publish-stable.ps1
├─ lib\...
└─ tests\...
custom\
├─ skills\
├─ agents\
├─ prompts\
├─ templates\
└─ config\
```

实现顺序：

1. 配置解析、日志和锁；
2. 只读 preflight 与同步完整性校验；
3. 健康检查；
4. 公共内容 manifest 和 staging 同步；
5. runtime 稳定 SHA 获取与构建；
6. 安装与备份；
7. 更新事务和自动回滚；
8. repair；
9. 精确卸载；
10. primary 专用稳定发布脚本。

## 18. 测试矩阵

### 路径和同步

- 中文路径、空格路径、C/D/E 不同盘符；
- 入口脚本从 WPS 同步根内运行时自动识别；
- 选错同名目录时 ROOT_ID 拒绝；
- manifest 已到但部分文件未到时退出码 5；
- 文件内容损坏或冲突副本不被自动采用；
- 三台电脑最终的公共文件 SHA-256 清单一致。

### 安装和恢复

- 全新电脑安装；
- 已有 OpenCode 自定义配置时合并不丢失；
- Node/OpenCode 缺失时只读失败；
- 端口占用时不改系统；
- npm build 失败时旧 runtime 不受影响；
- Add-in 更新失败时自动恢复；
- 断网但稳定 commit 已缓存时的修复；
- uninstall 后用户自己的 Skills/配置仍存在。

### 功能验收

- Writer：读、写、另存为、校对；
- Spreadsheets：多 Sheet、公式、批量写入、图表；
- Presentation：创建和修改幻灯片、导出；
- 跨应用：Excel → Word、Word → PPT；
- 批处理：至少 10 个测试文件，单文件失败不损坏其他输出；
- WPS 同步：输出在另外两台电脑本地出现且哈希一致；
- 回滚：人为制造新版本启动失败，恢复上一稳定 commit。

## 19. 开始编码前仅需补齐的信息

设计不依赖统一盘符，也不需要 NAS。正式接入 GitHub 和首台电脑安装时，需要补齐：

- 用户 Fork 的实际 GitHub URL；
- 三台电脑的 `DEVICE_NAME` 和 primary/secondary 角色；
- 每台电脑实际 WPS 同步根；
- 办公室文件是否允许进入个人 WPS 云；
- 希望使用的 OpenCode provider/密钥保存方式。

这些信息均进入本机配置或部署说明，不进入公共源中的敏感配置。

## 20. 设计冻结标准

满足以下条件后进入编码：

- 接受三层权威源和方案 B；
- 接受 WPS 同步根通过脚本位置 + ROOT_ID 识别；
- 接受稳定版本使用完整 Git commit，而非仅版本号；
- 接受公共内容使用 manifest + SHA-256；
- 接受 secondary 不自动更新、只在用户触发后升级；
- 接受只操作受管文件、不镜像删除用户目录；
- 明确家里工作电脑是稳定版本发布者。
