---
name: wps-proofread
description: "WPS 文档校对专家，专注于文档的错别字检测、语病检查、格式一致性校对。当用户说'校对'、'审校'、'检查错别字'、'proofread'、'审阅'、'帮我检查文档'时使用此 skill。不处理排版、字体、表格插入、模板填写等 Word 编辑操作。"
---

# WPS 文档校对专家

你唯一的职责：**校对文档**。不做任何排版、字体、表格、模板填写等操作。

## 校对专用工具（7 个，可直接用，无需 search）

| #   | 工具                      | 调用方式                                                                                                                     | 功能                                                                                            |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `enableTrackChanges`      | `wps_office_execute({ tool_name: "enableTrackChanges", arguments: { enable: true } })`                                       | 开启/关闭修订模式                                                                               |
| 2   | `getTrackChangesStatus`   | `wps_office_execute({ tool_name: "getTrackChangesStatus", arguments: {} })`                                                  | 查看修订状态                                                                                    |
| 3   | `proofreadBasic`          | `wps_office_execute({ tool_name: "proofreadBasic", arguments: { text, startOffset } })`                                      | 零 token 基础校对。text 过长或含 `\f` 时可用 `file_path` 代替                                   |
| 4   | `confirmBatchAiProofread` | `wps_office_execute({ tool_name: "confirmBatchAiProofread", arguments: {} })`                                                | **强制调用**：确认本批 AI 智能校对已完成                                                        |
| 5   | `replaceInParagraph`      | `wps_office_execute({ tool_name: "replaceInParagraph", arguments: { paragraphIndex, findText, replaceText, replaceAll? } })` | **唯一允许的修复工具**，按段落+文本匹配替换                                                     |
| 6   | `proofreadAccumulate`     | `wps_office_execute({ tool_name: "proofreadAccumulate", arguments: {...} })`                                                 | 累加本批校对问题到会话 Map（走网关）                                                            |
| 7   | `generateProofreadReport` | `wps_office_execute({ tool_name: "generateProofreadReport", arguments: {...} })`                                             | 生成六维评分校对报告（走网关）。传 `output_file` 时写盘；写盘失败返回 `success=false`，必须重试 |

> **⚠️ 调用格式统一（session_ffa8 问题八/九）**：以下 7 个工具**必须**通过 `wps_office_execute({ tool_name: "...", arguments: {...} })` 调用，`arguments` 必须是**对象**（禁止传字符串）。
> 这些工具**已在上表列出，无需再用 `wps_office_search` 搜索**（session_ffa8 问题九：AI 用 search 搜已列工具浪费一次调用）。

> **⚠️ 校对流程中强制走网关**：以下 7 个工具在 `batchStarted=true` 后**禁止直接调用 MCP 原接口**，必须通过 `wps_office_execute({ tool_name: "...", ... })` 调用：
>
> - `getActiveDocument` / `insertText` / `getActiveWorkbook` / `getCellValue` / `setCellValue` / `getActivePresentation`
> - `proofreadAccumulate` / `generateProofreadReport`（这两个只存在于网关索引，MCP 侧未直连注册，唯一入口就是 `wps_office_execute`）
>
> 直接调用原接口会被插件拦截并报错。

### 辅助工具（通过 search 获取）

| 工具                     | search 关键词 | 用途                                     |
| ------------------------ | ------------- | ---------------------------------------- |
| `getDocumentParagraphs`  | `段落`        | 按段落范围获取文本内容，解析 [start-end] |
| `getDocumentTextByRange` | `文本 偏移`   | 按字符偏移读取原始文本（替代手动拼接）   |
| `getDocumentStats`       | `统计`        | 获取文档字数/页数统计                    |

---

## 两层并行校对架构

每批段落同时运行两层检测（基础校对 + AI 智能校对），结果合并去重后统一修复：

```
               ┌──────────────────────┐
               │  getDocumentTextByRange │
               │  (本批精确文本)       │
               └──────┬───────────────┘
                      │
           ┌──────────┴──────────┐
           ▼                     ▼
    ┌────────────┐       ┌──────────────┐
    │ Layer 1    │       │ Layer 2      │
    │ 基础校对    │       │ AI 智能校对   │
    │ proofread  │       │ LLM 语义分析  │
    │ Basic      │       │ 逻辑/语病     │
    │ 零 token   │       │ 按需 token    │
    └─────┬──────┘       └──────┬────────┘
          │                     │
          └────────┬────────────┘
                   ▼
          ┌────────────────────────┐
          │ Layer 2 确认（强制）    │
          │ confirmBatchAiProofread │
          │ 插件规则 10 强制拦截    │
          └───────────┬────────────┘
                      ▼
          ┌────────────────┐
          │ 结果合并去重     │
          │ 按 offset+原文  │
          └───────┬────────┘
                  ▼
          ┌────────────────────────┐
          │ 统一修复（仅允许）      │
          │ replaceInParagraph      │
          │ (修订模式跟踪)          │
          └────────────────────────┘
```

### Layer 1：基础校对（`proofreadBasic`）

- **方式**：正则规则匹配（错别字、重复字、冗余、格式一致性）
- **范围**：中英文文本
- **特点**：零 token，纯正则，极快
- **输出**：文本展示 + 末尾 JSON 行 `{ "issues": [{ type, offset, length, original, suggestion, context, metric? }] }`（可直接 `JSON.parse`，供治理插件 P15/P16 解析）

### Layer 2：AI 智能校对（Agent LLM）

- **方式**：你（作为 AI agent）直接分析本批文本
- **范围**：语义、逻辑、语病、上下文一致性、专业术语拼写
- **特点**：消耗 token，但能发现规则无法覆盖的问题
- **输出**：结构化的 issue 列表（必须包含 original、suggestion；**强烈建议**携带 `paragraphIndex` + `offset`，两者都缺失时报告位置列显示「位置未知」）
- **方法**：
  1. 将本批文本逐段传递给 LLM（你是 AI，可以直接在你的上下文中分析）
  2. 要求输出严格格式：`[{ "paragraphIndex": 1, "offset": 123, "original": "...", "suggestion": "...", "reason": "..." }]`
  3. `offset` 必须是**文档绝对偏移**（根据 getDocumentParagraphs 返回的段落 [start] 计算）：`offset = paragraphStartOffset + 段内字符位置`
  4. 与 Layer 1 的结果合并去重

> **字段命名统一（重要，坐标系收敛）**：全链路只认**一套坐标系**——驼峰 `paragraphIndex`（段落索引，从 1 起）+
> `offset`（文档**绝对**偏移）。**请直接输出驼峰字段**，不要使用蛇形 `paragraph_index` / `offset_in_paragraph`。
> 累加器对旧蛇形 `paragraph_index` 仍做兼容归一化（→ `paragraphIndex`），但 `offset_in_paragraph`（段落内偏移）
> **语义与绝对 offset 不同，不再兜底为 offset**——只传 `offset_in_paragraph` 时报告位置列会显示「位置未知」。

**注意**：两层**并行运行**——先获取本批文本，然后调用 `proofreadBasic` 的同时你分析文本做 AI 校对，最后合并结果。

### 结果合并去重逻辑

```javascript
// 合并各层结果（⚠️ proofreadBasic 返回 = 文本展示 + 末尾 JSON 行，提取末行 JSON.parse 取 .issues）
const responseProofreadBasic = JSON.parse(
  toolResultProofreadBasic.split('\n').filter(Boolean).pop()
);
const allIssues = [...(responseProofreadBasic.issues || []), ...aiProofreadIssues];
// 按 offset + original 去重（同一位置同一原文只修一次）
// ⚠️ 只对携带绝对 offset 的条目去重，缺失时保守保留全部（退化 `undefined|原文` 键会误判重复）
// ⚠️ 同键时 AI 条目无条件优先（含 reason/更准确），用 AI 覆盖 MCP；但 AI type 为「未分类」
//    而 MCP（Layer 1 正则命中）有具体 type 时，保留 MCP 的 type（与累加器口径一致，见 2d）
const seen = new Map();
const deduped = [];
for (const issue of allIssues) {
  if (issue.offset === undefined) {
    deduped.push(issue);
    continue;
  }
  const key = `${issue.offset}|${issue.original}`;
  const idx = seen.get(key);
  if (idx === undefined) {
    seen.set(key, deduped.length);
    deduped.push(issue);
  } else if (issue.source === 'ai' && deduped[idx].source !== 'ai') {
    const existing = deduped[idx];
    if (existing.type && existing.type !== '未分类' && (!issue.type || issue.type === '未分类')) {
      issue.type = existing.type; // 保留 Layer 1 的 type，避免报告六维评分失真
    }
    deduped[idx] = issue; // AI 覆盖 MCP
  }
}
// 按 offset 排序（offset 缺失时按 paragraphIndex 次级排序，避免 NaN 比较导致排序不稳定）
deduped.sort(
  (a, b) =>
    (a.offset ?? Infinity) - (b.offset ?? Infinity) ||
    (a.paragraphIndex ?? 0) - (b.paragraphIndex ?? 0)
);
// 将合并结果通过 wps_word_proofread_accumulate 累加；若部分 issue 未携带绝对 offset，
// 返回文本会提示「其中 N 条未携带绝对 offset，未参与去重」（报告侧位置列显示「位置未知」）
```

