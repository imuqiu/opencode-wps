# 文档校对 Subagent 组架构（Issue #151）

> ## ⚠️ 已弃用（Issue #179 阶段4）
>
> 本文档描述的 4-subagent 编排（规划/管理/执行/报告）**已被放弃**。
> 真实会话实证：opencode 的 subagent 触发依赖 LLM 自觉，**不可靠**（4 个 subagent 从未被触发、
> 批次表从未登记、防幻觉门禁全部失效）。
>
> 现行方案（Issue #179 落地）：**单 agent 顺序执行标准步骤链 + 服务端强制**——
> 分批由 `proofreadAccumulate` 首次初始化自动完成（`generateAutoBatches`，批次表永远非空）、
> 进度严格递增校验、报告完整性硬门禁。详见 `skills/wps-proofread/SKILL.md`「校对执行模型」节。
>
> 以下内容仅作历史存档。

---

# （历史存档）文档校对 Subagent 组架构（Issue #151）

> 本文档说明 WPS 文档校对重构为「规划/管理/执行/报告」4 个 subagent 协同的架构设计。
> 这是校对能力的核心改造，解决分批不稳定、中途中断、上下文超限、统计不准、假装校对、耗时长六大问题。

## 背景与痛点

文档校对功能经过长时间积累已较成熟，但存在执行不稳定问题：

| # | 痛点 | 根因 |
|---|------|------|
| 1 | 不按分批校对 | 批次发起/续接全压单 agent 自主执行 |
| 2 | 校对中途结束 | 单 agent 上下文撑不住大文档 |
| 3 | 上下文超限压缩 | 规划+管理+执行+报告全压一个 agent |
| 4 | 成果统计不全/不准 | 累加依赖单 agent 全程正确调用 |
| 5 | 假装批量校对 | AI 可绕过视觉校验 |
| 6 | 大文档耗时过长 | 单 agent 串行逐批 |

## 目标架构

```
planner(规划) → manager(管理) → executor×3(执行,并行) → reporter(报告)
```

由**规划 subagent 自动编排调度**（无插件 UI 分流，改动面最小）。

## 4 个 subagent

| subagent | 定义文件 | 职责 | 接触正文 |
|----------|---------|------|---------|
| 规划 planner | `agents/wps-proofread-planner.md` | 分批计划 + 唯一 session_id + 登记分配表 | 否 |
| 管理 manager | `agents/wps-proofread-manager.md` | 调度≤3并行、监督逐步落盘、断点续跑、归并 | 否 |
| 执行 executor | `agents/wps-proofread-executor.md` | 专职逐批校对独立区间，走完整步骤链 | 是 |
| 报告 reporter | `agents/wps-proofread-reporter.md` | 归并生成五维报告 + 交叉校验 | 否 |

## 关键设计决策（用户确认）

| 决策 | 值 |
|------|-----|
| 并行度 | ≤3（WPS 单进程 COM 约束） |
| 单 agent 串行兜底 | **不保留**（靠重派+断点续跑替代） |
| 报告 | **统计准确优先**，保留五维，强化校验 |
| 调用入口 | 规划 agent 自动编排（无插件 UI 改动） |
| 进度可恢复 | 需要；管理 agent 监督每步逐一落盘，防幻觉 |

## 核心机制

### 1. 批次分配表落盘（proofread-store 扩展）

- 规划 agent 一次性生成分批计划 → 通过 `proofreadAccumulate` 的 `_batch_allocations` 参数登记批次分配表到磁盘 session（R3-2）。
- 管理 agent 据分配表调度，断点续跑时只重派非 done 批次；`getIncompleteBatches` 未完成定义扩展为「非 done」或「done 但步骤凭证不完整」（R7-1，防谎报 done 被跳过）。
- `saveSessionToDisk` 写盘时合并保留既有 batchAllocations，避免被 session 覆盖清空（R3-1）。

### 2. 逐步执行凭证落盘（防幻觉核心）

- 每个执行 agent 在校对完成批次时，于 `proofreadAccumulate` 携带 `_batch_id` + `_steps_log`（本批 6 步凭证），服务端 `appendStepRecord` 落盘到批次 stepsLog（R3-1 打通链路）。
- 管理 agent 对照标准步骤链核对，缺任一步即判定该批未完成并重新派发（读磁盘 session JSON 核对）。
- governance P20 拦截：携带 `_batch_id` 必须携带**非空** `_steps_log`（R8-2 防空凭证绕过）。

### 3. 并行隔离（governance P19/P21）

- 每个执行 agent 只处理独立段落区间（P19 归属越界拦截；区间按 batchId 隔离登记，R4-1 防多 executor 串扰）。
- 同一会话内并行执行 agent 区间不得重叠（P21 重叠检测）。
- 报告生成调用 `hasParallelRangeConflict` 作为并行区间冲突的最终防线（R4-2）。
- **并行门控（R1-2）**：执行 agent 携带 `_batch_id` 时进入并行模式，**跳过旧 P1/P2/P12/P18 会话级单值连续性校验**（这些在并行多执行 agent 下会被互相覆盖而误拦截），改由 P19 `_batch_range` 区间隔离承担正确校验；proofreadBasic/getDocumentTextByRange/confirmBatchAiProofread/replaceInParagraph 的会话级单值校验同步加 `isParallelBatch` 门控。
- **并行度超限提示（R11-2）**：报告统计 running 批次数，>3（WPS 单进程 COM 约束）时提示「⚠️ 并行度超限」。

### 4. 统计准确优先（report 强化校验）

