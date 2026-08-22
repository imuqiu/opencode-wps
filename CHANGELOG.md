# 更新日志

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **屎山清理（Issue #189，多 PR 推进）** — 系统清理项目历史债：
  - **PR-C handler-utils 单源化**：把 excel/ppt/word 三平台 handler 中**两平台逐字节相同**的 14 个纯工具函数（`getExcelSheet`/`colToLetter`/`resolveColumnLetter`/`colToNumber`/`resolveRowCol`/`resolveAlignment`/`toExcelColor`/`findNotesShape`/`findShape`/`getPPT`/`resolveSlideIndex`/`toRgb`/`getSelectionRange`/`toBgr`）抽到 `shared/wps-bridge/handler-utils.js` 单一来源，`sync-wps-bridge.js` 同步到平台目录，改一处四处生效。实测行为零变化（仅抽两平台逐字节相同的纯函数，不触碰行为差异部分）。

## [1.8.4] - 2026-08-22

### Added

- **将 MCP `test:integration` 集成测试接入 CI Validate 阶段（PR #199，Issue #186）** — 落地 Issue #147 十四条质量红线「充分测试，测试覆盖要全面」，补齐 `wps-office-mcp` 集成测试从未在 CI 中执行的缺口：
  - `.cnb.yml` Validate 阶段 MCP 行：`cd wps-office-mcp && npm run lint && npm run test:unit && npm run test:integration`（与单测并列，保留 Issue #185 的 lint 接入，去除重复 npm ci）；
  - `docs/DEVELOPMENT_GUIDE.md` CI 门禁表 MCP 行同步为「单测 + 集成测试」；
  - 集成测试对 WPS COM / MCP SDK / logger 均 mock，**无需 WPS 运行，headless CI 可真实跑通**（3 suites / 46 tests 通过）。

### Changed

- **版本号升级至 1.8.4** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.8.4，`validate-versions` 校验通过。

## [1.8.3] - 2026-08-22

### Added

- **NPC_TEAM 需求覆盖度检查 + ⏸CP2.5 暂停点（PR #188，Issue #147 补充）** — 在 NPC_TEAM skill 流水线 6/12 测试通过后新增「需求覆盖度检查」子步骤（逐条核对需求 ↔ 开发落点 ↔ 测试覆盖矩阵，任一需求无落点或无测试覆盖即不通过），完成后经 ⏸CP2.5 需求覆盖确认暂停待用户确认；未覆盖全部需求不得进入文档：
  - `docs/NPC_TEAM.md` + `.codebuddy/skills/npc-team/SKILL.md`（双源）：流水线主链 + 工作流程新增需求覆盖度检查 + ⏸CP2.5 暂停点，暂停确认表/门禁表/冒烟方法 F/验证点表/QA 角色卡片同步补齐；
  - `scripts/validate-npc-team-prompt.js`：新增 5 道 prompt 级门禁（需求覆盖度检查/覆盖度矩阵/⏸CP2.5 暂停点/需求全覆盖语义/暂停卡模板）+ 文档级校验（暂停确认表/工作流程/门禁表/冒烟方法/验证点表）；
  - `tests/validate-npc-team-prompt.test.js`：新增多个负向回归用例（删需求覆盖度检查/删 ⏸CP2.5/删开发落点矩阵/删 QA 职责等均拦截），用例 140→149 通过；
  - `README.md`：接力模式说明补齐需求覆盖度检查 + ⏸CP2.5 暂停点。

- **补建 MCP ESLint 静态规则检查（PR #200，Issue #185）** — 消灭 `wps-office-mcp` 的「僵尸 lint 脚本」（`npm run lint` 声明但从未安装/运行），落地 Issue #147 质量红线「npm run lint 检查代码」：
  - `wps-office-mcp` devDependencies 新增 `eslint@^8.57.0`、`@typescript-eslint/parser@^8`、`@typescript-eslint/eslint-plugin@^8`；
  - 新增 `wps-office-mcp/.eslintrc.cjs`（ESLint 8 + `@typescript-eslint/recommended` 规则，适配项目 CJS 风格与 jest 测试文件）；
  - 根 `preflight` 与 `.cnb.yml` CI 增加 `cd wps-office-mcp && npm run lint`；
  - `npm run lint` 在 wps-office-mcp 内真实可运行（0 error，77 个 any warning 不阻塞退出码）。

### Changed

- **版本号升级至 1.8.3** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.8.3，`validate-versions` 校验通过。

## [1.8.2] - 2026-08-22

### Added

- **NPC_TEAM 7/12 文档阶段按当次需求/bug 整改同步修改完善项目相关文档（PR #190，Issue #147 补充）** — 7/12 文档阶段明确化：当次需求开发/bug 整改对应的实际改动，须同步修改完善项目相关文档，确保文档与当次改动一致、不流于空泛模板：
  - `docs/NPC_TEAM.md`：工作流程 7/12 文档阶段描述明确化（与 .codebuddy/skills/npc-team/SKILL.md 双源同步一致）；
  - `scripts/validate-npc-team-prompt.js`：新增 7/12 文档两层门禁（inline 流水线 + 工作流程行，防删减）；
  - `tests/validate-npc-team-prompt.test.js`：新增 2 个负向回归用例（删 inline / 删 workflow 均拦截），用例 140/140 通过。

### Changed

- **版本号升级至 1.8.2** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.8.2，`validate-versions` 校验通过。

## [1.8.1] - 2026-08-21

### Added

- **NPC 十四条质量红线固化（Issue #147 防垒屎山）** — 把"NPC 垒屎山"倾向的 14 条工程纪律固化到 NPC_TEAM skill 与工程脚本，三个原子化 PR 落地：
  - **工程脚本补齐（PR #182）**：根目录新增 `npm run test`（聚合根 JS 单测）/ `test:e2e`（e2e 单独跑）/ `lint`（全仓 JS 语法门禁 `node --check`）/ `preflight`（一键聚合 validate 系列 + format:check + lint + test + test:e2e）四个脚本，`.cnb.yml` CI 接入 `npm run preflight`，`docs/DEVELOPMENT_GUIDE.md` 同步命令说明。
  - **e2e 假测试修复（PR #183）**：`tests/e2e.test.js` 3 个 `assertTrue(true, '跳过实际 HTTP 请求')` 假断言改为真实本地 mock HTTP server 校验（校验真实请求/响应/状态码），移除空断言，e2e 接入 CI；`runTests` 校验 testCount=0 时 exit 1，防假装测试。
  - **NPC_TEAM 铁律 16-18 固化（PR #184）**：`docs/NPC_TEAM.md` + `.codebuddy/skills/npc-team/SKILL.md` 双源新增铁律 16（思维纪律：充分分析根因/方案求证/评审实事求是/逻辑清晰无矛盾兜底）、铁律 17（改动纪律：最小必要改动/原子化 PR/无关问题单独拆 issue/用户可见变更更新 /docs）、铁律 18（测试纪律：充分测试逐条真测/执行单测+集成测试/运行 preflight/lint/format）；`scripts/validate-npc-team-prompt.js` 新增门禁锚点；`tests/validate-npc-team-prompt.test.js` 新增 14 个负向回归用例（124→138）。

### Changed

- **版本号升级至 1.8.1** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.8.1，`validate-versions` 校验通过。

### Fixed

- **"暂未建立的测试"已单独拆 issue 完善**：MCP `lint`（eslint src/**/*.ts）僵尸脚本（#185）、MCP `test:integration` 未接入 CI（#186）分别单独开 issue 跟踪完善，符合"无关问题单独拆"纪律。

## [1.8.0] - 2026-08-21

### Changed

- **版本号升级至 1.8.0** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.8.0，`validate-versions` 校验通过。

### Fixed

- **校对防幻觉链路加固（Issue #179 真实校对实例分析落地）** — 针对真实校对会话（session_ffa8）暴露的问题逐项修复：
  - **单批进度增量上限 200 段（评审 R2-1）**：700→1600 跳号（增量 900）被服务端拒绝，封堵 Issue #179 原始假进度攻击路径（与 `getDocumentParagraphs` 单批上限一致）。
  - **进度超界校验串行/并行共用（评审 R2-2/R3-1）**：`_processed_to_paragraph` > 文档总段数一律拒绝（含并行模式），防谎报超大值瞬间覆盖全文。
  - **批次区间缺口时「全部已修复 ✅」不显示（评审 R2-3）**：与「批次区间未覆盖完整」告警口径统一，防自动批次被篡改出缺口后仍误报。
  - **saveSessionToDisk 批次表深拷贝（评审 R2-7）**：防浅引用污染磁盘缓存/内存会话。
  - **SKILL.md 同步六维评分与进度校验说明（评审 R3-4/R3-5）**：五维→六维、增量上限与超界校验说明补充。
  - **install-addons.js 保留用户 MCP env 配置（评审 R4-1）**：重建 MCP 条目不再清空用户自定义环境变量；`applyWriteRoots` 按平台规范化路径分隔符（评审 R4-2）。
  - **`P17` 拦截原生 `write` 伪造校对报告（漏洞封堵）**：此前 `P17` 只对 `wps_office_execute` 网关内 `tool_name=write` 生效，而 OpenCode 原生 `write` 工具在「非网关调用直接 return」闸门就被放行，AI 可用原生 `write` 绕过服务端真实累计数据手动拼造报告。现将原生 `write`/`writeFile`/`writeText`/`edit` 写「校对报告」路径的拦截**提升到前置闸门之前**，除非服务端已成功生成报告（`reportGenerated=true`）否则一律拦截（`governance.js`）。
  - **服务端校验串行进度单调递增（防假进度跳号）**：`proofreadAccumulate` 在**串行模式**（无 `_batch_id`）下校验 `_processed_to_paragraph` 必须严格递增（新值 > 已上报进度），重复上报/进度回退一律拒绝——堵住 AI 谎报进度（如 700→1600 跳过中间批次）假装覆盖全文的漏洞；并行模式（带 `_batch_id`）各执行 agent 区间独立，保持 `Math.max` 不误伤（`proofread-report.ts`）。
  - **区分「空批次表」与「全部完成」（防误报）**：报告「全部已修复 ✅」改为仅在服务端确认真实覆盖全文（`processedToParagraph >= totalParagraphs`）时显示；否则显示「⚠️ 覆盖状态未确认完整」，杜绝「空批次表 + 无进度」兜底放行时误报「全部完成」（`proofread-report.ts`）。
  - **主 agent 补充校对 skill 路由**：`wps-expert.md` 的 Skill 调用优先级新增 `wps-proofread`（文档校对专项），并补充校对路由与铁律指引——用户请求校对时须调用 `wps-proofread`，报告必须由 `generateProofreadReport` 生成、严禁 `write` 伪造、未覆盖全文不得声称全部已修复。
  - **路径写盘白名单配置暴露**：新增 `opencode-wps/config.js` 的 `allowedWriteRoots` 配置项，`install-addons.js` 将其写入 `opencode.json` 中 MCP server 的 `env.OPCODE_ALLOWED_ROOTS`，解决用户文档在其他盘符（如 F 盘）时报告写盘报「Path not allowed」的问题（PR #180 只解决权限授权，未解决路径白名单）。逻辑抽取到 `shared/permission-helper.js` 的 `applyWriteRoots`（可测试）。
  - **测试**：`governance-p17.test.ts` 新增原生 `write` 拦截/放行用例；`proofread-report.test.ts` 新增串行进度防回退、并行乱序兼容、空批次表不误报、覆盖全文正常显示用例；`install-permission.test.js` 新增 `applyWriteRoots` 5 用例（均接入 CI）。

### Added（Issue #179 方案全量补齐）

- **服务端自动分批（取代 planner subagent）**：`proofreadAccumulate` 会话首次初始化（且未携带 `_batch_allocations`）时，服务端按 `docInfo.totalParagraphs` 自动生成连续批次（每批 100 段）落盘（`proofread-store.ts` 新增 `generateAutoBatches`）——批次表从此**永远非空**，根除「空批次表 = 全部完成」的误判；单 agent 顺序校对不要求逐批置 done，按进度覆盖判定（`proofread-report.ts`）。
- **报告门禁三态区分（防「从未规划/从未跑」误报）**：`generateProofreadReport` 区分「编排模式（AI 手动登记批次，要求全部 done + 凭证完整 + 覆盖全文）/ 串行模式（按进度覆盖判定）/ 空白会话（无 issues、无疑似问题、无修订依据 → 直接拒绝生成）」，历史遗留串行会话（有运行痕迹但无进度）放行但报告标注「⚠️ 覆盖状态未确认完整」不误报「全部已修复 ✅」；`saveSessionToDisk` 合并批次表改为 clone 写入，避免内存 session 被磁盘旧批次表污染导致手动登记被覆盖（`proofread-store.ts`）。
- **路径白名单方案 B（报告与文档同目录可写）**：`generateProofreadReport` 写盘校验时把 `docInfo.filePath` 所在目录并入允许根目录（`buildReportAllowedRoots`），报告与文档同目录可写、不全局开放盘符；与方案 A（`allowedWriteRoots` → `OPCODE_ALLOWED_ROOTS`）互补（`proofread-report.ts`）。
- **放弃 4-subagent 编排（文案层）**：`skills/wps-proofread/SKILL.md` 删除 4-subagent 编排章节，改为「单 agent 顺序执行 + 服务端强制分批/进度/门禁」执行模型；`agents/wps-proofread-planner/manager/executor/reporter.md` 头部标注「⚠️ 已停用（Issue #179 阶段4）」仅作历史存档。
- **格式维度拆分（统计口径）**：`TYPE_METRIC_MAP` 把「异常空格/中英混排/数字空格/中文标点」等纯格式问题从 `consistency`（一致性）拆出独立 `format`（格式）维度（权重最低 0.05），避免大量空格/标点把「一致性」拖成 0 分失真；报告统计摘要新增「其中纯格式问题 N 处」归类展示（`proofread-report.ts`）。

## [1.7.0] - 2026-08-20

### Added

- **服务端权限自动放行（Issue #179 方案A，根治长任务外部目录读写卡授权）** — 在生成 `opencode.json` 时写入服务端 `permission`（`"*": "allow"` + `external_directory: { "**": "allow" }`），服务端直接放行所有工具及工作目录外的文件读写，权限请求不再下发，彻底根治长任务（如 F 盘文档校对）因 `external_directory` 授权卡住（曾出现 7.86 小时中断）的问题：
  - **`opencode-wps/config.js`**：`permission.mode` 新增服务端放行语义——`'auto'` 时 `install-addons.js` 注入服务端 `permission`；`'manual'` 时移除（走前端弹窗人工确认）。
  - **`install-addons.js`**：生成 opencode.json 时读取 `config.js` 的 `permission.mode`，按模式注入/移除服务端 `permission`；逻辑抽取到 `shared/permission-helper.js`（纯函数，可测试）。
  - **`.opencode/opencode.jsonc`**：模板新增默认 `permission`，`external_directory` 可按需收紧到具体盘符（如 `F:\\**`）。
  - **文档**：`docs/USAGE.md`、`docs/SECURITY.md` 更新服务端放行机制、关闭与收紧方法及安全权衡说明。
  - **测试**：新增 `tests/install-permission.test.js`（6 用例：auto 注入/保留、manual 删除/无副作用、未知 mode 回退 auto、模板与默认值一致），并接入 `.cnb.yml` 与 `.github/workflows/ci.yml`。
  - **评审修复（PR #180 第 1 轮）**：
    - 未知 `permission.mode` 不再静默回退到 `auto`（全放行），改为按 `manual` 保守处理并在 install 日志中明确警告（避免拼写错误时静默扩大权限面）。
    - `manual` 模式仅移除「由模板注入的默认全放行配置」，保留用户在 `opencode.json` 中自定义的精细 `permission`（不再误删自定义配置）。
    - `SECURITY.md` 补充说明：opencode 原生 `"*": "allow"` 放行的内置工具（bash/edit/write 等）不受 governance.js 拦截，提醒收紧范围。
    - 测试从 6 用例扩至 9 用例，覆盖未知 mode 保守回退、manual 保留自定义权限、auto 变体不静默全放行。
    - **评审修复（PR #180 第 2 轮）**：`SECURITY.md`、`USAGE.md` 补充「收紧 external_directory 需同时清理已有 `opencode.json` 旧 `**` 规则」的指引——因 `install-addons.js` 的深层合并会让旧 `**` 与新的收紧规则共存，收紧不彻底。
    - **评审修复（PR #180 第 3 轮）**：`install-addons.js` 第 4.5 步 `catch` 分支改为保守处理——`config.js` 无法读取时**移除模板注入的全放行 permission**（安全降级方向为“收紧”而非“放宽”，与未知 mode 保守 manual 原则一致）并明确警告；manual 模式日志改为“不写入”以更准确。
    - **评审修复（PR #180 第 4 轮）**：
      - `install-addons.js` 修复 falsy mode（空串/0/false）被静默当 auto 全放行的问题——改为读取 falsy mode 值并交由 `applyServicePermission` 保守按 manual 处理（与未知 mode 保守原则一致）。
      - `.opencode/opencode.jsonc`、`config.js` 注释同步更新，反映 manual 模式仅移除默认全放行、保留用户自定义精细 permission 的实际行为。
      - 测试增至 10 用例，新增 falsy mode 保守处理覆盖。
    - **评审修复（PR #180 第 5 轮）**：`applyServicePermission` 返回值新增 `removedDefault` 字段区分 manual 下「移除默认全放行」与「保留自定义」；install 日志据此更精确；测试用例改用 JSON 深比较提升健壮性（不再依赖引用保留）。
    - **评审修复（PR #180 第 6 轮）**：`isSamePermission` 改为基于键的递归深比较（对属性顺序不敏感），修复 JSON.stringify 顺序敏感误判；新增「属性顺序不同的默认全放行也应被移除」测试，测试增至 11 用例。
    - **评审修复（PR #180 第 7 轮）**：`install-addons.js` 第 4.5 步顶部注释同步更新，反映 manual 仅移除默认全放行、保留自定义的实际行为（与模板/config.js 注释一致）。
    - **评审修复（PR #180 第 8 轮）**：CHANGELOG 版本段归属调整——将本 PR 未发布功能从已发布的 `[1.6.6]` 段移入新增的 `[Unreleased]` 段，符合 Keep a Changelog 规范，避免已发布版本混入未发布内容。

