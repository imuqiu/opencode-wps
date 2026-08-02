# 更新日志

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **修复 offset 可选后的去重键 Bug**（PR #71 二轮评审 warning）— 累加器去重键 `offset|original` 在 offset 缺失时退化 `undefined|原文` 会误判重复丢弃：改为**仅对携带绝对 offset 的条目去重**，缺失时保守保留全部（不同位置同原文不误并）；SKILL.md 两处排序改为 `offset ?? Infinity` 次级 `paragraphIndex`，消除 NaN 比较排序不稳定；移除 accumulate schema 中无效的 `offset_in_paragraph` 字段声明、清理 agents/wps-word.md 与 proofread.ts 头部对已删除 `replace_range` 的残留引用
- **对齐合并去重口径并补可观测性**（PR #71 三轮评审 3 warning + 3 info）— ① 去重键同键（同 offset 同 original）时 **source=ai 优先覆盖 mcp**（与 SKILL 合并口径一致，不再错留 2 条）；② 累加器返回文本补充 **offset 缺失计数**（「其中 N 条未携带绝对 offset，未参与去重」），报告侧可区分「位置未知」是漏传还是计算失败；③ `dedupedCount` 改为只统计**本批新增导致的去重**（不再把历史累计重复计入）；④ SKILL.md 公式移除已废弃的 `offset_in_paragraph` 字面量引用（改为「段内字符位置」）、「必须包含 offset」改为「强烈建议携带 paragraphIndex + offset」（与代码层可选语义对齐）；⑤ `normalizeIssueLocation` 删除被有意忽略的 `offset_in_paragraph` 类型声明（类型即文档）
- **AI 覆盖 MCP 时保留 Layer 1 type + 统一 SKILL 两处合并口径**（PR #71 四轮评审 2 warning + 3 info）— ① 累加器 AI 条目覆盖 MCP 条目时，若 AI type 兜底为「未分类」而 MCP（Layer 1 正则命中）有具体 type，**保留 MCP 的 type**（与 SKILL 2d 保护逻辑对齐，避免报告五维评分失真）；② SKILL.md **两处合并去重逻辑完全统一**（此前无条件 AI 优先 vs `issue.score` 条件 AI 优先互相矛盾，AI 参照执行会得到不同结果），现统一为「同键 AI 无条件优先 + 保留 Layer 1 type」；③ 去重键 `offset|original` 改用 `JSON.stringify([offset, original])`，消除原文含 `|` 时的分隔符歧义；④ `formatIssueLocation` 对非法 `paragraphIndex`（0/负数，约定从 1 起）不再展示「段落 0」，降级为偏移展示；⑤ schema 中 `offset`/`paragraph_index` 描述注明兼容字符串数字（AI 层可能输出 "3"）；⑥ **跨批 type 提升**：AI 未分类条目先入、后续批次 MCP 带具体 type 后到（同位置同原文）时，用 MCP 的具体 type 提升 AI 条目的「未分类」（AI 优先语义不变，避免报告五维评分漏计）；新增 6 个单测覆盖以上行为
- **CI 增加 Jest 测试门禁**（Issue #50 P1-1）— `.github/workflows/ci.yml` 的 build job 新增 `npm test` 步骤，`wps-office-mcp` 的 9 个 Jest 套件 / 208 个测试正式进入 CI，不再形同虚设
- **统一版本号为单一版本源 1.1.0**（Issue #50 P1-2）— 删除 `opencode-wps/manifest.xml` 冗余的小写 `<version>` 字段，`opencode-wps/package.json`、`wps-office-mcp/package.json` 及 lock 统一为 1.1.0；新增 `scripts/validate-versions.js` 校验脚本并接入 CI
- **修复 install-addons.js 自启矛盾**（Issue #50 P2-3）— 删除第 77 行过时声明"不再自动注册开机自启任务"，改为如实提示"第 8 步将注册 Launcher 开机自启"，与第 8 步实际行为一致
- **修复 CI JSON 检查形同虚设**（Issue #50 P2-4）— JSON 检查只列 `*.json` 文件并严格解析（不再静默吞掉 .js 失败），新增 `node --check` 独立 JS 文件语法检查
- **launcher CORS 收敛为白名单**（Issue #50 P2-5）— `opencode-wps/launcher.js` 的 `Access-Control-Allow-Origin` 由 `*` 改为白名单（127.0.0.1:14096 / localhost:14096 / 无 Origin / null / file://），拒绝恶意本地网页跨站读取
- **工具数量文档改为以代码为准**（Issue #50 P2-6）— README/AGENTS.md/docs/MCP.md 中的硬编码数字（238/240/490）改为约数并标注"以代码为准"，新增 `scripts/validate-tool-counts.js` 校验脚本防止过时数字残留

### Added
- Agent 选择功能（wps-expert/wps-word/wps-excel/wps-ppt）
- 4 层架构文档（JS插件 → Agents → Skills → MCP）
- 测试套件（security.test.js, utils.test.js, launcher.test.js）
- CONTRIBUTING.md 贡献指南
- Agent Skill 调用优先级指引
- **Word 文档校对功能**（混合 MCP 基础校对 + AI 智能校对）
  - 4 个校对专用 MCP 工具：`wps_word_enable_track_changes`、`wps_word_get_track_changes_status`、`wps_word_replace_range`、`wps_word_proofread_basic`
  - 基础校对规则引擎（零 token 正则检测错别字/重复字符/常见语病）
  - 修订模式（Track Changes）支持，所有修改可追溯
  - Markdown 校对报告自动生成（文档同目录）
  - 从真实校对报告提炼的 30+ 条正则规则
