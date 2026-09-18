# WPS 大会员、云同步与 GitHub 协同的三机部署可行性报告

## 执行摘要

三台 Windows 电脑可以在不引入 NAS 的前提下，形成一套简单、稳定、可维护的 WPS 工作环境。最佳方案不是把所有软件、Git 仓库和运行状态都塞进 WPS 云空间，而是明确划分三种职责：

- **WPS 云空间负责文档资产和小型公共发布包**：日常文档、模板、参考资料、公共 Skills、Agents、Prompts、部署入口和稳定版本清单。
- **GitHub Fork 负责代码事实和版本治理**：`upstream/main` 跟踪官方，`origin/main` 镜像官方，`origin/my-deploy` 保存自己的部署逻辑和文本型定制。
- **每台电脑负责本机运行环境和敏感状态**：WPS 插件、OpenCode、MCP 编译产物、Node 依赖、计划任务、日志、缓存、API Key、设备路径和回滚副本。

推荐采用“**GitHub 是代码权威源，WPS 云是公共发布与文档协作层，本机目录是运行层**”的三层模型。这样既能利用大会员的云空间、多设备访问、同步文件夹、历史版本和恢复能力，又不会让云同步介入 `node_modules`、Git 元数据、日志、缓存或数据库，从而避免大量小文件、文件锁、半同步状态和误删传播带来的不稳定。

WPS 大会员当前可理解为常规高级办公权益与 AI 权益的组合。公开页面显示其覆盖 PDF、图片、模板、云盘及 AI 写作、润色、扩写、缩写、排版、PPT 生成、阅读总结、阅读问答和公式生成等能力；公开权益页同时展示 365G 云空间档位。具体次数、大小、设备数和功能边界会随产品策略与客户端变化，必须以账号内“我的会员/我的云服务”页面为准。[^1][^2]

本方案不替代 WPS 原生 AI。WPS AI 继续承担单文档创作、总结、OCR、PDF、翻译和视觉美化；opencode-wps/MCP 负责可重复的批量操作、跨文件、跨 Sheet、跨 Writer/Spreadsheets/Presentation 和外部模型编排。

## 一、研究边界与证据等级

### 1. 可确认事实

- WPS“文档云同步”会把在 WPS 中打开和编辑的文档保存到云端，支持多设备查看、历史版本和协作。[^3]
- WPS“同步文件夹”是本地文件夹与云端之间的双向同步；本地新增、修改和删除会反映到云端，云端或其他设备的修改也可回到本地。[^4][^5]
- 同名文件夹在不同设备首次关联时，如同名文件内容不同，WPS 可能生成“副本”，而不是自动判断哪一份正确。[^6]
- WPS 提供云回收站、历史版本和本地备份中心等恢复路径，但同步删除仍然会传播，因此同步不能等同于独立备份。[^7]
- opencode-wps 的 Windows 版通过 WPS 加载项、OpenCode 服务、本地 MCP、PowerShell COM 操作当前 WPS 文档。[^8]
- opencode-wps 源码包含打开/保存 Writer、Spreadsheets、Presentation 文件的工具原语，其 Skills 也定义了逐文件批量转换和跨应用工作流。[^9][^10]

### 2. 需要谨慎使用的公开数字

WPS 官方历史教程及近期官网文章公开过以下档位：免费用户 1G、会员最高 365G、会员单文件最大 2G；历史页面还曾写明普通用户可设置 1 个同步文件夹、超级会员可设置 5 个。[^2][^4][^11]

这些数字可用于容量规划，但不能视为 2031 年前固定不变的合同参数。WPS 会员协议明确指出具体会员特权可以增加、删减、替换或调整，不同客户端的可用内容也可能不同。[^12]

因此本报告采用两个原则：

1. 架构不依赖“必须恰好有 365G”或“必须允许 5 个同步文件夹”。
2. 首次部署时从当前登录账号页面记录真实容量、单文件限制、同步文件夹数量和 AI 配额，作为本机验收数据。

### 3. 设备数量存在口径差异

公开资料对设备限制存在不同口径：账号协议页面写有账号累计设备和同类设备限制，部分会员特权页面又规定文档修复、数据恢复等具体服务可绑定三台设备；近期 WPS 内容页则表述个人会员支持三台设备同时在线。[^13][^14]

对三台 Windows 电脑而言，这不是部署失败的理由，但必须纳入验收：

- 三台电脑均使用同一账号登录前，先查看账号安全中心的已授权设备。
- 清除已淘汰、重装前或重复识别的旧设备。
- 分别验证云同步、PDF/文档修复和 AI 权益；某项权益不可用时，先检查该子服务设备绑定，而不是先判断 MCP 出错。
- 不把手机、平板的登录状态与某一特定会员功能的电脑绑定数量混为一谈。