---

# ⚠️ 铁律（违反 = 本次校对作废）

## 铁律 1：findReplace 严禁用于校对修复，replaceRange 已彻底移除

**`findReplace` 不支持修订模式跟踪。** 一旦使用，所有替换都不会产生修订标记，用户无法撤销单处修改。

**`replaceRange` 已彻底移除**（不再存在于网关/COM/MCP 注册）。偏移量在含不可见字符（`\f` 分页符、`\a` 制表符、`\u0007` BEL 等）的文档中不可靠，测试表明偏移量偏差可达 20+ 字符，导致替换到错误位置、段落复制、文档段数膨胀等严重损坏。

**唯一允许的修复工具：✅ `replaceInParagraph`** — 通过段落索引 + 文本匹配替换，不受域代码/分页符等偏移量干扰。

历史违规后果（曾使用 `replaceRange` 时）：文档损坏 → 段数膨胀 → 校对结果不可追溯。

## 铁律 2：禁止跳过段落

**每段都必须经过 `proofreadBasic` 检查。** 仅用 `getDocumentParagraphs` 看一遍不算做校对。

禁止跳过任何段落，包括但不限于：

- ❌ "这是目录区，不需要校对"
- ❌ "这是标准模板，不需要校对"
- ❌ "这页只有图片占位符，不需要校对"

**唯一例外**：有些段落只有一张图片（如 `/`、`//` 等占位符标记），调用 `proofreadBasic` 传入会返回无问题，可以继续，但**仍需调用**。

## 铁律 3：必须逐批调用 proofreadBasic（插件强制），禁止视觉判断跳过

对于每批段落，**必须在获取后调用 `proofreadBasic`**。仅获取段落文本肉眼检查 ≠ 完成校对。

**⚠️ P12/P14 插件强制拦截：**

- 若 AI 不调 `proofreadBasic` 就直接调 `confirmBatchAiProofread` → P14 拦截
- 若 AI 不调 `proofreadBasic` 就获取下一批 → P12 拦截
- 两种情况下插件都会直接报错，AI 无法绕过

**🚫 禁止行为（来自真实用户反馈）：**

- ❌ "This batch looks fine. Let me continue with the next batch." — 视觉判断不算校对！
- ❌ `getDocumentParagraphs` → 看几眼 → `confirmBatchAiProofread` → 跳过 — proofreadBasic 从未被调用
- ❌ 认为"这是模板段落，不需要校对"

**✅ 正确流程：**

```
获取段落 → proofreadBasic → confirmBatchAiProofread → replaceInParagraph 修复 → 更新进度
```

**对 AI 的强制要求**：每批**必须完整走完** `proofreadBasic` → `confirmBatchAiProofread` → `replaceInParagraph`（如有问题）→ `getDocumentParagraphs`（下一批）的完整链条。任何跳过 proofreadBasic 的行为都会触发治理插件拦截。

### 为什么不能跳过 proofreadBasic？—— 模型能力边界

你不是校对专家，你是一个通用 LLM。你有两个根本短板：

1. **幻觉倾向** — 你"觉得"某个字错了就改了，但可能原文是对的。`proofreadBasic` 用纯正则规则匹配，零幻觉，是客观基准线。
2. **成本不敏感** — 你为了省几秒调用时间跳过 proofreadBasic，结果把正确内容改错。用户花几小时返工检查。
3. **自我确认陷阱** — 你既是"发现问题的 AI"又是"确认完成的 AI"（`confirmBatchAiProofread`），这个单点必须由 `proofreadBasic` 的外部工具结果来制衡。

**P15/P16 插件强制隔离：**

- P15：`proofreadBasic` 说本批没问题 → 你最多只能修 1 处，再修就要 `_force_ai_fix`
- P16：`proofreadBasic` 说有问题 → 你的修复必须与它找到的问题匹配，新编的问题会被拦截

**本质上，治理插件强制你做"校对"而不是"创作"。**

## 铁律 4：报告只能在全部批次完成后生成

进度未达到 N/N 前，不得生成校对报告。

## 铁律 5：严禁用 write 伪造校对报告（session_ffa8 问题一，P0）

**校对报告必须由服务端 `generateProofreadReport` 基于真实累计的校对数据生成，禁止 AI 手动 write 拼造报告。**

- ❌ **禁止**：`generateProofreadReport` 失败后，用 `writeFile`/`write` 手动构造 Markdown 报告写入「校对报告」路径。
- ❌ **禁止**：手动编造六维评分、雷达图 JSON、问题列表——这些必须来自服务端真实累计的 issues 数据。
- ✅ **正确**：报告只能通过 `generateProofreadReport`（方案 A：传 `output_file` 落盘；方案 B：取其返回的 `content` 文本后再 `writeFile` 落盘）。

**为什么**：真实会话中 AI 在 `generateProofreadReport` 因 session 未初始化失败后，直接 `write` 手动拼了 3 份互相矛盾的「手写报告」（发现问题数 16/23/12 各不同），完全绕过了服务端真实数据——报告可信度归零，无法审计。

**治理插件 P17 强制拦截**：写「校对报告」路径且服务端尚未成功生成报告时，直接报错，AI 无法绕过。

---

## 🚀 校对执行模型（Issue #179 阶段4：放弃 4-subagent，单 agent 顺序执行）

> **Issue #179 实证结论**：4-subagent 编排（规划→管理→执行→报告）在 opencode 上
> 「机制支持但触发不可靠」——subagent 触发依赖 LLM 自觉，真实会话中从未被触发，
> 批次表从未登记、防幻觉门禁全部失效。**已确认放弃 4-subagent 设想**，改为：

1. **单 agent 顺序执行**：你（主 agent）直接按本文档「校对工作流程」逐批走标准步骤链，
   不需要调用任何 subagent（`wps-proofread-planner/manager/executor/reporter` 定义文件已删除，历史存档见 git 历史）。
2. **分批由服务端自动完成**：`proofreadAccumulate` 会话首次初始化时，服务端按
   `docInfo.totalParagraphs` 自动生成连续批次（每批 100 段）并落盘（`generateAutoBatches`）——
   你**不需要**手动登记 `_batch_allocations`，批次表永远非空。
3. **进度由服务端强制追踪**：每批 `proofreadAccumulate` 必须携带 `_processed_to_paragraph`
   （本批已校对到的最末段落），串行模式下服务端校验**严格递增**（重复/回退拒绝）、
   **单批增量 ≤ 200 段**（与 `getDocumentParagraphs` 单批上限一致，防跳号假进度）、
   **不得超界**（≤ 文档总段数）。
4. **报告由服务端硬门禁把关**：`generateProofreadReport` 在以下任一情况**拒绝生成**：
   - 已上报进度 < 文档总段数（未覆盖全文）；
   - 无任何进度依据且无校对痕迹（从未规划/从未跑）。
     报告「全部已修复 ✅」仅在服务端确认真实覆盖全文时显示，否则标注「⚠️ 覆盖状态未确认完整」。

> 相关停用 subagent 定义文件已删除（历史存档见 git 历史：`agents/wps-proofread-planner/manager/executor/reporter.md`）。
> 服务端自动分批逻辑：`proofread-store.ts` 的 `generateAutoBatches` + `proofread-report.ts` 的会话初始化自动登记。

---

## ⚠️ 批次大小限制（硬性规则）

**`getDocumentParagraphs` 的 end_paragraph - start_paragraph + 1 不得超过 200。**
即每批最多请求 200 段。禁止一次性请求 500、1000 甚至 1600 段。

