# 更新日志

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **NPC_TEAM 流水线新增 PR 合并（⏸CP3 合并前暂停确认）+ 发布阶段（Issue #76 最新补充）** — 按用户要求"再加上PR合并（在合并前需暂停待用户确认）、发布（更新版本号、发布形成changelog、发布产物）"，将提示词流水线从 10 阶段扩展为 **12 阶段（0/11~11/11）**：7/11 文档 → **⏸CP3 合并确认** → 8/11 合并 PR → 9/11 发布 → 10/11 汇报 → 11/11 复盘。核心机制：① **铁律 13 合并确认**：5/11 评审清零 + 6/11 测试通过后，合并 PR 前必须暂停输出【合并确认卡】等用户命令（继续合并/补充/停止），收到确认前绝不执行合并，禁止代替用户确认、禁止未经确认自行合并 PR（防"偷偷合并"）；② **铁律 14 发布三要素**：9/11 发布必须真实执行 ① 更新版本号（semver 递增）② 形成/更新 CHANGELOG（Keep a Changelog 格式）③ 发布产物（打 tag / 推送 release / 发布制品），并在 Issue/PR 留痕，禁止假装发布（不更新版本号/不写 changelog/不产出产物却宣称已发布）；③ 全程模式暂停点由 2 个增至 3 个（⏸CP1/⏸CP2/⏸CP3），命令词由 3 个增至 4 个（继续/补充/停止/继续合并）。配套：`scripts/validate-npc-team-prompt.js` 新增第 10c 节「合并确认」强校验（MERGE_CONFIRM_CORE 6 句式顺序校验）+ 第 10d 节「发布三要素」强校验（RELEASE_CORE 5 句式顺序校验），阶段编号校验升级为 0/11~11/11；`tests/validate-npc-team-prompt.test.js` 新增 10 个合并/发布回归用例（正向 + 8 负向全拦截：删合并前暂停/删禁止未确认合并/删合并确认卡段/删继续合并命令/删更新版本号/删 CHANGELOG/删发布产物/删禁止假装发布），**52 → 62 用例全绿**；`.codebuddy/skills/npc-team/SKILL.md` frontmatter 新增「合并确认/合并前暂停/发布」触发词 + 正文双源同步；`scripts/lib/npc-team-triggers.js` 触发词单一源同步；docs/NPC_TEAM.md 新增【合并确认卡】模板段、工作流程 12 阶段、暂停确认表 3 暂停点、门禁表「合并前暂停确认」「发布三要素」行、冒烟测试方法 D（合并确认）/E（全程回退）；README 同步更新

- **NPC_TEAM 评审-修复循环接力化 + 复评卡闭环（Issue #76，CR 第 1~2 轮修复）** — 按用户要求"其中的 PR review 与 修复循环也建议使用接力模式"，将 5/11 评审-修复循环在**接力模式**下逐轮接力：每轮评审与每次修复各是独立一次 `@CodeBuddy` 召唤，评审棒输出【评审接力卡】（含评审结论 + 修复召唤话术）、修复棒输出【修复接力卡】（含修复提交 + 复评召唤话术），禁止在一次召唤内偷偷连跑多轮评审-修复（防"假装评审"）。**CR 第 2 轮修复新增【复评接力卡】闭环模板**（复评结论🔴仍需修复/🟢通过双分支 + 未清零续第 R+1/10 轮评审 / 清零转 6/10 测试）+ R 计轮口径（R 从 1 起，一轮 = 评审棒+修复棒+复评棒）。配套：① 提示词铁律 8 升级为「10 轮彻底循环，接力模式」、CR 角色卡片/流水线/工作流程/门禁表/冒烟测试表同步；② `scripts/validate-npc-team-prompt.js` 新增第 10b 节「评审-修复接力」强校验（RELAY_REVIEW_CORE 12 句式顺序校验 + 评审/修复/复评接力卡召唤话术示例校验；**CR 第 1 轮修复：接力卡话术校验段化**，消除跨段假阳性；**CR 第 6 轮修复：评审/修复/复评接力卡话术校验同样段化**，消除三段卡漏检）；③ `tests/validate-npc-team-prompt.test.js` 新增 9+6 个接力/复评回归用例（正向 + 负向全拦截，**CR 第 1 轮修复负向用例改全量替换真拦截、CR 第 6 轮修复三段卡话术用例改段内定位真拦截、CR 第 7 轮修复新增锚点缺失段化拦截用例、CR 第 10 轮修复新增缩进漂移拦截/修正用例、CR 第 12 轮修复新增铁律 8 段内评审棒/修复棒句负向用例**），52 用例全绿；④ `docs/NPC_TEAM.md` 新增【评审接力卡】/【修复接力卡】/【复评接力卡】模板段与「方法 C（评审-修复接力）」冒烟测试；⑤ `.codebuddy/skills/npc-team/SKILL.md` 双源同步；README 同步更新（**CR 第 1 轮修复 README 接力表述**）

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