## 二、WPS 大会员权益应该怎样利用

### 1. 权益定位

大会员的实际价值可分为五类：

| 权益类别 | 适合承担的工作 | 与 MCP 的关系 |
|---|---|---|
| 云空间与同步 | 多设备访问、公共文档、模板、归档、同步文件夹 | 为 MCP 提供已落地到本机的输入和输出文件 |
| 历史版本与回收站 | 找回误改、误删和较早文档状态 | 是恢复层之一，但不是批量操作前备份的替代品 |
| PDF/OCR/图片 | PDF 转换、编辑、合并、拆分、OCR、图片处理 | 原生功能更成熟时直接使用，不重复造轮子 |
| 模板与排版 | 稻壳模板、PPT 美化、文档排版 | 用于最终呈现；MCP 负责填充和批量生成 |
| WPS AI | 写作、润色、总结、阅读问答、公式、PPT 生成 | 负责单文档语义和创意任务，MCP 负责编排和确定性步骤 |

大会员不是“自动化平台许可证”。它解决的是 WPS 内部功能、内容资源、云空间与 AI 使用权；opencode-wps/MCP 则把外部模型和可编排工具带入 WPS。两者互补，而不是互相替代。

### 2. 最值得优先使用的权益

对于已经持有至 2031 年的大会员账号，优先级建议为：

1. **云同步与历史版本**：先解决三台电脑的文件一致性和误改恢复。
2. **PDF/OCR**：让扫描件、PDF 合同和图片资料进入可编辑流程。
3. **模板与排版资源**：建立长期复用的 Word/PPT/Excel 模板库。
4. **WPS AI**：用于摘要、改写、语言润色、PPT 结构与单表解释。
5. **MCP 自动化**：在规则明确后处理批量、多文件和跨应用任务。

先建立稳定文件体系，再加自动化，能显著降低“AI 操作了错误副本”或“同步尚未完成就开始批处理”的风险。

## 三、三种 WPS 云能力不能混为一谈

| 能力 | 数据起点 | 同步方向 | 本地路径是否固定 | 适用场景 | 主要风险 |
|---|---|---|---|---|---|
| 文档云同步/自动漫游 | 在 WPS 中打开或保存的文档 | 文档级自动上云 | 原文件路径可以保持 | 最近文档、单文件连续编辑、历史版本 | 不适合管理完整工程目录 |
| 同步文件夹 | 用户选择的本地目录 | 本地与云端双向 | 每台电脑可不同 | 文件树、模板库、自动化输入输出、多设备工作区 | 删除传播、冲突副本、大量小文件 |
| WPS 网盘/智能同步 | 云端已有文件 | 以云端浏览、下载或本地可用为主 | 由客户端缓存/同步策略决定 | 节省本地空间、按需访问归档 | 未本地化文件不一定能被外部程序稳定访问 |

WPS 官方问答曾明确区分：智能同步可以把云端更新下载到本地，但不能替代“把任意本地目录自动上传”的同步文件夹。[^15] 因此，三机部署不能只写“使用 WPS 网盘”，必须明确使用的是哪种模式。

对 opencode-wps/MCP 来说，最重要的条件是**文件已存在为普通本机路径**。当前项目不是 WPS 云盘 API 客户端；它通过 COM 打开本机路径或操作当前活动文档。仅存在于云端、尚未下载或仍是占位符的文件，不应直接进入批处理。

## 四、WPS 云空间的推荐信息架构

### 1. 一个主工作区优于多个零散同步文件夹

历史公开资料曾显示高级会员可建立多个同步文件夹，但为降低配置和冲突，应尽量只使用一个主同步工作区：

```text
WPS-Workspace/
├─ 00-Inbox/                    # 待整理、待自动化处理的输入
├─ 10-Active/                   # 当前项目与日常文档
├─ 20-Shared/                   # 三机共同参考资料
├─ 30-Templates/                # Word / Excel / PPT 模板
├─ 40-Automation/
│  ├─ WPS-AI/
│  │  ├─ common/
│  │  │  ├─ skills/
│  │  │  ├─ agents/
│  │  │  ├─ prompts/
│  │  │  ├─ templates/
│  │  │  └─ config/
│  │  ├─ scripts/
│  │  ├─ versions/
│  │  │  └─ stable-version.txt
│  │  └─ docs/
│  ├─ jobs/
│  │  ├─ inbox/
│  │  ├─ working/
│  │  ├─ output/
│  │  └─ failed/
│  └─ manifests/
├─ 80-Archive/                  # 低频但需跨设备访问的资料
└─ 90-Exchange/                 # 临时分享；定期清理
```

