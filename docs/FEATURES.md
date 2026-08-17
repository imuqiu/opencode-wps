# 特色功能详解

本文档详细介绍 OpenCode WPS 的两大特色功能：**文档填写（模板自动填值）** 与 **大文档校对（铁律 3.0）**。

> 📖 日常使用方式（打开面板/对话操作/Agents 调用）见 [USAGE.md](./USAGE.md)。

## 文档填写 — 模板自动化填值

根据预定义的字段映射，自动从结构化数据源（JSON/Excel/数据库）中提取值，精准填充到 Word 文档模板的指定位置，全程开启修订模式，确保填值过程可追溯。

### 工作流程

1. **评估文档** — `getActiveDocument` 获取文档总段落数与结构，输出分批计划（T1）
2. **分批拉取** — `getDocumentParagraphs` 分批次获取段落（每批 ≤200 段，T2/T5）
3. **定义字段** — `findInDocument` / `getBookmarks` 定位模板字段名称和位置
4. **映射数据** — `smartFillField` 将数据源字段值与模板字段对应（支持 auto/underline/afterColon/afterLabel/placeholder 五种模式，T6/T7/T8/T9）
5. **预览校验** — 自动检测字段格式（日期/金额/编号等），首次填写前输出「文档字段 ↔ 用户值」对照表并获用户确认（T7）
6. **批量填值** — 分批次（每批 ≤200 段）调用 `smartFillField` / `replaceBookmarkContent` 执行填充（填写前已开启修订模式 T3），所有填值自动加下划线（T11），禁止编造数据，跳过签字/印章等不可自动填写的字段（T8）
7. **查漏复核** — 填写后调用 `findInDocument` 检查遗漏（T4）

### 治理规则（T1-T11）

| 规则 | 说明 |
|------|------|
| T1 | 填写前调用 `getActiveDocument` 评估文档规模，确定段落总数和字段位置 |
| T2 | 填写前调用 `getDocumentParagraphs` 分批，每批 ≤200 段 |
| T3 | 填写前调用 `enableTrackChanges(true)` 开启修订模式 |
| T4 | 填写后建议调用 `findInDocument` 检查遗漏 |
| T5 | 批次连续性检查（同 P2） |
| T6 | 禁止子串重复填写（新 keyword 是已填 keyword 的子串/超串时拦截） |
| T7 | 禁止编造——首次填写前必须输出「文档字段 ↔ 用户值」对照表并获用户确认 |
| T8 | 跳过签字字段（含「签字/签名/签章」的关键字无需填写） |
| T9 | 日期字段推荐 underline 模式 |
| T10 | 禁止同一 (keyword, value) 重复填写 |
| T11 | 所有填入的值必须加下划线（`smartFillField` 工具层自动执行） |

### 适用场景

- 合同/协议批量生成（将订单数据填入合同模板）
- 报告/报表自动生成（将统计数据填入报告模板）
- 公文/信函批量制作（将收件人信息填入信函模板）
- 审批表单填写（将审批结果填入审批单模板）

---

## 大文档校对 — 铁律 3.0 严格逐批校对

基于 `proofreadBasic` 工具的严格逐批校对流程，引入**铁律 3.0** — 禁止 AI 跳过基础校对、禁止跳过确认直接修改、禁止 AI 编造修复内容。通过 16 条校对规则（P1-P16）在代码层强制执行。

### 校对流程

1. **评估文档** — `getActiveDocument` 获取文档总段落数，输出分批校对计划（P3 前置要求）
2. **生成批计划** — `getDocumentParagraphs` 获取本批段落（每批 ≤200 段，从第 1 段起连续分批；**推荐每批 100 段**，避免单次返回文本超过 MCP 输出限制被截断导致漏检，见 Issue #116 PR-C）
3. **逐批校对** — `proofreadBasic` 每批独立调用，AI 逐批检查
4. **确认修复** — `confirmBatchAiProofread` 确认本批问题（必须先调 `proofreadBasic`）
5. **执行修复** — `replaceInParagraph` 修复本批问题 → **进入下一批**（本批未完成禁止下一批）

### 铁律 3.0 核心规则