- **path-safety.ts** 路径安全工具（validateFilePath / validateImagePath / isAllowedUrl）
- 18 个文件路径处理 handler 接入 path-safety 校验
- path-safety.test.ts 单元测试（13 个测试用例）
- launcher.js `isValidUrl()` URL 白名单校验
- launcher.js `stateLock` 并发请求保护（同时仅允许一个 `/start`）
- main.js PluginStorage JSON 命令 `{ cmd, ts }` 时间戳去重
- CORS 代理 `opencode-proxy.js`（端口 14098，剥离 CSP 头）

### Changed
- 安装脚本输出更详细的状态信息
- `getActiveDocument` 输出格式：`页数` → `总段数`，对齐 COM 实际返回字段（`paragraphCount`）
- `proofreadBasic` 增加异常空格检测（连续空格 / 全角空格）
- manifest.xml Version → 1.1.0
- SSE 指数退避：初始 1s，最大 30s
- `taskkill` 参数：`/PID xxx /F` → `/F /PID xxx 2>nul`
- `convert.ts` 恢复 `getAppTypeByExtension` / `getFormatCode` 为 export
- 5 个 PPT 工具标记为 `[DEPRECATED]`（提示使用现代替代工具）
- `add_speaker_notes` handler 转发至 `set_slide_notes`
- 7 对重复工具逐一比对：#1-#5 修复 deprecated 消息提示额外功能，#3/#6 移除 deprecated（功能不同）

### Security
- XSS 防护：safeInput 函数
- 配置持久化：CONFIG 对象
- Launcher 路径安全：配置文件读取、cwd 验证
- 进程管理优化：PID 文件精确终止
- 配置防御性检查：loadOpenCodeConfig 函数
- spawn 参数数组化（安全改进）
- **path-safety.ts** 路径遍历保护（所有接受文件路径的 handler 强制校验）
- **CORS 白名单**：`access-control-allow-origin: *` → `http://127.0.0.1:14096`
- **URL 注入防护**：launcher.js dockWindow 仅允许 http/https 协议 + 127.0.0.1/localhost
- **validateCwd 增强**：拒绝 UNC 路径和 DOS 设备路径
- **launcher.js stateLock**：防止 `/start` 并发请求
- **JSON 命令重放防护**：PluginStorage 轮询 + 时间戳去重
- **wmic 进程验证**：stopOpenCodeByPort 在 kill 前确认进程名

### Fixed
- GetUrlPath 简化为 URL API
- **Mac 侧 `setCellFormat` 支持视觉格式**：补齐 `format` 对象内 bold/italic/fontSize/fontName/fontColor/bgColor/underline/strikethrough/对齐/wrapText/numberFormat 处理，与 Windows `wps-com.ps1` 行为对齐（此前仅处理 4 个顶层参数，其余被静默丢弃）
  - 颜色支持 `format` 内优先、顶层 `fontColor`/`bgColor` 兼容旧调用
  - `fontSize` 仅接受正数（忽略 0/负数，避免边界值被静默处理或抛错）
  - 新增 22 个单元测试（tests/setcellformat-mac.test.js），路径改为 `__dirname` 固化，并接入 CI 测试步骤
- 网络请求重试：fetchWithRetry
- SSE 自动重连：connectSSE 增强
- WPS 就绪检查：checkWpsReady, checkDocument
- MCP COM 重试+超时：execWpsActionWithRetry
- 全局变量封装：AppState 单例
- proofread.ts 路径遍历漏洞（B1）
- formula.ts 3 个 handler 缺少 try/catch（B2）
- launcher.js dockWindow 命令注入（B4）
- launcher.js validateCwd UNC/DOS 设备路径泄露（B5）
- 删除 dock-debug.log 泄露（B7）
- proxy 端口冲突 14097 → 14098
- macOS 运行时校验：10 个 handler 添加 `process.platform === 'win32'` 守卫
- unhandledRejection 触发 process.exit 保留
- gateway.test.ts uuid v14 ESM mock 修复
- chart.ts/image.ts validateFilePath 移入 try 块内部（3 处）
- launcher.js stateLock 死锁 → try/catch/finally 保护
- main.js JSON 命令缺少 cmd 字段时跳过处理
- JSDoc 注释补充 25 处（main.js×10 + launcher.js×6 + taskpane.html×9）

---

## [1.0.0] - 2026-04-21

### Added
- WPS JS 加载项（opencode-wps）
- MCP 服务器（wps-office-mcp）
- 4 个 Skills（wps-word, wps-excel, wps-ppt, wps-office）
- Launcher 进程管理
- 一键安装脚本（install-addons.js）
- Markdown 渲染
- 多会话管理
- SSE 流式对话

### Features
- 任务窗格 Chat UI
- Ribbon 按钮
- WPS COM 桥接（PowerShell）
- 约 200 个 MCP 工具

---

## 历史版本

请查看 [Releases](https://github.com/lnxsun/opencode-wps/releases) 查看所有版本。