## [1.6.6] - 2026-08-19

### Fixed

- **WPS 文字首次打开面板头部被遮挡、压扁顶部功能区的问题（Issue #164，PR #170）** — 基于千年一炭实机反馈的**新认知**做的最小聚焦修复：打开文档/切标签正常、仅点击「打开面板」后头部被遮挡，且**仅 WPS 文字（12.1.0.28022）出现，PPT/Excel 正常**。根因：WPS 文字宿主在 `tskpane.Visible = true` 时会**重新计算任务窗格窗口位置**，把顶边定位到标题栏正下方（覆盖「开始/插入」功能区），从而**覆盖掉先前设置的 `DockPosition = Right`**；PPT/Excel 不会在置可见时重算这个错误位置，所以它们正常。本次修复在**两处 `Visible=true` 之后各做一次二次校正** `setTaskPaneDockPosition(...)`，把被宿主覆盖的正确停靠纠正回来：
  - **`createTaskPane()`（首次创建路径）**：`Visible = true` **之后**再调用一次 `setTaskPaneDockPosition(tskpane)`，纠正被 WPS 文字宿主覆盖的正确停靠。
  - **`OnAction` GetTaskPane 找回路径**：`tp.Visible = !tp.Visible` 切到**可见**后同样二次校正 `setTaskPaneDockPosition(tp)`（仅可见时校正，隐藏时跳过）。
  - **干净基线、不垒屎山**：本 PR 基于干净基线开发，PR #166/#169 引入的所有错误修复（`scheduleFirstOpenLayoutCorrection`、`FIRST_OPEN_RELAYOUT_DELAY_MS`、`WPS_LAYOUT_CORRECTION_ENABLED`、`cancelFirstOpenLayoutCorrection` 及各竞态/降级/防重复逻辑，净删 849 行）已整体移除，`main.js` 恢复为仅保留基础右侧停靠健壮性代码，其上仅叠加上述两处最小二次校正。
  - **无副作用收敛方式**：修复发生在 `Visible=true` **之后**、与「WPS 文字置可见时覆盖 DockPosition」的宿主行为对齐，**不引入**任何 `Visible=false→true` 重排、定时器、降级开关、防重复标记；即使二次校正假设不成立也只是「无效但无害」，不会像 PR #166 那样每次点击主动触发遮挡。
  - 经验证：`tests/taskpane-dock.test.js` **22/22 全绿**（20 基线 + 新增 2 个二次校正用例，验证 `Visible=true` 之后 DockPosition 被再次校正的时序）；formatsenderror 7/7、healthcheck 32/32 全绿；`node --check` + prettier 通过；经独立评审（info×3 无 warning/error）+ CI success 后合并。

### Changed

- **版本号升级至 1.6.6** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.6.6，`validate-versions` 校验通过。

## [1.6.5] - 2026-08-19

### Fixed

- **launcher 非 shell 分支（.exe/.ps1）启动 opencode serve 不再抛 "stdio is invalid"（Issue #161 回归，PR #171）** — 修复「启动服务」返回 HTTP 400、opencode 进程起不来：当 opencode 二进制为 `.exe`（或走 `.ps1` 的 powershell 直启）时，非 shell 分支把 `fs.createWriteStream()` 创建的日志 WriteStream **直接作为 spawn 的 stdio**。根因：`createWriteStream()` 异步打开文件，若在 `'open'` 事件触发前就把流传给 `child_process.spawn()`，流的 `fd` 仍为 `null`，Node 抛 `The argument 'stdio' is invalid. Received WriteStream { fd: null, ... }`（与 .cmd 场景同源，但此前仅 shell 分支规避了）。本次修复：
  - **非 shell 分支改用 `['ignore','pipe','pipe']` + 手动转发**：与 shell 分支（.cmd）完全一致，`stdout`/`stderr` 通过 `data` 事件手动写入日志流，彻底消除 WriteStream 未 open 即作为 stdio 的竞态；日志落盘行为完全不变。
  - **测试同步**：`tests/launcher.test.js` 新增非 shell 向未 open 的 WriteStream 作为 stdio 必抛 "stdio is invalid" 的根因用例；pipe 转发提取为公共函数 `pipeChildOutputToLog`，两分支统一复用，源码断言从「保留 WriteStream 直连 stdio」反转为「统一用 pipe + `pipeChildOutputToLog` 手动转发」。

### Changed

- **版本号升级至 1.6.5** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.6.5，`validate-versions` 校验通过。

## [1.6.4] - 2026-08-19

### Fixed

- **修复侧边栏 ChatUI 首次打开头部被遮挡、且压扁 WPS 顶部标签（开始/插入等）的问题（Issue #164，PR #166）** — 根因：在最大化窗口下**首次创建**任务窗格时，WPS 宿主（12.1.0.28022）会把任务窗格 WebView 的可见区域定位到文档窗口错误的顶边 Y（约偏移一个功能区高度），导致 ChatUI 顶部（`topbar` + `session-header`）被挤出可视区、被功能区盖住。关键证据：用户实测「新建 WPS 标签窗口再切回」可恢复，证明宿主在窗口/标签切换时会重算任务窗格的窗口矩形（含顶边 Y）——这是唯一可靠的恢复路径。页面内部（`getBoundingClientRect`/`window.innerHeight`）只能看到 WebView 内部视口、测不到宿主偏移，故此前 #78 六轮「页面内检测 + 强制 reflow + 宿主重绘」全部无效（方向从根上就错了）。本次修复：
  - **在「首次创建」路径调度一次宿主重排校正（`scheduleFirstOpenLayoutCorrection`）**：延迟 1000ms（`FIRST_OPEN_RELAYOUT_DELAY_MS`，等 WebView 初始布局稳定）后，重新断言停靠位置为右侧、并短暂 `Visible=false → true` 强制宿主按正确几何重建任务窗格可见窗口——与「切换标签触发宿主重排」同源，精准补上首次打开缺失的那一次宿主重排。
  - **只做首次、只做一次**：首次创建时宿主按错误几何布局**必现**（用户确认），之后宿主已正确重排，重复隐藏→显示反而可能闪屏，故用 `firstOpenLayoutCorrectionScheduled` 标记防重复调度；延迟窗口内若用户已手动隐藏面板则跳过（`Visible` 读回校验，尊重用户操作）；停靠位置校正失败时不再做无意义重排；校正失败只留痕不中断（下次打开仍有重排机会）。
  - **降级开关 `WPS_LAYOUT_CORRECTION_ENABLED`（默认开启）**：若实机验证发现「Visible 切换等效切标签宿主重排」假设不成立，可将该常量改为 `false` 一键禁用校正（避免每次首开闪屏），无需改动逻辑；作为未来 WPS 升级或遮挡复发的逃生舱。
  - 经验证：`tests/taskpane-dock.test.js` 新增用例后 **32/32 全绿**，经 **11 轮评审-修复循环清零**（每步在 PR #166 留痕）+ CI success 后合并。

### Changed

- **版本号升级至 1.6.4** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.6.4，`validate-versions` 校验通过。

## [1.6.3] - 2026-08-18

### Fixed

- **launcher 启动 opencode serve 时不再追加 `--permission allow` 旗标（Issue #161 根因）** — 修复「启动服务」反复提示"启动失败，请检查 OpenCode 是否已安装"：用户 `opencode-serve.log` 铁证表明，老版本 opencode 的 `serve` 子命令**根本不识别 `--permission` 旗标**（其 help 选项列表只有 `--print-logs/--log-level/--pure/--port/--hostname/--mdns/--mdns-domain/--cors`）。此前 Issue #116 在 auto 模式（`autoAllowOnLaunch: true`）下无条件追加 `--permission allow`，导致 opencode 把未知旗标当错误 → 打印 usage/help → 以 **code=1** 退出 → 14096 端口永远不监听 → 侧边栏 30s 轮询超时 → 报「启动失败」。本次修复：
  - **删除启动路径里的 `--permission` 旗标**：`buildSpawnCommand` 不再向 `serve` 参数追加 `--permission allow`；同时删除 `shouldAutoAllowPermission()` 与不再被调用的 `loadWpsConfig()`（消除死代码）。
  - **删除 `autoAllowOnLaunch` 配置**：config.js 不再产出服务端旗标，只保留 `permission.mode`（`auto`/`manual`）驱动前端自动响应。
  - **拒绝「探测旗标支持」的错误方向（推翻 PR #167）**：不新增 `supportsPermissionFlag()`/`getPermissionArgs()`/`buildPermissionProbeCommand()` 等能力探针——探测一个本就不该依赖、且老版本不存在的旗标 = 徒增代码 + 新增故障点。
  - **权限自动放行完全交由前端通道**：`taskpane.html` 的 `handlePermissionRequest` 在 `config.permission.mode === 'auto'` 时直接 `respondPermission('allow')`（不弹窗），另有 `/tui/control/next` 长轮询兜底；`manual` 模式保留弹窗人工确认。
  - **测试与文档同步**：`tests/launcher.test.js` 权限用例反转断言——验证 launcher **不再**追加 `--permission`、config **不再**有 `autoAllowOnLaunch`；`docs/USAGE.md` 移除「服务端根治追加 `--permission`」的误导描述，改为说明前端 auto-allow + `/tui/control/next` 兜底机制。

### Changed

- **版本号升级至 1.6.3** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.6.3，`validate-versions` 校验通过。

## [1.6.2] - 2026-08-18

### Fixed

- **launcher 复用 `buildSpawnCommand`，`.ps1` 用 powershell.exe 绝对路径启动（Issue #134 回归，PR #159）** — 修复「启动服务」反复提示"启动失败，请检查 OpenCode 是否已安装"：当用户 opencode 为 `.ps1`（如 Trae 自带 node 生成的 `opencode.ps1`）时，上一轮 `findOpenCodeBin` 已能探测到 `.ps1`，但 `startOpenCode` 实际启动时**未复用 `buildSpawnCommand` 的 `.ps1 → powershell.exe` 转换**，误直接 `spawn` `.ps1` 文件（Node 无法执行无解释器关联的 `.ps1`）导致 `ENOENT`、进程起不来、14096 端口不监听。本次修复：
  - **`startOpenCode` 复用 `buildSpawnCommand`**：新增可选 `port` 参数，用其返回的 `command/args/needShell` 执行 spawn；`.ps1` 走 `powershell.exe` 绝对路径（`resolvePowerShellExe()`，按 `System32 → SysWOW64 → 裸命令` 逐级兜底，保证计划任务/VBS/服务等**无人值守场景** PATH 缺 PowerShell 目录也能启动）启动，非 shell 分支改 `hiddenSpawn(spawnCmd.command, args)`，不再直接 spawn opencodeBin。
  - **收敛重复分支**：`startOpenCode` 消除自行复制的 `isPs1/isExe/needShell` 分支，统一以 `buildSpawnCommand` 为单一来源；`.cmd`/无扩展名走 `cmd.exe /d /s /c` 包装且复用 `spawnCmd.command` 拼 shellCmd，消除漂移风险。
  - **日志可复现、错误可定位**：spawn 日志对含空格路径加引号（`quoteIfNeeded` 提升为模块级函数）；spawn error 追加实际 spawn 的 `command` 字段；`.ps1` 场景 powershell 退出时对 14096 端口做 `isPortListening` 复核并提示「服务可能仍在运行」。
  - **测试与文档同步**：`tests/launcher.test.js` 新增 `resolvePowerShellExe` 兜底探测 / `.ps1` 走 powershell 绝对路径 / `quoteIfNeeded` 引号 / needShell 分支复用 `spawnCmd.command` / getDiagInfo 预览前缀等专项用例，**38 项全过**；`docs/TROUBLESHOOTING.md` 补充 `.ps1` powershell 绝对路径启动与 spawn error `command` 字段说明。
  - 经 **10 轮评审-修复循环清零**（每步在 PR 留痕）+ QA 测试（38/38 + `security.test.js` 31/31 + 全部 CI 门禁通过）+ CI success 后合并。

### Changed

- **版本号升级至 1.6.2** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.6.2，`validate-versions` 校验通过。

## [1.6.1] - 2026-08-18

### Added