如果现有三台电脑已经各自使用独立的同步根，不必立即迁移全部文档。第一阶段只需确保三台电脑都能得到同一个云端 `WPS-AI` 文件夹，并在各自 `machine.env` 中记录其本地绝对路径。

### 2. 云空间容量预算

即使账号显示 365G，也不建议无边界堆放。可采用以下软配额：

| 区域 | 建议上限 | 理由 |
|---|---:|---|
| `40-Automation/WPS-AI` 控制层 | 500 MB | 正常应远低于此值；防止误放模型、依赖或安装包 |
| `30-Templates` | 10 GB | 足够容纳大量 Office 模板、字体说明和示例资产 |
| `10-Active` | 80 GB | 保持常用文件本地化，搜索和同步速度更可控 |
| `20-Shared` | 40 GB | 参考资料不宜无限增长 |
| `80-Archive` | 200 GB | 低频资料可占主要容量，但不强制三机全部离线可用 |
| 预留空间 | 至少 10% | 给历史版本、临时输出和同步峰值留余量 |

这不是 WPS 强制限制，而是维护建议。公共自动化配置通常只有几十 MB；大会员空间真正应该服务于文档、模板、PDF、图片和归档，不应浪费在 `node_modules` 或 Git 对象上。

### 3. 文件数量比总容量更值得警惕

社区中有大会员用户报告同步文件夹存在约 20,000 个文件和单文件 2GB 的限制，但该文件数没有在本次可访问的官方权益正文中得到同等级确认，只能视为风险信号。[^16]

无论实际上限是多少，以下内容都不应进入同步文件夹：

- `.git/`
- `node_modules/`
- `dist/`、`build/`
- 包管理器缓存
- OpenCode 会话数据库
- 日志和轮转日志
- 临时文件、锁文件和浏览器缓存

这些目录会制造成千上万个小文件，并频繁修改时间戳，是云同步最差的负载类型。

## 五、GitHub 与 WPS 云的权威源划分

### 1. 权威源规则

| 内容 | 权威源 | WPS 云中的角色 | 本机中的角色 |
|---|---|---|---|
| 官方 opencode-wps 源码 | `upstream/main` | 不保存 | 通过 Fork 获取 |
| 自有部署代码 | `origin/my-deploy` | 发布后的只读副本 | 固定 SHA 的运行工作树 |
| Skills / Agents / 文本 Prompts | `origin/my-deploy/custom` | 三机分发副本 | 安装到 OpenCode 标准目录 |
| Office 二进制模板 | WPS 云 `30-Templates` | 权威文件 | 按需本地化、由 WPS/MCP 打开 |
| 稳定版本清单 | 家里电脑验收后发布到 WPS 云 | 三机更新指针 | update 脚本读取 |
| API Key、Token、Cookie | 本机安全存储 | 禁止 | 仅本机运行时使用 |
| 日志、缓存、会话 | 本机 | 禁止 | 可清理/可诊断状态 |

代码型公共内容不能同时允许“直接在 WPS 云改”和“直接在 GitHub 改”。推荐只在 `my-deploy` 修改，测试后用发布脚本复制到 WPS 云，并生成 SHA-256 manifest。WPS 云中的这部分是发布包，不是开发工作树。

Office 模板、参考文档和业务文件则反过来：它们以 WPS 云为权威源，不强行放进 Git。GitHub 只保存模板清单、用途说明和可选哈希，不保存频繁变动的 `.docx/.xlsx/.pptx` 二进制文件。

### 2. Git 分支

```text
upstream/main
  -> origin/main
      -> origin/my-deploy
          -> 家里电脑测试
              -> WPS 云 stable-version.txt
                  -> 办公室电脑、笔记本更新
```

当前官方仓库没有可用 Git tag/GitHub Release，且发布 `1.9.17` 后 `main` 又出现同版本号提交。因此稳定清单必须锁定个人 Fork 中已验收的完整 commit SHA，不能只写版本号。[^8][^17]

建议格式：

```text
VERSION=1.9.17
COMMIT=<40 位 origin/my-deploy 提交 SHA>
BRANCH=my-deploy
PUBLISHED_AT=2026-09-13T00:00:00+08:00
```

### 3. WPS 同步不能触发自动升级

`stable-version.txt` 同步到另外两台电脑后，只表示“有可用稳定版”，不能自动覆盖正在运行的插件。办公室电脑和笔记本必须由用户主动运行 `update.cmd`，脚本再执行：

