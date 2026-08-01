/**
 * Input: 校对会话数据（sessionIssues Map + docInfo）
 * Output: 五维校对报告
 * Pos: 校对报告生成模块。一旦我被修改，请更新我的头部注释，以及所属文件夹的md。
 * 五维校对报告模块 — B' 方案（2 工具 MCP 累加器）
 *
 * 包含：
 * - wps_word_proofread_accumulate: 累加校对问题到会话
 * - wps_word_generate_proofread_report: 生成五维校对报告
 *
 * 五维评分维度：
 * - fluency（流畅度）: 成分完整、语句通顺
 * - conciseness（简洁度）: 无冗余、不啰嗦
 * - accuracy（准确性）: 事实/术语/数据准确
 * - consistency（一致性）: 格式规范、用语一致（含 standardization）
 * - completeness（完整度）: 无占位文本、内容完整
 *
 * 评分量表：Layer 1 原始 [1, 5] → normalizeToTwoPointScale → [0, 2]
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  ToolDefinition,
  ToolHandler,
  ToolCallResult,
  ToolCategory,
  RegisteredTool,
} from '../../types/tools';
import { validateFilePath } from '../../utils/path-safety';

// ==================== 类型定义 ====================

/** 五维评分维度 */
type ProofreadMetric = 'fluency' | 'conciseness' | 'accuracy' | 'consistency' | 'completeness';

/** 文档信息 */
interface DocInfo {
  fileName: string;
  filePath: string;
  totalParagraphs: number;
  totalWords: number;
}

/** 校对问题条目 */
interface ProofreadIssueEntry {
  offset: number;
  length: number;
  original: string;
  suggestion: string;
  type: string;
  context: string;
  source: 'mcp' | 'ai';
  paragraphIndex?: number;
  reason?: string;
}

/** 会话数据 */
interface SessionData {
  issues: ProofreadIssueEntry[];
  docInfo: DocInfo;
  createdAt: string;
  totalRevisions?: number;
}

// ==================== 会话 Map 与清理机制 ====================

/**
 * 会话 Map 上限（防止长时运行内存无限增长）
 * 达到上限后，淘汰最久未更新的会话（LRU 近似：按 createdAt 排序淘汰最旧）
 */
const SESSION_MAP_MAX_SIZE = 200;

/** 最近一次访问时间戳（用于 LRU 淘汰） */
const sessionLastAccess = new Map<string, number>();

/** 淘汰最久未访问的会话（超过上限时） */
function enforceSessionLimit(): void {
  if (sessionIssues.size <= SESSION_MAP_MAX_SIZE) return;
  // 按最后访问时间升序（最旧优先），逐出超限部分
  const evictable = Array.from(sessionLastAccess.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, sessionIssues.size - SESSION_MAP_MAX_SIZE);
  for (const [sid] of evictable) {
    sessionIssues.delete(sid);
    sessionLastAccess.delete(sid);
  }
}

/** 触摸会话：刷新最后访问时间并执行上限淘汰 */
function touchSession(sessionId: string): void {
  sessionLastAccess.set(sessionId, Date.now());
  enforceSessionLimit();
}

/**
 * 报告生成后回收会话（报告是流程终点，问题数据已固化到报告文本）
 * 导出供测试使用
 */
export function releaseSession(sessionId: string): boolean {
  const removed = sessionIssues.delete(sessionId);
  sessionLastAccess.delete(sessionId);
  return removed;
}

// ==================== TYPE_METRIC_MAP ====================

/**
 * 问题类型 → 五维评分维度 映射表
 *
 * 设计文档 §3.1：
 * - `standardization`（规范性）维度在 Layer 1 实现中合并入 `consistency`（一致性）
 *   规范性问题本质上就是格式一致性，语义可接受。AI Layer 2 中仍独立存在。
 * - `completeness`（完整度）为新增维度，对应占位文本检测。
 */
