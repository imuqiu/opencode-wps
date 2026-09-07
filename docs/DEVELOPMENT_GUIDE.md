# 开发指南（Wiki 级）

本文档是 opencode-wps 的**完整开发手册**，面向开发者/贡献者，覆盖：开发环境搭建、项目结构、五大模块（插件/MCP/Skills/Agents/安装脚本）的开发指南、开发流程、代码规范、提交规范、测试、CI/CD 门禁、二次开发与常见问题。

> 📖 架构与设计见 [ARCHITECTURE.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/ARCHITECTURE.md)；代码审查规范见 [CODE_REVIEW_GUIDE.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/CODE_REVIEW_GUIDE.md)；WPS JS 加载项专项开发见 [WPSJS_DEVELOPMENT.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/WPSJS_DEVELOPMENT.md)。

---

## 目录

- [一、开发环境](#一开发环境)
- [二、项目结构](#二项目结构)
- [三、模块开发指南](#三模块开发指南)
- [四、开发流程](#四开发流程)
- [五、代码规范](#五代码规范)
- [六、提交规范](#六提交规范)
- [七、测试](#七测试)
- [八、CI/CD 门禁](#八cicd-门禁)
- [九、二次开发](#九二次开发)
- [十、常见问题](#十常见问题)
- [十一、联系方式](#十一联系方式)

---

## 一、开发环境

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| **操作系统** | Windows 10/11（主）/ macOS 12+ / Linux | Windows 是完整支持平台（COM 桥接） |
| **WPS Office** | 12.1.0+（Win 个人版或企业版） | Mac/Linux 用最新版 |
| **Node.js** | 18.0.0+（或 Bun 1.0+） | MCP 服务器为 TypeScript |
| **npm** | 随 Node.js | 依赖安装 |

### 环境准备

```bash
# 1. 克隆仓库
# 国内（CNB 镜像）：git clone https://cnb.cool/lnxsun/opencode-wps.git
# 国外（GitHub）：git clone https://github.com/lnxsun/opencode-wps.git
git clone https://github.com/lnxsun/opencode-wps.git
cd opencode-wps

# 2. 安装根依赖
npm install

# 3. 安装并编译 MCP 服务器
cd wps-office-mcp
npm install
npm run build
cd ..

# 4. 安装插件到本机
node install-addons.js        # Windows
# node install-addons-mac.js  # macOS
# node install-addons-linux.js# Linux

# 5. 重启 WPS Office，功能区出现 OpenCode AI 标签页
```

---

## 二、项目结构

```
opencode-wps/             # 仓库根目录
├── .opencode/             # 治理插件 + OpenCode 配置模板（仓库顶层）
│   ├── plugins/governance.js   # 执行治理（G1-G7 + P1-P16 + T1-T11）
│   └── opencode.jsonc          # OpenCode 配置模板
├── opencode-wps/          # Windows JS 插件（Chat UI + Launcher）
├── opencode-wps-assistant/# macOS JS 插件（反向轮询桥）
├── opencode-wps-linux/    # Linux JS 插件（反向轮询桥）
├── shared/wps-bridge/     # 跨平台共享层（单一来源）：response/registry/common-core/handler-utils
│   └── （由 scripts/sync-wps-bridge.js 同步到 Mac/Linux 平台目录）
├── wps-office-mcp/        # MCP 服务器（TypeScript，三层工具）
├── skills/                # 5 个 WPS Skills
├── agents/                # 4 个 WPS Agents
├── scripts/               # 校验/工具脚本（validate-*）
├── tests/                 # 测试文件
├── docs/                  # 文档中心
├── install-addons*.js     # 三平台一键安装脚本
├── launcher-mac.js        # macOS Launcher 进程
├── launcher-linux.js      # Linux Launcher 进程
└── package.json           # 根命令
```

### 关键路径与安装映射

| 源目录（git 跟踪） | 安装目标（非 git 跟踪） |
|--------------------|------------------------|
| `opencode-wps/` | `%APPDATA%\kingsoft\wps\jsaddons\opencode-wps_` |
| `wps-office-mcp/` | MCP 编译产物 + `~/.config/opencode/opencode.json` 配置 |
| `skills/` | `~/.opencode/skills/` |
| `agents/` | `~/.config/opencode/agents/` + `~/.opencode/agents/` |
| `.opencode/plugins/` | `~/.config/opencode/plugins/` |

> ⚠️ **铁律**：只编辑源文件，然后运行 `node install-addons.js` 同步；**绝不**直接编辑安装产物目录。每次改动后用 `git status` 核对，避免改错目录。

---

## 三、模块开发指南

### 3.1 WPS 插件（`opencode-wps/`，Windows）

核心文件：

| 文件 | 职责 |
|------|------|
| `main.js` | Ribbon 回调、状态管理、OpenCode 连接 |
| `taskpane.html` | Chat UI（SSE 流式、Markdown 渲染、会话/Agent 管理） |
| `launcher.js` | 后台 Launcher 进程（管理 OpenCode 服务） |
| `opencode-proxy.js` | CORS 代理（端口 14098，剥离 CSP 头） |
| `config.js` | 全局配置中心（`CONFIG` 对象） |
| `ribbon.xml` | 功能区按钮定义 |
| `manifest.xml` | 插件清单 |
| `serve.js` | 开发静态服务器（端口 3444，仅开发用） |

**开发要点**：
- 所有文件路径必须使用**绝对路径**
- 前端与后端通过 `config.js` 共享 `CONFIG`
- Chat UI 用 SSE 流式（`XMLHttpRequest`，禁用 `fetch`）

### 3.2 MCP 服务器（`wps-office-mcp/`，TypeScript）

```
wps-office-mcp/
├── src/
│   ├── server/           # MCP server 入口
│   ├── client/           # 跨平台路由（Win→PowerShell COM, Mac/Linux→HTTP poll）
│   │   ├── wps-client.ts
│   │   ├── mac-poll-server.ts   # Mac 反向轮询（Linux 复用本类）
│   │   ├── linux-poll-server.ts # Linux 轮询
│   │   └── wps-keepalive.ts    # 跨平台服务保活（Win/Mac 探测 :58890，Linux 探测 WPS 主进程）
│   ├── tools/            # 三层工具
│   │   ├── index.ts      # 注册工具（allTools）
│   │   ├── gateway/      # Gateway（COM_ACTIONS 索引，数据表已拆到 com-actions.ts）
│   │   ├── common/       # 通用工具
│   │   ├── excel/        # Excel 工具
│   │   ├── word/         # Word 工具
│   │   └── ppt/          # PPT 工具
│   ├── types/            # 类型定义
│   └── utils/
│       ├── path-safety.ts # 路径安全（validateFilePath）
│       ├── error.ts       # 错误处理工具
│       ├── launcher.ts    # Launcher 工具函数
│       └── logger.ts      # 日志工具
├── scripts/              # Windows COM 脚本（wps-com.ps1 等）
└── package.json
```

#### 三层工具体系

（理解 MCP 开发的关键）

| 层级 | 数量 | 命名 | 注册/调用方式 |
|------|------|------|---------------|
| 内置工具 | 12 | `wps_xxx` | 启动即注册，始终可用（含 `wps_office_search`/`wps_office_execute` Gateway；另含 2 个缓存内置工具 `wps_list_cache`/`wps_clear_cache`，完整清单见 [SKILLS.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/SKILLS.md#内置工具12-个所有-skill-共用)） |
| 注册工具 | ~240 | `wps_xxx_xxx` | 经 `tools/index.ts` 注册，Gateway 路由，有完整 TS handler |
| COM Actions | ~257 | 短名称 | `wps_office_search` → `wps_office_execute` → PS1 兜底 |

> 📚 **交叉参考**：内置工具完整清单与两级网关调用规范详见 [SKILLS.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/SKILLS.md#内置工具12-个所有-skill-共用)；运行时端口/Launcher 管理（14096/14097/14098）与使用侧配置详见 [USAGE.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/USAGE.md#63-端口速查)。

**开发流程**（新增一个工具）：
1. 在 `src/tools/<category>/` 下新建 handler（类型安全 + 参数校验）
2. 在 `tools/index.ts` 的 `allTools` 注册
3. （如需 COM 透传）在 `gateway/index.ts` 的 `COM_ACTIONS` 登记
4. `npm run build` 编译
5. 运行 `npm run validate:toolcounts` 校验工具数量
6. 重启 OpenCode 生效

**关键约定**：
- 所有接受文件路径的 handler 必须用 `validateFilePath()`（来自 `utils/path-safety.ts`）且在 `try` 块内调用
- 新增/修改后跑单元测试与工具数量校验

### 3.3 Skills（`skills/`）

5 个 WPS 专用 Skills：`wps-excel`、`wps-word`、`wps-ppt`、`wps-office`、`wps-proofread`。

每个 Skill 目录结构：
```
skills/wps-word/
├── SKILL.md    # Skill 定义（必需）
└── README.md   # 使用说明
```

> 📖 修改 Skills 前**必读** `skills/README.md`；每个 Skill 的详细用法见 [SKILLS.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/SKILLS.md)。

**开发流程**：
1. 编辑 `skills/<name>/SKILL.md`（或 README.md）
2. 运行 `node install-addons.js` 同步到 `~/.opencode/skills/`
3. 重启 OpenCode 使新 Skill 生效

### 3.4 Agents（`agents/`）

4 个 Agents：`wps-expert`、`wps-word`、`wps-excel`、`wps-ppt`。定义文件含 frontmatter（description/mode/color/tools）。

**开发流程**：
1. 编辑 `agents/*.md`
2. `node install-addons.js` 同步到 `~/.config/opencode/agents/` + `~/.opencode/agents/`
3. 重启 OpenCode 生效

### 3.5 治理插件（`.opencode/plugins/governance.js`）

通过 OpenCode Plugin Hooks（`tool.execute.before`/`after`）拦截所有 MCP 工具调用：

- **G1-G7**：Gateway 强制、破坏性操作确认、路径安全、密码保护、参数校验
- **P1-P16**：校对规则（批 ≤200、严格 proofread→confirm→fix 顺序）
- **T1-T11**：模板填值规则（评估文档、批 ≤200、修订追踪、不编造字段）

**开发流程**：
1. 修改 `governance.js`
2. `node install-addons.js` 同步到 `~/.config/opencode/plugins/`
3. 重启 OpenCode 生效

> ⚠️ 治理规则有配套 CI 校验（validate-settings 等），改动需保证 CI 通过。

### 3.6 安装脚本（`install-addons*.js`）

三平台一键安装脚本（Windows/macOS/Linux 各 7-8 步）：安装插件、编译 MCP、配置 OpenCode、同步 Skills/Agents/Plugins、注册自启。实现细节见 [INSTALL_SCRIPT.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/INSTALL_SCRIPT.md)。

### 3.7 跨平台共享层（`shared/wps-bridge/`）

**背景**：Mac 与 Linux 反向轮询桥存在大量同构 handler 代码（`response.js`/`registry.js`/`common-handler.js`），历史上改一个 bug 需在两平台各改一遍、极易漏改。本次重构将其收敛为**单一来源（single source of truth）**：

```
shared/wps-bridge/                 # 单一来源（git 跟踪，改这里）
├── response.js                    # 响应工具（ok/fail/invalidParam）
├── registry.js                    # handler 注册表
├── common-core.js                 # 通用 handler 核心（平台差异经 BRIDGE_PLATFORM 隔离）
└── handler-utils.js               # 平台无关纯工具函数（excel/ppt/word 共用）
        │  由 scripts/sync-wps-bridge.js 同步生成
        ▼
opencode-wps-assistant/            # macOS 平台产物（生成，勿手编）
    ├── utils/response.js
    └── handlers/{registry.js, common-handler.js, handler-utils.js}
opencode-wps-linux/                # Linux 平台产物（生成，勿手编）
    ├── utils/response.js
    └── handlers/{registry.js, common-handler.js, handler-utils.js}
```

**核心规则**：
- **编辑源**：只改 `shared/wps-bridge/*.js`，平台目录文件是**生成产物**，禁止手工编辑（顶部注释已标明）。
- **同步**：改完源后运行 `node scripts/sync-wps-bridge.js` 重新生成平台产物。
- **平台差异**：通过全局 `BRIDGE_PLATFORM`（`'mac' | 'linux'`）隔离，由同步脚本按平台注入。例如 `ensureOutputDir`（saveAs/convertToPDF 前置校验输出目录）仅在 `BRIDGE_PLATFORM==='mac'` 启用。
- **CI 漂移门禁**：`.cnb.yml` 用 `node scripts/sync-wps-bridge.js --check` 校验平台产物与共享层无漂移；本地用 `node scripts/sync-wps-bridge.js --check` 自查。
- **重复率基线**：`node scripts/sync-wps-bridge.js --report` 输出未单源化 handler（excel/ppt/word）在 mac/linux 间的归一化重复率基线，用于量化清理收益（Issue #189）。**只读模式**：不写回平台文件、不触发漂移校验。
- **测试**：`node tests/wps-bridge-shared.test.js`（单源一致性/生成正确性/平台差异隔离/漂移检测）。

> 💡 详细架构说明见 [ARCHITECTURE.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/ARCHITECTURE.md)「共享层说明」。

---

## 四、开发流程

### 1. 本地开发

见 [第一节](#一开发环境)。开发时常用命令：

```bash
# 构建 MCP 服务器
npm run build

# 安装 MCP 依赖
npm run mcp:install

# 运行 MCP 测试
npm run mcp:test

# 格式化代码
npm run format
npm run format:check
```

### 2. 创建功能分支

```bash
git checkout -b feat/your-feature
```

### 3. 修改代码（按模块）

- **Skills**：编辑 `skills/` → `node install-addons.js`
- **Agents**：编辑 `agents/` 或安装后的 `~/.config/opencode/agents/`（后者为产物）
- **MCP**：编辑 `wps-office-mcp/src/` → `npm run build`
- **插件**：编辑 `opencode-wps/` 下 JS/HTML 文件
- **治理**：编辑 `.opencode/plugins/governance.js` → 同步

### 4. 本地验证

```bash
# 统一预检门禁（validate 系列 + format:check + lint + test + test:e2e，提交 PR 前必跑）
# 前置条件：需先安装 MCP 依赖（preflight 内含 cd wps-office-mcp && npm run lint）：
#   cd wps-office-mcp && npm install   （或 npm run mcp:install）
npm run preflight
# 工具数量校验（12/240/257）
npm run validate:toolcounts
# NPC_TEAM 双源一致性
npm run validate:npc-team
# 版本号一致性
npm run validate:versions
# agent 不带 tools 白名单校验（防 Issue #247 根因复发）
npm run validate:agent-no-tools
# settings 校验
npm run validate:settings
# 运行全部根单测
npm run test
# 运行 e2e 集成测试
npm run test:e2e
# 全仓 JS 语法门禁
npm run lint
# 格式化代码（Prettier）
npm run format
# 仅检查格式（Prettier）
npm run format:check
cd wps-office-mcp && npm test
```

### 5. 提交并推送

```bash
git add .
git commit -m "feat(mcp): 添加 xxx 功能"
git push origin feat/your-feature
```

### 6. 创建 Pull Request

见 [PR 描述模板](#六提交规范)。

---

## 五、代码规范

### JavaScript（WPS 插件）

**必须遵守**（兼容 WPS 内置 Chromium 103/104）：
- 使用 ES5 语法：`var`（非 `let/const`）、`function`（非箭头函数）、回调（非 async/await）
- **必须使用 `XMLHttpRequest`，禁止 `fetch`**（WPS Chromium 104 的 fetch Promise 永远 pending）
- **禁止 `ReadableStream`/`TextDecoderStream`**（WPS 104 不完整支持）
- 所有路径处理用绝对路径 + `validateFilePath()`

### TypeScript（MCP）

- 启用 strict 模式
- 小驼峰命名
- JSDoc 风格注释
- 所有接受文件路径的 handler 用 `validateFilePath()`（在 `try` 块内）

### 通用

- 命名小驼峰
- JSDoc 注释
- Prettier 格式化（`npm run format`）

---

## 六、提交规范

使用 **Conventional Commits**：

```
<type>(<scope>): <subject>

<body>
<footer>
```

| type | 说明 |
|------|------|
| feat | 新功能 |
| fix | Bug 修复 |
| docs | 文档更新 |
| style | 代码格式调整 |
| refactor | 重构（无功能变化） |
| test | 测试相关 |
| chore | 构建/工具更新 |

### 示例

```bash
git commit -m "feat(agent): 添加 Agent 选择功能"
git commit -m "fix(security): 修复 XSS 漏洞"
git commit -m "docs: 更新 README"
git commit -m "feat(mcp): 添加 Excel 图表创建工具"
```

### PR 描述模板

```markdown
## 描述
简要说明这个 PR 解决的问题

## 变更内容
- 变更 1
- 变更 2

## 测试
- [ ] 单元测试通过
- [ ] 手动测试通过

## 截图（如适用）
```

---

## 七、测试

```bash
# 统一预检门禁（提交 PR 前必须运行，确保所有自动化检查通过）
# 前置条件：先安装 MCP 依赖（preflight 含 cd wps-office-mcp && npm run lint）
#   cd wps-office-mcp && npm install   （或 npm run mcp:install）
npm run preflight
# 运行全部根单测（tests/*.test.js，排除 e2e）
npm run test
# 运行 e2e 集成测试（真实 HTTP mock 链路）
npm run test:e2e
# 全仓 JS 语法检查
npm run lint
# MCP ESLint 静态规则检查（TypeScript，Issue #185 补建；preflight 已含，此处为单独执行）
cd wps-office-mcp && npm run lint
# 格式化代码（Prettier）
npm run format
# 检查格式（Prettier）
npm run format:check

# 路径安全测试
cd wps-office-mcp && npx jest src/tests/unit/path-safety.test.ts

# MCP 测试
npm run mcp:test

# MCP 单元测试
cd wps-office-mcp && npm run test:unit

# MCP 开发模式
cd wps-office-mcp && npm run dev
```

> 📖 测试也是 PR 门禁的一部分，见 [第八节](#八cicd-门禁)。

---

## 八、CI/CD 门禁

`.cnb.yml` 定义了 CNB 平台的 CI/CD 流水线。`main.push` 触发**全量门禁测试**：

| 校验项 | 命令 | 说明 |
|--------|------|------|
| settings 校验 | `node scripts/validate-settings.js` | 校验 NPC settings |
| 版本校验 | `node scripts/validate-versions.js` | 版本号一致性 |
| 工具数量 | `node scripts/validate-tool-counts.js` | 12/240/257 |
| NPC_TEAM | `node scripts/validate-npc-team-prompt.js` | 提示词双源一致性 |
| NPC_TEAM 同步 | `node scripts/sync-npc-team-skill.js --check` | Skill 同步检查 |
| 单测 | `node tests/*.test.js` | 安全/Launcher/Mac/Linux/桥接共享层回归 |
| 桥接共享层漂移 | `node tests/wps-bridge-shared.test.js` + `node scripts/sync-wps-bridge.js --check` | 单一来源一致性 + 平台产物无漂移（消除三平台 handler 重复重构） |
| JS 语法 | `node --check <file>` | 三平台脚本 + 共享层语法门禁 |
| MCP | `cd wps-office-mcp && npm ci && npm run test:unit && npm run test:integration` | MCP 单测 + 集成测试 |

提交 PR 前建议本地跑一遍门禁，避免 CI 失败。

### Code Wiki 生成（`tag_push` → `codewiki` 插件）

`.cnb.yml` 顶层 `$` 下另配置了 `tag_push` 事件，打 tag 时自动运行 **CNB Code Wiki（codewiki）插件**，读取仓库代码 + `docs/` 现有文档生成项目 Wiki：

```yaml
$:
  tag_push:
    - docker:
        image: cnbcool/codewiki:latest
      stages:
        - name: generate codewiki
          timeout: 10h
          settings:
            git_doc_dir: /data/codewiki/${CNB_REPO_SLUG}   # 必填
            knowledge_enabled: true                        # 生成 Wiki 自动入库仓库知识库
```

- **`git_doc_dir`**：必填项，指定 codewiki 插件的临时工作目录（官方示例写法）。
- **`knowledge_enabled: true`**：生成内容自动同步到仓库知识库，可被 AI 问答引用。
- **触发时机**：仅 `tag_push` 事件触发（打 tag 时），与 `main.push` 全量门禁互不干扰。发布时打 tag 即可触发 Wiki 生成，生成后仓库首页出现 Wiki 入口。

> ⚠️ **文档链接规范（Issue #204）**：codewiki 生成 Wiki 时**不会重写仓库内相对链接**，若 `docs/` 文档使用相对路径（`./xxx.md`、`../xxx.md`）互相引用，Wiki 页面内点击会 404。因此 `docs/` 与根 `README.md` 中的内部链接**一律使用 CNB blob 绝对链接**（`https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/xxx.md`），由脚本 `scripts/rewrite-wiki-links.js` 统一维护，并以 `npm run validate:wikilinks` 在 CI 校验，禁止新增相对链接。

### Wiki 手动上传脚本（`scripts/upload-wiki.js`，方案 A）

`.cnb.yml` 的 `tag_push` 事件中，在 codewiki 插件**之前**先运行 `scripts/upload-wiki.js`（方案 A），把 `docs/` 按 `WIKI_MENU` 的 4 大分类直接调用 `upload/wiki/file` API 上传为 Wiki 页面（绕过 codewiki 插件 LLM 生成缺陷，Issue #117/#204）：

```yaml
- name: upload wiki docs
  image: node:22
  run: |
    node scripts/upload-wiki.js
```

- **`WIKI_MENU`**：脚本顶部定义的 Wiki 菜单结构（4 大分类 + 各分类下 `docs/` 文件名），与仓库首页 Wiki 导航保持一致；新增文档需同步登记到对应分类的 `files`。
- **`WIKI_NAME_MAP`**：源文件名 → Wiki 中文显示名映射（如 `USAGE.md → 使用说明.md`），让 Wiki 左侧导航显示中文名称而非英文文件名；新增文档若希望导航显示中文名，需在此登记。`wikiName()` 函数负责转换，未映射的源文件名原样返回（`README.md` 保持原英文名不映射），映射值缺少 `.md` 后缀或含路径分隔符 `/` 时会输出警告。命名规范：优先使用纯中文；英文专有名词（MCP/OpenCode/WPS/API/Skills）保留原拼写；缩写组合（WPSJS/WPS_COM_PS1）保留下划线转空格，不拆分缩写字母。
- **`CATEGORY_INDEX`**：一级目录“同名”落地页配置（Issue #210）。Wiki 导航会把每个一级目录渲染成“与一级目录同名”的首个子节点（指向裸目录路径如 `/-/wiki/使用指南`），此前裸路径无页面会 404。脚本为每个一级目录额外上传一页裸路径落地页：
  - 存在同名文档的目录（使用指南→`USAGE.md`、开发指南→`DEVELOPMENT_GUIDE.md`）：复用该文档内容并在顶部加一行「本页为「××」分类入口页」说明；
  - 无同名文档的目录（平台专题/内部参考）：用 `buildCategoryIndex` 生成“分类索引页”，汇总本目录全部 Wiki 文档链接（链接指向 Wiki 内页面并做 URL 编码）。
- **防御行为**：未知分类抛「未知 Wiki 分类」错误；同名文档缺失时回退为索引页并打印警告（不终止上传流程）；`WIKI_MENU` 中未配置落地页的一级目录打印警告（防 404 复发）。
- **单测**：`tests/upload-wiki.test.js`（12 用例）覆盖落地页生成/复用/回退/编码/未注册警告，`npm run test` 会运行。

> ⚠️ **实测结论（Issue #117，2026-08-23）**：`upload/wiki/file` API 在 CI（tag_push）环境下**无法认证上传**（JSON `401 errcode:16`、multipart `400 errcode:3`），流水线临时令牌 `CNB_TOKEN` 对该内部 API 无权限。因此当前 `upload-wiki.js` 在 CI 中不会成功上传，需由用户本人（OAuth 权限）网页手动上传 `docs/`，或等平台修复 codewiki 插件 LLM 缺陷后自动生成；脚本保留作平台能力恢复后的自动尝试。

---

## 九、二次开发

### 新增一个 Word 工具（示例）

1. 在 `wps-office-mcp/src/tools/word/` 新建 `my-tool.ts`（含入参/出参类型 + 校验）
2. 在 `src/tools/index.ts` 的 `allTools` 注册
3. 编译：`cd wps-office-mcp && npm run build`
4. 校验：`npm run validate:toolcounts`
5. 重启 OpenCode，工具即被 MCP 注册

### 新增一个 Skill

1. 在 `skills/` 新建目录 `skills/my-skill/`
2. 添加 `SKILL.md`（frontmatter + 概述/能力/工具/工作流/限制）
3. `node install-addons.js` 同步
4. 重启 OpenCode

### 新增一个 Agent

1. 在 `agents/` 新建 `my-agent.md`（含 frontmatter）
2. `node install-addons.js` 同步
3. 重启 OpenCode，即可在 Agent 列表选择

### 新增一条治理规则

1. 在 `.opencode/plugins/governance.js` 的 before/after 钩子中新增规则
2. 保持编号连续（G/P/T 系列）
3. `node install-addons.js` 同步
4. 重启 OpenCode，并确保 CI 校验通过

---

## 十、常见问题

### 插件不显示

- 检查 WPS 版本是否 ≥ 12.1.0
- 重启 WPS Office
- 运行 `node install-addons.js` 重新安装

### MCP 连接失败

- 检查 OpenCode 服务是否启动
- 检查端口 14096 是否被占用
- 查看 `~/.config/opencode/opencode.json` 配置
- 在**仓库根目录**运行 `cd wps-office-mcp && npm install && npm run build && cd ..`，然后重启 OpenCode

### 服务启动失败

- 检查 Launcher 是否运行：`schtasks /Query /TN "OpenCodeLauncher"`
- 手动启动：`schtasks /Run /TN "OpenCodeLauncher"`

### Skills/Agents 未加载

- 重新运行安装脚本 + 重启 OpenCode

### 工具数量校验失败

- 运行 `npm run validate:toolcounts`，按提示调整 `tools/index.ts` / `gateway/index.ts` / `mcp-server.ts`

---

## 十一、联系方式

- GitHub Issues: 报告 Bug 和问题
- GitHub Discussions: 提问和讨论
- GitHub Releases: 查看公告

---

感谢你的贡献！