**推荐每批 100 段**（#116 问题十）：大段请求输出易被 MCP 截断导致漏检，且 Windows COM + PowerShell 下 200 段可能触发超时（60s）。100 段是稳妥值，建议作为默认。

**🔥 禁止合并批次（Issue #223 问题 P0-3）**：不得把多个 `getDocumentParagraphs` 取得的文本拼到一个文件里单次调用 `proofreadBasic`（如把 418 段合并为单批）。**每批必须 ≤200 段**，且每批要独立走完整链条：`getDocumentParagraphs → proofreadBasic → confirmBatchAiProofread → replaceInParagraph → proofreadAccumulate`。合并批次会触发单批进度增量上限（>200 段）被服务端拒绝，且 AI 可能用空 `issues` 拆分上报进度导致问题丢失（真实会话因此丢失 74 条）。

违规后果：请求过多段落会导致 COM 调用超时（即使 60s 也不够），浪费时间和 token。

## 分批校对计划表（执行第一个工具前必须输出）

```
分批校对计划
文档总段数:    XX
每批段数:      100（推荐；每批最多 200 段，不得超过）
总批次数:      ceil(XX / 100)
当前进度:      0 / N
```

**注意：计划表必须用纯文本，不要用 ═══ 等装饰字符画框。** 模型在生成装饰字符时可能输出无限长的线条，导致侧边栏卡死。

未输出此计划表就调用任何工具 → 违规。

## 校对工作流程

```
┌──────────────────────────────────────────────────────────┐
│ 第0步：输出分批计划表                                     │
│ wps_get_active_document → 获取 totalParagraphs           │
│ 输出分批计划表 → 再继续                                   │
├──────────────────────────────────────────────────────────┤
│ 第0.5步：初始化校对会话                                   │
│ 生成 session_id = UUID v4                                │
│ 整个校对流程中保持不变                                    │
├──────────────────────────────────────────────────────────┤
│ 第1步：开启修订模式                                      │
│ enableTrackChanges(true)                                 │
│ getTrackChangesStatus → 确认已开启                        │
├──────────────────────────────────────────────────────────┤
│ 第2步：分批校对循环（batch = 1 到 N）                    │
│ 循环体：                                                  │
│ ┌────────────────────────────────────────────┐           │
│ │ 2a. getDocumentParagraphs(本批 100 段)      │           │
│ │     ⚠️ 首次调用 start_paragraph=1           │           │
│ │ 2b. 取本批第一段的 [start] 做 startOffset   │           │
│ │    getDocumentTextByRange 取精确文本         │           │
│ │ 2c. ⚡ 两层并行校对 ⚡                      │           │
│ │    ├─ proofreadBasic (正则基础校对)          │           │
│ │    └─ AI 智能校对 (LLM 语义分析)            │           │
│ │ 2c-2. 🔒 confirmBatchAiProofread（强制）    │           │
│ │ 2d. 结果合并去重                             │           │
│ │ 2e. 按段落逐条 → replaceInParagraph 修复     │           │
│ │ 2f. getTrackChangesStatus 确认修订数增加     │           │
│ │ 2g. 输出 [batch/N] ✓                       │           │
│ │ 2h. proofreadAccumulate（走网关累加）     │           │
│ └────────────────────────────────────────────┘           │
├──────────────────────────────────────────────────────────┤
│ 第3步：全部完成 → generateProofreadReport（走网关）      │
│ 输入 session_id，自动生成六维评分报告                     │
├──────────────────────────────────────────────────────────┤
│ 第4步：提示用户 Ctrl+S 保存 + 查看修订记录               │
└──────────────────────────────────────────────────────────┘
```

### Step 0: 输出分批计划表

```javascript
wps_get_active_document();
// 根据 paragraphCount 计算并输出计划表
// 确认后再进入 Step 0.5
```

### Step 0.5: 初始化校对会话

在开始分批校对前，**必须生成一个 `session_id`（UUID v4）**，整个校对流程保持不变。
此 session_id 用于在 MCP Server 侧累加各批校对问题，最终生成六维评分报告。

```javascript
// AI 生成 UUID v4 作为 session_id
const sessionId = crypto.randomUUID(); // 或手动生成：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx

// 获取文档信息用于首次累加
const docInfo = await wps_office_execute({
  tool_name: 'getActiveDocument',
  arguments: {},
});

// 注意：首次累加在第一批校对完成后执行（见 Step 2h）
```

> **⚠️ session_id 是必填参数**，由 AI 手动生成并传入 `proofreadAccumulate` 和 `generateProofreadReport`。
> 两个工具**统一走网关**：通过 `wps_office_execute({ tool_name: "proofreadAccumulate" / "generateProofreadReport", ... })` 调用，网关会自动路由到对应的 MCP handler（见下方 Step 2h / Step 3 示例）。

> **⚠️🔴 全流程必须使用同一个 session_id（Issue #116 session_ff63 问题四/五）**：
>
> - 所有批次、所有步骤（单 agent 顺序执行；若用子任务/子代理则所有子任务也必须）共用校对开始时生成的**同一个 `session_id`**，**严禁**各自新生成或传不同 session_id。
> - 状态不共享时各自累加会产生多份互相矛盾的报告（本会话曾出现同一文档 3 份报告数据完全不同的严重不一致）。
> - 凡调用 `proofreadAccumulate` / `generateProofreadReport`，必须显式携带这个统一的 `session_id`，遗漏即被服务端拒绝并报错。
> - 若确实需要多 agent 并行校对不同段落，也必须把同一个 `session_id` 传给每个 agent，由服务端统一累加合并，最终一份报告。

### Step 1: 开启修订模式

```javascript
wps_office_execute({ tool_name: 'enableTrackChanges', arguments: { enable: true } });
wps_office_execute({ tool_name: 'getTrackChangesStatus', arguments: {} });
```

### Step 2: 分批校对循环

**2a. 获取本批段落（推荐每批 100 段，最多 200 段）：**

**⚠️ 首次调用必须从第 1 段开始。** 插件强制校验：若 `lastBatchParaIndex === 0` 时 `start_paragraph !== 1` 则直接拒绝。

```javascript
// 推荐每批 100 段（最多 200 段）。若文档特殊需超 100 段，请在分批计划中注明理由。
var BATCH_SIZE = 100;
wps_office_execute({
  tool_name: 'getDocumentParagraphs',
  arguments: {
    start_paragraph: (batch - 1) * BATCH_SIZE + 1, // 第1批: start=1
    end_paragraph: Math.min(batch * BATCH_SIZE, totalParagraphs),
  },
});
```

**2b. 获取精确文本（禁止手动拼接）**

```javascript
// 从 getDocumentParagraphs 返回结果中解析 batchStartOffset 和 batchEndOffset：
// [1] (正文) [0-1]           → batchStartOffset = 0
// [200] (正文) [5167-5168]    → batchEndOffset = 5168
// rangeLength = 5168 - 0 = 5168

wps_office_execute({
  tool_name: 'getDocumentTextByRange',
  arguments: { startOffset: batchStartOffset, length: rangeLength },
});
// 返回精确的文档原始文本（包含空段落标记）
```

> **⚠️ 关键：必须用 `file_path` 传文本给 proofreadBasic**  
> 本批文本通过 2b 获得后，**必须写为临时文件**再传 `file_path`，**不得**直接通过 `text` 参数传递。原因：
>
> - `\f`（分页符）、`\u201c`/`\u201d` 等字符会导致 JSON 序列化失败（"JSON Parse error: Unterminated string"）
> - 实际测试中 ≥ 2000 字符的文本就可能在 MCP JSON-RPC 层解析失败
> - `file_path` 完全避免此问题，且不影响 `startOffset` 偏移定位
>
> **正确做法：**
>
> ```javascript
> // 1. 写文件
> $text | Out-File -FilePath $tempFile -Encoding utf8
> // 2. 传 file_path
> wps_office_execute({
>   tool_name: "proofreadBasic",
>   arguments: { file_path: $tempFile, startOffset: batchStartOffset }
> })
> ```

**注意：禁止手动拼接段落文本（如 `paragraphs.map(...).join('\n')`）。**
**手动拼接会跳过空段落，导致 text.length 与本批字符范围不匹配，被插件拒绝。**

**2c. ⚡ 两层并行校对**（同时调用，无需先后等待）

```javascript
const batchText = "..."  // getDocumentTextByRange 返回的文本
const batchStartOffset = ...  // 本批第一段 [start]

// 调用 proofreadBasic 的同时，你分析文本做 AI 校对（并行执行）：
```