const TYPE_METRIC_MAP: Record<string, ProofreadMetric> = {
  // ── 流畅度 (fluency) ──
  '句式杂糅': 'fluency',     // 新增：PR #37 Layer 1 规则（通顺）
  '的得混淆': 'fluency',
  '的地混淆': 'fluency',
  '在再混淆': 'fluency',
  '即既混淆': 'fluency',
  '常见错别字': 'fluency',
  '口语化': 'fluency',
  '量词搭配': 'fluency',
  '少字': 'fluency',          // ✅ 缺字 → 成分残缺 → 通顺度（架构评审修正）

  // ── 简洁度 (conciseness) ──
  '冗余词': 'conciseness',     // 新增：PR #37 Layer 1 规则（简洁）
  '重复字符': 'conciseness',
  '重复标点': 'conciseness',
  '句式冗余': 'conciseness',
  '多字': 'conciseness',
  '多余点号': 'conciseness',

  // ── 准确性 (accuracy) ──
  '法律术语': 'accuracy',
  '工程术语': 'accuracy',

  // ── 一致性 (consistency，含原 standardization) ──
  '中英混排': 'consistency',
  '数字空格': 'consistency',
  '中文标点': 'consistency',
  '用词统一': 'consistency',
  '异常空格': 'consistency',

  // ── 完整度 (completeness) ──
  '占位文本': 'completeness',
};

// ==================== 权重公式 ====================

/**
 * 五维评分原始分计算（1-5 量表）
 *
 * - fluency: 5 - count×0.2，下限 0（count≥25 时得 0 分，触发修复）
 * - conciseness: 5 - count×0.3
 * - accuracy: 5 - count×1.0（术语错误权重最高，5 个即 0 分）
 * - consistency: 5 - count×0.1（格式问题权重最低）
 * - completeness: 有占位文本 → 直接得 0（blocker 级，触发修复）
 *
 * 返回值: [1, 5] 范围内的原始分（completeness 可能为 0）
 */
const METRIC_WEIGHT_FORMULA: Record<
  ProofreadMetric,
  (count: number, hasPlaceholder?: boolean) => number
> = {
  fluency: (c) => Math.max(0, 5 - c * 0.2),       // 下限 0（修正）
  conciseness: (c) => Math.max(0, 5 - c * 0.3),
  accuracy: (c) => Math.max(0, 5 - c * 1.0),
  consistency: (c) => Math.max(0, 5 - c * 0.1),
  completeness: (_c, hasPlaceholder) => (hasPlaceholder ? 0 : 5),
};

// ==================== 归一化函数 ====================

/**
 * 将 Layer 1 原始分（1-5 量表）归一化到 [0, 2] 区间
 *
 * 公式: normalized = (rawScore - 1) / 2
 * - rawScore=5 → 2.0
 * - rawScore=3 → 1.0
 * - rawScore=1 → 0.0
 * - rawScore=0 → 0.0（completeness 的 blocker 场景）
 *
 * 归一化后与 AI Layer 2 的 0/1/2 三级评分在同一空间，
 * 报告渲染时统一 ×5 得到 X.X/10 展示。
 */
function normalizeToTwoPointScale(rawScore: number): number {
  return Math.max(0, Math.min(2, (rawScore - 1) / 2));
}

// ==================== 会话管理 ====================

/**
 * 会话问题存储（与 governance.js 的 sessions Map 完全解耦）
 *
 * 两个进程、两个内存空间、两个 Map：
 * - governance.js sessions: 管理分批校对流程状态（lastBatchParaIndex, batchStarted 等）
 * - 本 Map: 管理校对问题的累加与报告生成（issues + docInfo）
 *
 * Key: AI 生成的 session_id（UUID v4）
 * Value: SessionData（issues 数组 + docInfo）
 */
const sessionIssues = new Map<string, SessionData>();

/** 导出供测试使用 */
export { sessionIssues };

// ==================== 累加器工具 ====================