1. 确认 WPS 同步已完成。
2. 验证稳定清单格式和 commit 存在性。
3. 备份本机配置与当前版本。
4. 在 staging 目录 checkout、安装依赖、构建和测试。
5. 停止 Launcher/OpenCode。
6. 调用官方安装逻辑更新插件和 MCP 配置。
7. 运行健康检查。
8. 成功后记录当前 SHA；失败则恢复上一版本。

这样既利用云同步分发稳定指针，又避免“一次云端改动同时破坏三台机器”。

## 六、三台电脑的首次同步流程

### 1. 家里工作电脑：建立权威云端目录

1. 在本地建立最终的 `WPS-Workspace` 或 `WPS-AI` 目录。
2. 写入一个不会变化的根标记文件，例如：

   ```text
   FILE=WPS-AI-ROOT
   ROOT_ID=6f818a9e-2f91-4b1d-91e0-example
   ```

3. 将它设置为 WPS 同步文件夹。
4. 等待客户端明确显示同步完成。
5. 登录 WPS Web/另一终端确认目录和根标记均已出现。
6. 在家里电脑创建 `C:\WPS-AI\machine.env`，指向本机实际同步路径。

### 2. 办公室电脑和笔记本：关联已有云端目录

不要分别建立三个“内容不同但名字都叫 WPS-AI”的文件夹再让 WPS 猜测如何合并。官方同步规则表明，同名但内容不同可能生成“副本”。[^6]

正确顺序是：

1. 登录同一 WPS 账号并确认设备授权正常。
2. 从云端已有的 `WPS-AI` 目录建立本地同步/下载副本。
3. 等待根标记文件出现。
4. 校验三台电脑的 `ROOT_ID` 相同。
5. 再分别写入各自的 `C:\WPS-AI\machine.env`。
6. 做一次小文件往返测试，确认没有出现 `-副本`、`冲突` 或重复目录。

如果当前 WPS 客户端只提供“添加本地同步文件夹”而没有明确的“将已有云端目录同步到此处”，应先用空目录测试客户端的关联行为，不能直接拿已有业务目录试验。

### 3. 每台电脑不同路径完全可行

```text
家里：   D:\WPS同步\WPS-AI
办公室： E:\我的云文档\WPS-AI
笔记本： C:\Users\xxx\Documents\WPS同步\WPS-AI
```

公共脚本只能通过 `WPS_SYNC_ROOT` 访问同步内容。任何公共文件中出现具体用户名或盘符都应视为验收失败。

## 七、适合云同步与不适合云同步的内容

### 1. 适合

- `.docx`、`.xlsx`、`.pptx`、PDF 和常用图片。
- 经人工确认的 Office 模板。
- 公共 Skills、Agents、Prompts、说明文档。
- 小型 PowerShell/CMD 部署入口。
- `stable-version.txt`、发布 manifest 和校验值。
- MCP 批处理的输入与最终输出。

### 2. 不适合

- Git 工作树和 `.git`。
- `node_modules`、`dist` 和编译缓存。
- WPS 加载项目录 `%APPDATA%\kingsoft\wps\jsaddons`。
- `%USERPROFILE%\.config\opencode\opencode.json`。
- OpenCode/MCP 日志和会话数据。
- `proofread-sessions`、`docinfo.cache.json`、PluginStorage。
- API Key、Token、Cookie、账号导出、凭据文件。
- 正在被程序高频重写的 SQLite/数据库文件。

WPS 官方说明传输和底层存储采用加密保护，并通过等保三级测评；这并不等于用户持有密钥的端到端加密。[^3] 因此账号凭据和部署密钥仍然禁止进入 WPS 云。办公室电脑上的单位敏感资料是否允许进入个人 WPS 云，还必须服从单位的数据分类和云存储政策。

## 八、WPS AI 与 MCP 的最佳协作方式

### 1. 分工原则

| 任务 | 首选 WPS 原生能力 | 首选 MCP/OpenCode |
|---|---:|---:|
| 单篇写作、润色、摘要、翻译 | 是 | 可补充自定义模型 |
| OCR、PDF 编辑/转换、图片处理 | 是 | 只在需编排命名/归档时介入 |
| PPT 模板和视觉美化 | 是 | 负责批量填充、结构生成和跨文件取数 |
| 同一表格内多 Sheet 规则处理 | 可辅助 | 是 |
| 多个 Word/Excel/PPT 顺序处理 | 否 | 是 |
| 从 Excel 生成多份合同/报告 | 否 | 是 |
| 可复用、可审计的自定义工作流 | 否 | 是 |
| 云端文件传输和历史版本 | 是 | 否 |

### 2. 四个高价值工作流

#### 工作流 A：Excel 名单批量生成 Word 文档

