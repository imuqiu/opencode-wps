# WPS + opencode-wps 三机统一部署：第一阶段实证分析

分析日期：2026-09-13（Asia/Shanghai）
分析对象：`lnxsun/opencode-wps` 官方 GitHub 仓库 `main`
实证提交：`5b335bf23fe1b78a8487564399d8b3999a94fc76`（2026-09-08）
仓库声明版本：`1.9.17`

## 1. 结论摘要

1. 应采用“官方仓库为 `upstream`、个人 Fork 为 `origin`、`main` 跟随官方、`my-deploy` 承载部署层”的模式，不需要现在增加 `stable` 分支。
2. WPS 云同步目录只应保存公共配置源、部署入口、模板和稳定版本清单；不要把 Git 工作树、`node_modules`、`dist`、日志、缓存或 WPS 插件运行目录放进 WPS 云同步。
3. 选择方案 B：WPS 同步目录是公共内容的“源”，安装时复制到本机固定目录。它比直接引用同步目录更能抵抗离线、同步中间态、文件锁和三机路径差异。
4. 建议本机持久运行副本为 `C:\WPS-AI\runtime\opencode-wps`。官方 MCP 配置写的是编译产物的绝对路径，因此该目录一旦安装后不能随意移动。
5. WPS 加载项必须安装到 `%APPDATA%\kingsoft\wps\jsaddons\opencode-wps_`；WPS 的注册文件也位于该 `jsaddons` 目录。这里不适合云同步。
6. 官方 Windows 安装器会写入 OpenCode 全局配置、复制 Skills/Agents/Plugins、编译 MCP、注册计划任务，但没有可靠完成需求中的系统/WPS/依赖预检、稳定版本锁定、更新、回滚、自动备份、卸载或完整健康检查。这些应仅在新增的 `deploy/` 层补齐。
7. 官方仓库当前没有 Git tag，也没有 GitHub Release；并且 `1.9.17` 发布提交之后，`main` 仍有新提交但版本号仍为 `1.9.17`。因此 `stable-version.txt` 不能只写 `1.9.17`，必须同时记录完整 commit SHA。
8. 官方安装器把 Skills 安装到 `~/.opencode/skills/`，而当前 OpenCode 官方文档的全局 Skills 标准位置是 `~/.config/opencode/skills/`。第二阶段必须做实际发现测试，并由部署适配层处理兼容，不能直接假定旧路径长期有效。
9. 官方项目没有独立的 `prompts/` 或 `templates/` 运行目录。公共 prompts 应映射成 OpenCode 的全局 `commands/`，或由 Agent 配置引用；公共 templates 是业务文档资产，按用户工作流复制或直接选择，不应混入插件运行目录。
10. WPS 原生 AI 与 opencode-wps/MCP 可以并存；该项目没有要求禁用 WPS AI。

## 2. 实际架构和调用链

Windows 实际调用链如下：

```text
WPS Writer / Spreadsheets / Presentation
  -> %APPDATA%\kingsoft\wps\jsaddons\opencode-wps_
  -> WPS 内嵌 Chat UI
  -> OpenCode serve 127.0.0.1:14096
  -> 本地 MCP（stdio）
  -> wps-office-mcp\dist\index.js
  -> Windows PowerShell 5.1 + WPS COM
  -> 当前打开的 WPS 文档

OpenCodeLauncher 计划任务
  -> wscript.exe start-launcher.vbs
  -> launcher.js 127.0.0.1:14097
  -> 管理 opencode serve 生命周期
```

`14098` 是备用 CORS proxy 端口，当前 Windows 主调用链不依赖它。`58891` 是 macOS/Linux 反向轮询端口，三台 Windows 电脑的第一阶段部署不需要开放或管理它。

## 3. 官方安装器的真实行为

`install-addons.js` 当前执行以下操作：

