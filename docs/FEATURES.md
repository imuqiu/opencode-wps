# 特色功能详解

本文档详细介绍 OpenCode WPS 的两大特色功能：**文档填写（模板自动填值）** 与 **大文档校对（铁律 3.0）**。

## 文档填写 — 模板自动化填值

根据预定义的字段映射，自动从结构化数据源（JSON/Excel/数据库）中提取值，精准填充到 Word 文档模板的指定位置，全程开启修订模式，确保填值过程可追溯。

### 工作流程

1. **评估文档** — `getDocumentTextByRange` 全文读取 → `analyzeDocStructure` 评估段落数量和结构
2. **定义字段** — `step2LabelFields` 逐个标注需要填写的字段名称和位置
3. **映射数据** — `step3MapFields` 将数据源字段与模板字段对应
4. **预览校验** — 自动检测字段格式（日期/金额/编号等），发现异常立即提示
5. **批量填值** — 分批次（每批 ≤200 段）调用 `replaceInParagraph` 执行填充，禁止 AI 编造数据，跳过签字/印章等不可自动填写的字段
6. **修订记录** — 全程开启 `TrackRevisions` 模式，所有修改自动标记修订，用户可逐个接受/拒绝

### 治理规则（T1-T11）

| 规则 | 说明 |
|------|------|
| T1 | 填写前评估文档结构，确定段落总数和字段位置 |
| T2-T3 | 分批处理，每批 ≤200 段 |
| T4 | 开启修订模式 |
| T5-T11 | 禁止编造字段值、跳过签字字段、所有填值加下划线标记等 |

### 适用场景

- 合同/协议批量生成（将订单数据填入合同模板）
- 报告/报表自动生成（将统计数据填入报告模板）
- 公文/信函批量制作（将收件人信息填入信函模板）
- 审批表单填写（将审批结果填入审批单模板）

---

## 大文档校对 — 铁律 3.0 严格逐批校对

基于 `proofreadBasic` 工具的严格逐批校对流程，引入**铁律 3.0** — 禁止 AI 跳过基础校对、禁止跳过确认直接修改、禁止 AI 编造修复内容。通过 16 条校对规则（P1-P16）在代码层强制执行。

### 校对流程

1. **生成批计划** — `getDocumentParagraphs` 获取全部段落 → 分批次（每批预期段数 × 2 为上限）
2. **逐批校对** — `proofreadBasic` 每批独立调用，AI 逐批检查
3. **确认修复** — `confirmBatchAiProofread` 确认本批问题
4. **执行修复** — `replaceInParagraph` 修复本批问题 → **进入下一批**

### 铁律 3.0 核心规则

| 规则 | 类型 | 说明 |
|------|------|------|
| **P1** | before | 每批前必调 `proofreadBasic`，禁止 AI 直接调用 `getDocumentParagraphs` 跳批 |
| **P2-P3** | before/after | `proofreadBasic` 文本长度限制（段落 × 行 × 200 字符） |
| **P4-P7** | after | 批次状态追踪（批数/段数/完成计数/状态设置） |
| **P8-P10** | before | `confirmBatchAiProofread` 前必须调 `proofreadBasic`，禁止跳过基础校对 |
| **P11** | before | 每批必须完成（proofread → confirm → fix）才能进入下一批 |
| **P12** | before | `getDocumentParagraphs` 禁止获取超出本批范围的段落 |
| **P13** | before | `confirmBatchAiProofread` 确认前必须调 `proofreadBasic` |
| **P14** | before | `confirmBatchAiProofread` 前必须调 `proofreadBasic`，禁止 AI "分析"后跳过 |
| **P15** | before | 当 `proofreadHadIssues=false`（基础校对无问题）时，最多允许 1 次 AI 自定修复，超限需 `_force_ai_fix` |
| **P16** | before | `replaceInParagraph` 的 `findText` 必须与至少一条 `proofreadIssueOriginals` 原文匹配 |

### 治理机制（hooks 闭环）

```
before 钩子拦截违规 → 工具执行 → after 钩子更新状态 → before 钩子校验状态
```

- `proofreadHadIssues`：记录基础校对是否发现问题 → P15 据此限制 AI 自定修复次数
- `proofreadIssueOriginals[]`：存储基础校对返回的 issue 原文 → P16 交叉校验
- `proofreadCalledThisBatch`：标记本批是否调过基础校对 → P12/P13/P14 共用
- `replaceCountThisBatch`：本批替换次数计数 → P15 超限拦截

### 适用场景

- 长文档（100+ 段落）的错别字/语病检查
- 合同/公文/学术文档的格式一致性校对
- 批量校对 + 批量修正（铁律 3.0 确保每批严格闭环）

> 📖 校对技术设计细节见 [proofread-fluency-conciseness-design.md](./proofread-fluency-conciseness-design.md)；治理插件实现见 [AGENTS.md](../AGENTS.md) 与 `.opencode/plugins/governance.js`。