1. 名单和模板保存在同步工作区。
2. WPS 原生功能完成模板设计和必要的 PDF/OCR 转换。
3. MCP 读取 Excel 多行数据，逐份打开 Word 模板、填字段、另存为独立文件。
4. 输出写入带日期的 `jobs/output/<job-id>`，不覆盖模板。
5. WPS 同步输出到其他设备，人工抽检后归档。

#### 工作流 B：多份周报汇总成总表和汇报 PPT

1. 各周报进入 `00-Inbox/<week>`。
2. MCP 逐个打开并提取结构化字段，写入汇总 Excel。
3. MCP 从汇总表生成 PPT 初稿。
4. WPS AI 做摘要、标题优化和视觉美化。
5. 最终文件进入 `10-Active`，原始输入移入 Archive。

#### 工作流 C：批量文档转 PDF 并规范命名

如果只是少量文件转换，直接使用大会员 PDF 能力。如果需要“扫描目录、按规则命名、逐份转换、生成清单、汇总失败项”，再使用 MCP 编排 WPS 的打开和导出能力。opencode-wps 的 Skills 明确给出了“扫描文件夹、逐个打开并导出、报告结果”的批量思路。[^10]

#### 工作流 D：长文档校对

WPS AI 用于语义建议，opencode-wps 的校对工作流用于分批读取、记录进度、生成校对报告和执行规则治理。校对会话数据留在本机，不进入云同步；完成后的文档和报告才进入 WPS 云。

### 3. 当前 GitHub 项目的能力边界

从源码看，项目确实具备打开 Writer 文档、Workbook 和 Presentation、保存/另存为、导出和跨应用操作的工具原语。[^9] 但它不是一个云端批处理服务：

- Windows 端依赖本机 WPS 和 COM。
- 操作对象通常是当前活动实例或逐个打开的文件。
- 大批量任务应顺序或小批执行，不要并行操纵同一个 WPS 实例。
- 云端文件必须先稳定落地到本机路径。
- 批量操作前必须创建本地快照；WPS 历史版本只作为第二道恢复手段。
- 当前项目更新频繁，Launcher、权限、超时和 Windows 进程管理在近期仍持续修复。[^17]

## 九、同步可靠性规则

### 1. 单写者规则

- `stable-version.txt` 只由家里工作电脑晋级流程写入。
- `scripts/`、`skills/`、`agents/`、`prompts/` 的发布副本只由 GitHub 发布流程写入。
- Office 模板指定一台电脑作为主编辑端；其他电脑修改前确认无人正在编辑。
- 自动化 job 使用唯一目录，不让两台电脑同时消费同一个 `inbox` 文件。

### 2. 作业目录状态机

```text
inbox/<job-id>
  -> working/<DEVICE_NAME>/<job-id>
      -> output/<job-id>
      -> failed/<job-id>
```

领取任务时先把整个 job 目录移动到设备专属 `working` 目录。这样即使三台电脑都在线，也不会同时处理同一批文件。

### 3. 更新发布顺序

发布公共配置时应遵循：

1. 先上传所有新文件到版本化目录。
2. 生成 SHA-256 manifest。
3. 等待 WPS 显示同步完成。
4. 最后更新 `stable-version.txt`。

消费者应先校验 manifest，再安装。稳定指针先到、文件后到属于未完成发布，必须拒绝更新并稍后重试。

### 4. 冲突处理

发现 `-副本`、`冲突` 或重复根目录时：

1. 立即暂停三台电脑的自动化更新。
2. 不自动删除任何一份。
3. 对比修改时间、大小、SHA-256 和内容。
4. 在家里电脑确定保留版本。
5. 通过 WPS 历史版本或回收站恢复遗漏内容。
6. 同步完全稳定后再恢复自动化。

## 十、备份与恢复策略

WPS 同步会同步删除，不能独立承担备份。WPS 回收站、历史版本、本地备份中心和磁盘 `$RECYCLE.WPS` 提供多条恢复路线，但它们的保留策略和可用性仍由 WPS 服务控制。[^7]

建议保留三层恢复：

| 层 | 内容 | 位置 | 用途 |
|---|---|---|---|
| Git 历史 | 代码、部署脚本、文本配置 | GitHub Fork | 恢复任意已提交版本 |
| WPS 历史/回收站 | Office 文档和模板 | WPS 云 | 恢复误改、误删 |
| 本机更新快照 | 插件、OpenCode/MCP 关键配置、版本号 | `C:\WPS-AI\backups` | 部署升级失败时快速回滚 |

批量自动化额外遵循“不覆盖原件”：输入只读，结果写入新的 `output/<job-id>`。只有人工验收后，才允许替换正式文件。

## 十一、与第一阶段部署分析合并后的最终架构

