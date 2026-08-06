# OpenCode WPS

[![CI](https://github.com/lnxsun/opencode-wps/actions/workflows/ci.yml/badge.svg)](https://github.com/lnxsun/opencode-wps/actions)
[![Version](https://img.shields.io/github/v/release/lnxsun/opencode-wps)](https://github.com/lnxsun/opencode-wps/releases)
[![License](https://img.shields.io/github/license/lnxsun/opencode-wps)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/lnxsun/opencode-wps)

[OpenCode](https://github.com/anomalyco/opencode) AI 助手的 WPS Office 插件，让你在 WPS 文字、表格、演示中直接与 AI 对话，获取智能辅助。**支持 Windows、macOS、Linux 三平台。**

## 核心特性

- **WPS 内嵌 AI 对话** — 侧边栏 Chat UI，支持 SSE 流式输出、Markdown 渲染、多会话管理
- **MCP 工具集成** — WPS Office MCP 服务器三层工具体系（内置 12 + 注册 ~240 + COM Actions ~257，数量以代码为准），AI 可直接读写/格式化文档
- **WPS 专用 Agents** — wps-expert / wps-word / wps-excel / wps-ppt，通过 Agent 选择实现功能聚焦
- **特色功能** — 模板自动填值（修订追踪）+ 长文档分批校对（铁律 3.0，16 条规则代码层强制执行）
- **执行治理** — governance.js Hooks 拦截所有 MCP 调用（G1-G7 + P1-P16 + T1-T11 共 34 条规则），防 AI 作弊
- **NPC Team 总指挥（零积分）** — 召唤官方免费 `@CodeBuddy` 一句「调用 NPC_TEAM skill」，6 位专家**接力**跑完研发全流程（默认接力模式：每次召唤只执行一步、独立留痕，含评审-修复循环接力；**合并前暂停待用户确认 ⏸CP3 + 发布三要素**），零平台积分
- **一键安装** — `node install-addons.js` 自动完成全部组件安装，开机自启

> 💡 **NPC Team（零积分）与 CNB Skills 不是 WPS 插件功能**：`@CodeBuddy`、NPC_TEAM 提示词、`.codebuddy/skills/` 等属于 **cnb.cool 平台的开发辅助工具**，用于在 CNB 平台（Issue/PR/对话）辅助研发，与 WPS 插件本体无关。详见 [docs/NPC_TEAM.md](./docs/NPC_TEAM.md)。

> 📖 详细功能说明见 [docs/FEATURES.md](./docs/FEATURES.md)。

## 快速开始

### 环境要求

- **操作系统**：Windows 10/11、macOS 12+ 或 Linux（Debian/Ubuntu/Arch 等，x86_64 / aarch64）
- **WPS Office**：Windows 个人版 12.1.0+ 或企业版 / Mac 最新版 / Linux 12.1.x（[linux.wps.cn](https://linux.wps.cn)）
- **Node.js**：18.0.0+（或 Bun 1.0+）
- **OpenCode**：`npm install -g opencode-ai`
- **Python 3**：Mac/Linux 需要（`wps-auto.sh` 生成空白 OOXML 用，缺失时回退无参启动）；Windows 不需要

### 一键安装

```bash
# 国内（CNB 镜像）：git clone https://cnb.cool/lnxsun/opencode-wps.git
# 国外（GitHub）：git clone https://github.com/lnxsun/opencode-wps.git
git clone https://github.com/lnxsun/opencode-wps.git
cd opencode-wps
npm install

# 按平台执行安装脚本
node install-addons.js          # Windows（8 步自动安装）
node install-addons-mac.js      # macOS（7 步自动安装）
node install-addons-linux.js    # Linux（8 步自动安装）
```

安装完成后重启 WPS，功能区出现 **OpenCode AI** 标签页：Windows 点击 **打开面板** 即可开始对话；macOS / Linux 点击 **打开Web** 在浏览器中对话。

> 📖 三平台完整安装步骤、目录路径与卸载说明见 [docs/INSTALLATION.md](./docs/INSTALLATION.md)。

## 使用方式

- **Windows**：WPS 侧边栏 Chat UI，直接与 AI 对话
- **macOS / Linux**：Ribbon 点击「打开Web」，浏览器中对话，插件轮询桥操作文档
- **对话能力**：SSE 流式输出、Markdown 渲染、会话管理、Agent 选择、`@wps-word` 等子 agent 调用

> 📖 完整使用指南见 [docs/USAGE.md](./docs/USAGE.md)；问题排查见 [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)。

## 项目架构（一图速览）

```
WPS 宿主 (Win/Mac/Linux)
   │
   ▼
WPS JS 插件 ── Win: Chat UI (SSE直连:14096) / Mac·Linux: 轮询桥 (:58891)
   │
   ▼
OpenCode 中央调度 (opencode serve :14096) ── governance.js Hooks 横切治理
   │
   ▼
WPS Office MCP 服务器 (12 内置 + ~240 handler + ~257 COM Actions)
   │
   ▼
Win: PowerShell COM 桥接  /  Mac·Linux: HTTP 轮询 (反向轮询插件)
```

> 📖 完整架构（4 层组件 + 十层调用链 + 平台差异）见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 文档地图

| 分类            | 文档                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🧭 **使用**     | [安装指南](./docs/INSTALLATION.md) · [使用指南](./docs/USAGE.md) · [特色功能](./docs/FEATURES.md) · [问题排查](./docs/TROUBLESHOOTING.md)                                                              |
| 🔧 **开发**     | [开发指南](./docs/DEVELOPMENT_GUIDE.md) · [代码审查](./docs/CODE_REVIEW_GUIDE.md) · [WPS JS 开发](./docs/WPSJS_DEVELOPMENT.md) · [安装脚本说明](./docs/INSTALL_SCRIPT.md) · [Skills](./docs/SKILLS.md) |
| 🖥️ **平台专题** | [Windows 支持](./docs/WINDOWS.md) · [macOS 支持](./docs/MAC.md) · [Linux 支持](./docs/LINUX.md)                                                                                                        |
| 📚 **内部参考** | [架构](./docs/ARCHITECTURE.md) · [MCP](./docs/MCP.md) · [API 参考](./docs/OPENCODE_API.md) · [安全](./docs/SECURITY.md) · [NPC Team](./docs/NPC_TEAM.md)                                               |
> 📚 完整文档中心（含全部 24 份顶层文档 + 2 份设计规格的索引）见 [docs/README.md](./docs/README.md)。

## NPC 研发助手（CNB 平台开发辅助工具，与 WPS 插件无关）

> ⚠️ 本节内容属于 **cnb.cool 平台**的研发辅助能力，**不是 WPS 插件的一部分**：它们不随 `install-addons*.js` 安装，不进入 `%APPDATA%`/`~/Library`/`~/.local` 等插件目录，也不依赖 WPS 运行。使用对象是**在 CNB 平台开发本仓库的开发者**，而非 WPS 插件使用者。

在 CNB 平台召唤官方免费 `@CodeBuddy`，只说一句：

```
调用 NPC_TEAM skill 完成以下需求：<你的需求>
```

本仓库内置 NPC_TEAM Skill，`@CodeBuddy` 自动化身 6 位专家（PM/产品/架构/开发/评审/测试），**默认接力模式**：每次召唤只执行拆解→开发→评审→测试→文档→**合并→发布**→汇报→复盘流水线中的一个步骤，输出【接力卡】后停下，用户逐步召唤下一棒续跑，**零平台 NPC 积分**。

> ⚡ **默认接力模式（每步独立调用 @CodeBuddy）**：每次召唤只执行流水线中一个步骤，输出【接力卡】（含任务书 + 下一步召唤话术）后立即停下，用户逐步召唤下一棒续跑——每步独立调用、独立留痕、独立可见，步间天然可确认/纠正/停止，彻底杜绝"单会话闷头跑完 + 编造全绿"；**评审-修复循环同样采用接力模式**（5/11 评审每轮独立召唤执行，评审/修复各自留痕，禁止假装进行）。**合并 PR 前必须暂停待用户确认（⏸CP3）**：评审清零 + 测试通过后输出【合并确认卡】，用户回复「继续合并」才执行合并，禁止未经确认自行合并；**9/11 发布真实执行三要素**：更新版本号 + 形成/更新 CHANGELOG + 发布产物（tag/release/制品），禁止假装发布。也支持用户明确要求时的全程模式（一次跑完，保留 ⏸CP1/⏸CP2/⏸CP3 暂停确认）。

> 📖 使用方式与提示词见 [docs/NPC_TEAM.md](./docs/NPC_TEAM.md)。

## 交流群

欢迎加入 OpenCode-WPS 微信交流群，获取最新动态、反馈问题、交流使用心得：

<img src="docs/assets/wechat-group.png" alt="OpenCode-WPS 微信交流群" width="300">

> 二维码不定期更新。如二维码过期，请提交 [Issue](https://github.com/lnxsun/opencode-wps/issues) 联系维护者。

## License

[MIT](./LICENSE)

---

📖 项目演进历史与致谢见 [docs/HISTORY.md](./docs/HISTORY.md)。