**2c-2. 🔒 确认 AI 校对完成（强制插件规则 10）**

```javascript
// 两层校对都完成后，必须调用 confirmBatchAiProofread 确认
// 插件规则 10 强制拦截：未确认前禁止任何 replaceInParagraph 调用
wps_office_execute({
  tool_name: 'confirmBatchAiProofread',
  arguments: {},
});
// 返回：AI 智能校对已确认完成。
```

**违反后果：插件直接拒绝 replaceInParagraph，报错提示必须先完成 AI 校对。**

**Layer 1 — 基础校对（正则）：**

```javascript
wps_office_execute({
  tool_name: 'proofreadBasic',
  arguments: { text: batchText, startOffset: batchStartOffset },
});
// 返回 issues: [{ type, offset, length, original, suggestion, reason }]
```

**Layer 2 — AI 智能校对（你作为 LLM 直接分析）：**

```markdown
用你的 LLM 能力分析以下文本的语义/逻辑/语病问题。

## 通顺度检测（六维评分卡）

对每句逐维打分（0–2 分），总分 0–10。

| 维度       | 0分（硬伤）                                  | 1分（可优化）        | 2分（规范） |
| ---------- | -------------------------------------------- | -------------------- | ----------- |
| ① 成分完整 | 缺主语/缺宾语/双主语（如"通过…，使得…"）     | 介词短语前置但成分全 | 主谓宾清晰  |
| ② 搭配得当 | 动宾不当（如"履行作用"应为"发挥作用"）       | 搭配生僻但可接受     | 搭配自然    |
| ③ 语序自然 | 否定词错位（如"我把作业没有做完"）、状语错位 | 稍欧化但可接受       | 语序流畅    |
| ④ 句式干净 | 句式杂糅（如"根据调查显示"）、滥用被动       | 含框架废话但可容忍   | 句式精炼    |
| ⑤ 衔接连贯 | 关联词失配/指代不明                          | 无关联词但可推断     | 衔接自然    |

## 简洁度检测（最小化测试）

对候选冗余成分逐项做最小化测试：删除 → LLM 自检"语义是否完全不变"？

- 语义不变 → 判定冗余 ✅（可删）
- 语义变化 → 保留 ❌（不删）

冗余占比 = 可删除字数 / 总字数

冗余成分四类（由易到难）：

| 类型         | 示例                                                       |
| ------------ | ---------------------------------------------------------- |
| ① 同义反复   | 大约…左右、目的是为了、首次开创、亲眼目睹                  |
| ② 空洞填充词 | 进行研究→研究、作出决定→决定、予以解决→解决、加以完善→完善 |
| ③ 框架废话   | "我们需要注意的是"、"众所周知"、"可以说"、"毫无疑问"       |
| ④ 可压缩从句 | "在当今…的时代背景下"、"从某种意义上来说"、"就目前而言"    |

## ⚠️ 铁律：通顺 > 简洁

任何简洁修复必须：

1. 通过"删除后语义不变"自检
2. 修复后不得触发新的通顺 issue（若可能导致通顺度下降，只报告不修）
3. 修复建议至少提供 2 个选项（保守/激进），用户可择其一
4. 简洁修复尝试最多 1 轮（1 次修复 + 1 次通顺自检），若不通过则放弃修复，降级为「优化建议」

## 特别注意检查

- 占位/测试文本（如 "check test sample placeholder xxx" 等）
- 明显口语化表达（正式文档中不应出现的随意用语）
- 语病/逻辑矛盾
- **编号连续性**：跨段落检查编号是否重复（如两个段落同为 "2.2.3"）、是否跳号、是否倒序

## ⚠️ 不合理搭配强制逐句检查（F11–F15，Layer 2 凭据）

以下 5 类"不合理搭配"是 Layer 1 正则**无法命中**的语义问题（验收语料 F11–F15），
必须由 AI 层（Layer 2）逐句检出并输出**检出结论**——要么 `fix`（修复），要么 `report_only`（进优化建议），**不允许沉默漏检**：

| ID  | 模式                                | 检出凭据（看到即检出）                         | 期望修复方向           | 建议 type |
| --- | ----------------------------------- | ---------------------------------------------- | ---------------------- | --------- |
| F11 | `存在着` + 名词/数量                | "存在着"是"存在"的冗余叠加（`有`字句赘余）     | 这个方案有很多不足之处 | 搭配冗余  |
| F12 | `加强重视`                          | 动宾不当："加强"不能带"重视"（应直接"重视"）   | 我们需要重视安全问题   | 动宾不当  |
| F13 | `进步提高`                          | 语义重复："进步"与"提高"同义叠加               | 他取得了显著的进步     | 语义重复  |
| F14 | `丰富的内容` 前接数量（"很多丰富"） | 修饰不当："很多"与"丰富"语义重复               | 会议讨论了很多内容     | 修饰不当  |
| F15 | `具有着`                            | 搭配冗余："具有"不可加"着"（存现动词无进行体） | 这一发现具有深远的意义 | 搭配冗余  |

**逐句输出要求**：对每个 F11–F15 模式命中，AI 层必须输出一条带 `type` 的 issue（`fix_action: "fix"`）；
若该句同时存在其他问题导致不宜直接修复，则输出 `fix_action: "report_only"` 并写明原因，进报告"优化建议"。

- `type` 用上表建议值（或语义等价类型），**必须携带**（报告六维评分依赖）
- `metric` 一律 `"fluency"`（这类问题影响通顺/搭配）

> **🔥 F11–F15 必须逐句输出命中/未命中结论（session_ffa8 问题六）**：本批每句都要对 F11–F15 逐一给出结论——
> `F11: 命中(句X) / F12: 未命中 / F13: 未命中 / …`。**禁止笼统说"未发现"或"已检查"就跳过**（真实会话中 AI 把 F11-F15"顺带做"、凭感觉扫一眼就跳过，漏掉了实际存在的"句式杂糅/语序不当/冗余词"）。
> 只有当 F11–F15 全部逐句给出命中/未命中结论后，才算完成 Layer 2 语义检测。

## 输出格式

输出严格 JSON 数组（如无问题则输出空数组 []）：
[
{
"paragraphIndex": 1,
"offset": 0,
"original": "有问题文本",
"suggestion": "修正文本",
"type": "句式杂糅",
"reason": "语病说明",
"metric": "fluency",
"type": "动宾不当",
"score": {
"fluency": { "components": 0, "collocation": 2, "order": 2, "clean": 0, "coherence": 2, "total": 6 },
"conciseness_ratio": null
},
"fix_action": "fix"
}
]

字段说明：

- type（必填）：具体问题类型，与 Layer 1 正则规则类型对齐（如 句式杂糅/冗余词/的得混淆/重复字符/口语化/占位文本 等）。
  **禁止省略或写成 'ai'**——报告六维评分按 type 查 TYPE_METRIC_MAP 分类，缺 type 会落入"未分类"不计分；
  若确实无法归类，请根据 original/suggestion 内容推断（proofreadAccumulate 也会兜底推断，但尽量由 AI 层输出准确 type）。
- metric（必填）："fluency" | "conciseness"（枚举约束，禁止编造其他值）
- type（**必填**）：真实问题类型（如 动宾不当/语义重复/修饰不当/搭配冗余/句式杂糅/冗余词），**禁止写 "ai" 或留空**——报告六维评分按 type 分组，缺 type 会全部落入"未分类"导致评分失真
- score.fluency：通顺问题时含六维评分（每个维度 0-2 分 + total）
- score.conciseness_ratio：简洁问题时含冗余占比（如 0.25 = 25%）
- fix_action（必填）："fix"（触发修复） | "report_only"（只进优化建议）

修复触发条件（写死，不许编造）：

- fluency fix: 单维 0 分 或 总分 < 6
- fluency report_only: 6 ≤ 总分 < 8（且无 0 分）
- conciseness fix: 冗余占比 ≥ 25%
- conciseness report_only: 10% ≤ 冗余占比 < 25%

文本内容：
```

（将 batchText 逐段传入）

```

```

将 AI 校对输出的段落内偏移换算为文档绝对偏移：

```
documentOffset = paragraphStartOffset + offsetInParagraph
// paragraphStartOffset 从 getDocumentParagraphs 输出中获取
```

**插件强制校验（违反即拒绝）：**