- **launcher 探测目录新增 bun 全局 bin（`BUN_INSTALL` 与 `~/.bun/bin`）（Issue #134，PR #160）** — 修复「点击启动服务没反应」：用户删除 `.trae-cn` 并用 `bun install -g opencode-ai` 全局安装 opencode（bin 生成于 `~/.bun/bin`）后，launcher 的 `getOpenCodeBinDirs()` 原先只探测 `.trae-cn` / npm / Program Files，**探测不到 bun 全局 bin**，回退到裸 `opencode` 依赖瘦 PATH 导致 spawn ENOENT、服务起不来。本次修复：
  - **新增 bun 全局 bin 探测**：`getOpenCodeBinDirs()` 支持 `BUN_INSTALL` 环境变量自定义安装位置（缺省 `~/.bun`），显式兜底 `~/.bun/bin`，去重逻辑保证无重复；`Program Files` / `Program Files (x86)` 由硬编码 `C:\` 改为读取 `process.env['ProgramFiles']` / `process.env['ProgramFiles(x86)']`（缺失回退硬编码），增强健壮性。
  - **不再探测已删除的 `.trae-cn`**：用户明确 `.trae-cn` 已删除且是历史问题根源，移除两条 `.trae-cn` 探测目录；在 `docs/TROUBLESHOOTING.md` 补充兼容性说明（如需兼容旧环境可自行在 `getOpenCodeBinDirs()` 末尾追加）。
  - **bun shim spawn 时注入 bun 运行时 PATH**：新增 `isBunShimPath()` 识别 bun 路径（用 `path.relative` 目录边界匹配，规避 `D:\bun` vs `D:\bunny` 前缀误判），命中 bun shim 的 `.exe` 分支时将该 bun bin 目录前置注入 `spawnEnv.PATH`，确保 shim 能解析到 bun 运行时。
  - **测试与文档同步**：`tests/launcher.test.js` 新增 bun 探测去重 / `BUN_INSTALL` 自定义与默认兜底 / `isBunShimPath` 边界与前缀不误判等用例，**33 项全过**；`docs/TROUBLESHOOTING.md` 自检指引与残留 `.trae-cn` 举例统一为 bun / npm 场景。
  - 经 **10 轮评审-修复循环清零**（每步在 PR 留痕）+ QA 测试（33 项全过、`isBunShimPath`/`getOpenCodeBinDirs`/bun PATH 注入边界验证通过）+ CI success 后合并。

### Changed

- **版本号升级至 1.6.1** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.6.1（顺带修复上一版漏改根 `package-lock.json` 的漂移），`validate-versions` 校验通过。

## [1.6.0] - 2026-08-18

### Added

- **代码质量重构：消除三平台 handler 重复 + 拆分 gateway 巨无霸（Issue #151 体检报告落地，PR #155）** — 针对仓库体检识别的「三平台 handler 大量复制粘贴 + `gateway/index.ts` 近 3000 行巨无霸」隐患，按「抽公共层 → 拆巨无霸 → 保持测试门禁」优先级重构，消除重复、降低维护成本、防止项目恶化为屎山：
  - **新增 `shared/wps-bridge/` 跨平台共享层（单一来源）**：`response.js` / `registry.js` / `common-core.js` 作为 Mac 与 Linux 反向轮询桥的公共逻辑唯一来源，解决历史上「改 bug 需在两平台各改一遍、极易漏改」问题。平台目录对应文件（`utils/response.js`、`handlers/registry.js`、`handlers/common-handler.js`）改为**生成产物**。
  - **新增 `scripts/sync-wps-bridge.js`**：将共享层同步到两个平台目录（生成平台化的 `common-handler.js`，按平台注入 `BRIDGE_PLATFORM` 标记）；`--check` 模式供 CI 漂移检测。
  - **平台差异隔离**：`common-handler.js` 共享化后，mac 独有 `ensureOutputDir`（saveAs/convertToPDF 前置校验输出目录）仅在 `BRIDGE_PLATFORM==='mac'` 启用；`setSelectedText` 缺 text 校验对齐 mac 安全语义（linux 此前静默清空，现统一拒绝缺参）。
  - **`gateway/index.ts` 数据表拆分**：将 `COM_ACTIONS`（~257 条，原内嵌近 2400 行）与类型定义（`VerificationStatus`/`ToolIndexItem`/`ToolParamSchema`）拆到独立 `com-actions.ts`，`index.ts` 从 2991 行瘦身至 ~580 行，专责 `searchTools`/`executeTool` 逻辑。
  - **测试与门禁**：新增 `tests/wps-bridge-shared.test.js`（10 用例：单源一致性 / 生成正确性 / 平台差异隔离 / 漂移检测 / gateway 拆分）；`.cnb.yml` 增加共享层 `--check` 漂移门禁 + 共享文件语法门禁。
  - 全量 **410+ 测试通过**（MCP 364 + 桥接共享层 10 + 既有 bridge/setcellformat/其他）+ `validate-versions`/`validate-toolcounts` 全绿，零回归。

### Changed

- **版本号升级至 1.6.0** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.6.0，`validate-versions` 校验通过。

## [1.5.9] - 2026-08-18

### Added

- **报告硬性完整性门禁 + 进度追踪 P22（Issue #151，PR #156）** — 彻底解决文档校对「假装完成 / 中途结束 / 匆忙生成报告」的遗留稳定性问题，根因修复为**服务端强制、非 opt-in**：
  - **`proofread-report.ts`**：`generateProofreadReport` 新增硬性完整性门禁——编排模式批次未完整 done / 覆盖有缺口 / 超界 / 重叠，或串行模式进度 `< totalParagraphs` 时，**直接返回 `success=false` 拒绝生成**（原先仅打软告警照样返回 success，AI 借此「假装完成 + 用 write 拼造假报告」）。
  - **`proofreadAccumulate` 强制进度追踪**：每次调用必报 `_processed_to_paragraph`，服务端在 session 记录 `progress.processedToParagraph`（取各批最大值，兼容并行），真实覆盖进度全程可核验，AI 无法跳过段落谎报完成。
  - **`governance.js` 新增 P22**：强制校验 `_processed_to_paragraph` 必填（规划初始化登记豁免），缺字段直接拦截，杜绝 AI 缺字段照常累加/出报告。
  - **文档/规则同步**：`skills/wps-proofread/SKILL.md`（P22 规则表 + 硬门禁说明）、`agents/wps-proofread-executor.md` / `wps-proofread-manager.md` / `wps-proofread-reporter.md`、`docs/PROOFREAD_SUBAGENTS.md` 同步更新。
  - **验证**：全量 416 测试通过（16 套件，含新增串行门禁 / 进度联动 / P22 用例）；TypeScript 编译 / prettier / `validate:toolcounts` / `validate:versions`(1.5.9) / `validate:npc-team` / `validate:settings` 全部通过；10 轮评审-修复清零 + CI success + mergeable 后经 ⏸CP3 用户确认合并。

### Changed

- **版本号升级至 1.5.9** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.5.9，`validate-versions` 校验通过。

## [1.5.8] - 2026-08-17

### Added

- **文档校对重构为「规划/管理/执行/报告」4 subagent 协同架构（Issue #151，PR #152）** — 将原单 agent 串行承担全部职责的文档校对流程，重构为 4 个 subagent 协同的稳定、准确、高效架构，解决六大执行不稳定问题（分批不稳 / 中途中断 / 上下文超限 / 统计不准 / 假装校对 / 耗时过长）：
  - **`agents/` 新增 4 个校对 subagent**：`wps-proofread-planner`（规划：一次性分批计划 + 生成唯一 session_id + 登记批次分配表）、`wps-proofread-manager`（管理：调度执行 agent 并行 ≤3 + 监督逐步落盘防幻觉 + 断点续跑）、`wps-proofread-executor`（执行：专职逐批按独立段落区间走完 `getDocumentParagraphs → proofreadBasic → confirmBatchAiProofread → replaceInParagraph → proofreadAccumulate` 全链条）、`wps-proofread-reporter`（报告：从磁盘 session 归并 + 五维评分保留 + 修订记录交叉校验 + 疑似缺失告警）。
  - **`skills/wps-proofread/SKILL.md`**：新增「校对 subagent 组编排」章节，规划 agent 自动编排调度（无插件 UI 分流，改动面最小）。
  - **`governance.js`**：新增 P19（批次归属/越界拦截）、P20（逐步凭证落盘防幻觉）、P21（并行区间重叠检测）。
  - **`proofread-store.ts`**：扩展批次分配表落盘 + 逐步执行凭证（stepsLog）持久化，支持断点续跑与每步审计。
  - **`proofread-report.ts`**：批次完整性校验（未完成批告警）+ issue 数 vs 修订数交叉校验（疑似缺失告警），统计准确优先。
  - **`docs/PROOFREAD_SUBAGENTS.md`**：新增架构说明文档；`docs/FEATURES.md` / `docs/USAGE.md` / `docs/SKILLS.md` 同步登记 4-subagent 组与 P19/P20/P21 规则。
  - **用户决策固化**：并行度 ≤3（WPS 单进程 COM 约束）；不保留单 agent 串行兜底（靠重派 + 断点续跑替代）；统计准确优先、保留五维评分并强化校验；规划 agent 自动编排；管理 agent 监督逐步落盘防幻觉。
  - 经 **24+ 轮评审-修复循环清零**（含追加 12 轮）+ QA 测试（410 用例全绿、并行稳定性 5 轮无回归）+ CI success 后合并。

### Changed

- **版本号升级至 1.5.8** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.5.8，`validate-versions` 校验通过。

## [1.5.7] - 2026-08-16

### Added

- **NPC_TEAM skill 6 改造点（Issue #76/#147，PR #148）** — 依据 Issue #76 提出的 6 个使用问题，对 `docs/NPC_TEAM.md` / `.codebuddy/skills/npc-team/SKILL.md` / `scripts/validate-npc-team-prompt.js` / `scripts/lib/npc-team-triggers.js` / `tests/validate-npc-team-prompt.test.js` 落地 6 项改造，并同步更新 `docs/README.md`：
  - **恢复 CP1/CP2 强制暂停点**（铁律 6 强化）：任何模式（接力/全程/自动连续）到 ⏸CP1/⏸CP2/⏸CP3 必须输出对应暂停卡停下等用户命令，不得静默跳过；配套校验门禁。
  - **每步独立调用 + 自动接续**（运行模式）：未设 ⏸CP 暂停点的步骤执行完输出接力卡后由系统按接力卡自动触发下一步，无需用户逐棒手动复制召唤话术；手动接力仍兜底可用。
  - **每步留痕粒度强化**（铁律 7）：评审棒/修复棒/复评棒每一步各自独立留痕，缺任一步即视为假装执行。
  - **新增🔬研究员 RES 第 7 角色**：角色卡片 7 张强校验；RES 介入 0/12、2/12、5/12、11/12 流水线；`description` 触发词补「研究员」。
  - **评审严格限定 PR 范围**（新增铁律 15）：CR 只评审 PR diff 新增/改动行，RES 定位只针对 PR diff 范围，不得泛化到无关模块。
  - **跑 N 轮 review-修复循环**（铁律 8 固化）：本次产物 PR 至少跑 10 轮评审-修复循环直至问题清零，有效下限 = max(10, 用户指定 N)，可核实验收。
- **RES 介入 5/12 研究员独立评审固化（Issue #147 补充，PR #148 commit a1bfeb1）** — 明确 RES 在 5/12 的四维独立评审职责（需求背景核实 / 方案可行性复核 / 根因定位 / 复现定位），评审结论须以「🔬 RES 研究员评审」独立留痕于 PR，缺任一项独立留痕即视为 RES 未介入（假介入）；配套 2 道校验门禁 + 2 个负向回归用例（validate-npc-team-prompt 用例 124/124）。
- **NPC Team 流水线模拟动画（Issue #147，commit 881e57f）** — 新增 `npc-team-pipeline-animation.html` 自包含 HTML/JS 动画，可视化演示 12 阶段 / 7 角色 / 3 暂停点 / 10 轮评审-修复循环自动连续执行，浏览器直接打开即可播放，用于核验流水线流程设计。

### Changed

- **版本号升级至 1.5.7** — 根 `package.json` / `package-lock.json` / `opencode-wps/`（package.json、config.js、manifest.xml）/ `opencode-wps-linux/`（package.json、manifest.xml）/ `wps-office-mcp/`（package.json、package-lock.json）版本一致升级至 1.5.7，`validate-versions` 校验通过。

## [1.5.6] - 2026-08-16

### Fixed

- **修复校对问题空白内容被误判缺字段（Issue #116 session_ff63，P0）** — `proofreadAccumulate` 原用 `trim()` 判断 `original`/`suggestion` 是否缺失，导致「异常空格 / 多余空格 / 全角空格」这类空白内容的合法校对问题（如 `original="  "`）被误判为缺字段而整批拒绝，第一批校对结果永久丢失。修复：不再 trim 判断，只拒绝「字段不存在」（undefined/null/非字符串）或「真正为空字符串」（`''`）；空白字符属合法校对发现，允许累加。疑似问题（suspected_issues）同步修复。新增 2 个回归测试（半角空格/全角空格）。
- **修复上下文用量条仍看不到（Issue #116 session_ff63，P1）** — SSE 事件（`session.status` / `message.updated`）取不到用量数据时静默跳过，用量条停在初始状态。修复：`extractCtxUsage` 返回 null 且从未获取过真实数据时调用 `ctxMeterNoData()` 诚实降级提示（`CTX_DATA_SEEN` 标记避免覆盖已展示的真实数据）。
- **修复超大型文档段落获取超时（Issue #116 session_ff63，P1）** — 9652 段超大型文档请求靠后批次时固定 60s 仍超时（WPS COM 需遍历前面所有段落定位）。修复：`getDocumentParagraphs` 按目标段落号分段动态放大超时（≤500段:60s / 301-3000段:90s / 3001-8000段:120s / >8000段:150s），Mac/Linux/Windows 三平台一致，并对字符串数字参数容错。新增 5 个测试（含边界值）。
- **强化全流程同一 session_id（Issue #116 session_ff63，P2/P3）** — SKILL 明确强调所有批次、所有 subagent 必须共用校对开始时生成的同一个 `session_id`，避免 subagent 各自累加产生多份矛盾报告；`generateProofreadReport` 缺 session_id 错误提示补充示例用法，引导 AI 传入正确必填参数。
- **新增工具权限自动确认（Issue #116 补充需求）** — 侧边栏看不到权限确认（serve web 能看到）导致长任务（如 97 批校对）卡住。修复（三保险）：① launcher 启动 `opencode serve` 时按配置追加 `--permission allow`（服务端源头放行）；② 前端 `handlePermissionRequest` 检测 config `permission.mode==='auto'` 时自动 `respondPermission('allow')` 不弹窗；③ 新增 `/tui/control/next` 长轮询兜底通道（serve web 走此通道），收到权限请求时 auto 自动允许。可配置：config.js 新增 `permission.mode`（`auto`/`manual`，默认 `auto`）+ `autoAllowOnLaunch`；governance.js 的 G1-G7 安全规则仍生效，不会被绕过。新增 launcher 权限自动确认测试。

## [1.5.5] - 2026-08-16

### Fixed

- **修复 codewiki 生成 Wiki 持续失败：移除已废弃的 llm_model_name 模型名（Issue #117，PR #145）** — 此前在 `.cnb.yml` 的 `tag_push → codewiki` 配置中写死了 `llm_model_name: 'hy3-preview'`，但该模型已在 CNB 平台下线，导致 codewiki 插件 LLM 接入始终返回空响应（`LLM响应中未找到有效的Action标签, LLM响应预览: (空)`），Wiki 生成一直 `status: error`。按官方反馈（cnb/feedback#4760「把这行去掉，已经没有这个模型了，建议不要写死模型名」）修复：移除 `llm_model_name: 'hy3-preview'` 一行，让 codewiki 插件走平台默认模型，并同步更新 `use_codebuddy` 注释。修复后重新打 tag `v1.5.5` 触发 Wiki 重新生成，核验仓库 Wiki 入口是否成功激活。

## [1.5.4] - 2026-08-16

### Fixed

- **修复点击「关闭服务」闪现 13 个黑色命令行窗口（Issue #143，PR #144）** — 点击 ChatUI 右上角「关闭服务」（黑色方块）时闪现 13 个黑窗。根因：`stopOpenCode()` → `stopOpenCodeByPort(14096)` 通过多个 `execSync` 子进程（`netstat` 查端口 → `powershell`/`wmic` 验证进程名 → `taskkill` 结束进程）停止服务，端口 14096 上同时存在主进程与多个 SSE 连接，逐 PID 验证+kill 未设 `windowsHide` 时弹出可见控制台窗口。修复：① 抽离 `hiddenExecSync()` 帮助函数统一强制 `windowsHide:true`（`CREATE_NO_WINDOW`）；② 全部 9+ 处 `execSync` 子进程调用统一走它，并为各调用点显式加 `windowsHide:true` 双保险。测试：`opencode-wps/tests/launcher.test.js` 新增「所有 execSync 均显式 windowsHide:true」+ 兜底计数（execSync 数 ≤ windowsHide 数），17/17 通过。

- **修复点击「启动服务」闪现 1 次黑窗（Issue #143 跟进，PR #144）** — 用户反馈点击启动服务也会闪 1 次黑色命令行窗口（与关闭服务闪 13 次同类问题）。根因：`startOpenCode()` 的 `spawn` 在 `needShell=true`（npm 全局安装的 `opencode.cmd` shim / 无扩展名 PATH shim）时依赖 Node `shell:true`，`windowsHide` 仅间接传给外层 `cmd.exe`，无法彻底覆盖 `.cmd` 批处理为脚本启动的嵌套控制台进程。修复：① 新增 `hiddenSpawn()` 帮助函数统一强制 `windowsHide:true`（与 `hiddenExecSync` 同风格）；② `.cmd` shim 分支改为**显式 `cmd.exe /d /s /c` 包装**（`shell:false` + `windowsHide:true` + `windowsVerbatimArguments:true`），让 `CREATE_NO_WINDOW` 直接作用于 cmd.exe 进程树；③ `.exe`/`.ps1` 直启分支统一走 `hiddenSpawn`。测试：`opencode-wps/tests/launcher.test.js` 新增「spawn 统一经 hiddenSpawn 强制 windowsHide」专项，22/22 通过；`tests/launcher.test.js` 30/30 通过。

## [1.5.3] - 2026-08-15

### Fixed

- **opencode 运行中但 UI 状态误显「已停止」（Issue #114 跟进）** — 用户反馈 opencode 实际运行中，WPS 插件顶部状态栏仍显示「已停止」。根因：插件状态判定过度依赖两个信号源——`/global/health`（14096 直连，在 WPS Chromium 下可能因 CORS 差异持续失败，Issue #114 已确认）与 launcher `/status`（14097）。当 **launcher 未运行** 时，`probeLauncherRunning()` 交叉验证失效，前端失去所有兜底信号，即使 opencode 进程在跑（14096 端口监听）也误显「已停止」，且健康检查（每 10s 探测 /global/health）持续失败无法自动恢复。本轮修复引入 **SSE（EventSource）作为第三信号源**（EventSource 不受 XHR CORS 差异影响）：① `probeLauncherRunning()` 新增 `launcherReachable` 回调参数，区分「launcher 可达但服务停止」与「launcher 不可达」；② 健康检查失败分支：当 launcher 不可达时主动 `connectSSE()` 探测——SSE onopen 成功即证明服务在跑并恢复「运行中」+ 切回 chat；③ `init()` 首屏 launcher 未运行分支同样触发 SSE 探测；④ `SSE.onopen` 在 setup 探测场景下补建会话（避免进入 chat 后 SESSION_ID 为空无法聊天）；⑤ 服务真停时 SSE onerror 且不自动重连（SESSION_ID 为空），不会误报也不会连接风暴。测试：`taskpane-healthcheck` 新增 4 用例共 23/23 通过。
- **评审加固（Issue #114 跟进，PR #141 多轮评审）**：依据 PR #141 的 5 轮独立 review-修复循环进一步完善——① `SSE.onopen` 补建会话时不再回调 `connectSSE()`（`connectSSE()` 开头会 close 刚建立成功的这条 SSE 再重连，造成不必要连接拆除/重建），仅建会话、保留当前已建立 SSE 继续接收消息；② 健康检查失败分支的探测性 `connectSSE()` 增加冷却守卫（`sseProbeAllowed()`，**30s 冷却窗口**，大于健康检查周期 10s 才能真正限流）——服务真停 + launcher 不可达时，最多每 30s 创建一次注定失败的 EventSource，收敛无谓周期性失败连接；③ 探测性连接失败不自动重连（`SSE_IS_PROBE` 标记）——避免绕过冷却守卫向已停止服务反复建连；④ `SSE.onopen` 探测恢复路径补齐模型/智能体下拉框（与 `onServerConnected()` 完整恢复行为一致）；⑤ **状态粘性防振荡**——SSE 已连接时信任该最强信号，不以 `/global/health` 失败拆除运行中状态（消除每 10s 的 chat↔setup 闪烁），`SSE.onerror` 断开后仍可正常降级。测试：`taskpane-healthcheck` 新增 10 用例，共 **32/32 通过**。

## [1.5.2] - 2026-08-14

### Fixed

- **修复 opencode 服务运行中但 UI 状态误显「已停止」（Issue #114 回归，PR #132）** — 用户反馈 opencode 实际运行中，WPS 插件顶部状态栏却显示「已停止」。根因：插件对服务状态的判定**单一依赖 `/global/health`** 健康检查，一旦瞬时误触失败（网络抖动 / CORS proxy 抖动 / launcher 重启间隙 / SSE 连接被 close），状态即误判为「已停止」且难以自动恢复。本轮将状态判定改为**多源交叉验证**：① `launcher.js` `/status` 端口回退——`running` 不再只依赖 `opencodeProcess` 引用，引用丢失时回退探测 14096 端口监听，并暴露 `portOpen` 字段供前端交叉验证；② `taskpane.html` 新增 `probeLauncherRunning()` 多源兜底——`/global/health` 失败但 launcher 确认服务在跑则恢复「运行中」并重建 SSE（覆盖「SSE 被 close 后无法自动恢复」的核心场景）；③ `SSE.onopen` 状态联动——连接成功同步恢复「运行中」并切回 chat；④ `init()` 首屏 launcher 回退 + `enterChat()` 去重。测试：`taskpane-healthcheck` 19/19、`launcher` 15/15、全量 10 套件通过。评审 10 轮 review-修复循环清零。

## [1.5.1] - 2026-08-14

### Fixed

- **修复 codewiki 生成 Wiki 失败：切换 CNB AI 接入点（Issue #117，PR #129）** — codewiki 插件默认 `use_codebuddy: 1`（CodeBuddy 接入点）在本环境调用 LLM 返回空响应，导致仓库结构分析失败（`analyze_repository_structure_agent: agent.run() 返回空内容` / `generate catalogue error: agent returned empty catalogue items`），Wiki 始终无法生成。按 codewiki 插件 README 示例在 `.cnb.yml` 的 `tag_push → codewiki` stage 增加 `use_codebuddy: 0`（切换 CNB AI 接入点）+ `llm_model_name: 'hy3-preview'`（混元免费模型，区别于 NPC 任务注释里的 hy3，此处为 codewiki 插件模型的合法命名）。本版本合并 PR #129 并打 tag `v1.5.1` 触发 codewiki 重新生成 Wiki，验证 Wiki 能否成功生成并激活仓库导航栏入口。Wiki 入口：https://cnb.cool/lnxsun/opencode-wps/-/wikis

## [1.5.0] - 2026-08-14

### Fixed

- **聊天报错 `UnknownError` 可排查（Issue #114 跟进，PR #126）** — 用户在聊天发送消息时偶发 `Error: {"name":"UnknownError","ref":"err_xxx"}`，此为 **OpenCode 服务端**（`opencode serve`）生成回复时的内部错误（常见于模型 API key 失效/限流、模型不存在、provider 配置错误、文档上下文过大），非插件 bug。本轮改进：① `opencode-wps/launcher.js` 将 opencode serve 的 `stdio: 'ignore'` 改为**日志落盘**到 `~/.opencode/logs/opencode-serve.log`（追加模式），服务端 stdout/stderr 不再被丢弃，用户可搜索 `err_xxx` 定位真实根因；② `opencode-wps/taskpane.html` 新增 `formatSendError()`，发送消息出错时若识别到 `UnknownError`，给出含日志路径与常见原因的**可操作排查引导**（不再裸显示 JSON）；③ `docs/TROUBLESHOOTING.md` 新增「UnknownError 排查」章节。测试：`taskpane-healthcheck` 14/14、`taskpane-formatsenderror` 7/7、`launcher` 14/14、`taskpane` 内联脚本语法全部通过。
  **评审修复（PR #126 第 1~10 轮）**：① 日志写流 `logStream` 提升为模块级变量并新增 `closeOpenCodeLogStream()`，在 `stopOpenCode()` 与子进程 `exit`/`error` 时统一关闭释放（仅 `end()` 先 flush 再关 fd，避免 destroy 丢数据），修复资源泄漏与末尾日志丢失；② 新增简单日志轮转（单文件超 5MB 先删旧 `.old` 再重命名，规避 Windows rename 目标已存在报错）；③ `formatSendError()` 日志路径提示改为「按实际用户目录定位」，不再硬编码 C 盘路径；④ `TROUBLESHOOTING.md` 同步补充日志路径与轮转清理说明；⑤ 新增 `tests/taskpane-formatsenderror.test.js`（7 用例）并接入 CI 门禁，覆盖 UnknownError/普通错误/空响应/网络错误/null-undefined 兜底等场景。

## [1.4.0] - 2026-08-14

### Added

- **校对数据服务端落盘持久化 + 必填字段校验 + 疑似问题机制（Issue #116，PR #124）** — 根治校对流程数据易失的核心问题：① 新增 `proofread-store.ts` 落盘存储模块，`proofreadAccumulate` 每次累加后增量写盘到 `~/.opencode-wps/proofread-sessions/{sessionId}.json`，报告生成优先读内存、缺失时从磁盘恢复（`getSessionOrLoad`），`releaseSession`/LRU 淘汰同步删除磁盘文件，存储目录 `0o700` 权限收敛——即使会话压缩（Compaction）或 MCP 服务重启，已累加校对问题不丢失、报告可完整生成；② `proofreadAccumulate` 入口对缺 `original`/`suggestion` 的 issue 明确报错，替代此前静默通过、到报告生成阶段 `.replace()` 读 `undefined` 崩溃的隐患；③ 报告生成器 `.replace()` 处统一 `(issue.original || '')` 兜底，历史坏数据漏过校验也不崩溃；④ 新增 `suspected_issues` 参数（AI 识别但未确认的问题），报告单独列出「⚠️ 待确认问题」节并标注「未修改，请人工核对」，不纳入五维评分，即使 issues 为空也列出该节。评审 10 轮 review-修复循环清零（含必填校验原子性、空 issues+疑似问题不丢失、权限收敛等）。

- **侧边栏权限确认 UI + 上下文用量条 + 等待审批状态（Issue #116，PR #120）** — 补齐侧边栏交互三个关键能力：① **权限确认模态框**：监听权限请求事件，弹出「工具调用权限确认」框（展示工具名/参数/说明），支持**允许 / 拒绝 / 记住选择**，通过 `POST /session/:id/permissions/:permissionID` 响应——解决此前「生成报告卡住」只能切 web 会话确认的问题；② **上下文用量条**：底部 3px 进度条随 SSE 实时更新，hover 显示详细 token 数，<70% 绿 / ≥70% 橙 / ≥90% 红，提示用户预判会话压缩；③ **等待审批状态**：`session.status` 新增 `waiting` 中间态，状态点橙色闪烁 + 底栏高亮提示「等待你确认工具调用」，与正常 busy 状态区分，避免用户误以为死循环。评审 5 轮 review-修复循环清零（含 props.id 提取优先级、SSE 断开状态清理、并发权限请求覆盖、会话切换状态清理等）。

- **MCP 超时放大 + 校对批次建议 + TC-12 口径说明（Issue #116，PR #121）** — 性能与数据口径优化：① `getDocumentParagraphs` 超时 30s→60s、`getDocumentTextByRange` 15s→30s，减少大批量段落获取在 WPS COM 处理慢时的超时重试；② SKILL 推荐每批 100 段（此前默认 200），避免单次返回文本超过 MCP 输出限制被截断导致漏检；③ TC-12 口径明确：报告「发现问题 = issue 条数」「修订数 ÷ 2 仅修订模式等价」，修正此前口径混乱。评审 5 轮 review-修复循环清零（含 SKILL 批次计算示例、版本引用一致性）。

## [1.3.1] - 2026-08-14

### Fixed

- **修复 codewiki 配置以正确激活 Wiki 入口（Issue #117，PR #127）** — 仓库首页 `showWiki=false`、Wiki 导航入口不显示、`/-/wikis` 报 404 的根因：codewiki 插件配置结构与插件 README 推荐模式不一致——旧配置把 `image` 放在任务级 `docker.image`、`git_doc_dir` 指向容器内 `/data/codewiki/${CNB_REPO_SLUG}` 路径且未声明 Docker 数据卷，插件生成的内容写入容器内部，流水线结束后即丢失，平台无法读取。按 codewiki 插件 README **Pattern 1（推荐模式）** 调整 `.cnb.yml`：① `image: cnbcool/codewiki:latest` 移至 `stages[].image`（阶段级）；② `git_doc_dir` 改为工作区路径 `/${CNB_BUILD_WORKSPACE}/${CNB_REPO_SLUG}/codewiki`，生成内容可被平台持久化读取；③ 保留 `knowledge_enabled: true`（Wiki 自动入库仓库知识库）。合并后打 `v1.3.1` tag 触发 `tag_push` → codewiki 重新生成 Wiki 并激活入口。Wiki 入口：https://cnb.cool/lnxsun/opencode-wps/-/wikis

## [1.3.0] - 2026-08-14

### Added

- **NPC_TEAM 评审-修复循环改为自动连续执行 + 每步留痕（Issue #76，PR #123）** — 按用户反馈"5 轮独立的 PR review 与修复循环还是不能自动进行、中间还是会暂停"并澄清"是每步在 PR 留痕，而不是每轮"，将提示词 5/12 评审-修复循环由「逐轮接力（每轮评审/修复/复评各为独立一次 @CodeBuddy 召唤，禁止一次召唤内连跑多轮）」改为**接力模式下自动连续执行**：用户要求跑 N 轮时，同一次召唤内自动连续跑完「评审棒 → 修复棒 → 复评棒 → 下一轮…」直至达成 N 轮且问题清零，**中途不暂停、无需逐棒手动召唤**；但**每一步（评审/修复/复评）都必须在 PR 分别回复留痕（留痕以「每步」为粒度而非「每轮」）**，每步留痕必须真实可核实，否则视为假装执行。配套：① 提示词铁律 8 / CR 角色卡片 / 流水线 5/12 / 工作流程 / 门禁表 / 冒烟测试方法 C 全部同步（评审-修复接力卡 → 评审-修复循环留痕卡，含评审/修复/复评留痕块 + 本步留痕位置字段）；② `scripts/validate-npc-team-prompt.js` 第 10b 节重写为「自动连续执行 + 每步留痕」强校验；③ `tests/validate-npc-team-prompt.test.js` 评审-修复接力相关用例重写为自动连续语义（115 用例全绿）；④ `.codebuddy/skills/npc-team/SKILL.md` frontmatter description + 正文双源同步。**评审修复汇总（PR #123 第 1~10 轮）**：① 铁律 11 补「评审-修复循环自动连续执行例外」声明；② 运行模式「接力模式」描述同步补评审-修复循环例外；③ description 补「自动继续/自动连续执行」触发词；④ 运行模式段内评审-修复例外强校验 + 锚点缺失提示；⑤R6 新增【评审-修复循环汇总卡】卡名强校验 + 负向用例；⑥R7 澄清用户要求 N 轮与「至少 10 轮」下限优先级——铁律 8 补「下限优先：若 N<10 按至少 10 轮执行」，复评留痕改「有效下限 = max(10, 用户要求 N)」；⑦R8 冒烟测试验证表「接力只执行一步」行补评审-修复自动连续例外；⑧R9 方法 C 已清零分支改「有效下限轮次 max(10, 用户要求 N)」；⑨R10 CHANGELOG 用例数同步 115。

## [1.2.0] - 2026-08-14

### Added

- **生成项目 Wiki（Issue #117，PR #118）** — 结合本项目代码库及库中现有文档（`docs/`），在 CNB 平台用 **Code Wiki（codewiki 插件）** 机制生成项目 Wiki：`.cnb.yml` 新增 `tag_push` → `codewiki` 插件 stage（`git_doc_dir: /data/codewiki/${CNB_REPO_SLUG}` 必填 + `knowledge_enabled: true` 自动入库仓库知识库，可被 AI 问答引用），打 tag 即自动读取仓库代码与现有文档生成 Wiki，仓库首页出现 Wiki 入口。同时围绕 **开发 / 使用双主线** 将文档补充至 Wiki 级详细度：`docs/USAGE.md`（Wiki 级使用手册：快速上手/三平台打开面板/完整对话操作/WPS 专用 Agents/常用文档操作场景/OpenCode 服务管理/配置参考/最佳实践）、`docs/DEVELOPMENT_GUIDE.md`（Wiki 级开发手册：环境/项目结构/五大模块开发/MCP 三层工具体系/开发流程/规范/测试/CI/CD/二次开发）、`docs/SKILLS.md`（内置工具清单/两级网关调用规范/各 Skill 能力/开发规范）；`docs/README.md` 更新四象限索引。评审 15 轮 review-修复循环清零 + QA 测试通过（锚点缺陷修复复验）。Wiki 入口：https://cnb.cool/lnxsun/opencode-wps/-/wikis

### Fixed

- **修复 opencode 服务运行中但状态栏误显"已停止"**（Issue #114）— 根因：健康检查"一次失败即永久放弃"的单向设计——`showSetup()` 与 `stopHealthCheck()` 强耦合，一旦进入 setup 视图健康检测永久关闭，且 setup 视图无任何自动恢复探测；瞬时网络抖动/CORS proxy 抖动/launcher 重启间隙一次误触即可导致即使服务始终健康，UI 也永远显示"已停止"。修复（`opencode-wps/taskpane.html`）：① `showSetup()` 移除 `stopHealthCheck()`，健康检测与视图切换解耦，改为**全局常驻**；② 新增 `IN_SETUP_VIEW` 标记，setup 下检测到服务恢复自动 `onServerConnected()` 切回 chat；③ `startHealthCheck()` 失败仅切视图不停止检测，成功且 setup 未连接时自动恢复；④ `init()` 初始失败路径补启动健康检测；⑤ 显式停止（`STOPPING` 标记）不再被全局健康检查自动重连，并清理手动启动轮询（`START_POLL_TIMER`）；⑥ 健康检查防重入（`HEALTH_CHECK_IN_FLIGHT`）避免请求风暴，仅状态变化时更新。新增 `tests/taskpane-healthcheck.test.js`（14 用例，AC1-AC5 + 历轮评审修复回归）并接入 CI。评审-修复 9 轮循环清零。

### Added

- **NPC_TEAM 流水线扩展：PR 合并（合并前暂停待确认）+ 发布四要素（Issue #76，CR 第 11~28 轮追加循环）** — …；**CR 第 28 轮修复：按用户明确要求「不要简单可缩裁剪，至少 10 轮保留」，全面删除「简单可缩」豁免（反转 CR 24 收紧方向）——① 铁律 8 移除「简单改动走最小路径时 review 轮数可相应缩减」句，改为「评审轮数不得以简单为由缩减，不得以简单可缩为名跳轮偷懒」；三张接力卡「已累计轮次」行移除「简单改动按铁律 8 可缩」、复评卡已清零分支与方法 C 移除「（简单改动可缩）」后缀，「至少 10 轮」成为无条件硬性下限（任何情况下都不得以简单为名缩减轮数）；② validate 强校验同步收紧：RULE8_CORE 改为校验「评审轮数不得以简单为由缩减」+「不得以简单可缩为名跳轮偷懒」完整句式（顺序校验同步）、RELAY_REREVIEW_CORE 已累计轮次/已清零分支改无条件完整句精确匹配（不再容忍简单可缩后缀）、评审/修复卡已累计轮次校验同步收紧、方法 C 校验移除简单可缩后缀容忍（保留 CR 25/26/27 新增的独立召唤/停棒/合并确认强校验）；③ 测试同步：删铁律 8 防钻空子用例改为删「禁止以简单为由缩减轮数」句负向用例、插入干扰句用例同步、CR 24 新增的 3 个「删豁免后缀应拦截」负向用例反转为「加回简单可缩后缀应拦截」，117 用例全绿；实测 6 类「简单可缩」复活攻击（删禁止缩减句/已清零分支加回/已累计轮次行加回/流水线加回/删跳轮偷懒句/方法 C 加回）均 exit 1 拦截。**；**CR 第 24 轮修复（本轮 5 轮循环 R1）：① 收紧「简单可缩」豁免后缀校验——第 23 轮放宽为前缀匹配/通配窗口后，豁免后缀可被篡改为「可减至 1 轮」等破坏性文本（实测 exit 0 漏检）；RELAY_REREVIEW_CORE 改完整句匹配（含精确豁免后缀）、三卡已累计轮次加豁免后缀存在性双重校验、方法 C 移除通配窗口改枚举校验，篡改/删后缀/数字削弱（10→3）现均拦截；② 新增 3 个负向回归用例（110→113）。**；**CR 第 23 轮修复（追加 12 轮循环 R4）：① 修复「简单可缩」裁剪与「至少 10 轮」下限的矛盾——铁律 8 明确「简单改动走最小路径时 review 轮数可相应缩减」，但第 21/22 轮把「至少 10 轮」无条件同步进三张接力卡已累计轮次行与复评卡已清零分支后，卡片无条件要求 10 轮、无简单可缩豁免，简单改动会被迫空跑到 10 轮；在三卡「已累计轮次」行补「简单改动按铁律 8 可缩」、复评卡已清零分支补「（简单改动可缩）」、方法 C 已清零分支同步补注；② validate 强校验同步放宽为允许简单可缩后缀（RELAY_REREVIEW_CORE 已累计轮次/已清零分支改用前缀匹配、评审/修复卡已累计轮次校验改正则、方法 C 校验嵌套括号容忍），消除「简单可缩」被校验堵死的语义冲突；配套更新 docs 静态校验描述。**；**CR 第 22 轮修复（追加 12 轮循环 R3）：① CHANGELOG 顶部条目标题「CR 第 11~~19 轮追加循环」更新为「第 11~~21 轮」与条目内实际轮次一致；② docs 静态校验描述补「复评卡已清零分支『至少 10 轮』下限 + 方法 C 已清零语义强校验」（第 21 轮新增校验能力未在文档同步）；③ 评审/修复接力卡「已累计轮次」行补「清零且已达至少 10 轮则进下一阶段」，与复评卡口径一致（此前三卡不一致，前两棒缺循环结束条件提示）；配套 validate 新增评审/修复卡已累计轮次 10 轮下限段内强校验 + 复评卡字段改段内定位（RELAY_REREVIEW_CORE，消除第 21 轮同步后全局 indexOf 误报）+ 删复评卡已累计轮次用例改段内真拦截（修复双源假阳性），新增 1 负向回归用例（109→110）。**；**CR 第 21 轮修复（追加 12 轮循环 R2）：① 复评接力卡「已清零」分支重申「至少 10 轮」下限——此前仅「已累计轮次」行有「清零且已达至少 10 轮」约束，已清零分支直接写「已清零 → 转 6/12 测试」，按字面执行时 CodeBuddy 第 1 轮清零即可能放行，与门禁表「至少 10 轮 review-修复循环至清零才进下一阶段」矛盾；改为「已清零（**且已达至少 10 轮**，转 6/12 测试，独立召唤）」；② 冒烟测试方法 C 已清零分支同步补「（且已达至少 10 轮）」，validate 9.7 ⑥ 新增「至少 10 轮」关键词强校验（防改成「已清零即可进 6/12」不拦截）；③ validate 10b 节注释残留旧口径「5/10 评审-修复循环」修正为 5/12。配套新增 2 负向回归用例（107→109）。**；**CR 第 20 轮修复（追加 12 轮循环 R1）：① 修复 `tests/validate-npc-team-prompt.test.js` `runValidateCaptureFull` 的 SKILL.md 还原失效——sync 脚本直接 writeFileSync 不产生 `.tmp`，旧还原条件 `fs.existsSync(SKILL_FILE + ".tmp")` 永远不成立，变异提示词永久污染 SKILL.md（实测 diff 45 字符）；改为 finally 无条件按备份原内容写回，并新增「测试后 SKILL.md 与测试前完全一致」回归用例（105→107）；② 修复 `validate-npc-team-prompt.js` 阶段完整性校验「边界节点双删」逃生口——原 `if (stageIdRe(0)||stageIdRe(11))` 在流水线段同时删掉 0/12 与 11/12 时条件不成立，走 else 只发 warning（实测同步双源后 exit 0）；改为无条件执行 0..11 全序校验，缺失任何阶段（含首尾）都报 error，新增负向回归用例；③ CHANGELOG 顶部条目 CR 第 15 轮（R5）叙述段错位到第 19 轮之后，恢复 R1→R9 递增顺序。**；**CR 第 11 轮修复（追加 9 轮循环 R1）：① 阶段完整性校验逃生口修复——原 `includes('0/12')` 命中 `10/12`、`includes('1/12')` 命中 `11/12` 子串，删流水线 0/12、1/12 节点仍 exit 0；改为【流水线】段内 0..11 全序出现校验（词边界正则 + indexOf 递增），并拦截跨段引用掩盖；② 复评接力卡「已清零」分支明确为独立召唤 6/12 测试（不再由复评棒自行跨阶段执行，铁律 11）；③ R 计轮口径统一——R 表示轮次（每轮 = 评审棒+修复棒+复评棒三棒），修复/复评棒下一步不再 +1，仅复评未清零转第 R+1 轮评审；配套 validate 句式同步 + 新增 2 个阶段完整性负向回归用例（91→93）**；**CR 第 12 轮修复（追加 9 轮循环 R2）：① 冒烟测试方法 C 残留旧口径 R+1/12 同步为三棒同轮口径（未清零 → 第 R+1 轮评审；已清零 → 独立召唤 6/12），并在 validate 9.7 新增方法 C 文档级语义强校验；② 三张接力卡「已累计轮次：R/12」分母语义混淆（评审轮次无 12 上限）改为「已累计轮次：第 R 轮」；③ CHANGELOG 残留 `0/12~~11/12` 双波浪号（Markdown 删除线语义）修正为单波浪号；配套 validate 句式 + 测试同步（93→94）**；**CR 第 13 轮修复（追加 9 轮循环 R3）：① 补【暂停·CP2 开发确认】暂停卡模板（全程模式第二强制暂停点此前无输出模板，validate 仅校验 ⏸CP2 字样被流水线引用命中）并在 validate 第 8 节强校验模板存在；② validate 9.7 新增 ⑦ 冒烟测试方法 E（全程模式回退验证）文档级存在性校验（防全程模式边界约束被删改）；③ README 发布表述对齐「发布真实执行（四要素）」行名；配套新增 2 负向用例（94→96）**；**CR 第 14 轮修复（追加 9 轮循环 R4）：① 暂停确认引导语区分输出契约——到 ⏸CP1/⏸CP2 时输出暂停卡、到 ⏸CP3 时输出【合并确认卡】（此前引导语把 CP3 也归为暂停卡，与铁律 13/合并确认卡模板矛盾），validate 第 8 节强校验引导语；② 【暂停·CP2 开发确认】模板命令三选一内容强校验（防模板与暂停确认表/工作流程漂移）；配套新增 2 负向用例（96→98）**；**CR 第 15 轮修复（追加 9 轮循环 R5）：① `DOC_DESC_TRIGGERS` 交集校验清单补齐「PR 合并/合并确认/发布/Release Notes」4 项（此前缺项使 checkDescAgainstDocs 对合并/发布触发短语形同虚设，与注释/dosc 脱钩）；② 全流程触发语义移除 10 阶段旧串（拆解→…→文档→汇报→复盘），仅保留 12 阶段新串（含 PR合并→发布），消除规则源过时表述**；**CR 第 16 轮修复（追加 9 轮循环 R6）：① 【接力卡】段首引导语残留旧口径「全程模式改为 ⏸CP1/⏸CP2/⏸CP3 暂停卡」修正为「⏸CP1/⏸CP2 暂停卡 + ⏸CP3【合并确认卡】」（第 4 轮修复的漏网之鱼，双源 SKILL 同步）；② validate 第 10 节【接力卡】段内新增段首引导语强校验（仅接力模式需输出 + 全程模式不输出接力卡 + CP3 合并确认卡），防全程/接力输出契约被删改；配套新增 2 负向用例（98→100）**；**CR 第 17 轮修复（追加 9 轮循环 R7）：① 【运行模式】判断逻辑补齐全程模式触发分支（明确要求一次跑完→全程模式；带接力卡/任务书→接力续棒；新需求→默认接力），此前判断只覆盖接力模式导致全程模式声明不可达；② validate 第 10 节新增 RELAY_JUDGE_CORE 判断逻辑句式强校验（三分支顺序校验），防运行模式切换契约被删改；配套新增 2 负向用例（100→102）**；**CR 第 18 轮修复（追加 9 轮循环 R8）：① 合并确认卡补 8/12→9/12 接力衔接（合并棒完成后输出【接力卡·8/12】+ 9/12 发布独立召唤话术 + DEV 四要素说明），此前合并棒完成后无发布棒指引；② validate 9.5 新增 8/12→9/12 接力衔接强校验（9/12 发布召唤话术/合并棒完成后/发布棒 DEV 四要素），防合并后无法规范进入发布；配套新增 2 负向用例（102→104）**；**CR 第 19 轮修复（追加 9 轮循环 R9·最终轮）：任务书「用户命令记录」字段补齐 CP3 确认合并命令（继续/补充/停止，CP3 含确认合并），与暂停确认表命令集对齐；validate RELAY_CORE 同步句式强校验；配套新增 1 负向用例（104→105）。同时核对了组件清单表（无过时阶段列举，无需修改）**；，将 NPC_TEAM 流水线从 10 阶段扩展为 **12 阶段**（0/12~~11/12）：新增 **⏸CP3 合并确认**（7/12 文档完成后暂停，输出【合并确认卡】——待合并 PR + 评审清零/测试通过/CI success 可核实记录位置，**只有用户本人回复「确认合并/继续」才放行 8/12 PR 合并**，禁止代替确认/未确认就合并/假装已合并）+ **8/12 PR 合并**（PM 真实 merge-pull 并留痕合并结果）+ **9/12 发布**（DEV 真实执行四要素：① 更新版本号（package.json 等）② 形成 CHANGELOG ③ 发布产物（构建/制品/标签）④ 形成 Release Notes，禁止只输出"已发布"却缺任一要素）；原 8/10 汇报→10/12、9/10 复盘→11/12。配套：① 提示词新增铁律 13（合并前暂停确认）/铁律 14（发布真实执行）、角色卡片 PM/DEV 职责扩展、【合并确认卡】模板段、流水线/工作流程/暂停确认表/门禁表/冒烟测试表全量同步（3 暂停点、12 阶段）；② `scripts/validate-npc-team-prompt.js` 新增第 9.5 节「PR 合并门禁」强校验（铁律 13 声明 + 【合并确认卡】段内要素：合并前置状态/用户确认才放行/禁止未确认就合并/8/12 合并召唤话术）+ 第 9.6 节「发布四要素」强校验（铁律 14 + ①版本号 ②CHANGELOG ③发布产物 ④Release Notes 四句式顺序校验）+ 阶段编号迁移（0/12~~11/12 完整性 + 历史 0/10~~9/10 残留拦截，排除评审轮次 R/10 合法用法）+ ⏸CP3 暂停点校验；③ `tests/validate-npc-team-prompt.test.js` 新增 14 个合并/发布回归用例（正向 2 + 负向 12：删铁律 13/删合并确认卡段/删合并前置状态/删用户确认才放行/删禁止未确认合并/删合并召唤话术/删铁律 14/删四要素①②③④/删禁止缺要素句 全拦截），52→79 用例全绿；④ `scripts/lib/npc-team-triggers.js` + `.codebuddy/skills/npc-team/SKILL.md` frontmatter description 新增「PR 合并/合并确认/发布/Release Notes」触发词；⑤ docs/README/CHANGELOG 同步更新。**CR 第 1 轮修复：评审轮次计轮 R/10→R/12 统一分母（保留「至少 10 轮」语义）+ 合并/发布触发词收紧（单字「发布」须与发布语境组合命中）+ CHANGELOG 0/12~~11/12 笔误修正 + README 阶段序列与 docs 对齐；CR 第 2 轮修复：合并门禁 9.5 补齐段内校验盲区（收到确认前不得执行合并/确认合并放行映射/命令三选一完整/铁律 13 禁止细节），新增 5 负向用例（66→71）；CR 第 3 轮修复：新增 9.7 文档级合并/发布覆盖校验（流水线主链/工作流程/门禁表/暂停确认表/角色卡片），实测 8 个漏检盲区全部拦截，新增 5 负向用例（71→76）；CR 第 4 轮修复：新增 sliceContentSection 文档级区间定位（锚点缺失显式报错），消除删章节标题绕过校验盲区，新增 3 负向用例（76→79）；CR 第 5 轮修复：CHANGELOG 用例数同步 52→79 + 文档自动校验章节描述同步；CR 第 6 轮修复：9.7 内容级强校验（流水线主链顺序/门禁表四要素与禁止细节/暂停确认表前置状态/工作流程合并语义）新增 5 负向用例（79→84）；CR 第 7 轮修复：正则放宽空白防误报 + 补工作流程合并行留痕合并结果强校验（84→87）；CR 第 8 轮修复：合并确认卡补待合并 PR 对象字段与用户已确认合并留痕位置强校验（87→89）；CR 第 9 轮修复：角色卡片 CR 卡 + 工作流程评审行补每轮分别回复留痕强校验（89→91）

- **NPC_TEAM 评审-修复循环接力化 + 复评卡闭环（Issue #76，CR 第 1~2 轮修复）** — 按用户要求"其中的 PR review 与 修复循环也建议使用接力模式"，将 5/10 评审-修复循环在**接力模式**下逐轮接力：每轮评审与每次修复各是独立一次 `@CodeBuddy` 召唤，评审棒输出【评审接力卡】（含评审结论 + 修复召唤话术）、修复棒输出【修复接力卡】（含修复提交 + 复评召唤话术），禁止在一次召唤内偷偷连跑多轮评审-修复（防"假装评审"）。**CR 第 2 轮修复新增【复评接力卡】闭环模板**（复评结论🔴仍需修复/🟢通过双分支 + 未清零续第 R+1/10 轮评审 / 清零转 6/10 测试）+ R 计轮口径（R 从 1 起，一轮 = 评审棒+修复棒+复评棒）。配套：① 提示词铁律 8 升级为「10 轮彻底循环，接力模式」、CR 角色卡片/流水线/工作流程/门禁表/冒烟测试表同步；② `scripts/validate-npc-team-prompt.js` 新增第 10b 节「评审-修复接力」强校验（RELAY_REVIEW_CORE 12 句式顺序校验 + 评审/修复/复评接力卡召唤话术示例校验；**CR 第 1 轮修复：接力卡话术校验段化**，消除跨段假阳性；**CR 第 6 轮修复：评审/修复/复评接力卡话术校验同样段化**，消除三段卡漏检）；③ `tests/validate-npc-team-prompt.test.js` 新增 9+6 个接力/复评回归用例（正向 + 负向全拦截，**CR 第 1 轮修复负向用例改全量替换真拦截、CR 第 6 轮修复三段卡话术用例改段内定位真拦截、CR 第 7 轮修复新增锚点缺失段化拦截用例、CR 第 10 轮修复新增缩进漂移拦截/修正用例、CR 第 12 轮修复新增铁律 8 段内评审棒/修复棒句负向用例**），52 用例全绿；④ `docs/NPC_TEAM.md` 新增【评审接力卡】/【修复接力卡】/【复评接力卡】模板段与「方法 C（评审-修复接力）」冒烟测试；⑤ `.codebuddy/skills/npc-team/SKILL.md` 双源同步；README 同步更新（**CR 第 1 轮修复 README 接力表述**）

- **NPC_TEAM 提示词改造：默认接力模式（每步独立调用 @CodeBuddy，Issue #76）** — 按用户最新要求"每一步都独立调一次 @CodeBuddy NPC，而不是调一次 @CodeBuddy 跑完全部步骤"，提示词新增「运行模式」自检（默认接力 / 可选全程）：**接力模式**下每次召唤 `@CodeBuddy` **只执行流水线中的一个步骤**，执行完输出【接力卡】（含任务书 + 下一步召唤话术）后立即停下，用户把接力卡复制给下一次召唤的 `@CodeBuddy` 逐步续跑完全流程——每步独立调用、独立留痕、独立可见，步间天然可确认/纠正/停止，彻底杜绝"单会话闷头跑完 + 编造全绿"（#78 事故根因）；**全程模式**（一次跑完全部步骤）仅当用户明确要求时可用（保留 ⏸CP1/⏸CP2 暂停确认）。新增铁律 11（接力只执行一步，绝不自行继续、绝不代替用户召唤下一棒）+ 铁律 12（接力卡必含召唤话术）+【任务书】/【接力卡】模板段。配套：① `scripts/validate-npc-team-prompt.js` 新增第 10 节「接力模式」强校验（RELAY_CORE 11 句式顺序校验 + 接力召唤话术示例校验），防回退为"一次跑完"旧行为；② `tests/validate-npc-team-prompt.test.js` 新增 9 个接力模式回归用例（正向 + 8 负向：删默认声明/删只执行一步/删铁律 11/删接力卡段/删召唤话术/删绝不自行继续/删任务书段/删召唤话术示例 均拦截），26 用例全绿；**CR 第 6 轮修复：累计用例数更新为 46（新增 4 个复评/双源段化拦截用例）；CR 第 7 轮修复：累计用例数更新为 47（新增 1 个锚点缺失段化拦截用例）；CR 第 10 轮修复：累计用例数更新为 50（新增缩进漂移拦截 2 用例 + sync 自动修正 1 用例）；CR 第 12 轮修复：累计用例数更新为 52（新增铁律 8 段内评审棒/修复棒句负向用例 2 个）；**CR 第 8 轮修复：CHANGELOG 用例数 46→47 + 1b 冒烟测试标题 3→4 步（方法 A/B/C/D）；CR 第 9 轮修复：RELAY_REVIEW_CORE 铁律 8 段内校验（防 CR 卡片段同句式逃生口）+ 删独立召唤用例段内定位真拦截**；③ `scripts/lib/npc-team-triggers.js` description 触发词新增「接力/每步独立执行」；④ `.codebuddy/skills/npc-team/SKILL.md` frontmatter 同步接力触发词 + 正文双源同步；⑤ `docs/NPC_TEAM.md` 新增「两种执行方式」「接力模式怎么开始/继续」「1b 接力模式冒烟测试」章节、对比表与冒烟测试表新增接力验证点；README 同步更新

- **NPC_TEAM Skill：一键调用，告别粘贴提示词（Issue #76）** — 新增 `.codebuddy/skills/npc-team/SKILL.md`：将 `docs/NPC_TEAM.md` 中的提示词做成 CNB 平台可自动加载的自定义 Skill（官方文档支持项目级 `.codebuddy/skills/` 目录）。使用方式：在 CNB 平台本仓库对话中召唤官方免费 `@CodeBuddy` 后，只需一句「调用 NPC_TEAM skill 完成以下需求：xxxxxx」即可化身 NPC Team 跑完全流程，**无需再粘贴提示词**；原粘贴方式保留为兜底。配套：① `scripts/validate-npc-team-prompt.js` 新增第 11 节「Skill 双源一致性」强校验（Skill 存在 + frontmatter 合法 + name 为 npc-team + 正文与 docs 提示词归一化后完全一致），已接入 CI；② 新增 `scripts/sync-npc-team-skill.js`（含 `--check` 模式）供改提示词后一键同步；③ `tests/validate-npc-team-prompt.test.js` 新增 5 个回归用例（正向双源一致 / Skill 缺失拦截 / 正文漂移拦截 / frontmatter name 错误拦截 / 同步脚本 --check），13 用例全绿；④ `docs/NPC_TEAM.md` 新增「使用方式一（推荐）：一句话调用 Skill」、组件清单与边界说明；README 同步更新

### Changed

- **明确 NPC_TEAM 提示词、skills 为 CNB 平台开发辅助工具（Issue #100）** — `README.md` 核心特性移除「NPC Team 总指挥（零积分）」条目（避免被误解为 WPS 插件功能），新增 💡 边界说明；NPC 章节标题改为「NPC 研发助手（CNB 平台开发辅助工具，与 WPS 插件无关）」，正文明确 `@CodeBuddy`/NPC_TEAM 提示词/`.codebuddy/skills/` 属于 cnb.cool 平台研发辅助能力：不随 `install-addons*.js` 安装、不进入插件目录、不依赖 WPS 运行；`docs/README.md`、`docs/USAGE.md`、`docs/SKILLS.md`、`docs/NPC_TEAM.md`、`.codebuddy/skills/npc-team/SKILL.md` 同步补边界声明（SKILL.md 仅加说明段，正文未动，CI 双源一致性校验通过）

- **以 README 为中心的文档体系重构（Issue #100）** — README.md 从 647 行精简为 116 行门户式结构（核心特性/快速开始/使用方式/架构速览/文档地图/NPC 零积分），详细内容子文档化：新增 `docs/INSTALLATION.md`（三平台安装合并+路径速查）、`docs/USAGE.md`（使用指南）、`docs/ARCHITECTURE.md`（4 层组件+十层调用链+工作原理+设计决策）、`docs/FEATURES.md`（特色功能详解）、`docs/HISTORY.md`（演进史+致谢）；重写 `docs/README.md` 为四象限完整文档中心索引（使用/开发/平台专题/内部参考，全覆盖 22 份顶层文档+2 份 specs，平台路径表补 Linux）；修复 `docs/CODE_REVIEW_GUIDE.md`、`docs/DEVELOPMENT_GUIDE.md` 两处既有断链（`./CODE_OF_CONDUCT.md` → `../CODE_OF_CONDUCT.md`）；自建 NPC（6 角色）配置参考迁入 `docs/NPC_TEAM.md` 防信息丢失；全库 63 份 md 文档相对链接经脚本校验全部有效，原 README 54 个关键概念全覆盖无遗漏

- **修复 Issue #78 三诊：打开面板路径主动调度宿主重绘，首次打开头部不再遮挡** — 用户实测合并 PR #83 后首次打开面板头部仍被遮挡、切标签后才恢复，且「打开两个文档标签窗口后开启 opencode-wps 标签则正常」。根因：PR #83 的宿主重绘（`forceTaskPaneRedraw`）只挂在 `WindowActivate` 事件上，而首次打开面板（`btnShowTaskPane`）**不经过该事件** → 首次打开时宿主重绘永不触发；打开第二个文档标签触发 `WindowActivate` → 重绘执行 → 头部恢复，与用户全部观察吻合。修复：① `forceTaskPaneRedraw` 新增 `force` 参数（仅日志区分触发源，防抖语义不变）；② `btnShowTaskPane` 首次创建/切换显示为可见后，延迟 400ms 主动调度宿主重绘（隐藏→显示任务窗格），让 WPS 宿主重新布局 WebView 拿到正确视口；③ 关闭路径不调度；重绘窗口内用户操作仍被尊重（`lastUserTaskPaneAction` 时间戳比对不变），切换路径仅当无重绘进行中才调度（避免快速点击额外闪烁），调度前重置时间戳避免旧操作被误判为窗口内操作；`tests/taskpane-dock.test.js` 新增 12 个用例（31 → 43），全量 8 套件 + 语法门禁全绿（评审修复：抽 `scheduleTaskPaneOpenRedraw` 公共函数去重；新增「重绘窗口内用户关闭不误弹」「窗格销毁放弃恢复」安全边界用例；等待期守卫保留用户时间戳；`WINDOW_ACTIVATE_REDRAW_DELAY` 抽命名常量；可观测性增强——守卫放弃/窗格不存在/窗格不可见三条静默返回路径补日志留痕，形成 放弃/跳过/完成 三段可观测链）

- **NPC Team 提示词校验：第 8 轮评审修复（Issue #76）** — 修复回归测试工作区残留：`tests/validate-npc-team-prompt.test.js` 的 `runValidate` finally 还原后追加 `unlinkSync` 清理 `.tmp`/`.bak`（实测此前每次运行都残留 `docs/NPC_TEAM.md.tmp` 被改写内容，可能污染 CI 后续步骤）；验证：运行后无残留、连续运行幂等、8 用例仍全通过
  — ① 9.1 留痕正则 `留下.*痕迹` 跨行贪婪收紧为 `留下.{0,60}痕迹|可核实.{0,60}痕迹`（第 1 轮同类问题在 9.1 的遗留，实测删铁律 7 留痕句曾被文档其他位置"痕迹"跨段满足）；② 铁律 7 特有表述「可见回复/记录」纳入 `RULE7_ANTI_HALLUCINATION` 强校验（文档工作流程/门禁表另有等价表述，但铁律 7 自身句式须受控）；③ **新增 `tests/validate-npc-team-prompt.test.js` 回归测试**（8 用例：正向 + 第 4/5/6/7 轮负向攻击固化），接入 CI `.cnb.yml` Validate 阶段；负向验证：删铁律 7 留痕句 → 拦截；删「可见回复/记录」→ 拦截；正向 0 错误 0 警告
  — ① 铁律 7 反幻觉细节纳入强校验：新增 `RULE7_ANTI_HALLUCINATION = ['可核实', '谎报']`，实测删铁律 7 括号约束（可核实痕迹/不存在的模拟器谎报）此前 exit 0 放行，现拦截；② `RULE8_CORE` 由"子串存在校验"升级为**顺序校验**（7 子串按铁律 8 段落内声明顺序递增 `indexOf`，打乱/插入干扰文本即报"句式顺序错乱"），并在注释显式记录 includes 校验局限（防删不改义，语义改写靠人工评审兜底）；负向验证：删铁律 7 括号约束 → 拦截；铁律 8 插入干扰句打乱顺序 → 拦截；正向 0 错误 0 警告
  — 扩展 `RULE8_CORE` 强校验常量，封堵铁律 8 残余盲区：① 新增「循环执行直至问题清零」强校验（此前 9.2 旧校验 `循环.{0,40}清零` 为 OR 宽松匹配，实测只删铁律 8 该句、靠 CR 卡片残留「直至问题清零」仍放行）；② 新增「每轮留痕规则不变」「不得因裁剪而跳轮假装」强校验（此前「简单可缩但留痕纪律不变」红线无任何校验保护，实测删掉该句仍 exit 0）。负向验证：删「循环执行直至问题清零」→ 拦截；删防钻空子句 → 2 错误拦截；正向 `node scripts/validate-npc-team-prompt.js` 仍 0 错误 0 警告
  — 修复 `scripts/validate-npc-team-prompt.js` 9.2.1 三项新增校验的 **OR 正则逃生口**：原校验（`每轮.{0,60}PR.{0,60}回复|分别回复|假装进行|...`）为 OR 匹配，只要提示词任意位置残留「分别回复」「假装进行」等字样即放行；实测删光铁律 8 核心约束（每轮 review 必须在 PR 中回复 / 每次修复也必须在 PR 中回复 / 绝不允许跳过轮次假装进行）、仅靠 CR 角色卡片残留「分别回复留痕」时校验仍 exit 0。改为**锁定铁律 8 完整句式常量 `RULE8_CORE` 逐字强校验**（4 个完整子串缺一即报错），负向验证：删铁律 8 核心约束 → 拦截；删单句「每轮 review 必须在 PR 中回复」→ 拦截；正向 `node scripts/validate-npc-team-prompt.js` 仍 0 错误 0 警告

- **NPC Team 提示词：评审-修复循环升级为 10 轮彻底循环（Issue #76 补充）** — 按用户反馈"代码评审和修复循环不完善"，将提示词铁律 8 从模糊的"循环直至清零"升级为**至少 10 轮彻底的 PR review 与修复循环**：① 每轮 review 必须在 PR 中回复（真实评审记录），每次修复也必须在 PR 中回复（修复说明 + 提交），**绝不允许跳过轮次假装进行**；② 10 轮后仍有问题则继续循环至清零，不得带已知问题进入下一阶段；简单改动走最小路径时 review 轮数可缩减但留痕纪律不变；③ 同步更新角色卡片（CR）、流水线 5/10 阶段、工作流程章节、真实执行与循环门禁表、冒烟测试验证点；`scripts/validate-npc-team-prompt.js` 新增 3 项校验（10 轮要求 / 每轮 review 与每次修复在 PR 分别回复留痕 / 不允许跳过轮次假装进行），负向测试验证均正确拦截（删"10 轮"、删"每轮分别回复"、删"假装进行" → 全部报错）；README 同步更新
- **修复 PR #86 第 1 轮评审 13 条（Issue #84 Mac 彻底评审）** — 对照 Linux 终版（PR #82 经 26 轮评审清零）逐文件比对，Mac 专属代码补齐 13 处 Linux 已修复而 Mac 未对齐的问题：① `launcher-mac.js` `startOpenCode` 空 cwd 改用 `os.homedir()` 兜底（此前直接报 `'cwd is undefined'`，导致「打开Web」自愈路径必败）；② `parseBody` 增加 `aborted` 标志防请求体超限后 `end` 事件双回调；③ `excel-handler.js` `insertRows`/`deleteRows`/`hideRows`/`showRows`/`groupRows` 行参数 `parseInt` + 正整数校验（此前 `params.row || 1` 对 0/负数/字符串静默兜底）；④ `sortRange` keyColumn 纯列字母补行号 + order 大小写不敏感；⑤ `autoFilter` criteria 存在时 field 必填校验；⑥ `replaceInSheet` 缺 findText 前置校验；⑦ `getCellComments` 无批注空保护；⑧ `transpose` 改 `PasteSpecial(-4104,false,false,true)` 真转置语义（此前普通粘贴覆盖）；⑨ `textToColumns` 参数修正（ConsecutiveDelimiter=false, Tab=true）；⑩ `consolidate` sources 非空 + function parseInt 校验；⑪ `getContext` 读首行真实值识别表头（新增 `headerRow` 字段）+ selectedCell 包 try/catch；⑫ `setCellStyle`/`setBorder`/`addConditionalFormat` 颜色统一走 `toExcelColor`、对齐走 `resolveAlignment`；⑬ `cleanData` 改 trim/collapse/all 三模式单元格级正则处理（去 Range.Replace 平台差异 + 全局正则 lastIndex 交替漏判 bug）；另修复 `setZoom` parseInt 校验；`tests/mac-bridge.test.js` 新增 8 个测试（17 → 25）；全部 JS `node --check` + `bash -n` 通过，6 套件 133 用例 + MCP 274 单测全绿，PR CI success
- **修复 PR #83 第 10 轮（最终轮）评审 2 info**（Issue #78）— ① `registerWindowActivateReflow` 新增 `windowActivateListenerRegistered` 已注册标志：`OnAddinLoad` 可能被多次调用（插件重载/异常恢复），防重复叠加 WindowActivate 监听（重复注册会叠加执行完整重绘流程、多定时器交错）；② `forceReflowFix` 的 300ms 最小间隔检查**提前到所有 DOM 访问之前**：被拦截时零 DOM 触碰（`getBoundingClientRect` 是同步布局读取成本高），避免无效代码路径；新增「OnAddinLoad 重复调用不重复注册」测试用例，测试 30 → 31 个全通过，全量 122 个用例全绿；**至此 10 轮 review 修复循环全部完成**
- **修复 PR #83 第 9 轮评审 3 info**（Issue #78）— ① `visibilitychange` 隐藏时复位 `reflowFixed`：WPS 切走标签时 WebView 可能被销毁重建，回显时必须重新检查布局，不能沿用隐藏前的「已修复」状态；② `showChat` 内 `typeof` 检查简化（`if (window.__scheduleReflowFix)` 直接调用）：时序倒挂由 IIFE 挂载时的「chat 已先行显示则补触发」兜底，两层机制互补，注释说明；③ `docs/WPSJS_DEVELOPMENT.md` 第 15 条补 DEV 增量 2：记录第 5~8 轮关键防护（输入焦点跳过/滚动位置保存恢复/300ms 最小间隔/chat 隐藏跳过/时序倒挂补触发/visibilitychange 隐藏复位/定时器统一走 scheduleReflowFix），维护者可读；测试 30 个全通过（静态骨架测试新增 ⑱visibilitychange 隐藏复位 / ⑲showChat 直接调用 断言），全量 121 个用例全绿
- **修复 PR #83 第 8 轮评审 1 critical + 1 warning（含第 5 轮回归自我纠正）**（Issue #78）— ① **critical（自纠，第 5 轮引入）**：`forceReflowFix` 的 `display:none` 会重置 `.messages` 滚动容器 `scrollTop`，第 5 轮「尊重位置」逻辑在重排**之后**才读 scrollTop（已被重置为 0），`nearBottom` 恒 false 且不滚动 → 用户消息列表被滚回顶部；改为重排**前**保存 `savedScrollTop`，重排后按 `wasNearBottom` 决策：原本在底部 → `scrollToBottom()`；原本在历史位置 → 精确恢复原 scrollTop，不打断阅读；② **warning（状态位空转）**：`scheduleReflowFix` 先重置 `reflowFixed=false` 再被 300ms 最小间隔拦截，导致状态位与事实不符、后续触发反复空转；改为间隔检查**先于**状态位重置（不足 300ms 直接 return 不动状态位），300ms/1000ms 定时器兜底统一走 `scheduleReflowFix`；测试 30 个全通过（静态骨架测试新增 ⑯滚动位置保存恢复 / ⑰最小间隔检查在状态位重置之前 断言，⑤定时器兜底正则同步更新），全量 121 个用例全绿
- **修复 PR #83 第 7 轮评审 3 info**（Issue #78）— ① `reflowRetryCount` 语义修正：`.app` 成功找到后清零（重试上限=「连续」失败上限），避免未来 `.app` 动态渲染时 10 次耗尽后 rAF 链式重试永久失效；② `heads.length === 0`（结构变动）时复查视为未修复（`reflowOk = heads.length > 0`），维持「持续可重试」语义，与第 4 轮注释一致；③ 已知限制留痕：`forceTaskPaneRedraw` 异步恢复对「WPS TaskPane 原生 X 关闭（不经过 OnAction，时间戳不更新）」的覆盖情况——销毁语义已由 `!cur` 判空覆盖、隐藏语义可能误弹，已记录到 `docs/WPSJS_DEVELOPMENT.md` 注意事项第 16 条 + main.js 注释；测试 30 个全通过（静态骨架测试新增 ⑭重试计数清零 / ⑮heads 空视为未修复 断言），全量 121 个用例全绿
- **修复 PR #83 第 6 轮评审 1 warning + 2 info**（Issue #78）— ① **warning（初始化时序倒挂）**：自愈 IIFE 定义在 `init()` 之后，`init` 异步回调（`onServerConnected`→`showChat`）可能先于 IIFE 执行，`typeof window.__scheduleReflowFix` 检查会静默跳过首次主动自愈；IIFE 挂载后补判断「chat 已先行显示」则立即 `scheduleReflowFix()`，覆盖时序倒挂场景；② **info（重排非幂等）**：新增 `lastForceReflowAt` 最小间隔 300ms，多个入口（rAF/load/定时器/resize/showChat）在同一时间窗内排队时只执行一次强制重排，避免昂贵布局反复跑；③ **info（scrollToBottom 空指针）**：`scrollToBottom()` 内部补判空（`if ($messages)`），避免 `CONNECTED` 为 true 但 `$messages` 为 null 时抛 TypeError 中断自愈流程；测试 30 个全通过（静态骨架测试新增 ⑪时序倒挂补触发 / ⑫重排最小间隔 / ⑬scrollToBottom 判空 断言），全量 121 个用例全绿
- **修复 PR #83 第 5 轮评审 2 warning + 1 info**（Issue #78）— ① **warning（重排打断输入）**：`forceReflowFix` 强制重排前检查 `#input-box` 是否聚焦（`document.activeElement === inputBox`），聚焦时跳过本次重排——避免 `display:none` 移除再恢复输入框导致 WPS Chromium（103）下输入框失焦、正在输入的光标丢失；② **warning（自愈强拉滚动条）**：重排成功后仅在用户消息列表**在底部**时才 `scrollToBottom()`（`nearBottom` 判断，容差 50px），用户向上查看历史消息时尊重阅读位置，不再强行拉回底部；③ **info（时间戳边界）**：`redrawStartTime` 提前到 `forceTaskPaneRedraw` 函数开头（读取窗格前），比对改 `lastUserTaskPaneAction >= redrawStartTime` 覆盖同毫秒边界（用户操作与重绘开始同毫秒也不误恢复）；测试 30 个全通过（静态骨架测试新增 ⑨输入焦点保护 / ⑩滚动位置尊重 断言），全量 121 个用例全绿
- **修复 PR #83 第 4 轮评审 1 warning + 2 info**（Issue #78）— ① **warning（用户介入时序 bug）**：`forceTaskPaneRedraw` 异步恢复回调仅靠 `cur.Visible` 无法防「用户手动关闭」——用户点 `btnShowTaskPane` toggle 把窗格关掉（Visible=false）时，回调会误判「我们隐藏的状态」而恢复置位、把刚关闭的窗格弹回来；新增 `lastUserTaskPaneAction` 时间戳（`OnAction` toggle 分支记录）+ `redrawStartTime` 比对：重绘期间用户操作过则放弃恢复，尊重用户意图；② **info**：`querySelectorAll('.topbar, .session-header')` 返回空时 `allInView` 恒真会误置 `reflowFixed` 永久关闭自愈；改为 `heads.length > 0` 才做预检，空时保守保持可重试；③ **info**：强制重排后**复查**头部是否回到视口内，仍越界时 `reflowFixed = reflowOk`（不置位），保留后续重试机会（WebView 布局 bug 顽固时一次重排可能不够）；测试 29 → 30 个（新增：重绘期间用户操作后放弃恢复），全量 121 个用例全绿
- **修复 PR #83 第 3 轮评审 2 warning + 2 info**（Issue #78）— ① `forceReflowFix` 增加 chat 视图隐藏判断（`view-chat.classList.contains('hidden')` 时直接跳过）：首次渲染处于 setup 视图时 `.topbar` 在 `display:none` 父级上 `getBoundingClientRect` 全为 0，预检恒不通过导致 `reflowFixed` 无法置位、定时器反复空转；② 预检改为**双头部检查**（`.topbar, .session-header` 任一越出视口即触发重排），消除只查 topbar 的漏判窗口；③ `showChat()` 末尾主动调用 `window.__scheduleReflowFix()`（页面底部 IIFE 暴露）：setup→chat 切换后不依赖旧 WebView 内核是否派发 resize，显式触发自愈；④ 宿主侧 `forceTaskPaneRedraw` 异步恢复延迟 80ms → 150ms（慢速环境宿主完成隐藏→重排耗时不定，80ms 可能过早导致重绘不完整）；测试 29 个全通过（静态骨架测试新增 ⑥⑦⑧ 断言），全量 120 个用例全绿
- **修复 PR #83 第 2 轮评审 1 critical + 2 warning + 1 info（含第 1 轮回归自我纠正）**（Issue #78）— ① **critical（自纠）**：`forceReflowFix` 预检 `documentElement.scrollHeight <= innerHeight` 在 `position:fixed` 布局下恒真（fixed 不产生滚动），导致强制重排永不执行、页面自愈失效；改为检测 `.topbar` 的 `getBoundingClientRect()` 是否在视口内（`r.top>=0 && r.bottom<=innerHeight && r.width>0`），布局正常才跳过；② **warning**：`forceTaskPaneRedraw` 新增 `taskPaneRedrawPending` 防抖标志，WindowActivate 连续触发时一次重绘未完成（80ms）跳过后续触发，避免交错定时器导致 Visible 状态错乱；③ **warning**：异步恢复前复查 `GetTaskPane` 当前窗格——已销毁（null）或已被外部恢复（`cur.Visible` 为 true，如用户重新打开）时跳过置位，不误弹用户刚关闭的窗格；④ **info**：300ms/1000ms 定时器兜底改为先重置 `reflowFixed` 再执行（`reflowFixed=false; forceReflowFix()`），避免首次误判后兜底全部空转；测试 26 → 29 个（新增：防抖跳过/外部恢复不重复置位/窗格销毁放弃恢复），全量 120 个用例全绿
- **修复 PR #83 第 1 轮评审 2 warning + 2 info**（Issue #78）— ① `opencode-wps/main.js` `forceTaskPaneRedraw` 的 `Visible false→true` 拆成**异步两步**（中间 `setTimeout 80ms` 让出宿主事件循环）：同一同步代码块内连续置位可能被 WPS 宿主合并处理导致重绘不生效；② `forceTaskPaneRedraw` 内 `PluginStorage.getItem` 单独 try/catch（与 `OnAction` 路径防御一致）：失败时留痕「读取 taskpane_id 失败」并继续用内存兜底，而非整函数误报「强制重绘失败」；③ `opencode-wps/taskpane.html` `forceReflowFix` 增加 `reflowFixed` 状态位 + 预检：布局已正常时不重复强制重排，避免 300ms/1000ms 定时器对正常布局**闪屏**；resize 时重置状态位允许再次自愈；④ rAF 链式重试加**次数上限**（10 次 ≈166ms），防止 `.app` 缺失时每帧无限空转占 CPU；测试：`loadMainJs` 的 setTimeout mock 改为可手动 flush（`__flushTimeouts`），「异步两步重绘」用例适配新时序，26 个全通过，全量 103 个用例全绿
- **修复 Issue #78 复诊（补 DEV 增量）：首次渲染兜底加固** — `opencode-wps/taskpane.html` 自愈逻辑增强：① `forceReflowFix` 在 `.app` 尚未挂载时改为 rAF 链式重试（不再直接 return 丢兜底）；② 新增 `raf` 兼容层，`requestAnimationFrame` 缺失时用 `setTimeout 16ms` 兜底（兼容旧 WebView 内核）；③ 首次渲染触发时机扩展为三路（rAF 首帧前 + `load` 事件 + 300ms/1000ms 定时器），覆盖 WebView 视口高度计算的不同时序；④ `tests/taskpane-dock.test.js` 新增「taskpane.html 自愈骨架」静态校验用例（position:fixed 锚定/forceReflowFix/offsetHeight 强制 reflow/rAF 降级/resize 与 visibilitychange 监听/多时机兜底），测试 25 → 26 个全通过；全量测试 103 个用例全绿
- **修复 Issue #78 复诊：头部被遮挡根因是 TaskPane WebView 首次渲染布局 bug，非 DockPosition**（Issue #78）— 用户实测 PR #79 修复后头部仍被遮挡、新建 WPS 标签页再切回即恢复；两张截图像素级对比显示任务窗格刚打开时 topbar/session-header 区域为空白（WebView 视口高度计算错误把 flex 头部挤出可视区），切换窗口触发宿主重绘后才恢复。三层防御修复：① `opencode-wps/taskpane.html` 的 `html,body` 改用 `position:fixed + inset:0` 锚定视口四边（规避 `height:100%` 部分版本失效）；② 页面内监听 `resize`/`visibilitychange` 并强制 reflow（`forceReflowFix`：隐藏→读 `offsetHeight`→恢复 `.app`，节流 100ms）；③ `opencode-wps/main.js` 注册 `AddApiEventListener('WindowActivate')`（官方 SDK `wps-jsapi` 声明事件），切回标签时强制任务窗格 `Visible false→true` 重绘（仅当窗格原本可见时执行，避免误弹已关闭窗格），旧版本无 `AddApiEventListener` 时静默降级；新增 5 个测试用例（注册监听/旧版本降级/重绘置位/不存在不误弹/异常静默），测试 20 → 25 个全通过；`docs/WPSJS_DEVELOPMENT.md` 注意事项新增第 15 条
- **修复 PR #79 第 12 轮评审 1 info**（Issue #78 / PR #79）— `opencode-wps/main.js` `btnShowTaskPane` 分支「GetTaskPane 找回」路径的 `setTaskPaneDockPosition(tp)` 返回值补检查：此前该路径停靠校正失败时仅内部留痕、无「窗格仍可用」增强留痕，与 `createTaskPane()` 内行为不一致（创建路径有增强留痕、找回路径静默）；现校正失败时同样补充 `console.error('[WPS] 任务窗格停靠校正失败（窗格仍可用，下次点击将重新校正）')` 留痕后不中断可见性切换（下次点击仍会重新校正，有自愈机会），两处行为统一；新增「GetTaskPane 找回路径停靠校正失败：留痕不中断可见性切换」测试用例，测试 19 → 20 个全通过；`docs/WPSJS_DEVELOPMENT.md` 注意事项新增第 14 条
- **修复 PR #79 第 11 轮评审 2 info**（Issue #78 / PR #79）— ① `opencode-wps/main.js` `createTaskPane()` 内 `CreateTaskPane` 返回值补判空：个别版本可能返回 `null`（而非抛异常），此前直接访问 `tskpane.ID` 会抛误导性 TypeError（外层 catch 虽能兜住，但「初始化任务窗格失败」文案带偏排查方向）；现返回 null 时 `console.error('创建任务窗格失败: CreateTaskPane 返回空对象')` 明确留痕并返回 null；② `createTaskPane()` 检查 `setTaskPaneDockPosition()` 返回值：停靠校正失败（内部已留痕）但窗格仍可用，不中断、补充「窗格仍可用，下次点击将重新校正」留痕后继续置可见并返回窗格对象（保留自愈机会）；新增 2 个测试用例（CreateTaskPane 返回 null 立即判空 / 停靠校正失败仍返回窗格对象），测试 17 → 19 个全通过；`docs/WPSJS_DEVELOPMENT.md` 注意事项新增第 12/13 条
- **修复 PR #79 第 10 轮评审 2 info**（Issue #78 / PR #79）— ① `opencode-wps/main.js` `createTaskPane()` 内 `PluginStorage.setItem('taskpane_id', ...)` 收敛进 `if (tskpane.ID)` 判空分支：此前 ID 为空（个别版本未回填）时仍会执行 `setItem`，把 `undefined` 持久化写入 `PluginStorage`，可能覆盖既有**有效** ID（评审 warning 盲区）；现仅 ID 有效时才持久化，ID 为空时留痕、不覆盖内存缓存、也不写持久化；② `errMsg()` JSDoc `@returns {string}` 改为 `@returns {*}`，与实现（非 Error 值原样返回）一致；`tests/taskpane-dock.test.js` 「窗格 ID 为空」用例补充 `setItemCalls.length === 0` 断言（封住持久化盲区），测试 17/17 全通过；`docs/WPSJS_DEVELOPMENT.md` 注意事项第 10 条补充「跳过 setItem 写入」语义
- **修复 PR #79 第 9 轮彻底评审 3 info**（Issue #78 / PR #79）— ① `opencode-wps/main.js` `createTaskPane()` 内 `taskpaneIdCache = tskpane.ID` 补空值防御：个别版本 `CreateTaskPane` 返回的窗格 `ID` 可能为 `undefined`，直接覆盖会令内存兜底失效回到多窗格叠加场景，现 ID 为空时 `console.error` 留痕且不覆盖既有缓存；② `tests/taskpane-dock.test.js` 文件头注释由 5 条断言更新为 17 用例全量清单（与真实用例数对齐）；③ `errMsg()` 统一范围补齐——`main.js` 中 5 处既有 `e.message` 裸访问（`checkWpsReady`/`checkDocument`/`sendDocInfo`/`startOpenCodeServer`/`checkStatus`）全部改 `errMsg(e)`，异常信息提取实现全文件收敛；新增「窗格 ID 为空不覆盖缓存」测试用例，测试 16 → 17 个全通过；`docs/WPSJS_DEVELOPMENT.md` 注意事项第 10/11 条同步更新
- **修复 PR #79 彻底评审 1 warning + 2 info**（Issue #78 / PR #79）— ① `opencode-wps/main.js` `createTaskPane()` 内 `tskpane.Visible = true` 单独包 try/catch：此前若个别版本对只读 `Visible` 抛异常，窗格已创建、ID 已存却返回 `null`，调用处误判「创建失败」且无自愈机会；现失败 `console.error` 留痕后**仍返回窗格对象**，保留下次点击自愈路径；② 新增模块级 `taskpaneIdCache` 内存 ID 兜底：`setItem` 持久化失败时，本次会话内再次点击不会重复 `CreateTaskPane` 造成多窗格叠加（`OnAction` 在 `getItem` 为空/异常时回退内存值）；③ 提取 `errMsg()` 公共函数统一 6+ 处 `(e && e.message ? e.message : e)` 重复表达式；新增 3 个测试用例（Visible 置位失败仍返回窗格对象 / setItem 持久化失败内存 ID 兜底不重复创建 / errMsg 函数），测试 13 → 16 个全通过；`docs/WPSJS_DEVELOPMENT.md` 注意事项新增第 9/10/11 条
- **修复 PR #79 第 8 轮评审 2 info**（Issue #78 / PR #79）— ① `opencode-wps/main.js` `createTaskPane()` 外层 catch 留痕文案由「创建任务窗格失败」改为「初始化任务窗格失败」：该 try 块实际涵盖 CreateTaskPane / 存 ID / DockPosition 校正 / Visible 置位全流程，原文案过窄会误导排查方向；② `btnShowTaskPane` 分支 `tp.Visible = !tp.Visible` 补 try/catch：与 `createTaskPane()` 内 `Visible` 置位保持统一异常兜底，避免个别 WPS 版本对该属性抛异常时中断按钮回调；新增「切换可见性失败（tp.Visible 只读）留痕不中断」测试用例，测试 12 → 13 个全通过；`docs/WPSJS_DEVELOPMENT.md` 注意事项新增第 8 条「可见性切换也要 try/catch」
- **修复 PR #79 第 7 轮评审 warning**（Issue #78 / PR #79）— `opencode-wps/main.js` `createTaskPane()` 内 `PluginStorage.setItem('taskpane_id', ...)` 原为**裸奔调用**：`setItem` 与 `getItem` 同源同概率抛异常（如插件初始化未完成），一旦抛异常会中断整个大 try 块，导致后续 `setTaskPaneDockPosition` 校正与 `tskpane.Visible = true` 置位被跳过（窗格创建了却永远不显示）、`createTaskPane()` 返回 `null` 后调用处直接 `return`，且无留痕。现改为 `setItem` 单独包 try/catch：失败 `console.error('[WPS] 保存 taskpane_id 失败: ...')` 留痕后**继续执行**后续初始化（DockPosition 校正 + Visible 置位照常）；新增「setItem 抛异常：留痕后继续校正停靠并置可见」测试用例，测试 11 → 12 个全通过；`docs/WPSJS_DEVELOPMENT.md` 注意事项新增第 7 条「setItem 必须 try/catch」
- **修复 PR #79 第 6 轮评审 2 info**（Issue #78 / PR #79）— ① `opencode-wps/main.js` `createTaskPane()` 包 try/catch：`CreateTaskPane` 抛异常（如 `taskpane.html` 路径无效、WPS 环境异常）时 `console.error` 留痕并返回 `null`，调用处判空兜底，不再直接中断；② `btnShowTaskPane` 分支 `PluginStorage.getItem("taskpane_id")` 包 try/catch（与仓库 `checkStatus`/`pollCommand`/`dockOpenCodeWindow` 防御模式一致），插件初始化未完成等场景读取失败留痕并回退重建；新增 2 个测试用例覆盖「getItem 抛异常回退重建 + 留痕」「CreateTaskPane 抛异常返回 null + 留痕」，测试 9 → 11 个全通过；`docs/WPSJS_DEVELOPMENT.md` 注意事项新增第 5/6 条
- **修复 PR #79 第 5 轮评审 info**（Issue #78 / PR #79）— `opencode-wps/main.js` `btnShowTaskPane` 分支 `GetTaskPane` 调用包 try/catch：个别 WPS 版本对无效/过期 `taskpane_id` 会**抛异常**（而非返回 null），此前会直接中断且无留痕，现统一 catch 后 `console.error` 留痕并回退 `createTaskPane()` 重建，贴合文档「必须判空」初衷；新增「GetTaskPane 抛异常回退重建 + 留痕」测试用例，测试 8 → 9 个全通过；`docs/WPSJS_DEVELOPMENT.md` 注意事项第 4 条补充抛异常场景
- **修复 PR #79 第 4 轮评审 2 info**（Issue #78 / PR #79）— ① `opencode-wps/main.js` 提取 `createTaskPane()` 辅助函数，统一「首次创建」与「GetTaskPane 判空回退重建」两段完全重复的逻辑（CreateTaskPane 单参数 + 存 taskpane_id + setTaskPaneDockPosition + Visible=true），`btnShowTaskPane` 分支简化为一处判空分流；② `docs/WPSJS_DEVELOPMENT.md` 注意事项第 2 条措辞修正——「当前仅使用 `msoCTPDockPositionLeft`/`Right`」改为「当前停靠枚举仅定义 Left/Right（实际使用 Right，Left 保留备用）」，避免误导；新增 `createTaskPane` 统一初始化用例，测试 7 → 8 个全通过
- **修复 PR #79 第 2 轮评审 2 问题**（Issue #78 / PR #79）— ① `GetTaskPane` 判空回退重建：`taskpane_id` 持久化于 `PluginStorage`，WPS 重启后旧 id 残留、`GetTaskPane` 返回 `null` 时直接访问 `tp.Visible` 会抛 TypeError 导致窗格打不开，现改为判空后回退「重新 `CreateTaskPane` + 重存 `taskpane_id`」；② 清理 `tests/taskpane-dock.test.js` 冗余死代码（`loadMainJs` 重复调用 3 次、恒真断言、未使用的 `sandbox2`/`app`/`src`），新增「GetTaskPane 返回 null 回退重建」用例，测试 6 → 7 个全通过；`docs/WPSJS_DEVELOPMENT.md` 注意事项补充第 4 条「`GetTaskPane` 必须判空」
- **修复 PR #79 评审 3 问题 + 补真实测试防线**（Issue #78 / PR #79）— ① 删除 `WPS_Enum` 中未使用的 `msoCTPDockPositionTop(1)/Bottom(3)`（与已有 `msoFileDialogOpen:1` 数值冲突埋雷），仅保留实际使用的 `Right(2)`；② `CreateTaskPane` 恢复单参数（仓库无官方文档佐证第二参数），创建后统一通过 `setTaskPaneDockPosition()` 设置 `DockPosition` 属性显式校正；③ 空 catch 改 `console.error` 留痕，新增 `tests/taskpane-dock.test.js`（vm 加载生产源码 + mock Application，6 用例：枚举无冲突/单参数/首次创建校正/再次打开重校正/失败留痕/无效对象）并接入 GitHub Actions legacy 测试与 `.cnb.yml` Validate 阶段；`docs/WPSJS_DEVELOPMENT.md` 新增「任务窗格 TaskPane API」章节记录验证结论
- **NPC Team 提示词新增「真实执行与循环门禁」（Issue #76 补充）** — 针对 #78 实测暴露的"编造评审/测试全绿"问题，提示词铁律新增 7~10：① **每步真实执行+留痕**：每一步必须单独执行并在 Issue/PR 留下可核实痕迹（评论/评审/提交/CI 记录），禁止假装执行；② **评审-修复循环**：5/10 评审留痕、问题全部修复后复评，循环直至清零；③ **测试失败跳转**：6/10 验收不通过跳回 4/10 或 5/10 重新执行直至通过；④ **充分复盘四要素**：9/10 复盘必须写清根因/教训/预防/加固；`scripts/validate-npc-team-prompt.js` 新增 4 项门禁校验（留痕/清零/跳转/四要素），负向测试验证均正确拦截；`docs/NPC_TEAM.md` 新增「真实执行与循环门禁」章节与【留痕检查】自检段
- **NPC Team 提示词新增「暂停确认机制」（Issue #76 补充）** — 流水线插入 2 个强制暂停点（⏸CP1 计划确认 / ⏸CP2 开发确认），到点输出暂停卡并停下，等用户命令词（**「继续」放行 / 「补充：<意见>」修正后继续 / 「停止」终止**）；铁律：**只有用户本人回复命令词才放行，禁止代替用户确认、禁止假装已确认**（防"自评自导跑完全流程"的幻觉）；`scripts/validate-npc-team-prompt.js` 新增暂停确认校验（⏸CP1/⏸CP2 完整定义、三命令词完整形式、禁止代替确认铁律、暂停卡格式段），负向测试验证：删暂停点/改命令词/删铁律/改名暂停段均正确拦截
- **NPC Team 校验脚本强化**（PR #77 复评 3 条 info 整改）— ① `scripts/validate-npc-team-prompt.js` 改用真正的命名捕获组 `m.groups.prompt`（移除恒为 undefined 的 `m.group ?? m[1]`）；② 角色校验从"全文中任意命中"弱校验升级为**强校验**：在 `【角色卡片】` 段内逐张匹配「emoji 缩写：/全称：」卡片行，卡片被误删（即使流水线正文仍含「开发/评审/测试」等词）也会报错拦截；③ 提示词代码块增加锚点 `# NPC_TEAM_PROMPT_START`，正则只捕获带锚点的块并校验长度下限（≥500 字符），避免将来在提示词前新增其他 text 块时静默捕获错误内容；`docs/NPC_TEAM.md` 同步在提示词块首行加锚点；负向测试验证：删除 QA 卡片 / 删除锚点均能正确拦截