```text
GitHub
├─ upstream/main                      官方更新
└─ origin
   ├─ main                            官方镜像
   └─ my-deploy                       部署与公共文本配置权威源
        │
        │ 家里电脑测试并发布
        ▼
WPS 云同步目录（每机绝对路径可不同）
├─ common/                            公共发布包
├─ scripts/                           安装/更新/修复/卸载入口
├─ versions/stable-version.txt        稳定 commit 指针
├─ templates/                         Office 模板权威源
└─ jobs/                              批处理输入输出
        │
        │ 用户主动 install/update + 校验
        ▼
每台电脑 C:\WPS-AI
├─ machine.env                        本机路径、设备名、端口
├─ runtime\opencode-wps               固定 SHA 的 Fork 工作树
├─ managed                            公共配置本机快照
├─ backups                            更新前备份
├─ logs                               部署日志
└─ state                              当前/上一版本
        │
        ├─ %APPDATA%\kingsoft\wps\jsaddons\opencode-wps_
        ├─ %USERPROFILE%\.config\opencode\...
        └─ OpenCodeLauncher 计划任务
```

继续采用第一阶段推荐的方案 B：WPS 云同步目录作为源，安装脚本复制到本机标准目录。这里正是利用 WPS 同步文件夹让三台电脑在同步完成后获得一致的公共内容；不同电脑的盘符和绝对路径不影响内容一致性。复制到本机标准目录的目的，是形成可校验、可回滚的运行快照，避免安装过程正好读到尚未同步完整的一组文件，而不是另建一套互不相干的公共内容。OpenCode 官方支持自定义配置目录，但直接让运行时引用云同步目录会把服务可用性绑定到同步状态，不符合“稳定优先”。[^18]

## 十二、实施计划

### 阶段 0：账号与云能力核验

- 在 WPS 客户端记录：会员名称、到期日、剩余云空间、单文件上限、同步文件夹数量、AI 配额。
- 查看设备管理，确认三台电脑均可正常登录和使用所需子权益。
- 确认办公室资料允许进入个人 WPS 云。
- 在三机安装相同或已验证兼容的 WPS 版本。

### 阶段 1：建立统一云根

- 家里电脑创建权威 `WPS-AI` 根和 `ROOT_ID`。
- 办公室电脑与笔记本关联云端已有目录。
- 验证新增、修改、删除、离线恢复和冲突副本行为。
- 确认脚本在中文路径、空格路径和不同盘符下都能读取。

### 阶段 2：建立 Fork 和稳定发布

- 创建个人 Fork。
- 配置 `upstream` 与 `origin`。
- 创建 `my-deploy`。
- 添加 `deploy/`、`custom/` 和发布 manifest。
- 用完整 commit SHA 管理稳定版本。

### 阶段 3：开发最小部署工具

- `install.cmd`
- `update.cmd`
- `repair.cmd`
- `uninstall.cmd`
- `sync-common.ps1`
- `health-check.ps1`
- 配置备份/恢复
- stable commit 校验和失败回滚

### 阶段 4：家里电脑验收

- Writer：打开、读取、修改、保存、另存为、长文档校对。
- Spreadsheets：多 Sheet 读取、批量写入、公式、图表。
- Presentation：打开、创建幻灯片、写入内容、导出。
- 跨应用：Excel → Word、Word → PPT。
- 批量：至少 10 个测试文件，验证失败汇总和不中断策略。
- WPS 云：输出同步到另外两台设备且无副本冲突。
- 回滚：人为制造构建失败，验证恢复上一 commit。

### 阶段 5：办公室和笔记本推广

- 只读取已晋级的稳定 SHA。
- 每台电脑独立备份和安装。
- 不自动追踪 GitHub latest。
- 记录设备特有问题，不把临时修复直接写入公共云配置。

## 十三、最终验收标准

### 云空间

- 三台电脑的 `ROOT_ID` 一致。
- 三机本地路径不同但脚本无需修改。
- 云端没有 `.git`、`node_modules`、日志、缓存、API Key 或会话数据库。
- 公共发布包有 manifest 和 SHA-256 校验。
- 存储使用量留有至少 10% 空间。

### 同步可靠性

- 新增、修改、删除和恢复流程均做过实测。
- 同名冲突不会被脚本自动删除。
- `stable-version.txt` 总是最后发布。
- WPS 未完成同步时 install/update 会拒绝继续。

### GitHub 与升级

- `origin/main` 无个人定制。
- `my-deploy` 可持续合并 `upstream/main`。
- 生产机按完整 SHA 更新。
- 办公室电脑和笔记本不会自动追官方最新版。
- 升级失败可恢复上一运行版本。

### WPS 与 MCP

