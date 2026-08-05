# 使用指南

本文档介绍 OpenCode WPS 的日常使用方式：打开 AI 对话面板、对话操作、WPS Agents 调用与 OpenCode 服务管理。

## 打开 AI 对话面板

### Windows（侧边栏 Chat UI）

1. 在 WPS 功能区点击 **OpenCode AI** 标签页
2. 点击 **打开面板** 按钮，右侧弹出 Chat 侧边栏
3. 点击 **连接状态** 按钮查看 OpenCode 服务状态

### macOS / Linux（浏览器对话 + 轮询桥）

Mac/Linux 版为命令轮询桥架构（无内嵌侧边栏），对话在浏览器中进行：

1. 在 WPS 功能区点击 **OpenCode AI** 标签页
2. 点击 **打开Web** 按钮，自动在系统默认浏览器（优先 Chrome/Edge）中打开 OpenCode AI 对话界面（`http://127.0.0.1:14096`）
3. 在浏览器中与 AI 对话，文档操作经 WPS 插件轮询桥（`:58891`）自动执行

> 若 launcher 未启动导致「打开Web」无响应，请先运行 `node launcher-mac.js`（macOS）或 `node launcher-linux.js`（Linux），或重启系统让自启机制拉起。

## 对话操作

- **发送消息** — 在输入框输入问题，按 Enter 或点击发送
- **SSE 流式输出** — AI 回复实时流式显示，支持 Markdown 渲染（代码块、表格、列表等）
- **会话管理** — 点击会话列表切换对话，支持创建、重命名、删除会话
- **Agent 选择** — 点击底部工具栏的 Agent 按钮，选择不同的 AI 助手

## WPS Agents

项目内置了专门的 WPS Office 智能助手：

| Agent | 类型 | 说明 |
|-------|------|------|
| **wps-expert** | 子 agent | WPS Office 智能助手，综合处理 Word/Excel/PPT（可用 `@wps-expert` 调用）|
| **wps-word** | 子 agent | Word 文档处理专家（可用 `@wps-word` 调用）|
| **wps-excel** | 子 agent | Excel 数据处理专家（可用 `@wps-excel` 调用）|
| **wps-ppt** | 子 agent | PPT 演示文稿专家（可用 `@wps-ppt` 调用）|

**使用方式**：

1. 在消息中使用 `@wps-expert`、`@wps-word`、`@wps-excel`、`@wps-ppt` 调用子 agents 处理特定任务
2. 在 CNB 平台对话中召唤官方免费 `@CodeBuddy`，只需一句「调用 NPC_TEAM skill 完成以下需求：xxxxxx」即可自动加载本仓库内置的 NPC_TEAM Skill 化身 NPC Team（零平台积分），或粘贴 [docs/NPC_TEAM.md](./NPC_TEAM.md) 提示词兜底

**自定义 Agents**：

- Agents 定义位置：`~/.config/opencode/agents/`
- 修改后重启 OpenCode 服务生效

## OpenCode 服务管理

OpenCode 服务通过 Launcher 进程管理（监听 `127.0.0.1:14097`），无需手动操作：

```bash
# 通过 Launcher API 管理服务（跨平台）
# 查看状态：GET http://127.0.0.1:14097/status
# 启动服务：POST http://127.0.0.1:14097/start (body: {"cwd": "目录"})
# 停止服务：POST http://127.0.0.1:14097/stop  ← 按端口 14096 精确停止
```

| 平台 | Launcher | 自启机制 |
|------|----------|----------|
| Windows | `opencode-wps/launcher.js` | 计划任务（`schtasks /Create`） |
| macOS | `launcher-mac.js` | LaunchAgent（`~/Library/LaunchAgents/com.opencode.launcher.plist`） |
| Linux | `launcher-linux.js` | XDG autostart |

服务默认监听 `127.0.0.1:14096`，WPS 插件会自动检测并连接。

## 特色功能速览

- **文档填写（模板自动填值）** — 从结构化数据源提取值填充 Word 模板，全程修订模式可追溯，适用合同/报告/公文/审批表单批量生成
- **大文档校对（铁律 3.0）** — 严格逐批校对（每批 ≤200 段），16 条规则代码层强制执行，禁止 AI 跳批/编造修复

> 📖 特色功能完整说明见 [docs/FEATURES.md](./FEATURES.md)。
