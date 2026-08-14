# 使用指南（Wiki 级）

本文档是 OpenCode WPS 的**完整使用手册**，覆盖从快速上手到深度使用的全部内容：打开 AI 对话面板、完整对话操作、WPS 专用 Agents 调用、常用文档操作场景、OpenCode 服务管理与配置。

> 若你刚接触本项目，建议先通读 [INSTALLATION.md](./INSTALLATION.md) 完成安装，再回到本文档。三平台完整说明见 [WINDOWS.md](./WINDOWS.md) / [MAC.md](./MAC.md) / [LINUX.md](./LINUX.md)；问题排查见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。

---

## 目录

- [一、快速上手](#一快速上手)
- [二、打开 AI 对话面板](#二打开-ai-对话面板)
- [三、完整对话操作](#三完整对话操作)
- [四、WPS 专用 Agents](#四wps-专用-agents)
- [五、常用文档操作场景](#五常用文档操作场景)
- [六、OpenCode 服务管理](#六opencode-服务管理)
- [七、配置参考](#七配置参考)
- [八、最佳实践](#八最佳实践)
- [九、已知限制](#九已知限制)

---

## 一、快速上手

安装完成并重启 WPS 后，功能区出现 **OpenCode AI** 标签页。按平台差异进入对话：

| 平台 | 操作 | 对话界面 |
|------|------|----------|
| **Windows** | 功能区 **OpenCode AI** → 点击 **打开面板** | WPS 内嵌侧边栏 Chat UI |
| **macOS** | 功能区 **OpenCode AI** → 点击 **打开Web** | 系统浏览器（优先 Chrome，回退默认浏览器） |
| **Linux** | 功能区 **OpenCode AI** → 点击 **打开Web** | 系统默认浏览器（xdg-open，回退 google-chrome/firefox） |

**第一条消息**：在输入框输入自然语言指令（如「把标题设为黑体三号」），按 Enter 或点击发送，AI 即开始处理。若涉及文档操作，AI 会自动调用 MCP 工具读写 WPS 当前活动文档。

> ⚠️ **使用前提**：MCP 操作（读写文档）要求 **WPS 处于运行状态**，且当前有打开的文档。若连接不上，先按 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) 排查，或 `cd wps-office-mcp && npm install && npm run build` 后重启 OpenCode。

---

## 二、打开 AI 对话面板

### Windows（侧边栏 Chat UI）

功能区 **OpenCode AI** 标签页提供 **打开面板 / 打开Web / 连接状态** 三个按钮：

| 按钮 | 功能 |
|------|------|
| **打开面板** | 在 WPS 右侧弹出 Chat 侧边栏（最常用） |
| **打开Web** | 在系统浏览器打开 AI 对话界面（备用） |
| **连接状态** | 查看 OpenCode 服务状态（是否在线、端口连通性） |

操作步骤：

1. 在 WPS 功能区点击 **OpenCode AI** 标签页
2. 点击 **打开面板**，右侧弹出 Chat 侧边栏
3. 点击 **连接状态** 确认 OpenCode 服务已就绪
4. （可选）点击 **打开Web** 在浏览器中打开同一对话界面

侧边栏顶部可 **新建会话**，底部工具栏可 **切换 Agent**、**查看连接状态**。

### macOS / Linux（浏览器对话 + 轮询桥）

Mac/Linux 版为命令轮询桥架构（无内嵌侧边栏），对话在浏览器中进行。功能区提供 **服务状态 / 暂停恢复 / 打开Web** 三个按钮：

| 按钮 | 功能 |
|------|------|
| **服务状态** | 查看轮询状态与已注册动作数 |
| **暂停/恢复** | 暂停或恢复轮询桥（临时关闭文档操作通道） |
| **打开Web** | 在浏览器打开 AI 对话界面 |

操作步骤：

1. 在 WPS 功能区点击 **OpenCode AI** 标签页
2. 点击 **打开Web**，自动在浏览器打开 `http://127.0.0.1:14096`
3. 在浏览器与 AI 对话，文档操作经 WPS 插件轮询桥（`:58891`）自动执行
4. 点击 **服务状态** 查看轮询状态与已注册动作数

> 💡 若「打开Web」无响应，多为 launcher 未启动。请先运行 `node launcher-mac.js`（macOS）或 `node launcher-linux.js`（Linux），或重启系统让自启机制拉起。

---

## 三、完整对话操作

### 3.1 发送消息

- **输入**：在输入框输入问题或指令，支持自然语言
- **发送**：按 `Enter` 或点击发送按钮
- **换行**：输入框内需换行时使用 `Shift + Enter`

### 3.2 SSE 流式输出

AI 回复**实时流式显示**（SSE，Server-Sent Events），边生成边展示，体验流畅。流式输出支持：

- **Markdown 渲染**：代码块、表格、列表、标题、链接、图片等自动渲染为富文本
- **流式光标**：生成中显示闪烁光标，完成后消失
- **取消生成**：可中断当前正在生成的回复

### 3.3 会话管理

侧边栏支持完整的会话管理：

| 操作 | 方式 | 说明 |
|------|------|------|
| **新建会话** | 顶栏「+」按钮 | 创建全新对话，独立上下文 |
| **切换会话** | 点击会话列表条目 | 在不同对话间切换，历史消息即时加载 |
| **重命名会话** | 会话条目下拉 → 重命名 | 为会话设置有意义的标题 |
| **删除会话** | 会话条目下拉 → 删除 | 删除会话及其全部历史（需确认） |

会话切换后，AI 会加载该会话的历史消息作为上下文继续对话，实现多任务并行、互不干扰。

### 3.4 Agent 选择

点击底部工具栏的 Agent 按钮，切换不同的 AI 助手（见 [第四节](#四wps-专用-agents)）。当前选中的 Agent 显示在输入框上方，切换后新消息按新 Agent 能力处理。

### 3.5 对话状态

- **连接状态**：输入框/顶栏显示与 OpenCode 服务的连接状态
- **生成状态**：回复生成中显示流式光标与「正在生成」提示
- **错误提示**：连接断开、工具调用失败等会以 Markdown 错误信息展示

---

## 四、WPS 专用 Agents

项目内置 4 个 WPS Office 智能助手（定义见 `agents/`，安装到 `~/.config/opencode/agents/` + `~/.opencode/agents/`）：

| Agent | 类型 | 说明 | 调用方式 |
|-------|------|------|----------|
| **wps-expert** | 子 agent | WPS Office 智能助手，综合处理 Word/Excel/PPT | `@wps-expert` |
| **wps-word** | 子 agent | Word 文档处理专家（排版/格式/模板填写） | `@wps-word` |
| **wps-excel** | 子 agent | Excel 数据处理专家（公式/函数/数据分析/图表） | `@wps-excel` |
| **wps-ppt** | 子 agent | PPT 演示文稿专家（制作/内容编辑/美化排版） | `@wps-ppt` |

### 4.1 调用方式

```text
# 方式一：消息中直接 @ 调用
@wps-word 把这篇文档的标题统一设为「标题 1」样式

# 方式二：切换 Agent 后直接对话
（先在底部工具栏切换到 wps-excel）帮我统计 A 列的总和
```

### 4.2 各 Agent 能力一览

**wps-word（Word）**：
- 文档排版、样式设置、字体格式
- 模板自动填值、修订模式校对
- 批量文档生成（合同/报告/公文）

**wps-excel（Excel）**：
- 公式与函数编写
- 数据清洗、数据分析
- 图表创建、单元格格式设置

**wps-ppt（PPT）**：
- 幻灯片制作、内容编辑
- 排版美化、动画设置
- 母版编辑、批量处理

**wps-expert（综合）**：
- 跨应用操作（Word/Excel/PPT）
- 自动路由到对应 Skills 处理
- 适合不明确属于哪个应用的混合任务

### 4.3 Agent 与 Skill 的对应关系

| Agent | 优先 Skill |
|-------|-----------|
| wps-expert | 全部 WPS Skills（wps-office/word/excel/ppt） |
| wps-word | wps-word |
| wps-excel | wps-excel |
| wps-ppt | wps-ppt |

### 4.4 自定义 Agents

- **定义位置**：`~/.config/opencode/agents/` + `~/.opencode/agents/`（两处均由 `install-addons*.js` 从源目录 `agents/` 同步）
- **修改方式**：编辑源目录 `agents/*.md`，运行 `node install-addons.js` 同步，重启 OpenCode 生效
- **自定义新 Agent**：在 `agents/` 新建 `*.md`（含 frontmatter），同步后即可在 Agent 列表中选择

> 📖 Agents 与 Skills 的关系、Skills 详细说明见 [SKILLS.md](./SKILLS.md)。

---

## 五、常用文档操作场景

以下是通过 AI 对话即可完成的典型场景（AI 会自动调用 MCP 工具操作 WPS）。

### 5.1 Word 文档

| 场景 | 示例指令 |
|------|----------|
| 排版 | 「把全文标题设为标题1，正文设为宋体小四」 |
| 模板填值 | 「按这张表的数据把合同模板填好，开启修订」 |
| 大文档校对 | 「帮我校对这篇文档，每批200段严格逐批」 |
| 格式调整 | 「把第三段加粗、居中」 |

### 5.2 Excel 表格

| 场景 | 示例指令 |
|------|----------|
| 公式 | 「在 B 列用 SUM 求 A 列总和」 |
| 数据清洗 | 「删掉 A 列的空行」 |
| 图表 | 「根据 1-6 月销量生成柱状图」 |
| 格式 | 「把表头设为黄色底、加粗」 |

### 5.3 PPT 演示

| 场景 | 示例指令 |
|------|----------|
| 制作 | 「新增一页标题为『季度汇报』的幻灯片」 |
| 美化 | 「把这页的美化一下，统一配色」 |
| 排版 | 「把第三页的文本框对齐居中」 |

### 5.4 跨应用（wps-expert）

| 场景 | 示例指令 |
|------|----------|
| 混合任务 | 「把 Excel 里的数据做成 PPT 图表」 |
| 通用 | 「帮我整理一下当前打开的文档」 |

> 📖 特色功能（模板填值 + 校对铁律 3.0）的完整工作流与治理规则见 [FEATURES.md](./FEATURES.md)。

---

## 六、OpenCode 服务管理

OpenCode 服务由 **Launcher 进程**管理（监听 `127.0.0.1:14097`），通常无需手动干预，开机自动启动。服务本身监听 `127.0.0.1:14096`。

### 6.1 Launcher API

可通过 Launcher 的 HTTP API 管理服务（curl / 浏览器访问）：

| 方法 | 端点 | 功能 |
|------|------|------|
| GET | `/status` | 查看服务状态 |
| GET | `/health` | 健康检查 |
| POST | `/start` | 启动服务（body: `{"cwd": "目录"}`） |
| POST | `/stop` | 停止服务（按端口 14096 精确停止） |
| POST | `/dock` | 打开浏览器（「打开Web」按钮经此端点实现） |
| POST | `/docinfo` | 写入当前文档信息缓存（body: 文档对象；`closed:true` 时清除缓存） |
| GET | `/docinfo` | 读取当前文档信息缓存（无缓存返回 404 `No document info available`） |

```bash
# 查看状态
curl http://127.0.0.1:14097/status

# 健康检查
curl http://127.0.0.1:14097/health

# 启动服务
curl -X POST http://127.0.0.1:14097/start -H 'Content-Type: application/json' -d '{"cwd":"/path/to/project"}'

# 停止服务
curl -X POST http://127.0.0.1:14097/stop

# 打开浏览器
curl -X POST http://127.0.0.1:14097/dock

# 写入文档信息缓存（对象 body；closed:true 清除）
curl -X POST http://127.0.0.1:14097/docinfo -H 'Content-Type: application/json' -d '{"name":"demo.docx","path":"C:\\demo\\demo.docx"}'

# 读取文档信息缓存
curl http://127.0.0.1:14097/docinfo
```

### 6.2 各平台 Launcher 与自启

| 平台 | Launcher 文件 | 自启机制 |
|------|---------------|----------|
| **Windows** | `opencode-wps/launcher.js` | 计划任务（`schtasks /Create`） |
| **macOS** | `launcher-mac.js` | LaunchAgent（`~/Library/LaunchAgents/com.opencode.launcher.plist`） |
| **Linux** | `launcher-linux.js` | XDG autostart（`~/.config/autostart/opencode-wps-launcher.desktop`） |

### 6.3 端口速查

| 端口 | 服务 | 说明 |
|------|------|------|
| `14096` | OpenCode 服务 | AI 对话核心服务 |
| `14097` | Launcher | 服务生命周期管理 |
| `14098` | CORS 代理 | `opencode-proxy.js` 剥离 CSP 头，供 WPS Chromium 使用 |
| `58891` | Mac/Linux 轮询桥 | 插件与 MCP 之间的反向轮询通道 |
| `58890` | WPS 服务保活 | Win/Mac 内置 RelayHttpServer 探测口（`wps-keepalive.ts` 定期探测，断开自动重启） |
| `3444` | 开发服务器 | `opencode-wps/serve.js` 静态开发服务器（仅开发用） |

> 📚 **交叉参考**：端口对应的 MCP Server 三层工具体系与开发映射详见 [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md#三层工具体系)；内置工具完整清单与两级网关调用规范详见 [SKILLS.md](./SKILLS.md#内置工具12-个所有-skill-共用)。

### 6.4 手动管理

```bash
# 查看 OpenCode 是否在运行（Win）
schtasks /Query /TN "OpenCodeLauncher"

# 手动启动计划任务（Win）
schtasks /Run /TN "OpenCodeLauncher"

# 手动启动 Launcher（Mac/Linux）
node launcher-mac.js
node launcher-linux.js
```

> 📖 更详细的平台特定服务管理见 [WINDOWS.md](./WINDOWS.md) / [MAC.md](./MAC.md) / [LINUX.md](./LINUX.md)。

---

## 七、配置参考

全局配置集中在 `opencode-wps/config.js` 的 `CONFIG` 对象（前端经 `<script src="config.js">` 注入，后端由 `launcher.js` require 引入）。关键配置项：

| 配置项 | 用途 | 默认值 |
|--------|------|--------|
| `CONFIG.opencode.apiBase` | OpenCode 服务地址 | `http://127.0.0.1:14096` |
| `CONFIG.launcher.apiBase` | Launcher 管理地址 | `http://127.0.0.1:14097` |
| `CONFIG.plugin.userHome` | 用户主目录（安装时注入） | 安装时注入值 |
| `CONFIG.network.timeout` | HTTP 请求超时 | `30000ms` |
| `CONFIG.session.defaultAgent` | 默认 Agent | `wps-expert` |

> ⚠️ **修改配置注意**：`config.js` 是源文件，修改后需运行 `node install-addons.js` 同步到插件目录；不要直接改 `%APPDATA%`/`~/Library` 等安装产物目录。

---

## 八、最佳实践

1. **明确指令**：给出具体、可执行的操作指令，AI 能更准确调用工具
2. **活用 Agent**：按任务类型选择 wps-word/excel/ppt，避免混合任务走错 Skill
3. **会话隔离**：不同任务用不同会话，避免上下文污染
4. **特色功能优先**：模板填值、校对用专门的 FEATURES 流程，确保可追溯、不编造
5. **及时保存**：AI 操作的是 WPS 活动文档，重要操作建议先另存副本
6. **连接排查**：操作失败先查连接状态（Win「连接状态」/ Mac·Linux「服务状态」）

---

## 九、已知限制

- **MCP 操作依赖 WPS 运行**：无打开文档时文档类工具不可用
- **Windows 为侧边栏 UI，Mac/Linux 为浏览器对话**：三者交互入口不同，能力一致
- **WPS Chromium 内核限制**（Windows 侧边栏）：不支持 `fetch` Promise、`ReadableStream` 等现代 Web 特性，本项目已用 `XMLHttpRequest` + SSE 规避
- **Linux 版为开发完成待实机验证**：见 [LINUX.md](./LINUX.md)

> 📖 完整问题排查与避坑指南见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。