- 报告从磁盘 session 归并真实数据。
- 批次完整性校验：存在未完成批次标注「⚠️ 仍有 N 批未完成」——**复用 `getIncompleteBatches` 语义**（`status !== done` 或 done 但凭证不完整均算未完成，R2-3）。
- 交叉校验：issue 数 vs 修订记录数（保守上界 = totalRevisions，每条 issue 至少 1 条修订，R1-1/R2-1），疑似缺失告警。
- **交叉校验反向提示（R7-1）**：修订数 > 3×issue 数时提示「⚠️ 疑似未记录修复」（可能存在未累加的修复或非校对修订）。
- 批次区间覆盖完整性校验：未连续覆盖文档时标注「⚠️ 批次区间未覆盖完整」及缺口段落（R6-1）。
- **批次区间重叠检测（R8-2）**：不论批次状态，区间相交时提示「⚠️ 批次区间重叠」。
- **批次区间超出总段数（R10-3）**：批次 end > 文档总段数时提示规划 agent 多登记。
- 批次分配表为空时提示「⚠️ 未检测到批次分配表」（R10-2）。
- 并行 running 批次区间相交时标注「⚠️ 并行区间冲突」（R4-2）。
- **docInfo 字段兜底（R10-2）**：fileName/filePath 缺失时显示「未知」，totalParagraphs/totalWords 缺失时显示 0，杜绝 undefined。

### 5. 批次状态机与健壮性（R3-2/R6-1/R8-1/R11-1）

- **批次状态机（R3-2/R6-1）**：`updateBatchStatus` 约束合法转换 `pending→running→done`、任意→`failed`、`failed`/`running`/`done`→`pending`（重派）；拒绝 `pending→done`（跳过执行直接完成）。特别地，`done→pending` 合法（R6-1），使「done 但凭证不完整」的批次能回退重派，与 `getIncompleteBatches` 防幻觉机制协同，消除死锁。
- **批次区间合法性/重叠校验（R8-1）**：`saveBatchAllocations` 规划阶段拒绝非法区间（start<1 或 end<start）与批次间区间重叠，提前拦截带病调度。
- **步骤名 trim（R11-1）**：P20 校验、`appendStepRecord` 落盘、`getMissingSteps`/`getIncompleteBatches` 判定均对步骤名 `trim()`，避免带空白步骤名被误拦/误判缺失。
- **凭证提交失败文案（R10-1）**：批次分配表登记失败时提示「批次区间非法/重叠，或存储不可写」，区分原因。

### 6. 报告硬性完整性门禁 + 进度追踪（Issue #151 遗留问题彻底修复）

> 这是对原方案关键缺口的修复：此前批次完整性/覆盖校验在报告生成时**仅告警不阻塞**，且全部依赖 AI 自愿传 `_batch_id`/`_batch_allocations`（opt-in），导致实际跑校对时 AI 可绕过——未跑完全文就调用 `generateProofreadReport`，服务端照样 `success=true`，AI 便"假装已完成"并匆忙交付报告。

**修复机制（服务端强制、非 opt-in）：**

- **进度追踪**：`proofreadAccumulate` 每次必须上报 `_processed_to_paragraph`（本批已校对到的最末段落），服务端在 session 记录 `progress.processedToParagraph`（取各批最大值，兼容并行）。治理 **P22** 强制校验（规划初始化登记豁免），缺此字段直接拦截。
- **报告硬门禁（`generateProofreadReport`）**：以下任一未满足则**拒绝生成报告**（`success=false` + 明确错误），而非仅打告警：
  ① 编排模式（批次分配表已登记）：全部批次 `done` 且凭证完整 + 区间覆盖全文（无缺口/超界/重叠）；
  ② 串行模式（无批次表）：`progress.processedToParagraph >= docInfo.totalParagraphs`；
  ③ 两者皆无进度依据（历史会话）：保留原告警放行，不误伤既有合法串行流程。

**效果**：AI 无法再"中途结束就假装完成"、无法跳过段落漏校、无法在未覆盖全文前匆忙生成报告——服务端会在报告阶段强制拦截并要求补齐。

> **已知边界（评审第 2 轮）**：串行模式下的进度门禁依赖治理 P12/P18 强制顺序推进（必须先完成本批 proofread 周期才能获取下一批），能拦截"中途停止/跳过中段"；极端"仅跳最后一批"场景（先 proofread 到 N-1，最后一批只 getDocumentParagraphs 不 proofread 就报 progress=N）仍有残余可能。**完整闭环路径是编排模式（登记批次分配表 + 逐步凭证落盘）**——`getIncompleteBatches` 按批次校验 done+凭证完整，任一最后批次被跳也会被拦截。建议大文档一律走编排模式。

## 涉及文件

| 文件 | 操作 |
|------|------|
| `agents/wps-proofread-planner.md` | ➕ |
| `agents/wps-proofread-manager.md` | ➕ |
| `agents/wps-proofread-executor.md` | ➕ |
| `agents/wps-proofread-reporter.md` | ➕ |
| `skills/wps-proofread/SKILL.md` | ✏️ 编排章节 |
| `.opencode/plugins/governance.js` | ✏️ P19/P20/P21 |
| `wps-office-mcp/src/tools/word/proofread-store.ts` | ✏️ 批次分配+逐步凭证 |
| `wps-office-mcp/src/tools/word/proofread-report.ts` | ✏️ 校验+告警 |
| `docs/PROOFREAD_SUBAGENTS.md` | ➕ 本文档 |
| `docs/README.md` | ✏️ 索引 |

## 相关文档

- [校对通顺度/简洁度设计](./proofread-fluency-conciseness-design.md)
- [Skills 文档](./SKILLS.md)