1. 将仓库的 `opencode-wps/` 复制到 `%APPDATA%\kingsoft\wps\jsaddons\opencode-wps_`。
2. 合并写入 `publish.xml`、`jsplugins.xml`，并尝试在 `authaddin.json` 中启用加载项。
3. 在仓库内的 `wps-office-mcp/` 执行 `npm install` 和 `npm run build`。
4. 将 MCP 命令写入 `%USERPROFILE%\.config\opencode\opencode.json`；命令包含当前仓库 `wps-office-mcp\dist\index.js` 的绝对路径。
5. 把仓库 Skills 复制到 `%USERPROFILE%\.opencode\skills`。
6. 把 Agents 同时复制到 `%USERPROFILE%\.config\opencode\agents` 和 `%USERPROFILE%\.opencode\agents`。
7. 把治理插件复制到 `%USERPROFILE%\.config\opencode\plugins`。
8. 删除若干旧版 Claude/OpenCode 兼容目录。
9. 在插件目录生成 `start-launcher.vbs`，注册用户登录触发的 `OpenCodeLauncher` 计划任务并立即启动 Launcher。

重要影响：

- 仓库不是“安装完即可删除”的源码包。MCP 配置直接指向仓库内的 `dist/index.js`，所以部署源必须被复制/克隆到稳定的本机路径。
- 插件目录是安装产物，每次安装都会覆盖同名插件文件。用户定制不能直接改这里。
- Skills、Agents、治理插件也按文件覆盖。自定义同名文件若直接放在目标目录，会被再次安装覆盖。
- `opencode.json` 会与模板深度合并并保留已有用户值，但它本身可能含 provider API Key、MCP 环境变量和权限配置，必须按敏感本机文件处理。
- 官方卸载仅有文档化的手工步骤，没有 `uninstall` 命令。

## 4. 路径与数据分类表