export const proofreadAccumulateDefinition: ToolDefinition = {
  name: 'wps_word_proofread_accumulate',
  description: `累加一批校对问题到指定会话。

在校对分批循环中，每批 proofreadBasic + AI 校对完成后，将合并去重后的 issues 和文档信息通过此工具存入会话 Map。
多批调用会追加（而非覆盖），最终由 wps_word_generate_proofread_report 统一生成五维评分报告。

使用场景：
- 每批校对完成后，将问题写入会话
- 首次调用需同时传入 doc_info

注意：
- session_id 由 AI 生成（UUID v4），需在整个校对流程中保持一致
- 重复调用会追加 issues（不会覆盖）`,
  category: ToolCategory.DOCUMENT,
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: '校对会话ID（AI 生成的 UUID v4），整个校对流程保持一致',
      },
      issues: {
        type: 'array',
        description: '本批校对发现的问题列表（Layer 1 + Layer 2 合并去重后）',
        items: {
          type: 'object',
          properties: {
            offset: { type: 'number', description: '文档绝对偏移位置' },
            length: { type: 'number', description: '问题文本长度' },
            original: { type: 'string', description: '原文' },
            suggestion: { type: 'string', description: '建议修改' },
            type: { type: 'string', description: '问题类型（如 的得混淆/重复字符/口语化 等）' },
            context: { type: 'string', description: '上下文' },
            source: { type: 'string', description: '检测来源: mcp（Layer 1）或 ai（Layer 2）' },
            paragraphIndex: { type: 'number', description: '段落索引（可选，从 1 开始）' },
            reason: { type: 'string', description: 'AI 检测理由（仅 source=ai 时有效）' },
          },
        },
      },
      doc_info: {
        type: 'object',
        description: '文档信息（仅首次调用需要，后续调用可省略）',
        properties: {
          fileName: { type: 'string', description: '文档文件名' },
          filePath: { type: 'string', description: '文档完整路径' },
          totalParagraphs: { type: 'number', description: '文档总段数' },
          totalWords: { type: 'number', description: '文档总字数' },
        },
      },
      total_revisions: {
        type: 'number',
        description: '当前累计修订数（可选，用于报告统计）',
      },
    },
    required: ['session_id', 'issues'],
  },
};