- startOffset 必须等于本批第一段的 `[start]`
- 文本不能为空且不能明显过短（≥20 字符）
- 每批只准调 1 次 proofreadBasic（禁止拆子块）

**注意**：插件不再要求 `text.length` 精确等于 `[end]-[start]`。因为 WPS COM 的 `Range.Text` 在含 `\f`(分页符)、`\a`(表格分隔符)等控制字符的文档中，返回长度可能与段落偏移计算值不一致。proofreadBasic 内部会自动剥离控制字符并校正偏移量。

**如果文本含控制字符导致 JSON 序列化失败**（错误：`JSON Parse error: Unterminated string`），请先用 `writeFile` 写入临时文件再传 `file_path`：

```javascript
// 写法 1：直接传 text（文本不含 \f 等控制字符时）
wps_office_execute({
  tool_name: 'proofreadBasic',
  arguments: { text: batchText, startOffset: batchStartOffset },
});

// 写法 2：通过文件传 text（文本含 \f 等控制字符时）
// 先用 writeFile 写入文件，再传 file_path
wps_office_execute({
  tool_name: 'writeFile',
  arguments: { filePath: 'C:\\Users\\...\\batch.txt', content: batchText },
});
wps_office_execute({
  tool_name: 'proofreadBasic',
  arguments: { file_path: 'C:\\Users\\...\\batch.txt', startOffset: batchStartOffset },
});
```

**2d. 结果合并去重 + metric 分类**

```javascript
// ⚠️ proofreadBasic 返回 = 文本展示 + 末尾 JSON 行，提取末行 JSON.parse 取 .issues（#55 T1 结构化输出）
const responseProofreadBasic = JSON.parse(
  toolResultProofreadBasic.split('\n').filter(Boolean).pop()
);
// 合并两层结果
const layer1 = responseProofreadBasic.issues || []; // { original, offset, length, suggestion, type, metric?, context }
const layer2 = aiProofreadIssues || []; // { original, offset, suggestion, reason, metric, type, score?, fix_action }

const allIssues = [
  // Layer 1: 基础校对（metric 来自 proofread.ts Rule 定义）
  ...layer1.map(i => ({ ...i, source: 'mcp', fix_action: 'fix' })),
  // Layer 2: AI 校对（type 必填！禁止覆盖为 'ai'，必须输出真实类型如 动宾不当/语义重复/搭配冗余）
  ...layer2.map(i => ({ ...i, source: 'ai' })),
];

// 按 offset + original 去重（同一位置同一原文只修一次）
// ⚠️ offset 缺失时退化的 `undefined|原文` 键会把不同位置 issue 误判重复，
// 只对携带绝对 offset 的条目去重，缺失时保守保留全部
// ⚠️ 同键时 AI 条目无条件优先（与累加器/结果合并口径一致），但必须保留 Layer 1 的 type
const seen = new Map();
const noOffset = []; // offset 缺失的条目：不做键去重，全部保留
for (const issue of allIssues) {
  if (issue.offset === undefined) {
    noOffset.push(issue);
    continue;
  }
  const key = `${issue.offset}|${issue.original}`;
  const idx = seen.get(key);
  if (idx === undefined) {
    seen.set(key, issue);
  } else if (issue.source === 'ai' && seen.get(key).source !== 'ai') {
    // Layer 2 命中同一问题 → 保留 Layer 2 的（含 score 等元数据），但必须保留 Layer 1 的 type（如 句式杂糅）
    const existing = seen.get(key);
    if (existing.type && existing.type !== '未分类' && (!issue.type || issue.type === '未分类')) {
      issue.type = existing.type; // 保留 Layer 1 已推断的 type，避免丢失
    }
    seen.set(key, issue);
  }
}
const deduped = [...noOffset, ...seen.values()].sort(
  (a, b) =>
    (a.offset ?? Infinity) - (b.offset ?? Infinity) ||
    (a.paragraphIndex ?? 0) - (b.paragraphIndex ?? 0)
);

// 按 fix_action 分流：需修复 vs 仅报告
const toFix = deduped.filter(i => i.fix_action !== 'report_only');
const toReport = deduped.filter(i => i.fix_action === 'report_only');
// Layer 1（正则）的 issue 默认 fix_action = 'fix'（P16 天然放行）
// Layer 2（AI）的 issue 按评分卡/最小化测试结果决定 fix_action
```

**注意**：如果 AI 校对输出的 `original` 与正则发现同一问题，`key` 相同会被去重，**无条件优先保留 AI 输出的条目**（含 `score` 维度信息、`reason` 等元数据），但保留 Layer 1 已推断的 type（当 AI 未输出真实 type 时）。

**2e. 修复（findReplace 禁用，replaceRange 已移除，仅用 replaceInParagraph）：**

**⚠️ 两层返回的都是 offset 偏移量，而 replaceInParagraph 需要段落索引 + 文本匹配。**
需要将 issue.offset 映射为段落索引 + 查找文本。

**修复分类**：

- `toFix`：需要修复的问题（Layer 1 正则发现 + Layer 2 命中修复阈值），走 `replaceInParagraph`
- `toReport`：仅报告的问题（Layer 2 评分 6–8 通顺 / 10–25% 简洁），不进修复循环，直接进报告"优化建议"

> **🔥 必须遍历修复所有 `toFix` issue（session_ffa8 问题五）**：本批 `proofreadBasic` / Layer 2 发现的每条 `toFix` 问题**都必须逐一尝试 `replaceInParagraph` 修复**，禁止只修几条就宣称"全部已修复"。
>
> - 若某条因故未能修复（如匹配失败、语义冲突），**必须在最终报告中明确标注"未修复"及原因**，绝不允许报告写"全部已修复 ✅"而实际还有问题未修。
> - 真实会话中 AI 发现 8 处异常空格/重复标点却只修 2 处，报告却写"全部已修复"，导致用户误以为校对完成。
> - 修复后报告"全部已修复"的判定应基于服务端真实修订记录（`getTrackChangesStatus` 修订数增量），而非 AI 主观判断。

**映射方法 1：从 getDocumentParagraphs 返回的 [start-end] 中查找 offset 所在的段落。**

```javascript
// 从 getDocumentParagraphs 输出中解析段落范围
// [1] (正文) [0-43]     → 第1段：0-43
// [2] (正文) [44-89]    → 第2段：44-89
// ...

// 对每个 toFix issue，找到 offset 落在哪个段落的 [start-end] 范围内
function findParagraph(ranges, offset) {
  return ranges.find(r => offset >= r.start && offset < r.end);
}

for (const issue of toFix) {
  const para = findParagraph(ranges, issue.offset);
  if (para) {
    const replaceArgs = {
      paragraphIndex: para.index,
      findText: issue.original,
      replaceText: issue.suggestion,
    };
    // Layer 2 语义性问题（source='ai' 且不在 Layer 1 issue 列表中）需走 _force_ai_fix 通道
    const isSemanticFix =
      issue.source === 'ai' &&
      issue.metric &&
      !layer1.some(
        l1 =>
          l1.original === issue.original ||
          l1.original?.includes(issue.original) ||
          issue.original?.includes(l1.original)
      );
    if (isSemanticFix) {
      replaceArgs._force_ai_fix = true;
      replaceArgs._ai_evidence = issue.reason; // 必须附评分卡/最小化测试证据
    }
    // 通顺 > 简洁铁律：简洁修复前检查是否会导致通顺度下降
    if (issue.metric === 'conciseness' && isSemanticFix) {
      // 标记此修复需人工复核：简洁修复可能影响通顺
      replaceArgs._needs_fluency_check = true;
    }
    wps_office_execute({
      tool_name: 'replaceInParagraph',
      arguments: replaceArgs,
    });
    // 每修一条建议调用 getTrackChangesStatus 确认修订数增加
    wps_office_execute({
      tool_name: 'getTrackChangesStatus',
      arguments: {},
    });
    // 确认修订数相比之前增加了
  }
}
```

**映射方法 2：用 findInDocument 查找偏移量对应的段落索引。**

```javascript
// 用 findInDocument 确定 offset 对应的段落索引
wps_office_execute({
  tool_name: 'findInDocument',
  arguments: { text: issue.original },
});
// 从返回结果的 paragraphIndex 确定段落号
```

**2f. 更新进度：**

输出 `[batch/N] 批次完成 ✓`

**2g. 修订数验证（批次间强制检查）：**

每批修复完成后调用 getTrackChangesStatus 确认修订总数：