### Added

- **NPC Team 提示词 V2 优化 + 有效性测试**（Issue #76）— `docs/NPC_TEAM.md` 提示词从 ~2092 token 压缩到 ~1019 token（**-51%**，6 角色/10 阶段/零积分/安全红线全保留）：流水线改单行紧凑格式、合并身份声明与角色清单、切换卡示例压缩为单卡、去除与工作流程章节重复的流水线描述；新增 `scripts/validate-npc-team-prompt.js` 静态校验脚本（校验 6 角色齐全/10 阶段编号完整/零积分红线/安全红线/切换卡）并接入 `.cnb.yml` CI 的 Validate 阶段；文档新增「有效性测试（可复现）」章节（静态校验 + 2 分钟冒烟测试方法 + 实测结论）

### Fixed

- **清理 Issue #78 无效修复代码（确认为 WPS 宿主 bug，Issue #78 七诊收尾）** — 经 6 轮实机验证（PR #79/#83/#90/#109）确认「侧边栏 chatui 头部被遮挡 + WPS 顶栏标签被压扁」为 **WPS 宿主 TaskPane 布局 bug**，插件侧无法修复（仅新建标签/切标签可临时恢复）。按用户要求清理全部无效修复代码，不再垒屎山：① `opencode-wps/main.js` 删除宿主重绘模块（`forceTaskPaneRedraw`/`scheduleTaskPaneOpenRedraw`/`registerWindowActivateReflow` 及配套状态变量/常量/`WindowActivate` 监听注册），`OnAddinLoad` 恢复仅初始化枚举+连接 OpenCode；② `opencode-wps/taskpane.html` 删除「头部遮挡自愈」IIFE（`forceReflowFix`/`scheduleReflowFix`/resize/visibilitychange 监听/定时器兜底）、`showChat()` 中的自愈调度调用，`html,body` 布局恢复标准 `width:100%;height:100%`（去掉 `position:fixed` hack）；③ `tests/taskpane-dock.test.js` 删除重绘/自愈相关用例（43 → 20），仅保留任务窗格创建/切换的通用健壮性用例（判空/try-catch/ID 兜底/停靠校正）；④ `docs/WPSJS_DEVELOPMENT.md` 删除注意事项第 15/16 条（无效修复结论+已知限制）与「头部遮挡修复实机验收步骤」章节。**保留**：PR #79 的任务窗格基础健壮性代码（右侧停靠默认、判空回退重建、全链路 try/catch 留痕、内存 ID 兜底）——这些是通用质量提升，与 WPS bug 无关。验证：taskpane-dock 20/20 + 全量 7 套件 + `node --check` 全绿
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
- **Mac 版「打开Web」按钮**（Issue #74）— `opencode-wps-assistant/ribbon.xml` 新增「对话」分组及「打开Web」按钮，`main.js` 新增 `OnOpenWebClick` 回调，点击后经 launcher `/dock` 自动在系统默认浏览器（优先 Chrome/Edge）打开 `http://127.0.0.1:14096`，消除 Mac 端「WPS 内操作、浏览器里手动输地址对话」的割裂感

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