- 不禁用 WPS 原生 AI。
- 当前云端文件必须本地化后才进入 MCP 任务。
- 批量操作不覆盖输入原件。
- 同一个 WPS 实例不进行并行 COM 写操作。
- Writer、Spreadsheets、Presentation 和跨应用流程均通过实测。

## 十四、最终建议

这套方案可行，而且已有 WPS 大会员会显著提高它的实用价值。但“大空间”不应成为把所有技术目录上云的理由。最稳妥的做法是：

1. 用 WPS 云保存真正需要跨设备访问、版本恢复和协作的文档资产。
2. 用 GitHub 管理代码、部署脚本和文本型配置的历史与合并。
3. 用本机固定目录运行 opencode-wps、MCP 和依赖。
4. 用 WPS 云中的稳定清单连接 GitHub 发布与三机升级，但永不自动升级。
5. 用 WPS AI 完成它擅长的单文档智能处理，用 MCP 连接多个文件和多个步骤。

在这个边界下，WPS 云空间得到充分使用，同时不会成为程序运行、密钥存储或数据库同步层。方案符合“简单优先、稳定优先、可恢复优先、少依赖、兼容官方更新”的目标。

## 十五、已落地状态与三机推广清单（2026-09-18）

方案已经在家里笔记本 `HOME-LAPTOP` 完成首台落地，不再只是设计稿：

- GitHub Fork 为 `imuqiu/opencode-wps`，部署分支为 `my-deploy`；运行版本始终锁定完整 commit SHA。
- WPS 公共同步根为本机 `F:\WPS-AI`，根 ID 为 `443ec43b-be56-46e1-9fea-abfcbd5a4d70`；其他电脑可以使用不同盘符，但必须同步到同一个根 ID。
- 系统 Git、Node.js、npm、OpenCode、WPS Add-in、MCP、Launcher 计划任务均已安装。
- 发布包包含 27 个受 SHA-256 manifest 保护的文件；缺文件、内容被改或根 ID 不符都会拒绝安装。
- Windows PowerShell 5.1 与 PowerShell 7 的部署测试均为 13/13 通过。
- OpenCode 1.18.31 的 `/global/health` 返回健康，`wps-office` MCP 显示 connected。
- WPS Writer、Spreadsheets、Presentation 均通过独立 COM 创建、保存和关闭文件的实机测试。
- 安装失败演练已两次触发并成功恢复旧 runtime、Add-in 和计划任务；更新流程另包含停服务、staging 切换、Launcher 验活和失败恢复。

推广顺序固定为：

1. `HOME-LAPTOP`：低频使用，承担 primary 发布与先行验收。
2. `OFFICE-PC`：第二台安装，观察至少一个工作日。
3. `SHOP-PC`：使用最频繁，最后安装，只接受已经在前两台通过的稳定 SHA。

办公室电脑和店铺电脑只需要先完成四件事：安装并登录同一 WPS 账号、把云端已有的 `WPS-AI` 同步到一个普通本地目录、等待 `ROOT_ID.txt` 与 `versions/stable-version.txt` 完整出现、用各自设备名生成本机 `C:\WPS-AI\machine.env`。系统依赖缺失时先运行 `scripts\bootstrap-dependencies.cmd`；之后从同步目录运行 `scripts\preflight.cmd` 和 `scripts\install.cmd`，安装完成后运行 `scripts\health-check.cmd`。

依赖审计目前报告 10 个传递依赖问题（1 低、4 中、5 高、0 严重），主要位于 MCP 的开发/间接依赖树。由于直接执行 `npm audit fix` 可能改写官方 lockfile 并破坏可复现性，本方案不在三台生产机上原地自动修复；应在 `my-deploy` 独立分支升级、构建、测试后再发布新的稳定 SHA。Launcher 和 OpenCode 仅监听 `127.0.0.1`，这会降低外部网络暴露，但不能替代后续依赖升级。

最后仍需由用户在 WPS 客户端完成两项人工验收：三台电脑的同步新增/修改/删除/恢复测试，以及当前大会员账号的容量、设备数和具体 AI 配额记录。这两项属于账号和云端状态，部署器不能代替用户确认。

## Sources