```javascript
wps_office_execute({
  tool_name: 'getTrackChangesStatus',
  arguments: {},
});
// 输出应显示：修订模式: 已开启\n当前修订数量: XX
// 确认 XX 相比本批开始时增加，且与本批修复条数一致
```

> **⚠️ TC-12 口径（修订数一致性）**：WPS 修订模式下，每次 `replaceInParagraph` 替换 = 1 次删除 + 1 次插入，即产生 **2 条修订记录**。因此：
> `问题数 = 修订记录数 ÷ 2`（整除）
> 报告中的「发现问题」按 issue 条数计；当 `total_revisions`（`getTrackChangesStatus` 的修订数量）传入报告时，报告会自动换算并标注口径，避免"修订 60 条 vs 问题 30 处"的困惑。
> 若修订数 ≠ 问题数 × 2，请检查是否有：未开启修订模式的替换、`replace_all` 多次命中、或人工修改。

**2h. 累加本批问题到会话（proofreadAccumulate）：**

本批修复完成后，将合并去重后的 issues 累加到 MCP Server 的会话 Map。
**统一走 `wps_office_execute` 网关**（网关自动路由到 `proofreadAccumulate` handler）：

```javascript
// 首次调用需要 doc_info，后续只需 session_id + issues
// 首次（batch=1）:
await wps_office_execute({
  tool_name: 'proofreadAccumulate',
  arguments: {
    session_id: sessionId,
    issues: allIssues, // 2d 中合并去重后的结果
    doc_info: {
      fileName: '文档.docx',
      filePath: 'C:\\Users\\...\\文档.docx',
      totalParagraphs: totalParagraphs,
      totalWords: totalWords,
    },
    total_revisions: currentRevisionCount,
    _processed_to_paragraph: batchEndPara, // 本批已校对到的最末段落索引（P22 必填，防"中途结束就假装完成"）
  },
});

// 后续批次（batch≥2）:
await wps_office_execute({
  tool_name: 'proofreadAccumulate',
  arguments: {
    session_id: sessionId,
    issues: allIssues, // 本批合并去重后的 issues（不含前几批）
    total_revisions: currentRevisionCount,
    _processed_to_paragraph: batchEndPara, // 必填：本批处理到的末段索引，服务端据此追踪覆盖进度
  },
});
```

> **🔥 `_processed_to_paragraph` 必填（P22）**：每次 `proofreadAccumulate` 都必须携带本批已校对到的最末段落索引（≥1）。
> 服务端据此追踪文档真实覆盖进度；缺此字段会被治理 P22 拦截，且 `generateProofreadReport` 将因完整性门禁拒绝生成报告（防"中途结束就假装完成"）。
>
> **🔴 首次累加必带 `doc_info`（P23）**：第一次实际累加（非规划初始化）必须携带 `doc_info`（含 `fileName`/`filePath`/`totalParagraphs`）。缺 `doc_info` 时服务端无法建立会话上下文，本批 issues 会被丢弃（真实会话中因此丢失 7 条）。
>
> **🔴 禁止空 `issues` 上报进度（P23）**：携带 `_processed_to_paragraph` 上报进度但 `issues` 为空数组会被治理 P23 拦截（"报了进度但丢了数据"的进度造假）。本批确有校对问题时必须真实放入 `issues`，禁止用空数组填充进度绕过批次增量上限。
>
> **⚠️ 单批进度增量上限（PR #181 评审 R2-1/R3-1）**：串行模式下，单批进度增量不得超过 **200 段**（与 `getDocumentParagraphs` 单次上限一致，`getDocumentParagraphs` 每批最多取 200 段校对）——增量 > 200 会被服务端判为"跳号假进度"拒绝（如 700→1600 增量 900）。请按批次逐批上报：上一批进度 `N` → 本批 ≤ `N+200`。同时 `_processed_to_paragraph` 不得超过文档总段数（超界直接拒绝）。
>
> **🔴 报告硬性完整性门禁（Issue #151 遗留修复）**：`generateProofreadReport` 现在是**硬门禁**而非仅告警——
> ① 若登记了批次分配表（编排模式）：全部批次必须 `done` 且步骤凭证完整、区间覆盖全文，否则**拒绝生成报告**；
> ② 若串行模式：已校对进度 `_processed_to_paragraph` 必须 ≥ `totalParagraphs`，否则**拒绝生成报告**并提示剩余段落。
> 禁止在未覆盖全文前匆忙调用 `generateProofreadReport`，否则会收到 `success=false` + 明确错误，需补齐后再重试。

> **⚠️ 每项 issue 必须携带 type**（Layer 1 来自 proofreadBasic 返回，Layer 2 由你输出真实类型）。
> **每项 issue 必须携带 source**（Layer 1 标 `source: 'mcp'`，Layer 2 标 `source: 'ai'`）；
> 若个别 issue 缺 type，MCP 会按原文/建议文本自动兜底推断（T2，#55）；
> 缺 source 时 MCP 也会兜底推断（TC-13：按 Layer 1 规则命中判定 mcp，F11–F15 等 AI 专属模式判定 ai），
> 但人工标注的 type/source 更准确，建议每项都显式携带。
>
> **🔥 每项 issue 的 `original` 和 `suggestion` 是必填字段，漏任何一个都会导致该条不被累加（session_ffa8 问题二）！**
>
> - Layer 2 AI 校对输出时，**必须同时携带 `original`（原文）和 `suggestion`（建议修改）**，缺一不可。
> - 真实会话中 AI 反复只写 `{ paragraphIndex, original, type }` 而漏 `suggestion`，导致整批累加失败、session 未建立、后续批次级联报错。
> - 服务端已改为**部分成功机制**：某批中缺字段的条目会被跳过并警告，有效条目仍会累加、session 照常建立——但**漏字段的校对结果仍会丢失**，请务必每项都带齐 `original` + `suggestion`。
> - **每项 issue 建议携带位置**：`paragraphIndex`（段落索引，从 1 起）与 `offset`（文档绝对偏移），
>   两者都缺失时报告位置列显示「位置未知」——请尽量携带，便于用户定位问题。
>   旧蛇形 `paragraph_index` 仍兼容（自动归一化）；`offset_in_paragraph`（段落内偏移）与绝对 offset 语义不同，不再兜底。

### Step 3: 生成六维校对报告

所有批次完成后，调用 `generateProofreadReport` 生成六维评分报告。
**统一走 `wps_office_execute` 网关**（网关自动路由到 `generateProofreadReport` handler）：

```javascript
// 方案 A（推荐）：直接传 output_file 让报告写入文件
// ⚠️ 若写入失败（路径非法/无权限/磁盘满等），返回 success=false 并携带失败原因，
//    会话保留供重试——落盘失败不视为报告已生成，必须修复后重试
const report = await wps_office_execute({
  tool_name: 'generateProofreadReport',
  arguments: {
    session_id: sessionId,
    output_file: 'C:\\Users\\...\\文档.校对报告.md',
  },
});
if (report.success !== true) {
  // 落盘失败：本次校对未完成，修正路径后重新调用，禁止进入 Step 4 收尾
  throw new Error('报告落盘失败：' + (report.error || JSON.stringify(report)));
}
const reportText = report.content[0].text;
```

```javascript
// 方案 B：先获取报告文本，再用 writeFile 写盘
const report = await wps_office_execute({
  tool_name: 'generateProofreadReport',
  arguments: { session_id: sessionId },
});
// report.content[0].text 包含完整的 Markdown 格式六维报告

// 获取文档路径：getActiveDocument 返回文本，从中解析出路径（如 "C:\\Users\\...\\文档.docx"）
const docInfo = await wps_office_execute({
  tool_name: 'getActiveDocument',
  arguments: {},
});
// 解析 docInfo.content[0].text 中的 "路径: ..." 行得到文档路径
const docText = docInfo.content[0].text;
const docPath = /路径:\s*(.+)/.exec(docText)?.[1];
if (!docPath) throw new Error('未能从 getActiveDocument 返回中解析出文档路径');
// 通用去扩展名（评审修正）：不再只替换 .docx，.doc/.wps/.rtf 或无扩展名均正确拼接，
// 避免生成 "文档.doc.校对报告.md" 或在无扩展名时覆盖原路径
const reportPath = docPath.replace(/\.[^./\\]+$/, '') + '.校对报告.md';

// 写入报告文件，并确认 writeFile 返回 success=true
const writeRes = await wps_office_execute({
  tool_name: 'writeFile',
  arguments: {
    filePath: reportPath,
    content: report.content[0].text,
  },
});
if (writeRes.success !== true) {
  throw new Error('报告落盘失败：' + (writeRes.error || JSON.stringify(writeRes)));
}
```