| 项目 | 当前默认位置 | 是否可改路径 | 适合 WPS 云同步 | 敏感信息 | 官方升级覆盖 | 推荐处理方式 | 原因 |
|---|---|---:|---:|---:|---:|---|---|
| Fork 源码工作树 | 官方不规定；用户克隆位置 | 是 | 否 | 通常否 | `git merge` 影响 | 固定到 `C:\WPS-AI\runtime\opencode-wps` | MCP 配置引用其绝对路径；Git、依赖和构建输出不适合云同步 |
| Windows WPS 插件 | `%APPDATA%\kingsoft\wps\jsaddons\opencode-wps_` | 官方安装器不可配 | 否 | 否 | 是，整包复制覆盖 | 视为可重建安装产物 | WPS 加载机制要求，且包含运行态缓存文件 |
| WPS 插件注册 | `%APPDATA%\kingsoft\wps\jsaddons\publish.xml`、`jsplugins.xml`、`authaddin.json` | 基本固定 | 否 | 低 | 安装器会合并/修改 | 更新前备份，修复时重建条目 | 属于本机 WPS 状态，多机同步可能互相污染 |
| MCP 源码 | `<本机工作树>\wps-office-mcp` | 随工作树 | 否 | 否 | 是 | 跟随固定本机工作树 | 源码与上游强耦合 |
| MCP 编译产物 | `<本机工作树>\wps-office-mcp\dist\index.js` | 间接可改 | 否 | 否 | 是 | 每次更新后本机构建 | OpenCode 直接执行该绝对路径 |
| MCP 依赖 | `<本机工作树>\wps-office-mcp\node_modules` | 间接可改 | 否 | 否 | `npm install` 会变 | 每机本地安装，可删除重建 | 文件数量大、平台相关、同步冲突概率高 |
| 根安装器依赖 | `<本机工作树>\node_modules` | 间接可改 | 否 | 否 | `npm install` 会变 | 每机本地安装 | `install-addons.js` 依赖 `fs-extra` 等包 |
| OpenCode 全局配置 | `%USERPROFILE%\.config\opencode\opencode.json` | OpenCode 支持 `OPENCODE_CONFIG` | 否 | 是 | 安装器合并并重写 | 本机保留；备份；只由部署层合并受管字段 | 可能含 API Key、模型/provider、权限和本机 MCP 绝对路径 |
| MCP 注册项 | 上述 `opencode.json` 的 `mcp.wps-office` | 可配置 | 否 | 可能 | 是 | 安装/更新时生成，保留非受管字段 | `command` 含 Node 与 MCP 的本机绝对路径 |
| 写盘白名单 | MCP 条目的 `env.OPCODE_ALLOWED_ROOTS` | 是 | 否 | 可能暴露本机路径 | 安装器可能更新 | 从 `machine.env` 生成；至少加入实际文档根目录 | 多机盘符不同，不能放公共绝对路径 |
| OpenCode Skills（项目当前行为） | `%USERPROFILE%\.opencode\skills` | 部署层可改 | 否，目标目录 | 否 | 同名会覆盖 | 公共目录作源，复制安装；做发现测试 | 项目使用旧/项目特定位置 |
| OpenCode Skills（当前标准） | `%USERPROFILE%\.config\opencode\skills` | `OPENCODE_CONFIG_DIR` 可改变 | 否，目标目录 | 否 | 部署层控制 | 作为首选全局目标，必要时兼容镜像旧路径 | 当前 OpenCode 文档列出的全局路径 |
| Agents | `%USERPROFILE%\.config\opencode\agents` 和 `%USERPROFILE%\.opencode\agents` | 部署层可改 | 否，目标目录 | 通常否 | 同名会覆盖 | 公共目录作源，按 manifest 复制 | 标准路径与兼容路径并存，需避免手工改安装产物 |
| 治理 Plugins | `%USERPROFILE%\.config\opencode\plugins` | `OPENCODE_CONFIG_DIR` 可改变 | 否 | 通常否 | 同名会覆盖 | 官方插件跟随版本；自定义插件另命名 | 治理逻辑与 MCP/Skills 版本耦合，不应独立漂移 |
| Prompts / Commands | 官方仓库无独立 prompts；OpenCode 标准为 `%USERPROFILE%\.config\opencode\commands` | 是 | 源文件适合 | 通常否 | 部署层控制 | `common\prompts` 作源，安装为 `commands\*.md` | OpenCode 的可发现提示词机制叫 Commands |
| Templates | 官方仓库无标准运行目录 | 是 | 是 | 视模板内容 | 否 | 保留在 `common\templates`，按工作流读取/复制 | 是业务文档资产，不是插件运行配置 |
| Launcher | `%APPDATA%\kingsoft\wps\jsaddons\opencode-wps_\launcher.js` | 官方安装器不可配 | 否 | 否 | 是 | 跟随插件包重新安装 | 与插件版本耦合 |
| Launcher VBS | 同目录 `start-launcher.vbs` | 官方安装器不可配 | 否 | 含本机绝对路径 | 是 | 安装时生成 | 计划任务入口，路径与当前用户绑定 |
| 自启动 | Windows 计划任务 `OpenCodeLauncher` | 名称在官方脚本中固定 | 否 | 含本机路径 | 每次安装重建 | 备份任务信息，repair 可重建 | 机器状态，不能跨机同步 |
| OpenCode 服务端口 | `127.0.0.1:14096` | `config.js` 声明可改，但多处仍有常量 | 否 | 否 | 是 | 第一阶段保持默认；冲突才适配 | 全链路存在多处硬编码，任意改端口不是单点配置 |
| Launcher 端口 | `127.0.0.1:14097` | 多处硬编码 | 否 | 否 | 是 | 第一阶段保持默认 | 安装器、插件、MCP helper、诊断均依赖 |
| 备用 Proxy 端口 | `127.0.0.1:14098` | 源码可改 | 否 | 否 | 是 | 不启动、不纳入健康必选项 | 当前 Windows 主调用链不使用 |
| Launcher 日志 | `%USERPROFILE%\.opencode\logs\opencode-serve.log` 和 `.old` | 官方未暴露配置 | 否 | 是 | 否；会轮转 | 本地保留，诊断/清理 | 可能包含路径、模型或错误上下文；频繁追加 |
| MCP 日志 | `%USERPROFILE%\.wps-office-mcp\logs` | 官方未暴露路径配置 | 否 | 是 | 否 | 本地保留，限制保留期 | 高频写入，可能含工具调用元数据 |
| 校对会话 | `%USERPROFILE%\.opencode-wps\proofread-sessions\*.json` | 是，`OPENCODE_WPS_PROOFREAD_DIR` | 否 | 是 | 否 | 本地保留并纳入可选故障备份 | 包含文档校对内容/状态，频繁写入 |
| MCP 跨应用数据缓存 | MCP 进程内存 `Map` | 否 | 否 | 可能 | 服务重启即丢 | 不同步；健康检查不要求持久化 | 本就是临时跨应用数据 |
| 当前文档信息缓存 | 插件目录 `docinfo.cache.json` | 否 | 否 | 是 | 更新可能删除/覆盖 | 本地临时文件；卸载/修复可清理 | 含当前文档元信息且频繁写入 |
| WPS PluginStorage/localStorage | WPS 自身应用数据 | 否 | 否 | 可能含 CWD/会话 ID | WPS 管理 | 不同步、不备份会话态 | 设备与 WPS 版本相关，持久性也不可靠 |
| `machine.env` | 建议 `C:\WPS-AI\machine.env` | 部署层定义 | 禁止 | 是 | 否 | 仅本机创建，ACL 限当前用户 | 含设备名、端口、绝对路径，未来可能含敏感环境变量名 |
| 公共 Skills/Agents/Prompts/Templates | 建议 `%WPS_SYNC_ROOT%\common\...` | 是 | 是 | 应为否 | 不应被上游覆盖 | 作为唯一公共源，按清单复制到本机 | 适合三机共享且易于恢复 |
| 稳定版本清单 | `%WPS_SYNC_ROOT%\versions\stable-version.txt` | 是 | 是 | 否 | 由用户晋级流程更新 | 同时记录版本与完整 SHA | 版本号单独不能唯一定位官方代码 |