export const proofreadAccumulateHandler: ToolHandler = async (
  args: Record<string, unknown>
): Promise<ToolCallResult> => {
  const { session_id, issues, doc_info, total_revisions } = args as {
    session_id: string;
    issues?: ProofreadIssueEntry[];
    doc_info?: DocInfo;
    total_revisions?: number;
  };

  if (!session_id || typeof session_id !== 'string') {
    return {
      id: uuidv4(),
      success: false,
      content: [{ type: 'text', text: 'session_id 不能为空！' }],
      error: '缺少 session_id',
    };
  }

  if (!Array.isArray(issues)) {
    return {
      id: uuidv4(),
      success: false,
      content: [{ type: 'text', text: 'issues 必须是数组！' }],
      error: '参数格式错误',
    };
  }

  // 获取或创建会话
  let session = sessionIssues.get(session_id);
  if (!session) {
    if (!doc_info) {
      return {
        id: uuidv4(),
        success: false,
        content: [
          {
            type: 'text',
            text: '首次调用 wps_word_proofread_accumulate 必须提供 doc_info！',
          },
        ],
        error: '缺少 doc_info（首次调用）',
      };
    }
    session = {
      issues: [],
      docInfo: doc_info,
      createdAt: new Date().toISOString(),
    };
    sessionIssues.set(session_id, session);
  }
  // 刷新最后访问时间并执行上限淘汰
  touchSession(session_id);

  // 更新 docInfo（如果提供了新的）
  if (doc_info) {
    session.docInfo = doc_info;
  }

  // 更新修订数
  if (typeof total_revisions === 'number') {
    session.totalRevisions = total_revisions;
  }

  // 追加 issues
  const beforeCount = session.issues.length;
  session.issues.push(...issues);

  // 去重（按 offset + original）
  const seen = new Set<string>();
  session.issues = session.issues.filter((entry) => {
    const key = `${entry.offset}|${entry.original}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const dedupedCount = beforeCount + issues.length - session.issues.length;

  return {
    id: uuidv4(),
    success: true,
    content: [
      {
        type: 'text',
        text:
          `已累加 ${issues.length} 条问题到会话 ${session_id}。\n` +
          `当前会话累计: ${session.issues.length} 条问题` +
          (dedupedCount > 0 ? `（去重 ${dedupedCount} 条）` : '') +
          '。',
      },
    ],
  };
};

// ==================== 报告生成工具 ====================

export const generateProofreadReportDefinition: ToolDefinition = {
  name: 'wps_word_generate_proofread_report',
  description: `生成五维校对报告。

从会话 Map 中读取所有累加的校对问题，按五维评分维度（fluency/conciseness/accuracy/consistency/completeness）生成结构化报告。
每个维度输出原始分（1-5）、归一化分（0-2）和 X.X/10 展示分。

使用场景：
- 所有批次校对完成后，生成最终校对报告
- 必须在使用 wps_word_proofread_accumulate 累加所有批次问题后调用

报告包含：
- 五维雷达图数据
- 每维度问题统计（数量、原始分、归一化分、10 分制分）
- 详细问题列表（按维度分组）`,
  category: ToolCategory.DOCUMENT,
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: '校对会话ID（与 wps_word_proofread_accumulate 中使用的一致）',
      },
      output_file: {
        type: 'string',
        description:
          '报告输出文件路径（可选）。如提供，报告将写入此 .md 文件；如不提供，仅返回报告文本。',
      },
    },
    required: ['session_id'],
  },
};

export const generateProofreadReportHandler: ToolHandler = async (
  args: Record<string, unknown>
): Promise<ToolCallResult> => {
  const { session_id, output_file } = args as {
    session_id: string;
    output_file?: string;
  };

  if (!session_id || typeof session_id !== 'string') {
    return {
      id: uuidv4(),
      success: false,
      content: [{ type: 'text', text: 'session_id 不能为空！' }],
      error: '缺少 session_id',
    };
  }

  const session = sessionIssues.get(session_id);
  if (!session) {
    return {
      id: uuidv4(),
      success: false,
      content: [
        {
          type: 'text',
          text: `未找到会话 ${session_id}。请先使用 wps_word_proofread_accumulate 累加校对问题。`,
        },
      ],
      error: '会话不存在',
    };
  }

  const { issues, docInfo, createdAt, totalRevisions } = session;

  if (issues.length === 0) {
    const emptyReport = buildEmptyReport(docInfo, createdAt);
    if (output_file) {
      try {
        const safePath = validateFilePath(output_file, ['.md', '.txt']);
        fs.writeFileSync(safePath, emptyReport, 'utf-8');
      } catch (err) {
        // 文件写入失败不影响返回
      }
    }
    // 空报告同样回收会话
    releaseSession(session_id);
    return {
      id: uuidv4(),
      success: true,
      content: [{ type: 'text', text: emptyReport }],
    };
  }

  // 按维度统计
  const metricCounts: Record<ProofreadMetric, number> = {
    fluency: 0,
    conciseness: 0,
    accuracy: 0,
    consistency: 0,
    completeness: 0,
  };

  const metricIssues: Record<ProofreadMetric, ProofreadIssueEntry[]> = {
    fluency: [],
    conciseness: [],
    accuracy: [],
    consistency: [],
    completeness: [],
  };

  const unknownTypeIssues: ProofreadIssueEntry[] = [];

  for (const issue of issues) {
    const metric = TYPE_METRIC_MAP[issue.type];
    if (metric) {
      metricCounts[metric]++;
      metricIssues[metric].push(issue);
    } else {
      unknownTypeIssues.push(issue);
    }
  }

  // 计算五维评分
  const hasPlaceholder = metricCounts.completeness > 0;

  interface MetricScore {
    count: number;
    rawScore: number;
    normalizedScore: number;
    displayScore: string;
  }

  const scores: Record<ProofreadMetric, MetricScore> = {} as Record<ProofreadMetric, MetricScore>;

  for (const metric of Object.keys(metricCounts) as ProofreadMetric[]) {
    const count = metricCounts[metric];
    const rawScore =
      metric === 'completeness'
        ? METRIC_WEIGHT_FORMULA[metric](count, hasPlaceholder)
        : METRIC_WEIGHT_FORMULA[metric](count);

    const normalizedScore =
      metric === 'completeness' && rawScore === 0
        ? 0 // completeness 的 blocker 场景：直接 0
        : normalizeToTwoPointScale(rawScore);

    scores[metric] = {
      count,
      rawScore,
      normalizedScore: Math.round(normalizedScore * 100) / 100,
      displayScore: (normalizedScore * 5).toFixed(1),
    };
  }

  // ═══════════════════════════════════════════
  // 构建报告
  // ═══════════════════════════════════════════

  const reportDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const metricLabels: Record<ProofreadMetric, string> = {
    fluency: '流畅度',
    conciseness: '简洁度',
    accuracy: '准确性',
    consistency: '一致性',
    completeness: '完整度',
  };

  const metricOrder: ProofreadMetric[] = [
    'fluency',
    'conciseness',
    'accuracy',
    'consistency',
    'completeness',
  ];

  let report = '';

  report += `# 校对报告\n\n`;
  report += `- **文档**: ${docInfo.fileName}\n`;
  report += `- **路径**: \`${docInfo.filePath}\`\n`;
  report += `- **校对时间**: ${reportDate}\n`;
  report += `- **总段数**: ${docInfo.totalParagraphs}\n`;
  report += `- **总字数**: ${docInfo.totalWords}\n`;
  if (totalRevisions !== undefined) {
    report += `- **修订总数**: ${totalRevisions}\n`;
  }
  report += `- **发现问题**: ${issues.length} 处\n`;
  report += `\n`;

  // 五维评分摘要
  report += `## 五维评分\n\n`;
  report += `| 维度 | 问题数 | 原始分 (1-5) | 归一化 (0-2) | 得分 (X.X/10) |\n`;
  report += `|------|--------|-------------|-------------|---------------|\n`;

  for (const metric of metricOrder) {
    const s = scores[metric];
    const label = metricLabels[metric];
    report += `| ${label} (${metric}) | ${s.count} | ${s.rawScore.toFixed(1)} | ${s.normalizedScore.toFixed(2)} | ${s.displayScore}/10 |\n`;
  }

  report += `\n`;

  // 雷达图数据（JSON 格式，方便前端渲染）
  report += `## 雷达图数据\n\n`;
  report += `\`\`\`json\n`;
  report += JSON.stringify(
    {
      metrics: metricOrder.map((m) => ({
        name: metricLabels[m],
        key: m,
        count: scores[m].count,
        raw: scores[m].rawScore,
        normalized: scores[m].normalizedScore,
        display: scores[m].displayScore,
      })),
    },
    null,
    2
  );
  report += `\n\`\`\`\n\n`;

  // 按维度详细问题
  report += `## 问题详情\n\n`;

  for (const metric of metricOrder) {
    const metricIssuesList = metricIssues[metric];
    if (metricIssuesList.length === 0) continue;

    report += `### ${metricLabels[metric]} (${metric}) — ${metricIssuesList.length} 处\n\n`;

    report += `| # | 位置 | 原文 | 建议修改 | 类型 | 来源 |\n`;
    report += `|---|------|------|---------|------|------|\n`;

    metricIssuesList.forEach((issue, idx) => {
      const location = issue.paragraphIndex
        ? `段落 ${issue.paragraphIndex}`
        : `偏移 ${issue.offset}`;
      const escapedOriginal = issue.original.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const escapedSuggestion = issue.suggestion.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      report += `| ${idx + 1} | ${location} | ${escapedOriginal} | ${escapedSuggestion} | ${issue.type} | ${issue.source === 'ai' ? 'AI' : 'MCP'} |\n`;
    });

    report += `\n`;
  }

  // 未知类型问题（兜底）
  if (unknownTypeIssues.length > 0) {
    report += `### 未分类问题 — ${unknownTypeIssues.length} 处\n\n`;
    report += `| # | 位置 | 原文 | 建议修改 | 类型 | 来源 |\n`;
    report += `|---|------|------|---------|------|------|\n`;
    unknownTypeIssues.forEach((issue, idx) => {
      const location = issue.paragraphIndex
        ? `段落 ${issue.paragraphIndex}`
        : `偏移 ${issue.offset}`;
      const escapedOriginal = issue.original.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const escapedSuggestion = issue.suggestion.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      report += `| ${idx + 1} | ${location} | ${escapedOriginal} | ${escapedSuggestion} | ${issue.type} | ${issue.source === 'ai' ? 'AI' : 'MCP'} |\n`;
    });
    report += `\n`;
  }

  // 统计摘要
  report += `## 统计摘要\n\n`;
  const mcpCount = issues.filter((i) => i.source === 'mcp').length;
  const aiCount = issues.filter((i) => i.source === 'ai').length;
  report += `| 来源 | 数量 |\n`;
  report += `|------|------|\n`;
  report += `| 正则基础校对 (MCP) | ${mcpCount} 处 |\n`;
  report += `| AI 智能校对 | ${aiCount} 处 |\n`;
  report += `| **合计** | **${issues.length} 处** |\n`;
  report += `| 全部已修复 | ✅ |\n`;

  // 报告生成后回收会话，释放内存（报告文本已固化，会话数据不再需要）
  releaseSession(session_id);

  // 写入文件（如果指定）
  if (output_file) {
    try {
      const safePath = validateFilePath(output_file, ['.md', '.txt']);
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(safePath, report, 'utf-8');
    } catch (err) {
      // 文件写入失败不影响文本返回
    }
  }

  return {
    id: uuidv4(),
    success: true,
    content: [{ type: 'text', text: report }],
  };
};

// ==================== 辅助函数 ====================

/**
 * 构建空报告（0 个问题时）
 */
function buildEmptyReport(docInfo: DocInfo, _createdAt: string): string {
  const reportDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return [
    `# 校对报告`,
    ``,
    `- **文档**: ${docInfo.fileName}`,
    `- **路径**: \`${docInfo.filePath}\``,
    `- **校对时间**: ${reportDate}`,
    `- **总段数**: ${docInfo.totalParagraphs}`,
    `- **总字数**: ${docInfo.totalWords}`,
    `- **发现问题**: 0 处`,
    ``,
    `## 五维评分`,
    ``,
    `| 维度 | 问题数 | 原始分 (1-5) | 归一化 (0-2) | 得分 (X.X/10) |`,
    `|------|--------|-------------|-------------|---------------|`,
    `| 流畅度 (fluency) | 0 | 5.0 | 2.00 | 10.0/10 |`,
    `| 简洁度 (conciseness) | 0 | 5.0 | 2.00 | 10.0/10 |`,
    `| 准确性 (accuracy) | 0 | 5.0 | 2.00 | 10.0/10 |`,
    `| 一致性 (consistency) | 0 | 5.0 | 2.00 | 10.0/10 |`,
    `| 完整度 (completeness) | 0 | 5.0 | 2.00 | 10.0/10 |`,
    ``,
    `✅ 文档质量优秀，未发现任何问题。`,
  ].join('\n');
}

// ==================== 导出 ====================

export const proofreadReportTools: RegisteredTool[] = [
  { definition: proofreadAccumulateDefinition, handler: proofreadAccumulateHandler },
  { definition: generateProofreadReportDefinition, handler: generateProofreadReportHandler },
];

export default proofreadReportTools;
