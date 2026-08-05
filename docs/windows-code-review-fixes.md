# Windows 插件代码评审与修复记录（Issue #85）

> 背景：Linux 侧插件开发时评审发现大量问题，Windows 侧此前未做彻底评审。
> 本文件记录本轮对 Windows 侧全部代码的评审结论与修复项。
> 流水线：4/10 开发（M1-M7）→ 5/10 评审 → 6/10 测试。

## 评审范围

| 模块 | 文件 | 规模 |
|------|------|------|
| M1 | `opencode-wps/taskpane.html` | 1705 行 |
| M2 | `opencode-wps/main.js` | 561 行 |
| M3 | `opencode-wps/launcher.js` | 522 行 |
| M4 | `opencode-wps/config.js` / `opencode-proxy.js` / `serve.js` | 小 |
| M5 | `wps-office-mcp/src` | ~3.1 万行 TS |
| M6 | `install-addons.js` + `scripts/` | 中 |
| M7 | `skills/` / `agents/` / `.opencode/plugins/governance.js` | 中 |

## 修复清单（🔴 必修 / 🟡 建议）

### M1 taskpane.html

| 级别 | 问题 | 修复 |
|------|------|------|
| 🔴 | `toggleProviderDropdown` 的 `p.id` 未转义直接拼进 onclick（供应商名来自服务端 `/config/providers`，可被污染 → DOM XSS） | `escapeAttr(p.id)` |
| 🔴 | `openSidebar` 的 `s.id` 未转义拼进 onclick（会话 id 来自服务端 `/session`） | `escapeAttr(s.id)` |
| 🔴 | `escapeAttr` 原实现不转义 `<>&`，且单引号用 `&#39;`——在 onclick 双层解析下 HTML 会先解码回 `'` 重新引入注入 | 重写：`&`→`&amp;`、`<`→`&lt;`、`>`→`&gt;`、`"`→`&quot;`、`'`→`\'`（JS 字符串转义） |
| 🟡 | `renderCwdHistory` 转义顺序 bug：`&` 最后替换会把前面生成的 `&quot;` 二次转义成 `&amp;quot;` | `&` 最先替换 |
| 🟡 | Markdown 链接 `target="_blank"` 缺 `rel="noopener noreferrer"`（tabnabbing） | 补充 |
| 🟡 | `stopOpenCode` 未清理 SSE 重连定时器，停止服务后仍会继续重连 | 清理 `sseReconnectTimer` 并重置退避 |
| 🟡 | `handleFileUpload` 文件名未清洗换行控制字符，可伪造 `</file-upload>` 注入额外消息块 | 清洗 `[\r\n\x00-\x1f]` |

### M3 launcher.js

| 级别 | 问题 | 修复 |
|------|------|------|
| 🔴 | `validateCwd` 契约不一致：UNC 分支 `throw`、其它分支返回对象；`dockWindow` 无 try/catch → UNC 输入触发 `uncaughtException` 导致 launcher 崩溃 | 统一返回 `{ valid: false, error }` |
| 🔴 | `stopOpenCodeByPort(port)` 未校验端口，`/start` 的 `body.port` 可注入 shell 元字符（命令注入） | `parseInt` + 1-65535 范围校验 |
| 🟡 | wmic 查询失败时**继续 kill**：Windows 11 无 wmic → 误杀占用端口的非 OpenCode 进程 | 查询失败保守跳过 |
| 🟡 | `parseBody` 无 body 大小限制 → DoS | 1MB 上限 + 413 响应 |
| 🟡 | `dockWindow` 的 URL 拼进 PowerShell 双引号无包裹：cwd 含 `$` 触发变量插值、含 `'` 破坏字符串 | 单引号包裹 + 单引号翻倍转义 |
| 🟡 | `dock.ps1` 固定文件名 → 并发请求互相覆盖竞态 | 唯一临时文件名（时间戳+随机数） |

### M4 proxy/serve

| 级别 | 问题 | 修复 |
|------|------|------|
| 🟡 | `serve.js` 路径穿越用 `indexOf(ROOT)` 前缀匹配：`C:\root2\x` 可绕过 `C:\root` | `path.relative` 严格校验 |
| 🟡 | `opencode-proxy.js` 客户端断开时上游请求悬挂（句柄/内存泄漏） | `clientReq` error/close 时 `proxyReq.destroy()` |

### M5 wps-office-mcp

| 级别 | 问题 | 修复 |
|------|------|------|
| 🟡 | `wps-client.ts` 的 `Promise.race` 超时定时器永不清理：每次 COM 调用（即使成功）遗留最长 30s 挂起定时器 → Jest worker 无法退出 + 资源泄漏 | `result` 完成即 `clearTimeout` |
| 🟡 | Mac 分支 `execWpsAction` 被调用两次（timeoutPromise 内 + race 内） | 只调用一次存入变量 |

### M6 install-addons.js

| 级别 | 问题 | 修复 |
|------|------|------|
| 🟡 | VBS 启动器路径含引号会破坏 VBS 字符串 | 防御性 `"` → `""` 转义 |

## 评审通过项（无需修复）

- **M2 main.js**：try/catch 覆盖完善（此前 PR #83 已 10 轮加固），无新增必修项
- **M5 路径安全**：`validateFilePath`/`validateImagePath`/`isAllowedUrl` 已在全部写路径 handler 应用
- **M5 工具一致性**：240 注册工具 + 257 COM Actions 全部对齐，无死映射（脚本验证）
- **M7 governance**：G1-G7/P1-P16/T1-T11 规则完整，GATEWAY_ONLY 黑名单防直连
- **凭据/危险函数扫描**：无硬编码密钥、无 eval、无 new Function（browsertest 为能力探测）

## 测试验证

| 检查项 | 结果 |
|--------|------|
| `node --check` 全部 JS 文件（12 个） | ✅ |
| taskpane.html 内联 JS 语法 | ✅ |
| `wps-office-mcp` tsc build | ✅ |
| `wps-office-mcp` jest（302 用例） | ✅ 11 suites / 302 tests |
| `scripts/validate-tool-counts.js` | ✅ 509 工具一致 |
| `scripts/validate-versions.js` | ✅ 1.1.0 全一致 |
| `scripts/validate-settings.js` | ✅ |
| `scripts/validate-npc-team-prompt.js` | ✅ |