## 5. 哪些目录是固定的，哪些可以抽象

### 应接受为本机固定位置

- `%APPDATA%\kingsoft\wps\jsaddons\...`：WPS 加载项和注册文件。
- `%USERPROFILE%\.config\opencode\...`：OpenCode 全局配置、Agents、Plugins，以及当前标准 Skills/Commands。
- Windows 计划任务：机器级运行状态。
- `%USERPROFILE%\.opencode\logs`、`%USERPROFILE%\.wps-office-mcp\logs`、`%USERPROFILE%\.opencode-wps\proofread-sessions`：本机运行数据。

这些位置不应强行用 Junction/Symbolic Link 指向 WPS 云盘。

### 应由部署层抽象的位置

- `WPS_SYNC_ROOT`：每台电脑不同，来自 `C:\WPS-AI\machine.env`。
- 本机 runtime 根：建议默认 `C:\WPS-AI\runtime`，可由 `RUNTIME_ROOT` 覆盖。
- 本机备份根：建议 `C:\WPS-AI\backups`。
- 文档写盘允许根：由每台电脑自己的配置生成。
- Node/OpenCode 可执行路径：安装时解析成绝对路径，避免计划任务 PATH 不一致。

## 6. 方案 A / B 比较

| 维度 | A：直接引用 WPS 同步目录 | B：同步目录为源，复制到本机 |
|---|---|---|
| 路径差异 | 依赖每机注入环境变量 | 安装阶段解析一次即可 |
| WPS 云离线/同步中间态 | 可能让运行配置突然缺失或半更新 | 本机快照继续工作 |
| 高频写入污染 | 容易把缓存/日志写回云盘 | 运行目录与云盘隔离 |
| 回滚 | 共享源回滚可能同时影响三机 | 每机可恢复上一个本地快照 |
| 官方兼容 | 需要给 Launcher 注入自定义配置目录 | 保持官方默认目标路径 |
| 维护复杂度 | 表面少复制，运行耦合更强 | 多一个可审计的同步步骤 |

结论：采用 B。`sync-common.ps1` 只复制由 manifest 管理的公共文件，并以 staging + 原子替换方式发布本地快照；不要用“目标目录全量镜像删除”处理用户自己的 OpenCode 配置。

## 7. 推荐的最终目录分工

### 个人 Fork：代码与部署逻辑的权威源

```text
opencode-wps (origin/my-deploy)
├─ upstream 原有目录
├─ deploy/
│  ├─ install.cmd
│  ├─ update.cmd
│  ├─ repair.cmd
│  ├─ uninstall.cmd
│  ├─ machine.env.example
│  ├─ sync-common.ps1
│  ├─ health-check.ps1
│  └─ lib/
└─ custom/
   ├─ skills/
   ├─ agents/
   ├─ prompts/
   └─ templates/
```

### WPS 云同步目录：公共发布内容

```text
%WPS_SYNC_ROOT%\
├─ common/
│  ├─ skills/
│  ├─ agents/
│  ├─ prompts/
│  ├─ templates/
│  └─ config/
├─ scripts/                 # 从 my-deploy/deploy 发布的入口脚本
├─ versions/
│  └─ stable-version.txt
└─ docs/
   └─ deployment-notes.md
```

### 每台电脑：运行和敏感状态