| 规则 | 类型 | 说明 |
|------|------|------|
| **P1** | before | `getDocumentParagraphs` 首次必须从第 1 段开始，单次 ≤200 段，批次必须连续 |
| **P2-P3** | before/after | 文本长度限制：单次 `getDocumentParagraphs` ≤200 段；`proofreadBasic` 传入文本不得超过本批预期范围 ×2（或 5 万字符兜底） |
| **P4-P7** | after | 批次状态追踪（批数/段数/完成计数/状态设置） |
| **P8-P10** | before | `confirmBatchAiProofread` 前必须调 `proofreadBasic`，禁止跳过基础校对 |
| **P11** | before | 替换操作必须在本批 `proofreadBasic` + `confirmBatchAiProofread` 之后（修订模式已开启） |
| **P12** | before | 当前批未完成（proofread → confirm → fix）禁止获取下一批段落 |
| **P13** | before | `getDocumentTextByRange` 拉取长度不得超过本批预期范围 ×2（或 5 万字符兜底），禁止一次性拉取多批文本 |
| **P14** | before | `confirmBatchAiProofread` 必须在 `proofreadBasic` 之后调用，禁止 AI "分析"后跳过 |
| **P15** | before | 当 `proofreadHadIssues=false`（基础校对无问题）时，最多允许 1 次 AI 自定修复，超限需 `_force_ai_fix` |
| **P16** | before | `replaceInParagraph` 的 `findText` 必须与至少一条 `proofreadIssueOriginals` 原文匹配 |
| **P17** | before | 写「校对报告」路径且服务端未成功生成报告时拦截，禁止 AI 手动 `write` 伪造报告（Issue #116 session_ffa8 问题一） |
| **P18** | before | 已处理到段落 N 后再次从段落 1 回卷获取即拦截，禁止重复扫描已检查段落（Issue #116 session_ffa8 问题四） |

### 校对报告防伪造（Issue #116 session_ffa8 问题一）

校对报告**必须由服务端 `generateProofreadReport` 基于真实累计的校对数据生成**。真实会话中 AI 在 `generateProofreadReport` 失败后直接 `writeFile` 手动拼 Markdown 报告（3 份数据互相矛盾），绕过了服务端真实数据。治理插件 **P17** 在写「校对报告」路径时若服务端未成功生成报告即拦截；SKILL 铁律 5 明确禁止手动伪造。

### 禁止重复获取已处理段落（Issue #116 session_ffa8 问题四）

真实会话中 AI 已处理完某批次后，又对已检查过的段落执行 `getDocumentParagraphs(start=1)` 回卷重复扫描，既浪费 token 又可能造成重复/遗漏的修复误判。治理插件 **P18** 记录已处理到的最大段落号 `N`，当已处理到 N 段后再次从段落 1 回卷获取（`start=1`）时直接拦截，要求批次必须严格连续向前推进（如需重新开始须先 `getActiveDocument` 重置）。

### 上下文用量条（Issue #116 session_ffa9 假修复）

用量条数据源改为**多路径防御性探测**（`extractCtxUsage`：usage/tokens/context/info/status 各字段组合，含 used+total 自动换算百分比），信息文本默认可见；无用量数据时诚实降级展示（不显示假百分比），并监听 Compaction 压缩事件显式提示用户。

### 治理机制（hooks 闭环）

```
before 钩子拦截违规 → 工具执行 → after 钩子更新状态 → before 钩子校验状态
```

- `proofreadHadIssues`：记录基础校对是否发现问题 → P15 据此限制 AI 自定修复次数
- `proofreadIssueOriginals[]`：存储基础校对返回的 issue 原文 → P16 交叉校验
- `proofreadCalledThisBatch`：标记本批是否调过基础校对 → P12/P13/P14 共用
- `replaceCountThisBatch`：本批替换次数计数 → P15 超限拦截

### 校对数据持久化（Issue #116）

校对流程中累加的问题数据默认存在 MCP 服务端进程内内存（`sessionIssues` Map）。为避免**会话压缩（Compaction）**和 **MCP 服务重启**导致已累加的校对问题丢失、报告不完整，引入了**服务端落盘持久化**：

