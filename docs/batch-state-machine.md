# 分批处理状态机 — 设计规范（设计模式沉淀）

> **关联 Issue**: [#229](https://cnb.cool/lnxsun/opencode-wps/-/issues/229)（分批校对执行极不稳定整改）
> **关联 PR**: [#230](https://cnb.cool/lnxsun/opencode-wps/-/pulls/230)（分批校对稳定性整改）
> **定位**: 内部参考 / 设计模式沉淀
> **目的**: 把分批校对状态机在 Issue #229 整改中踩过的坑固化下来，作为后续新批处理功能（分批翻译、分批导出、分批格式化等）的**参考模板**，避免重复踩坑。
> **状态**: 已落地（随 v1.9.14 发布）

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [什么是分批处理状态机](#2-什么是分批处理状态机)
3. [状态定义](#3-状态定义)
4. [状态转换规则](#4-状态转换规则)
5. [失败处理：避免死锁](#5-失败处理避免死锁)
6. [边界校验：以请求参数为准](#6-边界校验以请求参数为准)
7. [作用域隔离：按业务单元](#7-作用域隔离按业务单元)
8. [三态设计：解析失败视为未知](#8-三态设计解析失败视为未知)
9. [治理规则全景（P 规则）](#9-治理规则全景p-规则)
10. [通用设计清单（新工具自查表）](#10-通用设计清单新工具自查表)
11. [与现有文档的关系](#11-与现有文档的关系)

---

## 1. 背景与动机

分批校对（`wps-proofread` Skill）在真实使用中暴露出**执行极不稳定、不能按分批从头到尾严格执行**的问题。根因是治理层状态机在设计时**没有系统考虑失败路径**，导致批次中途失败即死锁、输出截断导致静默漏检、多文档状态互相污染等一系列连锁问题。

本次整改（Issue #229）经**多轮评审-修复循环**才将全部问题清零。这些经验不应随代码合入而消散，而应固化为**可复用的设计模式**——这就是本文档的定位：**给未来任何分批处理类功能做状态机设计的规范参考**。

本文档是对实际代码（`.opencode/plugins/governance.js` + `wps-office-mcp/src/tools/word/proofread-store.ts`）的**如实沉淀**，非凭空设计。

---

## 2. 什么是分批处理状态机

分批处理（batch processing）指把大文档/大数据集按固定大小切成若干批次（batch），逐批串行（或受限并行）处理、逐步推进的流程。其状态机负责：

- 追踪**当前进度**（处理到哪个批次、哪一段）
- 校验**步骤顺序**（禁止跳步、禁止越界）
- 处理**失败路径**（重试 / 回退 / 重置，避免死锁）
- 保证**完整覆盖**（不漏批、不漏段，能判定「全文已覆盖」）

分批校对的标准步骤链（与 `proofread-store.ts` 的 `PROOFREAD_STEP_CHAIN` 一致）：

```
getDocumentParagraphs   →  getDocumentTextByRange   →  proofreadBasic
→  confirmBatchAiProofread   →  replaceInParagraph   →  proofreadAccumulate
```

治理层在 OpenCode 插件钩子（`tool.execute.before` / `after`）中，对每个工具调用实施 **P 规则校验**，构成一张「状态 × 动作」的转移表。

---

## 3. 状态定义

治理层为每个会话维护一份 `SessionState`（见 `getSessionState`）。与分批推进相关的核心字段及其语义：

| 状态字段 | 含义 | 归属 |
|----------|------|------|
| `batchStarted` | 是否已开始分批（首批 getDocumentParagraphs 后置 true） | 会话级 |
| `batchCount` | 已启动的批次数 | 会话级 |
| `batchStartParaIndex` / `lastBatchParaIndex` | 本批/已处理到的最末段落号（连续性校验基准） | 会话级 |
| `batchStartOffset` / `batchEndOffset` | 本批段落的字符起止偏移（文本范围校验） | 会话级 |
| `batchRequestedStart` / `batchRequestedEnd` | **本批实际请求**的段落范围（同批重试判据） | 会话级 |
| `batchTruncated` | 本批 getDocumentParagraphs 输出是否被截断 | 会话级 |
| `batchRetryCount` | 同批重试次数（≤ `MAX_BATCH_RETRY_LIMIT`） | 会话级 |
| `proofreadCalledThisBatch` | 本批是否已调 proofreadBasic | 会话级 |
| `aiProofreadDoneThisBatch` | 本批是否已确认 AI 校对 | 会话级 |
| `replaceCalledThisBatch` / `replaceCountThisBatch` | 本批替换状态 | 会话级 |
| `proofreadHadIssues` | 本批基础校对是否有问题（**三态**：true/false/null） | 会话级 |
| `proofreadIssueOriginals` | 本批发现的问题原文列表（P16 交叉校验） | 会话级 |
| `totalParagraphs` | 文档总段数（getActiveDocument 解析） | 会话级 |
| `allBatchesComplete` | 是否已覆盖全文 | 会话级 |
| `maxReportedParagraph` / `fullCoverageReached` | 覆盖推进追踪（P23/P24） | 会话级 |
| `activeDocPath` | 当前活动文档路径（文档切换自动重置） | 会话级 |
| `assignedRanges` / `registeredRanges` | 并行模式下各执行 agent 的区间（按批次隔离） | 会话级 |

> **批次（batch）级 vs 会话（session）级**：串行模式下批次状态是会话级的单值；并行模式（携带 `_batch_id`）下，会话级单值会被各执行 agent 互相覆盖，故由 `assignedRanges[batchId]` 按批次隔离 + `_steps_log` 凭证校验承担正确性（见第 7 节）。

---

## 4. 状态转换规则

分批校对的状态推进**必须严格按步骤链顺序**，治理层以 P 规则强制：

| 前置状态 | 动作 | 迁移条件 | 迁移后状态 | 规则 |
|----------|------|----------|-----------|------|
| 未开始 | `getActiveDocument` | 解析 `totalParagraphs` | 获得总段数 | P3 前置 |
| 未开始 | `getDocumentParagraphs` | 首次必须从第 1 段起，≤200 段 | `batchStarted=true`, `batchCount=1` | P1/P2 |
| 批推进中 | `getDocumentParagraphs` | 连续（start = lastBatchParaIndex+1）| `batchStarted`, `batchCount++` | P2/P12 |
| 批推进中 | `getDocumentParagraphs` | 同批重试（见第 5 节）| 重置本批校对子状态 | P2/P12/P18 放行 |
| 批推进中 | `proofreadBasic` | 已 batchStarted；startOffset 匹配本批 | `proofreadCalledThisBatch=true` | P3/P5/P8/P9/P6b |
| 批推进中 | `confirmBatchAiProofread` | 必须先 proofreadBasic | `aiProofreadDoneThisBatch=true` | P14 |
| 批推进中 | `replaceInParagraph` | 必须先 proofreadBasic + confirm | `replaceCalledThisBatch=true` | P11/P15/P16 |
| 批推进中 | `proofreadAccumulate` | 上报 `_processed_to_paragraph`；首次强制 doc_info | `maxReportedParagraph` 推进 | P22/P23 |
| 覆盖全文 | 下一批 | `allBatchesComplete=true` 后禁止推进 | 强制收尾 | P24 |
| 覆盖全文 | `generateProofreadReport` | 覆盖判定通过 | `reportGenerated=true` | P24/P17 |
| 任意 | `getActiveDocument(_restart:true)` 或切换文档 | 显式重置 / 路径变化 | 全部状态重置 | resetProofreadState |

**关键设计**：每一步的「前置条件」都在 `before` 钩子校验（提前拦截），状态写入在 `after` 钩子完成。这样任何非法跳步在动作执行前即被阻断。

---

## 5. 失败处理：避免死锁

这是本整改**最核心**的经验。第一批设计（v1.9.13 及以前）在「批次中途某步骤失败」时**无任何重试路径**，直接死锁。

### 5.1 死锁场景（原问题）

```
getDocumentParagraphs(101,200)  → 成功，lastBatchParaIndex=200
getDocumentTextByRange          → 成功
proofreadBasic                  → 失败（COM 超时 / isError）
```

此时治理层状态：`batchStarted=true`、`lastBatchParaIndex=200`、`proofreadCalledThisBatch=false`。

| 尝试 | 结果 | 原因 |
|------|------|------|
| 重试同批（start=101） | ❌ 拦截 | P2 要求 start = lastBatchParaIndex+1，101 ≠ 201 |
| 获取下一批（start=201） | ❌ 拦截 | P12 要求当前批完成 |
| 回卷重扫（start=1） | ❌ 拦截 | P18 禁止回卷 |
| 唯一出路 `getActiveDocument` 重置 | ⚠️ 代价大 | **已处理的全部批次进度丢失** |

### 5.2 修复方案（批内重试）

**核心思路：允许「同批重试」**。当请求范围与本批实际请求范围一致时，视为「重试同批」，放行 P2/P12/P18 的连续性/回卷检查。

```js
// MAX_BATCH_RETRY_LIMIT = 3
const batchNotCompleted = !st.proofreadCalledThisBatch || st.batchTruncated === true;
const retryingSameBatch =
  !isParallelBatch &&
  st.batchRequestedStart != null &&       // 首次调用时为 null，不算重试
  batchStartArg === st.batchRequestedStart &&
  batchEndArg === st.batchRequestedEnd &&
  batchNotCompleted &&                    // 本批未完成（未调 proofreadBasic 或输出被截断）
  (st.batchRetryCount || 0) < MAX_BATCH_RETRY_LIMIT;
```

- 首次调用时 `batchRequestedStart` 为 `null`，不算重试。
- 重试成功则 `batchRetryCount` 递增；重试成功后新批次重置该计数。
- **重试上限 3 次**，防 AI 无限循环。
- 重试同批时**局部重置本批的校对子状态**（清零 `proofreadCalledThisBatch`/`aiProofreadDoneThisBatch`/`replaceCountThisBatch`/`proofreadHadIssues` 等），**保留批次进度字段**（`lastBatchParaIndex`/`batchCount`/`batchStartOffset` 等），保证可重新走完整步骤链且不丢已处理批次进度。注意：**不可调用完整的 `resetProofreadState`**（它会连批次进度一起清零，反而破坏批次推进）。

### 5.3 通用失败处理清单（新工具必查）

1. **每批的每个步骤失败，都要有重试路径**，不能只靠「重置全局」。
2. **重试要有上限**（`MAX_BATCH_RETRY_LIMIT`），防止死循环。
3. **重试成功后要重置本批子状态**，保证步骤链可完整重走。
4. **超时/失败的 after hook 不执行**时，before hook 的连续性校验不应因此误拦**同参数重试**。

---

## 6. 边界校验：以请求参数为准

### 6.1 问题：输出截断导致状态错乱

`getDocumentParagraphs` 返回每段完整文本拼成的长输出，易被 MCP 截断。原设计用 `parseParagraphRanges(outText)` 的**末段**当 `lastBatchParaIndex` 和 `batchEndOffset`：

```
请求 getDocumentParagraphs(1,100) → 输出只到段落 80（截断）
  → lastBatchParaIndex = 80（截断处）
  → batchEndOffset = 段落 80 的 end（如 7999），而非段落 100 的 end（9999）
后果：段落 81-100 被静默漏检，且 P6b 文本长度校验基于偏小 offset 误判。
```

### 6.2 修复方案：批次边界以请求参数为准

- `lastBatchParaIndex` 按**请求的 `end_paragraph`** 记录（保连续性）。
- 记录 `batchRequestedStart` / `batchRequestedEnd`（请求范围），供同批重试判据。
- 当输出返回段数 < 请求段数时置 `batchTruncated=true`，**提示 AI 先同批重试补齐段落后再校对**，杜绝静默漏检。
- `batchEndOffset` 在输出不完整时回退为输出末段 end，并配合 `batchTruncated` 让 P6b 提示文本不足，双重保险。

### 6.3 边界校验核心原则

> **凡是「本批范围」的判定，一律以请求参数为准，绝不信任输出截断处。**
> 输出只作为「是否完整」的辅助信号（`batchTruncated`），不作为范围依据。

---

## 7. 作用域隔离：按业务单元

### 7.1 问题：会话状态作用域过宽

原设计状态按 **OpenCode 会话 ID**（`input.sessionID`）存储，导致：

- 同一对话校对**多个文档**时，各文档的批次进度互相污染（P18 误拦「回卷」）。
- `MAX_SESSIONS=50` 用 **FIFO** 淘汰，进行中的校对会话可能被新会话挤掉，**批次状态突然丢失**。

### 7.2 修复方案：文档隔离 + LRU 淘汰

1. **文档切换自动重置**：`getSessionState` 记录 `activeDocPath`，调用 `getActiveDocument` 时检测路径变化；切换到新文档 → `resetProofreadState` 完整重置全部校对/模板状态。`_restart:true` 显式重置同一文档进度。
2. **LRU 淘汰**：`MAX_SESSIONS` 满时淘汰**最久未访问**的会话（`lastAccessTime`），而非最旧的，保护进行中的校对会话。
3. **并行区间按批次隔离**：并行模式下用 `assignedRanges[batchId]`（按 `_batch_id` 隔离区间）+ `registeredRanges`（检测不同批次区间重叠），取代会话级单值，避免多执行 agent 互相覆盖。

### 7.3 通用原则

> **状态应绑定到「业务单元」（文档 / 数据集），而不是粗粒度的「对话 / 会话」。**
> 业务单元切换时必须能干净重置；容量淘汰策略应优先保护「进行中的业务单元」而非「最旧的」。

---

## 8. 三态设计：解析失败视为未知

### 8.1 问题：JSON 解析失败被当作「无问题」

`proofreadBasic` 返回「文本展示 + 末尾 JSON 行」。原设计 `proofreadHadIssues` 初始为 `false`，解析失败时保持 `false`：

- **P15** 限制：无 issue 时 AI 最多修复 1 处（需要 `_force_ai_fix`）→ 合法修复被限流。
- **P16** 失效：`proofreadIssueOriginals` 为空 → 交叉校验完全失效。

### 8.2 修复方案：三态布尔

```js
proofreadHadIssues: null   // null = 未知，true = 有问题，false = 无问题
```

- 解析成功 → `true` / `false`（按 `issues.length`）。
- **解析失败 → 保持 `null`（未知）**，而非 `false`。
- P15/P16 仅在 `proofreadHadIssues` 为明确的 `true`/`false` 时启用；为 `null` 时**不误拦**，但引导 AI 重新确认。

### 8.3 通用原则

> **外部数据解析失败应视为「未知」而非「无/空」。**「没解析到」≠「不存在」。
> 三态（true/false/null）比二态（true/false）更安全，能避免把「解析错误」误判为「业务上的否定结果」。

---

## 9. 治理规则全景（P 规则）

以下为分批校对涉及的核心 P 规则全景（完整列表见 `docs/FEATURES.md` 大文档校对一节）：

| 规则 | 作用 |
|------|------|
| P1/P2 | getDocumentParagraphs 首段从 1 起、单批 ≤200 段、批次连续 |
| P3/P5/P8/P9 | proofreadBasic 前置（已 getActiveDocument、startOffset 匹配本批） |
| P6b | proofreadBasic 文本长度 ≤ 本批范围×2（防一次校多批） |
| P12 | 当前批未完成禁止获取下一批 |
| P13 | getDocumentTextByRange 限本批范围 |
| P14 | confirmBatchAiProofread 必须先后 proofreadBasic |
| P15 | 无 issue 时禁止 AI 大量自行修复（`_force_ai_fix` 可强制） |
| P16 | 替换内容与已知 issue 原文交叉校验（防乱改） |
| P17 | 禁止 AI 手动 write 伪造校对报告 |
| P18 | 禁止回卷重复扫描已处理段落 |
| P19-P21 | 并行批次归属 / 凭证落盘 / 区间重叠检测 |
| P22 | proofreadAccumulate 必须上报 `_processed_to_paragraph` |
| P23 | 首次 proofreadAccumulate 强制 doc_info + 覆盖追踪 |
| P24 | 覆盖全文后强制生成收尾报告 |
| P25 | `_processed_to_paragraph` 不得超过本批实际返回末段（`batchActualEndParaIndex`，防假进度） |
| P25b | `_processed_to_paragraph` 不得回退（会话内单调推进，防重复上报旧批次） |
| P26 | issue `paragraphIndex` 必须落在当前批窗口（`batchActualStartParaIndex .. batchActualEndParaIndex`，防陈旧 issue 填充） |
| P27 | proofreadAccumulate 前必须先调 proofreadBasic，且未获取批次段落即上报进度同样拦截（防只视觉扫描/防不获取段落伪造整篇进度）；仅首次规划登记豁免，伪造 `_batch_allocations` 无法绕过 |
| P28 | 进度必须逐批连续推进（跳变 ≤ 200 段/批，防跳跃式假进度）；仅串行模式生效 |

---

## 10. 通用设计清单（新工具自查表）

新增任何**分批处理类功能**时，逐条对照此清单：

- [ ] **1. 状态定义**：是否清晰区分「业务单元级 / 批次级 / 步骤级」状态？
- [ ] **2. 步骤顺序**：是否用明确步骤链（Step Chain）强制顺序，禁止跳步？
- [ ] **3. 失败路径**：批次中途任一步骤失败，是否有**同批重试**路径，而非只能全局重置？
- [ ] **4. 重试上限**：重试是否设上限（如 3 次）防死循环？
- [ ] **5. 重试重置**：重试成功后是否重置本批子状态，保证可完整重走步骤链？
- [ ] **6. 边界依据**：批次范围是否**以请求参数为准**，而非输出截断处？
- [ ] **7. 截断检测**：输出截断是否被检测并标记（如 `batchTruncated`），提示补齐而非静默漏检？
- [ ] **8. 作用域隔离**：状态是否绑定业务单元（文档/数据集），切换时能否干净重置？
- [ ] **9. 容量淘汰**：会话/缓存满时是否保护「进行中业务单元」（LRU）而非无脑淘汰最旧？
- [ ] **10. 三态设计**：外部数据解析失败是否视为「未知」而非「无/空」？
- [ ] **11. 完整覆盖**：能否判定「已覆盖全部业务单元」，并在覆盖后强制收尾（报告/汇总）？
- [ ] **12. 凭证防伪**：并行/多智能体场景是否有步骤凭证落盘，防止编造执行记录？

---

## 11. 与现有文档的关系

| 文档 | 关系 |
|------|------|
| [FEATURES.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/FEATURES.md) | 校对功能使用说明 + P 规则表格（本规范对应的实现） |
| [proofread-fluency-conciseness-design.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/proofread-fluency-conciseness-design.md) | 校对评分/算法技术设计（本规范侧重点在**流程状态机**） |
| [SKILLS.md](https://cnb.cool/lnxsun/opencode-wps/-/blob/main/docs/SKILLS.md) | Skills 能力说明 |
| `skills/wps-proofread/SKILL.md` | 分批校对操作手册（随 Issue #229 补充了同批重试/批次边界/三态/总段数兜底语义） |

> 本文档是**设计模式参考**，不是功能使用手册；功能用法见 FEATURES.md，操作步骤见 wps-proofread Skill。