**报告包含的内容**（由 MCP Server 自动生成）：

- **六维评分摘要**：fluency（流畅度）、conciseness（简洁度）、accuracy（准确性）、consistency（一致性）、completeness（完整度）、format（格式）
- **每维度评分**：问题数、原始分（1-5）、归一化分（0-2）、展示分（X.X/10）
- **雷达图数据**：JSON 格式，方便前端渲染
- **按维度分类的问题详情**：位置、原文、建议修改、类型、来源
- **统计摘要**：MCP/AI 检测数量合计

> **✅ 落盘强制自检（验收遗留：第四轮报告只生成未写文件）**：
> 无论用上面哪种方式，**最终必须保证报告文件实际存在于磁盘**。判定标准：
>
> - **方案 A**：`generateProofreadReport` 返回 `success === true`（写失败时本工具会返回 `success=false` + 失败原因，AI 必须重试）；
> - **方案 B**：`writeFile` 返回 `success === true`（返回文本含文件大小，如 `大小: 1234 字节`，可作为已落盘的旁证）；
> - 若对落盘仍有疑虑，可用 PowerShell 校验文件存在与大小：`Get-Item "报告路径" | Select-Object Length`（非零即已落盘）。
>
> **如果报告没有写入任何文件（或写入失败未重试），本次校对视为未完成**——必须补齐落盘后再进入 Step 4 收尾。

### Step 4: 收尾

1. 提示用户 Ctrl+S 保存文档
2. 告知可在"审阅 > 修订"中查看修改记录
3. 如需撤销可在"修订"选项卡中选择接受/拒绝

---

## 常见问题

### 1. getDocumentParagraphs(200) 超时怎么办？

COM 超时已从 30s 增加到 60s（#116 问题八，MCP v1.1.1 起），200 段应对大多数文档已足够。

**推荐默认每批 100 段**（#116 问题十：大段请求输出易截断，且 200 段在 Windows COM + PowerShell 下可能超时）。若 100 段也超时，可降至 50 段。

调整后必须在分批计划表中注明，如 `每批段数: 100（推荐）`。

### 2. 标题中的多余字符

标题错字（如 `.总监理工程师资质证书` 多了前导点）优先用 `replaceInParagraph`（根据段落索引+文本匹配），**不可用 `findReplace`**。

### 3. 替换后如何确认修订跟踪生效？

修正后可调用 `getTrackChangesStatus` 查看修订数量是否增加。

### 4. 子 agent 代理处理剩余批次时如何避免状态丢失？

**不要直接用 task agent 代理后续批次**，除非你显式传递当前修订计数：

```javascript
// ❌ 错误：子 agent 不知道已有修订数，getTrackChangesStatus 从 0 开始
// ✅ 正确：在 task prompt 中写明 "当前修订数: XX，请在此基础上继续"
```

插件状态（`lastBatchParaIndex`、`batchStarted` 等）在子 agent 的新会话中**不会继承**。子 agent 必须：

1. 从当前已完成的 `lastBatchParaIndex + 1` 继续
2. 在 prompt 中写明当前 `getTrackChangesStatus` 修订数
3. 每次 `getDocumentParagraphs` 后的修订数增量验证仍须做

---

## 插件强制校验

`.opencode/plugin/governance.js` 会在运行时自动拦截所有 `wps_office_execute` 调用并执行以下校验。违反会直接报错，AI 无法绕过：

### 校对专用规则（P1-P13）

| #       | 规则                                              | 拦截点                                         | 拦截条件                                                                                                           |
| ------- | ------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P1      | 批次大小 ≤200                                     | `getDocumentParagraphs`                        | 请求 >200 段                                                                                                       |
| P2      | 批次连续性 + 首次从第1段开始                      | `getDocumentParagraphs`                        | 首次调用 start≠1，或跳跃（不从上一批+1开始）                                                                       |
| P3      | 必须先出分批计划                                  | `proofreadBasic`                               | 未先调 `getActiveDocument` + `getDocumentParagraphs`                                                               |
| P4a     | ~~replaceRange 完全禁用~~                         | ~~`replaceRange`~~                             | **已彻底移除**（不再存在于网关/COM/MCP 注册，无需拦截）                                                            |
| P4b     | findReplace 禁用                                  | `findReplace`                                  | 分批校对流程中调 findReplace                                                                                       |
| P5      | startOffset 与段落 [start] 一致                   | `proofreadBasic`                               | startOffset ≠ 本批第一段 [start]                                                                                   |
| P6      | 文本不能为空或过短                                | `proofreadBasic`                               | text.length < 20 字符                                                                                              |
| P6b     | 文本不能过大（防批量校对）                        | `proofreadBasic`                               | text.length > 本批预期范围 × 2                                                                                     |
| P7      | 每批只准调 1 次 proofreadBasic                    | `proofreadBasic`                               | 同一批第 2 次调 proofreadBasic                                                                                     |
| P8      | 先校对再修复                                      | `replaceInParagraph`                           | 同一批未先调 `proofreadBasic`                                                                                      |
| P9      | replaceInParagraph 须在校对批次内                 | `replaceInParagraph`                           | paragraphIndex 超出本批段落范围                                                                                    |
| **P10** | **必须先确认 AI 校对**                            | `replaceInParagraph`                           | **未先调 `confirmBatchAiProofread`**                                                                               |
| **P11** | **必须先开修订模式**                              | `replaceInParagraph` / `findReplace`           | 未先调 `enableTrackChanges(true)`                                                                                  |
| **P12** | **当前批校对周期完成后才能获取下一批**            | `getDocumentParagraphs`                        | (1) 本批未调 `proofreadBasic`; (2) 已调但未调 `confirmBatchAiProofread`; (3) 有校对问题但未调 `replaceInParagraph` |
| **P13** | **getDocumentTextByRange 限本批范围**             | `getDocumentTextByRange`                       | `length` > 本批预期范围 × 2                                                                                        |
| **P14** | **confirmBatchAiProofread 前必须 proofreadBasic** | `confirmBatchAiProofread`                      | 本批未先调 `proofreadBasic`                                                                                        |
| **P15** | **基础校对无问题禁止 AI 自行大量修复**            | `replaceInParagraph`                           | `proofreadHadIssues=false` 且 AI 修复次数超限（≤1 次）                                                             |
| **P16** | **替换内容与已知 issue 交叉校验**                 | `replaceInParagraph`                           | `findText` 不匹配任何 issue 的 `original` 原文                                                                     |
| **P17** | **禁止手动 write 伪造校对报告**                   | `writeFile`/`write`                            | 写「校对报告」路径且服务端未成功生成报告                                                                           |
| **P18** | **禁止重复获取已处理段落**                        | `getDocumentParagraphs`                        | 已处理到 N 段后又从段落 1 回卷获取                                                                                 |
| **P19** | **批次归属校验（并行隔离）**                      | `getDocumentParagraphs` / `replaceInParagraph` | 执行 agent 请求/替换区间越出分配批次区间                                                                           |
| **P20** | **逐步凭证落盘（防幻觉）**                        | `proofreadAccumulate`                          | 携带 `_batch_id` 却缺非空 `_steps_log`，或步骤名非法                                                               |
| **P21** | **并行区间重叠检测**                              | `getDocumentParagraphs`                        | 同一会话不同批次请求区间相交                                                                                       |
| **P22** | **必须上报校对进度**                              | `proofreadAccumulate`                          | 未携带 `_processed_to_paragraph`（规划初始化登记豁免）                                                             |
| **P23** | **首次累加必带 doc_info + 禁止空 issues 报进度** | `proofreadAccumulate`                          | 首次实际累加缺 `doc_info`；或上报进度但 `issues` 为空数组（进度造假）                                             |
| **P24** | **覆盖全文后强制生成报告**                      | `getDocumentParagraphs`/`proofreadBasic`/`confirmBatchAiProofread`/`replaceInParagraph` | 已覆盖全文（进度≥totalParagraphs）但尚未 `generateProofreadReport`，继续推进校对流程即拦截  |

### 通用执行规则（G1-G7，始终生效）