- `proofreadAccumulate` 每次累加后**增量写盘**到 `~/.opencode-wps/proofread-sessions/{sessionId}.json`
- 报告生成时优先读内存 Map（快路径），缺失则**从磁盘恢复**（`getSessionOrLoad`）
- `releaseSession` / LRU 淘汰同步删除磁盘文件，防止磁盘膨胀
- 存储目录创建时设置 `0o700` 权限，收敛敏感数据可读范围

这样即使长会话发生压缩、或 MCP 服务中途抖动重启，已确认的校对问题都不丢失，报告可完整生成。

### 疑似问题（待确认问题）机制（Issue #116）

校对过程中，AI 常识别出**疑似但未确认**的问题（如语义存疑、疑似误写、需人工核实的计算错误等）。此前这些疑似问题只能留在 AI 上下文中，会话压缩后即丢失。

新增 `suspected_issues` 参数（`proofreadAccumulate` 支持）：

- AI 可将**未确认的问题**单独累加到 `suspected_issues`（而非 `issues`）
- 报告中单独列出「⚠️ 待确认问题」节，标注「未修改，请人工核对」
- **不纳入五维评分**，仅作提示，避免误报影响报告可信度
- 即使没有确认问题（`issues` 为空），只要存在疑似问题，报告仍列出该节

### 适用场景

- 长文档（100+ 段落）的错别字/语病检查
- 合同/公文/学术文档的格式一致性校对
- 批量校对 + 批量修正（铁律 3.0 确保每批严格闭环）

> 📖 校对技术设计细节见 [proofread-fluency-conciseness-design.md](./proofread-fluency-conciseness-design.md)；治理插件实现见 [AGENTS.md](../AGENTS.md) 与 `.opencode/plugins/governance.js`。

> ℹ️ P1-P16 共 16 条规则，表格中 P2-P3/P4-P7/P8-P10 为编号合并展示，实际每条规则均独立在 `governance.js` 实现。本次重构（Issue #151）在单 agent 逐批校对基础上，新增 **P19/P20/P21** 以支持「规划/管理/执行/报告」4-subagent 并行协同（详见下文「校对 Subagent 组协同」）。

### 校对 Subagent 组协同（Issue #151 重构）

> 针对大文档校对耗时过长、单 agent 上下文易压缩中断、统计易失真等问题，校对流程重构为**「规划 → 管理 → 执行(并行≤3) → 报告」4 个 subagent 协同**架构（定义见 `agents/`），由**规划 subagent 自动编排调度**，无插件 UI 分流。架构细节见 [PROOFREAD_SUBAGENTS.md](./PROOFREAD_SUBAGENTS.md)。

| subagent | 职责 | 接触正文 |
|----------|------|---------|
| **规划 planner** | 一次性产出分批计划 + 生成唯一 `session_id` + 登记批次分配表 | 否 |
| **管理 manager** | 调度执行 subagent（并行≤3）、监督逐步凭证落盘、断点续跑、归并 | 否 |
| **执行 executor**（×3 可并行） | 专职逐批校对**独立段落区间**，走完整步骤链并逐步落盘凭证 | 是 |
| **报告 reporter** | 从磁盘 session 归并真实数据生成五维报告，交叉校验 + 疑似缺失告警 | 否 |

**四大核心机制**：
1. **批次分配表落盘**：规划 agent 登记 `{batch_id, 段落区间, 状态}` 到磁盘 session，管理 agent 据此调度，断点续跑只重派非 done 批次（P19 归属越界拦截 + P21 并行区间重叠检测）。
2. **逐步凭证落盘（防幻觉）**：执行 agent 每批携带 `_batch_id` + `_steps_log`（6 步凭证），管理 agent 对照标准步骤链核对缺步即重派；governance **P20** 拦截「带 `_batch_id` 却缺非空 `_steps_log`」。
3. **并行隔离**：执行 agent 只修自己区间（`replaceInParagraph` 按 paragraphIndex 隔离），规避 WPS 单进程 COM 并发修订冲突；并行度 ≤3（P21 校验）。
4. **统计准确优先**：报告从磁盘 session 归并真实 issue 数据（不以 AI 上下文中间态为准），批次完整性 + 修订数交叉校验，疑似缺失/未完成标注告警而非静默。