## [1.1.1] - 2026-08-06

### Fixed

- **清理 Issue #78 无效修复代码（确认为 WPS 宿主 bug，Issue #78 七诊收尾，PR #112）** — 经 6 轮实机验证（PR #79/#83/#90/#109）确认「侧边栏 chatui 头部被遮挡 + WPS 顶栏标签被压扁」为 **WPS 宿主 TaskPane 布局 bug**，插件侧无法修复（仅新建标签/切标签可临时恢复）。清理全部无效修复代码（净删 889 行，+9/-889）：① `opencode-wps/main.js` 删除宿主重绘模块（`forceTaskPaneRedraw`/`scheduleTaskPaneOpenRedraw`/`registerWindowActivateReflow` 及配套状态变量/常量/`WindowActivate` 监听注册），`OnAddinLoad` 恢复仅初始化枚举+连接 OpenCode；② `opencode-wps/taskpane.html` 删除「头部遮挡自愈」IIFE（`forceReflowFix`/`scheduleReflowFix`/resize/visibilitychange 监听/定时器兜底）与 `showChat()` 中的自愈调度调用，`html,body` 布局恢复标准 `width:100%;height:100%`；③ `tests/taskpane-dock.test.js` 删除重绘/自愈相关用例（43 → 20）；④ `docs/WPSJS_DEVELOPMENT.md` 删除注意事项第 15/16 条与「头部遮挡修复实机验收步骤」章节。**保留**：PR #79 的任务窗格基础健壮性代码（右侧停靠默认、判空回退重建、全链路 try/catch 留痕、内存 ID 兜底）——通用质量提升，与 WPS bug 无关。验证：5 轮 review-修复循环问题清零 + 8 套件 **193 用例全绿** + CI success + 全仓库零残留扫描通过

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

请查看 [Releases](https://github.com/lnxsun/opencode-wps/releases)（国内镜像：https://cnb.cool/lnxsun/opencode-wps/-/releases）查看所有版本。