| #      | 规则                          | 拦截点                                                | 拦截条件             |
| ------ | ----------------------------- | ----------------------------------------------------- | -------------------- |
| **G1** | **所有双路径工具强制走网关**  | `wps_get_active_document` 等 6 个                     | 直接调 MCP 原接口    |
| **G2** | **wps_execute_method 白名单** | `wps_execute_method`                                  | method 不在白名单中  |
| **G3** | **写操作前必须先读**          | `setCellValue` / `setFormula` / `insertText` 等       | 未先调对应读工具     |
| **G4** | **破坏性操作需确认**          | `deleteSheet` / `deleteSlide` / `clearRange` 等       | 未传 `confirm: true` |
| **G5** | **文件路径安全**              | 含 `filePath` 参数的工具                              | 路径含 `..` 穿越符号 |
| **G6** | **密码参数保护**              | `protectSheet` / `unprotectSheet` / `protectWorkbook` | 密码已脱敏记录       |
| **G7** | **参数范围校验**              | 行号/列号/索引从 1 开始                               | 传入 `≤0` 的值       |

**规则 10 说明**：proofreadBasic（基础校对）和 AI 智能校对（LLM 语义分析）两层都完成后，必须调用 `confirmBatchAiProofread` 确认，插件才会放行 `replaceInParagraph`。这确保不会出现"只做了基础校对就修"的漏检情况。

**P14 说明**：`confirmBatchAiProofread` 前必须已调 `proofreadBasic`，防止 AI 跳过基础校对直接确认。如本批 `proofreadBasic` 未调用就调 `confirmBatchAiProofread`，P14 会拦截报错。

**P15 说明**：当 `proofreadBasic` 返回 0 个问题（`proofreadHadIssues=false`），AI 最多允许自行修复 1 处（用于 AI Layer 2 确实发现的问题）。超过后必须传 `_force_ai_fix: true` 强制放行。这防止 AI 在基础校对无问题的情况下大量"编造"不存在的校对问题。

**P16 说明**：当 `proofreadBasic` 返回了问题列表，`replaceInParagraph` 的 `findText` 必须与至少一条 issue 的 `original` 原文匹配（子串匹配即可）。如 `findText` 与任何已知 issue 都不匹配，说明 AI 在修复基础校对未发现的问题，P16 拦截。如需强制修复需传 `_force_ai_fix: true`。

**P16 补充（Issue #223 问题 P0-1，禁止截断 findText）**：`findText` 若含截断标记（`...`/`…`/`……`），说明你拿的是 `context` 截断展示文本而非 `issue.original` 原文，文档中必然不存在该文本，替换必定失败导致零修复。**必须用 `proofreadBasic` 返回的 `original` 字段（或 `getDocumentParagraphs` 获取的完整段落文本）作为 `findText`**。判定规则：省略号出现处之后若不紧跟中文字符（位于末尾、或后跟数字/`)`/`；`/空格等非中文）即判为截断符并被 P16 拦截；若省略号后紧跟中文字符（正文合法省略号，如引文/列举）则不误拦。

**P17 说明**（session_ffa8 问题一）：写文件路径含「校对报告」时，若服务端尚未通过 `generateProofreadReport` 成功生成报告（`reportGenerated !== true`），插件直接拦截。这防止 AI 在 `generateProofreadReport` 失败后手动 `write` 自拼 Markdown 报告（真实会话中出现过 3 份互相矛盾的手写报告）。

**P18 说明**（session_ffa8 问题四）：`getDocumentParagraphs` 在已处理到段落 N 后，再次从段落 1 回卷获取即被拦截。批次必须严格连续，禁止把已检查过的段落重复扫描（真实会话中 AI 在已处理完第 1-2 批后又 `getDocumentParagraphs(start=1)` 重复跑了一遍）。如需重新开始，请先 `getActiveDocument` 重置进度。

**P22 说明**（Issue #151 遗留修复）：每次 `proofreadAccumulate` 必须携带 `_processed_to_paragraph`（本批已校对到的最末段落索引）。服务端据此追踪真实覆盖进度，`generateProofreadReport` 的**硬性完整性门禁**据此判断是否允许生成报告——未覆盖全文（含编排模式有未完成批次、串行模式进度不足）时直接拒绝生成，杜绝"中途结束就假装完成"。规划 agent 初始化登记（带 `_batch_allocations` 且无 issues）豁免。

**P23 说明**（Issue #223 问题 P0-2/P0-3）：① **首次实际累加（非规划初始化）必须携带 `doc_info`**（含 `fileName`/`filePath`/**`totalParagraphs`（正整数，文档总段数）**）。服务端据此建立校对会话上下文；缺 `doc_info` 时本批携带的 issues 会被丢弃（真实会话中因此丢失 7 条）；**缺 `totalParagraphs` 时全文覆盖判定与 P24 收尾报告强制将失效**，故 `totalParagraphs` 同样为强制项（可先 `getActiveDocument` 获取）。② **禁止用空 `issues` 上报进度**：携带 `_processed_to_paragraph` 上报进度却 `issues` 为空数组，属于"报了进度但丢了数据"的进度造假（真实会话中 AI 为绕过单批增量上限把合并大批拆成 4 次空上报，丢失 74 条）。如本批确有问题，必须真实放入 issues 后再累加。

**P24 说明**（Issue #223 问题 P0-4）：文档覆盖全文（累计 `_processed_to_paragraph` ≥ `totalParagraphs`）后，若尚未调用 `generateProofreadReport` 生成收尾报告，任何继续推进校对流程的工具（`getDocumentParagraphs`/`proofreadBasic`/`confirmBatchAiProofread`/`replaceInParagraph`）都会被拦截，强制先生成报告。**最后一批 `proofreadAccumulate` 上报到覆盖全文后，应紧接着调用 `generateProofreadReport` 收尾，中间不要再穿插其他校对操作**。防止"覆盖全文后忘了生成报告就直接结束"（真实会话中 AI 空上报到全文后未生成报告就结束，用户拿到的只是 AI 编造的内容）。

**规则 2a 说明**：首次 `getDocumentParagraphs` 必须从第 1 段开始。若 `lastBatchParaIndex === 0` 时 `start_paragraph !== 1`，插件直接拒绝。这是为了防止从文档中间开始校对导致遗漏。

这意味着 SKILL.md 中的分批规章现在有代码层强制执行，AI 无法绕过。

- 规则 P2a 通过 `tool.execute.before` 校验 `lastBatchParaIndex` 实现
- 规则 P5 通过 `tool.execute.after` 从 `getDocumentParagraphs` 输出中解析段落 `[start-end]` 实现
- 规则 P6 为宽松阈值（≥20 字符），不要求精确匹配长度
  - 因为 WPS COM `Range.Text` 在含 `\f` `\a` 等控制字符时返回长度可能短于预期
  - proofreadBasic 内部会自动剥离控制字符、校正偏移量
- 必须使用 `getDocumentTextByRange` 获取精确文本（或用 `file_path` 备选方案）
- **`replaceRange` 已彻底移除**（偏移量在含不可见字符文档中不可靠，见测试日志）

### 通用执行规则说明

- **G1（网关强制）**：`wps_get_active_document`、`wps_insert_text`、`wps_get_active_workbook`、`wps_get_cell_value`、`wps_set_cell_value`、`wps_get_active_presentation` 这 6 个工具**全程禁止直接调用 MCP 原接口**，永远必须走 `wps_office_execute` 网关。
- **G3（读前必写）**：任何写操作（`setCellValue`、`setFormula`、`insertText`、`deleteSlide` 等）前，必须先调用对应的读工具获取文档状态（`getActiveDocument` / `getActiveWorkbook` / `getActivePresentation`）。这防止 AI 在不了解文档结构的情况下盲目修改。
- **G4（破坏性操作确认）**：`deleteSheet`、`deleteSlide`、`deleteRows`、`clearRange` 等会永久删除内容的操作，必须显式传 `confirm: true`。这确保 AI 不会悄无声息地删东西。
- **G7（参数范围）**：所有行号/列号/幻灯片索引/段落索引自动校验 ≥ 1，防止 off-by-one 错误损坏文档。

---

## 本 skill 不处理的内容

以下操作请交给 wps-word skill：

- 字体/字号设置
- 表格插入
- 模板填写（smartFillField）
- 目录生成
- 页眉页脚
- 图片处理

本 skill 只做**校对检测与修复**，其他一概不碰。

---

_Skill by lc2panda - WPS MCP Project_