```text
C:\WPS-AI\
├─ machine.env
├─ runtime\opencode-wps\    # origin/my-deploy 的已锁定本机工作树
├─ managed\                 # 公共内容的本机快照/manifest
├─ backups\                 # 更新前备份，按时间戳/版本保存
├─ logs\                    # 部署脚本自己的日志
└─ state\                   # installed/previous commit、健康状态
```

`machine.env` 建议第一阶段字段：

```dotenv
WPS_SYNC_ROOT=E:\我的云文档\WPS-AI
DEVICE_NAME=OFFICE-PC
RUNTIME_ROOT=C:\WPS-AI\runtime
LOCAL_PORT=14096
LAUNCHER_PORT=14097
```

不要在公共配置里保存 `API_KEY`、Token、Cookie 或用户目录绝对路径。敏感值优先使用用户级环境变量或 Windows 凭据存储；若第二阶段仍使用 env 文件，则必须只存本机并限制 ACL。

## 8. 稳定版本与分支机制

### 分支

- `upstream/main`：官方只读远端。
- `origin/main`：只做官方同步，不放个人部署逻辑。
- `origin/my-deploy`：合并 `origin/main` 后叠加 `deploy/`、`custom/`。
- 暂不创建 `stable` 分支。稳定性由不可变 commit 锁定即可。

### `stable-version.txt` 格式

由于官方无 tag 且版本号会覆盖多个 commit，建议用简单的键值格式：

```text
VERSION=1.9.17
COMMIT=<家里电脑验收通过的 40 位 my-deploy commit SHA>
BRANCH=my-deploy
```

生产更新必须按完整 SHA checkout，并验证：

- SHA 存在于 `origin/my-deploy` 历史中；
- 工作树干净；
- `package.json` 的版本与 `VERSION` 一致；
- 必要时核对批准清单中的哈希；
- 家里电脑验收通过后才修改公共稳定清单。

办公室电脑与笔记本不能执行 `git pull origin my-deploy` 后直接运行，因为分支头会移动；应 `git fetch origin` 后定位稳定 SHA。

## 9. 更新覆盖面与最小定制边界

上游更新会影响：

- `opencode-wps/`：每次重装覆盖 WPS 加载项和 Launcher。
- `wps-office-mcp/`：源、依赖锁、编译产物和 COM 脚本。
- `skills/`、`agents/`、`.opencode/plugins/`：再次安装时覆盖对应同名目标。
- `.opencode/opencode.jsonc` 与 `opencode-wps/config.js`：会影响合并后的 OpenCode 配置、权限和写盘白名单。
- `install-addons.js`：可能改变目标路径、清理范围、计划任务和配置合并逻辑。

因此自定义内容应优先放在新增的 `deploy/` 和 `custom/`，且使用不同于官方的名称。不要直接修改：

- `%APPDATA%\...\opencode-wps_` 中的安装产物；
- `%USERPROFILE%\.config\opencode\...` 中由脚本管理的副本；
- 官方已有 Skill/Agent/Plugin 的同名文件；
- 官方核心 MCP handler，除非已证实部署适配层无法实现。

若必须修改核心代码，应每个问题单独提交，附回归测试，并在 `deploy/patches.md` 记录上游文件、原因和重新合并检查点。

## 10. 安全、隐私与云同步边界

必须排除：

```gitignore
machine.env
.env
.env.*
*.key
secrets/
logs/
cache/
.cache/
backups/
state/
node_modules/
dist/
*.log
*.old
docinfo.cache.json
```

补充风险：

- `opencode.json` 可能直接包含 provider API Key；不能整文件同步。
- `OPCODE_ALLOWED_ROOTS` 暴露本机路径且属于设备差异配置。
- `proofread-sessions/*.json` 可能包含文档内容或修改记录。
- `docinfo.cache.json`、PluginStorage 和会话 ID 属运行状态。
- 官方模板默认 `permission.mode = auto`，会允许所有工具及外部目录。第二阶段安装时应明确展示当前模式；办公室环境如需收紧，可在 `machine.env` 选择 `manual` 或具体目录白名单，不能把这一差异同步给所有电脑。

## 11. 第一阶段发现的缺口