[^1]: WPS，新会员权益对比页，“[WPS新会员介绍页](https://personal-act.wps.cn/vcl/h5_privilege_list?entrance=guideLogin&from=login&position=0&vcl_cli=android&version=1134)”，访问于 2026-09-13。页面列出超级会员/大会员的功能与 AI 权益类别；具体账号权益以登录后显示为准。
[^2]: WPS，“[WPS超级会员有什么用？一张表看懂核心权益与值不值得开](https://www.wps.cn/article/PpOg3z06.html)”，2026-08-27。公开说明 PDF、模板、AI 与 365G 云空间定位。
[^3]: WPS 学堂，“[云文档：一键开启文档云同步](https://www.wps.cn/learning/article/detail/id/12342)”，2020-05-23。说明文档云同步、多端访问、历史版本、分享以及传输/存储保护。
[^4]: WPS 学堂，“[还在用微信、QQ反复传文件？这个方法帮你文件多端实时同步](https://www.wps.cn/learning/article/detail/id/330472)”，2021-11-17。说明同步文件夹、双向访问、公开容量和单文件档位。
[^5]: WPS 学堂，“[如何批量备份指定的本地文件夹？同步文件夹来帮你](https://www.wps.cn/learning/question/detail/id/330726.html)”，2022-05-05。明确新增、更新、删除和文件夹变更会同步到云端。
[^6]: WPS 学堂，“[WPS网盘文件夹同步规则](https://www.wps.cn/learning/question/detail/id/331543)”，2020-08-10。说明多设备同名目录在内容不同情况下可能产生副本。
[^7]: WPS 服务中心，“[文件/数据内容丢失怎么办？](https://helpdesk.wps.cn/detail?art_index=0&id=2175&module_title=%E6%90%9C%E7%B4%A2)”，更新于 2026-05-26。列出云回收站、历史版本、本地备份中心和 `$RECYCLE.WPS` 等恢复方式。
[^8]: lnxsun，“[opencode-wps](https://github.com/lnxsun/opencode-wps)”，GitHub，访问于 2026-09-13。项目架构、Windows 安装、WPS 加载项、MCP、Agents、Skills 和 Launcher。
[^9]: lnxsun，“[WPS MCP Word document tools](https://github.com/lnxsun/opencode-wps/blob/5b335bf23fe1b78a8487564399d8b3999a94fc76/wps-office-mcp/src/tools/word/document.ts)”“[Excel workbook tools](https://github.com/lnxsun/opencode-wps/blob/5b335bf23fe1b78a8487564399d8b3999a94fc76/wps-office-mcp/src/tools/excel/workbook.ts)”“[Presentation tools](https://github.com/lnxsun/opencode-wps/blob/5b335bf23fe1b78a8487564399d8b3999a94fc76/wps-office-mcp/src/tools/ppt/presentation.ts)”，commit `5b335bf`，访问于 2026-09-13。
[^10]: lnxsun，“[wps-office Skill](https://github.com/lnxsun/opencode-wps/blob/5b335bf23fe1b78a8487564399d8b3999a94fc76/skills/wps-office/SKILL.md)”，commit `5b335bf`。定义跨应用与逐文件批量处理流程。
[^11]: WPS 学堂，“[文档无法上传怎么办](https://www.wps.cn/learning/question/detail/id/331281)”，2020-06-03；“[文档保存时限制文件太大，无法上传怎么办](https://www.wps.cn/learning/question/detail/id/334104)”，2024-09-19。公开过免费/会员容量和单文件上限；当前值仍须账号内核验。
[^12]: WPS，“[WPS会员服务使用协议](https://www.wps.cn/privacy/vipserve)”，页面标示更新于 2021-11-04，访问于 2026-09-13。说明会员特权及客户端差异可能调整。
[^13]: WPS，“[金山办公在线服务系列协议](https://www.wps.cn/privacy/full_account)”，访问于 2026-09-13。包含账号设备上限及“具体子服务另有规定则从其规定”的条款。
[^14]: WPS 会员中心，“[文档修复](https://vip.wps.cn/privilege_page/privilege_detail?id=1)”；WPS，“[会员登录设备数](https://365.wps.cn/content/880f6b5cd96e4439b41a3c61ae2025ed.html)”，2026-08-10。显示不同服务/页面的设备限制口径。
[^15]: WPS 学堂，“[如何将电脑目录和云文档同步](https://www.wps.cn/learning/room/d/321479)”，访问于 2026-09-13。区分智能同步与本地文件夹自动上传。
[^16]: WPS 官方社区，“[同步文件夹话题](https://forum.wps.cn/topics/tag/142)”，其中 2024-07-21 用户报告约 20,000 文件限制。该项为社区实测反馈，并非本报告确认的官方承诺。
[^17]: lnxsun，“[CHANGELOG](https://github.com/lnxsun/opencode-wps/blob/main/CHANGELOG.md)”，访问于 2026-09-13。显示近期 Windows Launcher、超时、权限、日志和稳定性修复。
[^18]: OpenCode，“[Config](https://opencode.ai/docs/config)”，访问于 2026-09-13。说明全局配置目录、`OPENCODE_CONFIG` 和 `OPENCODE_CONFIG_DIR`。