| 需求 | 官方现状 | 第二阶段处理 |
|---|---|---|
| OS/WPS/Node/OpenCode 预检 | 安装器未完整预检 | PowerShell preflight，失败即停止且不改系统 |
| 自动发现 WPS 同步根 | 无 | 候选扫描 + 用户首次选择 + 路径标记文件校验 |
| `machine.env` | 无 | 本机创建、解析、ACL、示例文件 |
| 多机不同路径 | 无专门抽象 | 所有公共入口只读 `WPS_SYNC_ROOT` |
| 稳定版本锁定 | 无 | 版本 + 完整 commit SHA |
| 更新前备份 | 无 | 文件清单式备份，保存 previous commit |
| 更新/回滚 | 无 | staging 构建、健康检查、失败恢复 |
| repair | 无 | 重建 MCP、插件注册、计划任务和公共配置 |
| uninstall | 只有手工文档 | 精确删除受管文件，保留用户非受管配置 |
| 健康检查 | 分散的 `/health`、`/status`、`/diag` | 统一只读检查并输出 WPS/OpenCode/MCP/插件/同步/版本状态 |
| 配置所有权 | 安装器会重写全局配置 | 仅管理 `mcp.wps-office` 等明确字段，更新前备份 |
| Skills 路径兼容 | 项目路径与当前 OpenCode 文档不一致 | 实机 discovery 测试后由适配层安装正确位置 |
| OpenCode 版本兼容 | 只要求已安装，不锁版本 | 记录已验证版本范围；升级 OpenCode 也走家里电脑先验收 |

## 12. 本机只读基线检查

当前执行分析的电脑上：

- Windows 用户目录为 `C:\Users\Administrator`。
- 检测到 WPS `12.1.0.28043` 与 `12.1.0.28505` 两个版本目录，满足官方 `12.1.0+` 的最低声明。
- 可用 Node.js 为 `v24.19.0`，满足 Node 18+；但该命令来自 Codex 自带运行时，不应视为系统已完成 Node/npm 部署。
- 当前 PATH 未发现 npm 或 OpenCode CLI。
- 当前未发现 opencode-wps 插件目录、OpenCode 配置、相关日志、`OpenCodeLauncher` 计划任务或 14096/14097/14098 监听端口。

结论：这台电脑可作为后续“全新安装”测试基线，但正式执行前需要安装可供普通用户会话和计划任务访问的系统 Node/npm 与 OpenCode，不能依赖 Codex 私有运行时路径。

## 13. 第二阶段实施顺序建议

1. 先创建个人 Fork 和 `my-deploy`，不改核心代码。
2. 实现纯读取的 `preflight.ps1` 与 `machine.env` 解析器。
3. 实现稳定清单解析、完整 SHA 校验和本机 runtime staging。
4. 包装官方 `install-addons.js`，加入更新前备份和失败恢复。
5. 实现 `sync-common.ps1`，按 manifest 管理公共 Skills/Agents/Commands/Templates。
6. 实现统一 `health-check.ps1`，至少检查插件文件、注册条目、配置、MCP 入口、计划任务、端口与 WPS COM。
7. 实现 `repair.cmd`，仅重建受管内容；最后实现精确卸载。
8. 在家里工作电脑完成 Writer、Spreadsheets、Presentation、MCP、OpenCode、Add-in 的验收矩阵。
9. 把通过验收的 `my-deploy` 完整 SHA 晋级到 `stable-version.txt`，再让其他两台电脑更新。

## 14. 资料依据

- 官方项目主页与安装说明：<https://github.com/lnxsun/opencode-wps>
- 官方源码中的 Windows 安装器：<https://github.com/lnxsun/opencode-wps/blob/main/install-addons.js>
- 官方 Windows 文档：<https://github.com/lnxsun/opencode-wps/blob/main/docs/WINDOWS.md>
- 官方安装/卸载文档：<https://github.com/lnxsun/opencode-wps/blob/main/docs/INSTALLATION.md>
- 官方问题排查与日志位置：<https://github.com/lnxsun/opencode-wps/blob/main/docs/TROUBLESHOOTING.md>
- OpenCode 配置路径与 `OPENCODE_CONFIG_DIR`：<https://opencode.ai/docs/config>
- OpenCode Agents：<https://opencode.ai/docs/agents>
- OpenCode Skills：<https://opencode.ai/docs/skills>
- OpenCode Commands（可作为 prompts 的标准落点）：<https://opencode.ai/docs/commands>
- OpenCode Plugins：<https://opencode.ai/docs/plugins>

本报告是第一阶段分析，不包含完整部署脚本，也未对当前电脑执行安装、注册、启动或配置写入。
