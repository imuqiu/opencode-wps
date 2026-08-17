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
 * 落盘持久化配套：proofread-store.ts（Issue #116）
 * - 校对数据落盘到 ~/.opencode-wps/proofread-sessions/{sessionId}.json
 * - 服务重启后可从磁盘恢复（getSessionOrLoad）
 * - 必填字段校验（original/suggestion）在 accumulate 入口拦截
 * - 报告生成器 .replace() 处兜底，历史坏数据不崩溃
 * - 疑似问题（suspectedIssues）单独列出待确认
 *
 * ⚠️ 重要：这两个工具是 GATEWAY_ONLY（网关专用）——定义在 allTools 中
 * 仅用于 gateway HANDLER_MAP 路由映射（gateway/index.ts 遍历 allTools 建索引），
 * 并不直连注册为 MCP 工具。唯一入口是 wps_office_execute 网关
 * （COM_ACTIONS 索引：proofreadAccumulate / generateProofreadReport）。
 * 结构性防护见 ToolRegistry.GATEWAY_ONLY_TOOLS 黑名单；请勿误删本模块的
 * proofreadReportTools 导出，否则网关路由会失效。
 *
 * 五维评分维度：
 * - fluency（流畅度）: 成分完整、语句通顺
 * - conciseness（简洁度）: 无冗余、不啰嗦
 * - accuracy（准确性）: 事实/术语/数据准确
 * - consistency（一致性）: 格式规范、用语一致（含 standardization）
 * - completeness（完整度）: 无占位文本、内容完整
 *
 * 评分量表：Layer 1 原始 [1, 5] → normalizeToTwoPointScale → [0, 2]
 * T2（#55）：
 * - proofreadAccumulate 对缺 type 的 issue 做兜底推断（normalizeIssueType → inferTypeFromContent），
 *   报告五维评分不再因 type=undefined/`'ai'` 全部落入"未分类"而失真
 * - 报告对"未分类"降级处理并提示（不计入五维评分）
 * - TC-12 口径：报告明确"问题数 = 修订记录数 ÷ 2"（每次替换=删除+插入 2 条修订）；
 *   奇数修订（删除类修复只产生 1 条）时提示"换算不整除、请人工核对"
 * - 缺 source 的 issue 兜底推断（normalizeIssueSource，TC-13）：Layer 1 规则命中→mcp、
 *   F11–F15 AI 专属模式→ai、无法判断→保守 mcp；报告"未标注来源"统计不再失真
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  saveSessionToDisk,
  loadSessionFromDisk,
  removeSessionFromDisk,
  loadBatchAllocations,
  appendStepRecord,
  saveBatchAllocations,
  hasParallelRangeConflict,
  getIncompleteBatches,
} from './proofread-store';
import {
  ToolDefinition,
  ToolHandler,
  ToolCallResult,
  ToolCategory,
  RegisteredTool,
} from '../../types/tools';
import { validateFilePath, ALLOWED_WRITE_ROOTS } from '../../utils/path-safety';

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
  /** 文档绝对偏移（可选：AI 层漏传时展示层降级为「位置未知」，不应用 offset_in_paragraph 冒充） */
  offset?: number;
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
  /** 疑似问题（Issue #116 问题十一）：AI 识别但未确认的问题，报告单独列出「待确认」 */
  suspectedIssues?: ProofreadIssueEntry[];
  /**
   * 校对进度（Issue #151 遗留问题彻底修复）：服务端追踪文档实际校对覆盖进度，
   * 用于 `generateProofreadReport` 的硬性完整性门禁——
   * 串行模式下若 `processedToParagraph < docInfo.totalParagraphs`，禁止生成报告（防"中途结束就假装完成"）。
   * 由 `proofreadAccumulate` 每次上报 `_processed_to_paragraph` 增量更新（取各批最大值）。
   */
  progress?: {
    /** 已校对到的最末段落索引（含），1 起 */
    processedToParagraph: number;
    /** 文档总段数（与 docInfo.totalParagraphs 一致，冗余便于校验） */
    totalParagraphs: number;
    /** 是否已覆盖全文（processedToParagraph >= totalParagraphs） */
    allBatchesComplete?: boolean;
  };
}

// ==================== 会话 Map 与清理机制 ====================

/**
 * 会话 Map 上限（防止长时运行内存无限增长）
 * 达到上限后，淘汰最久未更新的会话（近似 LRU：按 sessionLastAccess 最后访问时间升序淘汰最旧）
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
    // LRU 淘汰同步清理磁盘文件（Issue #116 问题十二）
    // 评审第 1 轮 W3：检查删除返回值，失败时打日志，避免磁盘文件残留膨胀
    const removed = removeSessionFromDisk(sid);
    if (!removed) {
      console.warn(`[proofread] LRU 淘汰清理磁盘文件失败: ${sid}`);
    }
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
  // 同步清理磁盘文件（Issue #116 问题十二：服务端落盘持久化的清理口径）
  // 评审第 3 轮 W5：检查删除返回值，失败时打日志，避免磁盘文件残留
  const diskRemoved = removeSessionFromDisk(sessionId);
  if (!diskRemoved) {
    console.warn(`[proofread] releaseSession 清理磁盘文件失败: ${sessionId}`);
  }
  return removed;
}

/**
 * 获取会话数据，优先内存 Map，缺失时尝试从磁盘恢复（Issue #116 问题七/九/十二）
 *
 * 服务重启后进程内 Map 清空，但磁盘仍有该 session 的数据时，从磁盘加载恢复。
 */
function getSessionOrLoad(sessionId: string): SessionData | undefined {
  const memSession = sessionIssues.get(sessionId);
  if (memSession) return memSession;
  const diskSession = loadSessionFromDisk<SessionData>(sessionId);
  // 评审第 1 轮 W1：磁盘恢复需校验数据结构完整性——issues 与 docInfo 都是后续流程的必字段，
  // 缺任一即视为坏数据（半写入/截断），不恢复进内存，避免报告生成/累加复用 docInfo 时二次崩溃
  if (
    diskSession &&
    Array.isArray(diskSession.issues) &&
    diskSession.docInfo &&
    typeof diskSession.docInfo === 'object'
  ) {
    // 恢复进内存 Map（保证后续操作一致），并刷新访问时间
    sessionIssues.set(sessionId, diskSession);
    touchSession(sessionId);
    return diskSession;
  }
  return undefined;
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
  句式杂糅: 'fluency', // 新增：PR #37 Layer 1 规则（通顺）
  的得混淆: 'fluency',
  的地混淆: 'fluency',
  在再混淆: 'fluency',
  即既混淆: 'fluency',
  常见错别字: 'fluency',
  口语化: 'fluency',
  量词搭配: 'fluency',
  少字: 'fluency', // ✅ 缺字 → 成分残缺 → 通顺度（架构评审修正）
  // ── 流畅度（AI Layer 2 常用类型，T2/T3：#55 F11–F15）──
  动宾不当: 'fluency', // F12 加强重视安全问题
  语义重复: 'fluency', // F13 显著的进步提高
  修饰不当: 'fluency', // F14 很多丰富的内容
  搭配冗余: 'fluency', // F15 具有着深远的意义
  '冗余+搭配': 'fluency', // F11 存在着很多不足之处
  冗余搭配: 'fluency',
  语序不当: 'fluency',
  成分残缺: 'fluency',
  句式混乱: 'fluency',
  关联词失配: 'fluency',
  指代不明: 'fluency',
  逻辑矛盾: 'fluency',
  语病: 'fluency',
  搭配不当: 'fluency',
  成分赘余: 'conciseness', // 语义重复/赘余 → 简洁度
  重复表达: 'conciseness',

  // ── 简洁度 (conciseness) ──
  冗余词: 'conciseness', // 新增：PR #37 Layer 1 规则（简洁）
  重复字符: 'conciseness',
  重复标点: 'conciseness',
  句式冗余: 'conciseness',
  多字: 'conciseness',
  多余点号: 'conciseness',

  // ── 准确性 (accuracy) ──
  法律术语: 'accuracy',
  工程术语: 'accuracy',

  // ── 一致性 (consistency，含原 standardization) ──
  中英混排: 'consistency',
  数字空格: 'consistency',
  中文标点: 'consistency',
  用词统一: 'consistency',
  异常空格: 'consistency',

  // ── 完整度 (completeness) ──
  占位文本: 'completeness',
};

// ==================== F14 修饰不当模式（评审修正 #70） ====================

/**
 * F14 修饰不当（AI Layer 2）的判定模式。
 *
 * ⚠️ 评审修正：原模式 `(很多|许多|大量|丰富).{0,6}(内容|经验|知识)` 会把
 * "丰富的经验"（丰富直接修饰经验，正常搭配）误判为修饰不当（aiOnlyPattern
 * 也会因此把正常表达兜底归为 ai，来源失真反向复现）。F14 的本质是**数量词
 * 修饰"丰富/充分"**造成语义重复（如"很多丰富的内容"→"很多内容"），
 * 故需数量词与 丰富/充分 同时出现才命中。
 *
 * 统一供 inferIssueType / inferTypeFromContent / normalizeIssueSource 三处复用，
 * 避免规则漂移（评审建议 5）。
 */
export const F14_MODIFIER_PATTERN = new RegExp(
  '(很多|许多|大量|丰富)(的)?(丰富|充分)(的)?(内容|经验|知识)'
);

/**
 * AI 专属模式（F11–F15）判定正则，统一供 normalizeIssueSource 使用。
 *
 * 评审建议（#70 第 4 轮）：原先在 normalizeIssueSource 函数体内用
 * `new RegExp(...)` 每条重建一次实例（issues.map() 遍历时反复分配），
 * 与已提为模块级的 F14_MODIFIER_PATTERN 不对称。提取为模块级常量后
 * 只构建一次，且与 F14_MODIFIER_PATTERN 保持引用关系，杜绝规则漂移。
 */
export const AI_ONLY_PATTERN = new RegExp(
  `存在着|具有着|加强重视|(进步|提升|提高)(提高|进步)|${F14_MODIFIER_PATTERN.source}`
);

// ==================== type 兜底推断（T2，#55） ====================

/**
 * 对缺 type / type 异常的 issue 做兜底推断，保证五维评分有真实统计来源。
 *
 * 背景（#55 P0-2）：AI 层累加时若未携带 type（或旧代码把 AI issue 的
 * type 覆盖为 'ai'），TYPE_METRIC_MAP 查不到 → 全部落入"未分类"兜底，
 * 导致报告五维全 10.0/10、问题类型全 undefined、统计"正则 0 处 + AI 0 处"。
 *
 * 推断优先级：
 * 1. type 已有且非 'ai'/undefined → 直接返回
 * 2. 按 suggestion/original 文本规则映射（与 proofread.ts 规则同源）
 * 3. 仍无法推断 → 返回 '未分类'（报告降级提示，不计入五维评分）
 *
 * ⚠️ 评审建议（#70 第 4 轮）：生产累加路径已改走 normalizeIssueType →
 * inferTypeFromContent（#55 T2 重构），本函数在当前生产代码中已无调用点，
 * 保留仅供测试与向后兼容（历史 SKILL 合并产物 type='ai' 的兜底口径相同）。
 */
export function inferIssueType(issue: {
  type?: string;
  original?: string;
  suggestion?: string;
}): string {
  const rawType = issue.type;
  // 有效 type 直接使用（排除 'ai' 占位值与空值）
  if (rawType && rawType !== 'ai' && rawType !== '未分类') return rawType;

  const original = (issue.original || '').trim();
  const suggestion = (issue.suggestion || '').trim();
  const text = `${original} ${suggestion}`;

  // ── 冗余词（conciseness）──
  if (/进行(了)?|作出(了)?|予以(了)?|加以(了)?|针对.*这一问题/.test(text)) {
    return '冗余词';
  }
  // ── 句式杂糅（fluency）──
  if (/通过.*?(使|让|令)/.test(original)) return '句式杂糅';
  if (/根据.*?(显示|表明|证实)/.test(original)) return '句式杂糅';
  if (/由于.*?的原因(导致|使|造成)/.test(original)) return '句式杂糅';
  // ── F11–F15 典型模式（AI Layer 2，fluency）──
  if (/存在着|具有着/.test(original)) return '搭配冗余'; // F11/F15
  if (/加强重视/.test(original)) return '动宾不当'; // F12
  if (/(进步|提升|提高)(提高|进步)/.test(original)) return '语义重复'; // F13
  // F14（评审修正：需数量词+丰富/充分 同时出现，避免"丰富的经验"误判）
  if (F14_MODIFIER_PATTERN.test(original)) return '修饰不当';
  // ── 的得地 / 重复 / 标点（向后兼容旧规则）──
  if (/(的的|的地|得的|变的|做的)/.test(original)) return '的得混淆';
  if (/([\u4e00-\u9fff])\1{2,}/.test(original)) return '重复字符';
  if (/([，。；：、！？]){2,}/.test(original)) return '重复标点';
  // ── 占位文本（completeness）──
  if (/xxx|xx公司|test|sample|placeholder|lorem ipsum/i.test(text)) return '占位文本';

  return '未分类';
}

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
  fluency: c => Math.max(0, 5 - c * 0.2), // 下限 0（修正）
  conciseness: c => Math.max(0, 5 - c * 0.3),
  accuracy: c => Math.max(0, 5 - c * 1.0),
  consistency: c => Math.max(0, 5 - c * 0.1),
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

// ==================== 兜底类型推断（#55 T2） ====================

/**
 * 从 original/suggestion 内容推断问题类型（用于缺 type 的 issue 兜底）
 * 规则与 proofread.ts rules 的典型模式保持同步，按优先级匹配
 */
export function inferTypeFromContent(original: string, suggestion: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    // ── 通顺（fluency） ──
    [/通过.{0,20}(使|让|令)/, '句式杂糅'],
    [/根据.{0,20}(显示|表明|证实)/, '句式杂糅'],
    [/由于.{0,20}的原因(导致|使|造成)/, '句式杂糅'],
    [/(即|既)(然|而)/, '即既混淆'],
    [/(做|搞|弄|写|说|画|跑|跳|走|看|听|吃|喝)的(太|很|非常|比较|极为|十分|挺)/, '的得混淆'],
    [/(狠|很|真|非|极|异|格)的(好|坏|快|慢|多|少|高|低|长|短|大|小)/, '的得混淆'],
    [/在(次|来|去)/, '在再混淆'],
    // ── 简洁（conciseness） ──
    [
      /进行(了)?((深入|详细|认真|充分|全面|系统|细致|专门|彻底|有效)[的])?(研究|分析|讨论|处理|调查)/,
      '冗余词',
    ],
    [/作出(了)?(决定|部署|安排)/, '冗余词'],
    [/予以(了)?(解决|处理|落实)/, '冗余词'],
    [/加以(了)?(解决|完善|规范)/, '冗余词'],
    [/针对.{0,20}这一问题/, '冗余词'],
    [/大约.{0,8}(左右|上下)/, '句式冗余'],
    [/的原因(是因为|是由于)/, '句式冗余'],
    [/目的是为了|可以(说|看成|认为)是|被(广大|众多)所/, '句式冗余'],
    [/必须要|全部都|进一步地|现如今|涉及到|付诸于|诉诸于/, '多字'],
    [/并(非|不)是/, '多字'],
    [/(的的|了了|，，|。。|！！|？？)/, '重复字符'],
    // ── F11–F15 典型模式（AI Layer 2，fluency；#55 T3） ──
    [/存在着|具有着/, '搭配冗余'], // F11/F15
    [/加强重视/, '动宾不当'], // F12
    [/(进步|提升|提高)(提高|进步)/, '语义重复'], // F13
    // F14（评审修正：数量词+丰富/充分，避免"丰富的经验"误判）
    [F14_MODIFIER_PATTERN, '修饰不当'],
    // ── 其他 ──
    [/签定(合同|协议|合约|约定)/, '法律术语'],
    [/其它(人|事|物|方面|单位|情况|问题)/, '用词统一'],
    [/(?:check|test|sample|todo|fixme|lorem ipsum)/i, '占位文本'],
    [/xxx|xxx有限公司/, '占位文本'],
  ];

  for (const [re, type] of patterns) {
    if (re.test(original)) return type;
  }
  // 原文无法匹配时，尝试从建议文本推断
  if (suggestion) {
    for (const [re, type] of patterns) {
      if (re.test(suggestion)) return type;
    }
  }
  return undefined;
}

/**
 * 规整 issue.type：缺 type / 空 type / type='ai'（SKILL 合并 bug 产物）→ 兜底推断；
 * 仍无法推断 → '未分类'（报告降级处理，不计入五维评分）
 *
 * 评审建议（与 normalizeIssueSource 对称）：有效 type 一律 trim 后返回归一化值，
 * 避免带前后空格的 type（如 ' 的得混淆 '）在 TYPE_METRIC_MAP 严格查表时落入
 * "未分类"（metricForIssue 用 === 查表，不做 trim），与 TC-13 来源失真同源。
 */
export function normalizeIssueType(issue: ProofreadIssueEntry): ProofreadIssueEntry {
  const rawType = typeof issue.type === 'string' ? issue.type.trim() : '';
  if (rawType && rawType !== 'ai' && rawType !== '未分类') {
    // 返回 trim 后的归一化 type（原引用可能带前后空格，报告 TYPE_METRIC_MAP 查表会漏）
    return { ...issue, type: rawType };
  }
  const inferred = inferTypeFromContent(issue.original || '', issue.suggestion || '');
  return { ...issue, type: inferred || '未分类' };
}

/**
 * 规整 issue 的定位字段（位置展示「偏移 undefined」瑕疵修复，PR #71 评审 + 架构复盘收敛版）：
 *
 * ## 坐标系收敛背景
 * 架构复盘结论：全链路只保留**一套坐标系**——驼峰 `paragraphIndex`（段落索引，从 1 起）
 * + `offset`（文档**绝对**偏移）。
 * - SKILL.md Layer 2 已改为**直接输出驼峰 + 绝对 offset**，不再要求蛇形 `paragraph_index` /
 *   `offset_in_paragraph`，从源头消灭双坐标系。
 * - `offset_in_paragraph`（段落内偏移）≠ `offset`（文档绝对偏移），语义不同，**绝不互相兜底**
 *   （评审 warning：段落内偏移冒充绝对偏移会引入「偏移值语义错误」的隐性风险）。
 *
 * ## 本函数职责（纯防御，不再承担语义换算）
 * 1. `paragraph_index`（蛇形旧别名）→ `paragraphIndex`（驼峰），兼容存量 AI 输出
 * 2. `offset` 仅接受数值（兼容字符串数字如 `"3"`，评审 warning：AI 层可能输出字符串）
 * 3. `offset_in_paragraph` **忽略不计**（不兜底为 offset）——该字段语义为段落内偏移，
 *    与绝对偏移不可混用；缺失 offset 时展示层降级为「位置未知」
 * 4. 不再用 `as number` 类型断言（评审 info：断言掩盖 undefined 可能性，类型不诚实），
 *    直接返回 `offset?: number`
 */

/**
 * 将可能是字符串数字的输入安全转为数值（评审 warning：AI 层可能输出 "3" 而非 3）
 * 非数值 / undefined / 空字符串 → undefined（不强行转换）
 */
function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function normalizeIssueLocation(issue: ProofreadIssueEntry): ProofreadIssueEntry {
  // 仅声明本函数真正消费的字段（评审 info：类型声明即承诺，不声明被有意忽略的
  // offset_in_paragraph——它语义是段落内偏移，与绝对 offset 不可混用，统一由
  // SKILL 约束 AI 层不输出该字段）
  const raw = issue as ProofreadIssueEntry & {
    paragraphIndex?: number | string;
    paragraph_index?: number | string;
    offset?: number | string;
  };
  // paragraphIndex 优先驼峰，其次蛇形旧别名（两种都可能带字符串数字）
  const paragraphIndex =
    toFiniteNumber(raw.paragraphIndex) ?? toFiniteNumber(raw.paragraph_index) ?? undefined;
  // offset 仅接受绝对偏移数值（含字符串数字）；offset_in_paragraph 语义不同，绝不兜底
  const offset = toFiniteNumber(raw.offset);
  return { ...issue, paragraphIndex, offset };
}

/**
 * 去重键（四评审 info：`offset|original` 用 `|` 分隔，原文含 `|` 时可能碰撞误判）
 * 改为 JSON 序列化数组，彻底消除分隔符歧义。
 * 仅对携带绝对 offset 的条目调用（offset 为 number）。
 */
function dedupKey(offset: number, original: string): string {
  return JSON.stringify([offset, original]);
}

/**
 * 规整 issue.source：缺 source / 非法值 → 兜底推断（TC-13，验收遗留）
 *
 * 背景：第三轮会话 proofreadAccumulate 的 issues 未携带 source，报告统计摘要
 * 出现"⚠️ 未标注来源 30 处"（TC-13 来源统计失真）。SKILL 已要求 AI 层输出
 * source（mcp/ai），但代码侧缺少兜底，AI 漏传时报告仍失真。
 *
 * 兜底策略（保守、可追溯，评审建议：严格按注释实现两层判断，
 * 避免"非 AI 专属模式 → 全部 mcp"导致 AI 漏传 source 的非 F11–F15 问题
 * （如口语化/语序不当）被误计为 MCP，TC-13 来源失真在反方向复现）：
 * 1. source 已是 'mcp' / 'ai' → 直接返回（大小写归一化为小写）
 * 2. 命中 F11–F15 AI 专属模式（搭配冗余/动宾不当/语义重复/修饰不当）→ 'ai'
 * 3. 命中 Layer 1 规则（inferTypeFromContent 返回具体类型）→ 'mcp'
 * 4. 仍无法判断 → 保守 'mcp'（Layer 1 规则引擎命中优先，AI 补充场景由 SKILL 约束）
 */
export function normalizeIssueSource(issue: ProofreadIssueEntry): ProofreadIssueEntry {
  const rawSource = typeof issue.source === 'string' ? issue.source.trim().toLowerCase() : '';
  if (rawSource === 'mcp' || rawSource === 'ai') {
    // 评审建议：大小写变体（如 'MCP'/'AI'）虽宽容通过校验，但报告统计用严格 === 判断，
    // 直接返回原引用会导致大小写不一致时仍落入"未标注来源"（TC-13 失真复现）。
    // 统一归一化为小写后再返回，彻底堵住漏网场景。
    return { ...issue, source: rawSource };
  }
  const original = issue.original || '';
  const suggestion = issue.suggestion || '';
  // 第 2 步：F11–F15 的 AI 专属搭配模式（搭配冗余/动宾不当/语义重复/修饰不当）
  // 这些模式 Layer 1 不检出（#25 语料标注 Layer 2 专属），兜底归为 ai。
  // 必须先于 Layer 1 判断：inferTypeFromContent 也能命中 F11–F15 模式（返回对应 type），
  // 若先走 Layer 1 会把 AI 专属问题误计为 mcp。
  const text = `${original} ${suggestion}`;
  if (AI_ONLY_PATTERN.test(text)) {
    return { ...issue, source: 'ai' };
  }
  // 第 3 步：Layer 1 规则命中（inferTypeFromContent 返回具体类型）→ mcp
  const inferred = inferTypeFromContent(original, suggestion);
  if (inferred) {
    return { ...issue, source: 'mcp' };
  }
  // 第 4 步：仍无法判断 → 保守 'mcp'（Layer 1 规则引擎命中优先，AI 补充场景由 SKILL 约束）
  return { ...issue, source: 'mcp' };
}

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
            offset: {
              type: 'number',
              description:
                '文档绝对偏移位置（Layer 2 输出驼峰字段，缺失时报告位置列显示「位置未知」；兼容字符串数字如 "3"，自动归一化为数值）',
            },
            length: { type: 'number', description: '问题文本长度' },
            original: { type: 'string', description: '原文（必填）' },
            suggestion: { type: 'string', description: '建议修改（必填）' },
            type: { type: 'string', description: '问题类型（如 的得混淆/重复字符/口语化 等）' },
            context: { type: 'string', description: '上下文' },
            source: { type: 'string', description: '检测来源: mcp（Layer 1）或 ai（Layer 2）' },
            paragraphIndex: { type: 'number', description: '段落索引（可选，从 1 开始）' },
            paragraph_index: {
              type: 'number',
              description:
                '段落索引蛇形旧别名（兼容存量 AI 输出，自动归一化到 paragraphIndex；兼容字符串数字）',
            },
            reason: { type: 'string', description: 'AI 检测理由（仅 source=ai 时有效）' },
          },
          required: ['original', 'suggestion'],
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
      suspected_issues: {
        type: 'array',
        description:
          '疑似问题列表（可选，Issue #116 问题十一）：AI 识别但未确认的问题，报告单独列出「待确认问题」节，不纳入五维评分',
        items: {
          type: 'object',
          properties: {
            offset: { type: 'number', description: '文档绝对偏移位置（可选）' },
            length: { type: 'number', description: '问题文本长度' },
            original: { type: 'string', description: '原文（必填）' },
            suggestion: { type: 'string', description: '疑为的修改建议（必填）' },
            type: { type: 'string', description: '问题类型（可选）' },
            context: { type: 'string', description: '上下文（可选）' },
            source: { type: 'string', description: '检测来源: mcp 或 ai' },
            paragraphIndex: { type: 'number', description: '段落索引（可选）' },
          },
          required: ['original', 'suggestion'],
        },
      },
    },
    required: ['session_id', 'issues'],
  },
};

export const proofreadAccumulateHandler: ToolHandler = async (
  args: Record<string, unknown>
): Promise<ToolCallResult> => {
  let {
    session_id,
    issues,
    doc_info,
    total_revisions,
    suspected_issues,
    _batch_id,
    _steps_log,
    _batch_allocations,
    _processed_to_paragraph,
  } = args as {
    session_id: string;
    issues?: ProofreadIssueEntry[];
    doc_info?: DocInfo;
    total_revisions?: number;
    /** 疑似问题（Issue #116 问题十一）：AI 识别但未确认的问题 */
    suspected_issues?: ProofreadIssueEntry[];
    /** 本批已校对到的最末段落索引（Issue #151 遗留修复）：服务端追踪进度，供报告硬性完整性门禁 */
    _processed_to_paragraph?: number;
    /** 批次标识（Issue #151 校对 subagent 并行重构）：执行 agent 声明本批所属批次，随凭证落盘 */
    _batch_id?: string;
    /** 本批逐步执行凭证（Issue #151 决策 5 防幻觉）：执行 agent 在 proofreadAccumulate 时一并提交，服务端落盘
     *  R1-5：除驼峰字段外，允许 snake_case 变体（如 revisions_before），服务端消费时统一兼容 */
    _steps_log?: Array<{
      step: string;
      timestamp?: number;
      paragraphIndex?: number;
      paragraph_index?: number;
      revisionsBefore?: number;
      revisionsAfter?: number;
      issuesCount?: number;
      revisions_before?: number;
      revisions_after?: number;
      issues_count?: number;
      [key: string]: unknown;
    }>;
    /** 批次分配表（Issue #151 R3-2）：规划 agent 在初始化 session 时登记分批计划，供管理 agent 调度/断点续跑 */
    _batch_allocations?: Array<{
      batchId: string;
      range: { start: number; end: number };
      status?: 'pending' | 'running' | 'done' | 'failed';
      assignee?: string;
      stepsLog?: unknown[];
    }>;
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

  // 获取或创建会话（优先内存，磁盘兑底——服务重启后可从磁盘恢复，Issue #116 问题七/九/十二）
  let session = getSessionOrLoad(session_id);
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

  // 必填字段校验（Issue #116 问题六 + session_ffa8 问题二/三 部分成功机制）：
  // original/suggestion 缺失时**不再整体拒绝整批**，而是过滤掉无效条目、只累加有效条目，
  // 返回 success=true + 明确警告（列出跳过条数、缺哪些字段、示例 original），
  // 从而避免：① AI 在批次累加失败后 session 从未建立、后续批次级联报「首次调用必须提供 doc_info」；
  // ② 一条坏数据导致整批有价值的校对结果丢失。
  // 早期暴露错误（而非报告阶段才因 .replace() 读 undefined 而崩溃）的目标由警告文本承担。
  const validIssues: ProofreadIssueEntry[] = [];
  const invalidIssues: Array<{ i: ProofreadIssueEntry; reason: string }> = [];
  for (const i of issues) {
    const missing: string[] = [];
    // Issue #116 session_ff63 问题一（P0）：原实现用 trim() 判断字段缺失，
    // 导致「异常空格 / 多余空格 / 全角空格」这类空白内容的合法校对问题（original="  "，
    // suggestion=" "）被误判为「缺字段」而整批拒绝，第一批校对结果永久丢失。
    // 修复：不再 trim 判断内容——只拒绝「字段不存在」（undefined/null/非字符串）或
    // 「真正为空字符串」（''，无原文可校对）；空白字符本身可能是文档的真实问题（异常空格），
    // 属合法校对发现，必须允许累加。
    if (
      i.original === undefined ||
      i.original === null ||
      typeof i.original !== 'string' ||
      i.original === ''
    )
      missing.push('original');
    if (
      i.suggestion === undefined ||
      i.suggestion === null ||
      typeof i.suggestion !== 'string' ||
      i.suggestion === ''
    )
      missing.push('suggestion');
    if (missing.length > 0) {
      invalidIssues.push({ i, reason: `缺 ${missing.join('/')}` });
    } else {
      validIssues.push(i);
    }
  }
  // 空 issues 数组：无校验项，直接跳过（仍可更新 total_revisions / docInfo / 初始化会话，
  // 兼容「仅携带 total_revisions / doc_info 的会话初始化调用」）。
  // 有效条目为空且确有无效条目（issues 非空但全部缺字段）时返回失败，给出更明确错误（含示例）。
  if (validIssues.length === 0 && invalidIssues.length > 0) {
    const example = ` 首条: { original: "${(invalidIssues[0].i.original || '').slice(0, 30)}", 缺字段: ${invalidIssues[0].reason} }`;
    return {
      id: uuidv4(),
      success: false,
      content: [
        {
          type: 'text',
          text:
            `issues 中 ${invalidIssues.length} 条全部缺少必填字段 original/suggestion，无有效条目可累加。\n` +
            `每条校对问题必须携带 original（原文）和 suggestion（建议修改）两个必填字段。\n` +
            example.trim() +
            `\n` +
            `请补充缺失字段后重试；若为首次调用还需携带 doc_info 初始化会话。`,
        },
      ],
      error: `issues ${invalidIssues.length} 条全部缺 original/suggestion`,
    };
  }
  const skippedInvalidCount = invalidIssues.length;
  // 部分成功：用有效条目替换 issues 供后续累加（空数组时保持空，正常走后续 total_revisions 更新）
  issues = validIssues;

  // 疑似问题必填校验（评审第 2 轮 C2）：与 issues 对称，suspected_issues 也需校验
  // original/suggestion；同样采用「部分成功」语义——过滤无效疑似条目、保留有效条目，
  // 避免一条坏数据导致整批疑似问题丢失（session_ffa8 问题三 级联失败的同类根因）。
  let skippedSuspectedCount = 0;
  if (suspected_issues && Array.isArray(suspected_issues)) {
    const validSuspected: ProofreadIssueEntry[] = [];
    for (const i of suspected_issues) {
      const missing: string[] = [];
      // Issue #116 session_ff63 问题一（P0）：与 issues 主校验一致——不再 trim 判断，
      // 只拒绝「字段不存在」或「真正为空字符串」；空白内容（异常空格等）是合法疑似问题，允许累加。
      if (
        i.original === undefined ||
        i.original === null ||
        typeof i.original !== 'string' ||
        i.original === ''
      )
        missing.push('original');
      if (
        i.suggestion === undefined ||
        i.suggestion === null ||
        typeof i.suggestion !== 'string' ||
        i.suggestion === ''
      )
        missing.push('suggestion');
      if (missing.length > 0) {
        skippedSuspectedCount++;
      } else {
        validSuspected.push(i);
      }
    }
    // 部分成功：过滤无效疑似条目，保留有效条目（含整批无效时置空）；
    // 不再因一条坏疑似数据拒绝整批（session_ffa8 问题三 级联失败的同类根因）。
    suspected_issues = validSuspected;
  }

  // 更新 docInfo（如果提供了新的）
  if (doc_info) {
    session.docInfo = doc_info;
  }

  // 更新修订数
  // R2-2（评审第 2 轮）：并行 executor 各自调用 getTrackChangesStatus 会取到不同时刻的全局修订数，
  // 直接整体覆盖存在"最后写入者胜出"的写竞争，值可能滞后/不准。
  // 修订记录是单调累积的（校对过程中替换/删除会不断新增修订），故采用**取最大值**策略：
  // 会话修订基线只增不减，无论并行 executor 何时上报，最终稳定在最大值，更接近真实最终修订数，
  // 且不改变调用方协议（无需 executor 增量上报）。
  if (typeof total_revisions === 'number') {
    if (session.totalRevisions === undefined || total_revisions > session.totalRevisions) {
      session.totalRevisions = total_revisions;
    }
  }

  // 追加 issues（#55 T2：入口统一规整 type，缺 type / type='ai' 时兜底推断；
  // 验收遗留：缺 source 时同样兜底推断，避免报告"未标注来源"失真 TC-13）
  // 「偏移 undefined」瑕疵：先归一化位置字段（蛇形 paragraph_index → 驼峰 paragraphIndex；
  // offset 仅接受绝对偏移数值，offset_in_paragraph 语义不同不兜底，缺失时报告降级「位置未知」）
  const normalizedIssues = issues.map(i =>
    normalizeIssueLocation(normalizeIssueSource(normalizeIssueType(i)))
  );
  // 本批中 offset 缺失的条数（评审 warning：返回文本需暴露这一可观测信号，
  // 报告侧「位置未知」需能区分是漏传还是计算失败）
  const missingOffsetCount = normalizedIssues.filter(i => i.offset === undefined).length;
  // 先把本批追加进会话，再做全量去重（保留历史累计语义，便于报告侧统计）
  session.issues.push(...normalizedIssues);

  // 去重（评审 warning：offset 可选后，退化键会把不同位置 issue 误判重复丢弃；
  // 三评审：去重键需与 SKILL 合并口径一致）——
  // 策略：仅对携带绝对 offset 的条目按 dedupKey(offset, original) 去重，同键时 **source=ai 优先覆盖 mcp**
  // （SKILL 合并逻辑：同位置同原文只修一次，且优先保留含 reason/更准确的 AI 条目）；
  // offset 缺失时无法确认是否为同一位置，保守不去重（保留全部）。
  const seen = new Map<string, number>(); // key → deduped 数组下标（用于 ai 覆盖 mcp）
  const deduped: ProofreadIssueEntry[] = [];
  for (const entry of session.issues) {
    if (entry.offset === undefined) {
      deduped.push(entry);
      continue;
    }
    const key = dedupKey(entry.offset, entry.original);
    const existingIdx = seen.get(key);
    if (existingIdx === undefined) {
      seen.set(key, deduped.length);
      deduped.push(entry);
    } else if (entry.source === 'ai' && deduped[existingIdx].source !== 'ai') {
      // 同位置同原文：AI 条目优先（SKILL 合并口径：优先保留含 reason/更准确的 AI 条目），
      // 用 AI 条目覆盖 MCP 条目
      // 四评审 warning（与 SKILL 2d `issue.type = existing.type` 保护对齐）：AI 条目 type
      // 兜底失败为「未分类」而 MCP 条目（Layer 1 正则命中）有具体 type 时，保留 MCP 的
      // type——否则覆盖后报告 TYPE_METRIC_MAP 查表把该问题漏入五维评分（type 失真）。
      const existing = deduped[existingIdx];
      const merged =
        entry.type === '未分类' && existing.type && existing.type !== '未分类'
          ? { ...entry, type: existing.type }
          : entry;
      deduped[existingIdx] = merged;
    } else if (
      entry.source === 'mcp' &&
      deduped[existingIdx].source === 'ai' &&
      deduped[existingIdx].type === '未分类' &&
      entry.type &&
      entry.type !== '未分类'
    ) {
      // 跨批边缘：AI 未分类条目先入（该批 Layer 1 未命中），后续批次 MCP 带具体 type 后到。
      // AI 优先语义不变（保留 AI 条目主体），但用 MCP 的具体 type 提升 AI 条目的「未分类」，
      // 避免报告五维评分漏计该问题（与批内 SKILL 合并结果对齐）。
      deduped[existingIdx] = { ...deduped[existingIdx], type: entry.type };
    }
    // 其余情况（同 source 重复 / mcp 撞 ai）保留先到者
  }
  session.issues = deduped;

  // 本批实际生效的去重数（评审 info：旧公式 beforeCount + issues.length -
  // session.issues.length 会把「跨批重复」也计为去重——第 1 批去重 1 条、
  // 第 2 批又重复 1 条会两次各报「去重 1 条」，误导口径）——
  // 按评审建议「只统计本批新增导致的去重」：对本批条目单独跑一遍同款去重逻辑
  // （不含历史），本批内部重复（同 offset 同 original 多次出现）才计入去重数；
  // 与历史重复的条目不计（那只是重复提交已有问题，不是本批新增的去重）。
  const batchSeen = new Set<string>();
  let batchDeduped = 0;
  for (const entry of normalizedIssues) {
    if (entry.offset === undefined) continue;
    const key = dedupKey(entry.offset, entry.original);
    if (batchSeen.has(key)) batchDeduped++;
    else batchSeen.add(key);
  }
  const dedupedCount = batchDeduped;

  // 疑似问题累加（Issue #116 问题十一）：AI 识别但未确认的问题，报告单独列出「待确认」
  // 支持通过 suspected_issues 参数累加，与正式问题分开存储
  // 必填校验已前置（评审第 2 轮 C2），此处不再重复；
  // 评审第 2 轮 W4：与正式 issues 一致，suspected_issues 也做去重（同 offset+original 不重复 push）
  if (suspected_issues && Array.isArray(suspected_issues)) {
    const normalizedSuspected = suspected_issues.map(i =>
      normalizeIssueLocation(normalizeIssueSource(normalizeIssueType(i)))
    );
    if (!session.suspectedIssues) {
      session.suspectedIssues = [];
    }
    // 去重：仅对携带绝对 offset 的条目按 dedupKey 去重（与正式 issues 口径一致），
    // offset 缺失时保守不去重（保留全部）
    const existingKeys = new Set(
      session.suspectedIssues
        .filter(i => i.offset !== undefined)
        .map(i => dedupKey(i.offset!, i.original))
    );
    for (const entry of normalizedSuspected) {
      if (entry.offset === undefined) {
        session.suspectedIssues.push(entry);
        continue;
      }
      const key = dedupKey(entry.offset, entry.original);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      session.suspectedIssues.push(entry);
    }
  }

  // Issue #151 R3-2：批次分配表登记（规划 agent 在初始化 session 时调用）
  // 规划 agent 一次性产出分批计划后，通过 _batch_allocations 落盘批次分配表，
  // 供管理 agent 调度（并行≤3）/ 断点续跑（非 done 批次重新入队）使用。
  // 落盘失败不阻塞主流程（返回警告而非失败），但需向 AI 暴露信号。
  let batchAllocationsPersisted = false;
  if (Array.isArray(_batch_allocations) && _batch_allocations.length > 0) {
    try {
      batchAllocationsPersisted = saveBatchAllocations(session_id, _batch_allocations as never);
    } catch {
      batchAllocationsPersisted = false;
    }
  }

  // Issue #151 决策 5 防幻觉：逐步执行凭证落盘（R3-1 修复）
  // 执行 agent 在 proofreadAccumulate 时携带 _batch_id + _steps_log 提交本批逐步凭证。
  // 服务端在此消费并追加到对应批次的 stepsLog（proofread-store 的 appendStepRecord 落盘），
  // 使管理 agent 的 getMissingSteps 监督 / 断点续跑有真实磁盘数据可依。
  // 注：governance P20 已拦截"带 _batch_id 却缺 _steps_log"的调用，此处仅做防御性兜底。
  // R1-5：对 _steps_log 条目的字段做驼峰/snake_case 兼容（如 revisions_before → revisionsBefore），
  // 避免执行 agent 输出 snake_case 被静默丢弃导致步骤凭证字段缺失。
  let stepsPersisted = false;
  if (_batch_id && Array.isArray(_steps_log) && _steps_log.length > 0) {
    try {
      let allOk = true;
      for (const rec of _steps_log) {
        const normalizeNum = (v: unknown): number | undefined =>
          typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : undefined;
        const ok = appendStepRecord(session_id, _batch_id, {
          step: rec.step as never,
          timestamp: normalizeNum(rec.timestamp) ?? Date.now(),
          paragraphIndex: normalizeNum(rec.paragraphIndex ?? rec.paragraph_index),
          revisionsBefore: normalizeNum(rec.revisionsBefore ?? rec.revisions_before),
          revisionsAfter: normalizeNum(rec.revisionsAfter ?? rec.revisions_after),
          issuesCount: normalizeNum(rec.issuesCount ?? rec.issues_count),
        });
        if (!ok) {
          allOk = false; // 批次不存在或落盘失败，停止追加并标记失败
          break;
        }
      }
      stepsPersisted = allOk;
    } catch {
      stepsPersisted = false;
    }
  }

  // 追踪校对进度（Issue #151 遗留修复）：串行/并行均上报 _processed_to_paragraph，
  // 服务端记录已校对到的最末段落，供 generateProofreadReport 硬性完整性门禁（防"中途结束就假装完成"）。
  if (
    typeof _processed_to_paragraph === 'number' &&
    Number.isFinite(_processed_to_paragraph) &&
    _processed_to_paragraph >= 1
  ) {
    const totalPara =
      typeof session.docInfo?.totalParagraphs === 'number' ? session.docInfo.totalParagraphs : 0;
    const prev = session.progress?.processedToParagraph ?? 0;
    // 取各批上报的最大值（并行多执行 agent 各自上报自己的区间终点）
    session.progress = {
      processedToParagraph: Math.max(prev, _processed_to_paragraph),
      totalParagraphs: totalPara,
      allBatchesComplete:
        totalPara > 0 ? Math.max(prev, _processed_to_paragraph) >= totalPara : undefined,
    };
  }

  // 增量落盘（Issue #116 问题十二）：每次累加后同步到磁盘，服务重启后可恢复
  // 落盘失败不阻塞主流程（返回警告而非失败），但需向 AI 暴露信号
  const diskWriteSuccess = saveSessionToDisk(session_id, session);

  return {
    id: uuidv4(),
    success: true,
    // 评审第 4 轮 W6：增加可编程字段 data.diskPersisted，供 AI 程序化判断落盘状态，
    // 而非仅解析文本警告
    data: {
      diskPersisted: diskWriteSuccess,
      // Issue #151 R3-1：暴露逐步凭证落盘状态，供管理 agent / 报告程序化判断防幻觉监督是否生效
      stepsPersisted,
      // Issue #151 R3-2：暴露批次分配表登记状态，供规划 agent 判断分批计划是否落盘成功
      batchAllocationsPersisted,
      // Issue #151 遗留修复：暴露服务端已追踪的校对进度，供 AI/管理 agent 判断覆盖是否完整
      progress:
        session.progress && typeof session.progress.processedToParagraph === 'number'
          ? session.progress
          : undefined,
    },
    content: [
      {
        type: 'text',
        text:
          `已累加 ${issues.length} 条问题到会话 ${session_id}。\n` +
          `当前会话累计: ${session.issues.length} 条问题` +
          (session.progress && typeof session.progress.processedToParagraph === 'number'
            ? `\n已校对进度: ${session.progress.processedToParagraph} / ${session.progress.totalParagraphs} 段` +
              (session.progress.allBatchesComplete
                ? '（已覆盖全文 ✅，可生成报告）'
                : '（未覆盖全文，生成报告会被完整性门禁拒绝）')
            : '') +
          (skippedInvalidCount > 0
            ? `\n⚠️ 本批 ${skippedInvalidCount} 条因缺 original/suggestion 被跳过（有效条目已累加）；请 AI 补充缺失字段后重新累加这些被跳过的问题`
            : '') +
          (skippedSuspectedCount > 0
            ? `\n⚠️ 疑似问题 ${skippedSuspectedCount} 条因缺 original/suggestion 被跳过`
            : '') +
          (dedupedCount > 0 ? `（本批去重 ${dedupedCount} 条）` : '') +
          (session.suspectedIssues && session.suspectedIssues.length > 0
            ? `；疑似问题 ${session.suspectedIssues.length} 条（待确认）`
            : '') +
          (diskWriteSuccess
            ? ''
            : `\n⚠️ 会话数据落盘失败（存储目录不可写），服务重启后数据可能丢失`) +
          (missingOffsetCount > 0
            ? `；其中 ${missingOffsetCount} 条未携带绝对 offset，未参与去重（报告位置列显示「位置未知」）`
            : '') +
          (_batch_id && Array.isArray(_steps_log) && _steps_log.length > 0
            ? stepsPersisted
              ? `\n本批 ${_batch_id} 步骤凭证已落盘（${_steps_log.length} 条）`
              : `\n⚠️ 本批 ${_batch_id} 步骤凭证落盘失败（批次不存在或存储不可写），请检查批次分配表或磁盘`
            : '') +
          (Array.isArray(_batch_allocations) && _batch_allocations.length > 0
            ? batchAllocationsPersisted
              ? `\n批次分配表已登记（${_batch_allocations.length} 批）`
              : `\n⚠️ 批次分配表登记失败（批次区间非法/重叠，或存储不可写），管理 agent 将无法调度/断点续跑；请检查批次区间是否连续且不重叠、存储是否可写`
            : '') +
          '。',
      },
    ],
  };
};

// ==================== 报告辅助（T2/T3，#55） ====================

/**
 * 问题类型 → 五维评分维度（供报告分组使用，含兜底推断后的 type）
 */
function metricForIssue(issue: ProofreadIssueEntry): ProofreadMetric | null {
  return TYPE_METRIC_MAP[issue.type] ?? null;
}

/**
 * 报告位置列展示（三阶兜底：段落 → 偏移 → 位置未知）
 *
 * 「偏移 undefined」瑕疵修复后抽取的公共函数：
 * 指标维度列表与未分类列表两处位置列逻辑相同，统一收口避免重复（评审 info）。
 * - 段落索引优先（段落  N；四轮评审 info：约定从 1 起，0/负数视为非法值不展示）
 * - 否则有数值 offset → 偏移 N（含 offset=0 合法值，用 typeof 判断而非 falsy）
 * - 否则「位置未知」——优雅降级，不再输出字面量「偏移 undefined」
 */
function formatIssueLocation(issue: ProofreadIssueEntry): string {
  // 四评审 info：paragraphIndex 约定从 1 起，非法值（0/负数）不展示「段落 N」
  // （0 不是合法段落号，AI 层误传时降级到 offset 或「位置未知」）
  if (typeof issue.paragraphIndex === 'number' && issue.paragraphIndex > 0) {
    return `段落 ${issue.paragraphIndex}`;
  }
  if (typeof issue.offset === 'number') {
    return `偏移 ${issue.offset}`;
  }
  return '位置未知';
}

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
          '报告输出文件路径（可选）。如提供，报告将写入此 .md 文件；如不提供，仅返回报告文本。\n' +
          '注意：若写入失败（路径非法/无权限/磁盘满等），本工具返回 success=false 并携带失败原因，' +
          '会话保留供重试——**落盘失败不视为报告已生成**，AI 必须修复后重试或改用 writeFile 落盘。',
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
    // Issue #116 session_ff63 问题五（P3）：AI 多次漏传 session_id。
    // 错误提示补充示例用法，引导 AI 传入正确的必填参数（用校对开始时生成的 UUID v4）。
    return {
      id: uuidv4(),
      success: false,
      content: [
        {
          type: 'text',
          text:
            `session_id 不能为空！请在 arguments 中传入必填参数 session_id（校对开始时生成的 UUID v4）。\n` +
            `正确示例：\n` +
            `  wps_office_execute({\n` +
            `    action: \"generateProofreadReport\",\n` +
            `    arguments: { session_id: \"这里填校对开始时的 UUID v4，如 550e8400-e29b-41d4-a716-446655440000\" }\n` +
            `  })\n` +
            `session_id 必须在调用 proofreadAccumulate 累加问题后保持不变，用于汇总已累加的问题生成报告。`,
        },
      ],
      error: '缺少 session_id',
    };
  }

  // 获取会话数据（优先内存，磁盘兑底——服务重启后可从磁盘恢复，Issue #116 问题七/九/十二）
  const session = getSessionOrLoad(session_id);
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

  const { issues, docInfo, createdAt, totalRevisions, suspectedIssues } = session;

  // ═══ 硬性完整性门禁（Issue #151 遗留问题彻底修复）═══
  // 背景：此前报告生成对"未完成"仅打告警不阻塞，且批次分配/进度校验全部 opt-in（依赖 AI 自愿传
  // _batch_id/_batch_allocations），导致大模型可绕过"防幻觉"机制：未跑完全部段落就调用
  // generateProofreadReport，服务端照样返回 success=true，AI 便"假装已完成"并匆忙交付报告。
  //
  // 修复：在服务端加一道**强制、非 opt-in** 的完整性门禁，以下任一未满足则**拒绝生成报告**（返回
  // success=false + 明确错误），而非仅打告警：
  //  ① 若登记了批次分配表（编排模式）：全部批次必须 done 且步骤凭证完整，且区间覆盖全文（无缺口/超界/重叠）；
  //  ② 若未登记批次分配表（串行模式）：服务端追踪的已校对进度 processedToParagraph 必须 >= docInfo.totalParagraphs。
  //  ③ 两者皆无进度依据（历史会话/异常）：保留原有告警放行，避免误伤既有合法串行流程。
  const batchAllocs = loadBatchAllocations(session_id);
  const incomplete = getIncompleteBatches(session_id);
  const totalPara = typeof docInfo?.totalParagraphs === 'number' ? docInfo.totalParagraphs : 0;
  const processedTo = session.progress?.processedToParagraph;

  // ① 编排模式（批次分配表已登记）：硬性要求全部批次完整 + 区间覆盖全文
  if (batchAllocs.length > 0) {
    const errors: string[] = [];
    if (incomplete.length > 0) {
      const list = incomplete
        .map(b => `${b.batchId}(段落${b.range.start}-${b.range.end}, ${b.status})`)
        .join(', ');
      errors.push(
        `仍有 ${incomplete.length} 批未完成（含 done 但步骤凭证不完整）：${list}。` +
          `请由管理/执行 subagent 补完这些批次并落盘完整步骤凭证后再生成报告。`
      );
    }
    // 区间覆盖完整性：合并批次区间，检查缺口/超界/重叠
    if (totalPara > 0) {
      const sorted = batchAllocs.map(b => b.range).sort((a, b) => a.start - b.start);
      let cursor = 1;
      const gaps: Array<{ start: number; end: number }> = [];
      for (const r of sorted) {
        if (r.start > cursor) gaps.push({ start: cursor, end: r.start - 1 });
        cursor = Math.max(cursor, r.end + 1);
      }
      if (cursor <= totalPara) gaps.push({ start: cursor, end: totalPara });
      if (gaps.length > 0) {
        const gs = gaps
          .map(g => (g.start === g.end ? `${g.start}` : `${g.start}-${g.end}`))
          .join(', ');
        errors.push(`批次区间未覆盖完整：段落 ${gs} 未被任何批次分配，请补充对应批次后重试。`);
      }
      const exceed = batchAllocs.filter(b => b.range.end > totalPara);
      if (exceed.length > 0) {
        errors.push(
          `批次区间超出文档总段数：${exceed.map(b => b.batchId).join(', ')} 的 end 超过 ${totalPara} 段。`
        );
      }
    }
    if (errors.length > 0) {
      return {
        id: uuidv4(),
        success: false,
        content: [
          {
            type: 'text',
            text:
              `【完整性门禁】本次校对未完整覆盖，**禁止生成报告**（防"假装完成/中途结束"）：\n` +
              errors.map(e => `- ${e}`).join('\n') +
              `\n请完成全部批次后再重新调用 generateProofreadReport。`,
          },
        ],
        error: `校对未完整完成，禁止生成报告: ${errors.join(' ')}`,
      };
    }
  } else if (typeof processedTo === 'number' && totalPara > 0 && processedTo < totalPara) {
    // ② 串行模式：有明确进度且未覆盖全文 → 拒绝生成报告（防"中途结束就假装完成"）
    return {
      id: uuidv4(),
      success: false,
      content: [
        {
          type: 'text',
          text:
            `【完整性门禁】本次校对尚未完成，**禁止生成报告**：\n` +
            `已校对到第 ${processedTo} 段，文档共 ${totalPara} 段，尚有 ${totalPara - processedTo} 段未校对。\n` +
            `请继续完成剩余段落（每段走完整步骤链并 proofreadAccumulate 上报 _processed_to_paragraph），` +
            `覆盖全文后再重新调用 generateProofreadReport。`,
        },
      ],
      error: `校对未覆盖全文，禁止生成报告: 已到第 ${processedTo}/${totalPara} 段`,
    };
  }

  if (issues.length === 0) {
    // 评审第 6 轮 C3：空 issues 但存在疑似问题时，不走纯空报告，
    // 需在报告中单列「待确认问题」节（疑似问题正是要供人工核对，不能丢弃）
    // 评审第 8 轮 W8：有疑似问题时，空报告收尾用中性提示（而非「✅ 未发现任何问题」），
    // 避免「✅ 未发现问题」与「⚠️ 待确认问题」语义并置引起困惑
    const hasSuspected = !!(suspectedIssues && suspectedIssues.length > 0);
    const emptyReport =
      buildEmptyReport(docInfo, createdAt, hasSuspected) +
      (hasSuspected ? buildSuspectedSection(suspectedIssues!) : '');
    let wroteFile = false;
    let writeError: string | undefined;
    if (output_file) {
      try {
        const safePath = validateFilePath(output_file, ALLOWED_WRITE_ROOTS);
        // 评审建议（#70 第 4 轮）：空报告分支补上与主分支一致的 mkdirSync 自动建父目录——
        // 同一 output_file 因问题数不同（0 vs >0）不应行为不一致：主分支会建目录，
        // 空报告分支此前直接 writeFileSync，目标父目录不存在时会失败（与其他分支口径不同）。
        const dir = path.dirname(safePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(safePath, emptyReport, 'utf-8');
        wroteFile = true;
      } catch (err) {
        // 评审建议：落盘失败必须向上游（AI 层）暴露明确信号，禁止静默吞错——
        // 否则 AI 误判"报告已生成"（用户多次遇到：落盘失败但提示已生成校对报告）。
        // 保留会话便于 AI 修正 output_file 后重试。
        writeError = err instanceof Error ? err.message : String(err);
      }
    }
    // 空报告同样回收会话——仅当写入成功（或未指定 output_file）时释放；写失败保留供重试
    if (!output_file || wroteFile) {
      releaseSession(session_id);
    }
    if (writeError) {
      // 评审建议：失败返回不内嵌完整报告全文（长文档时消耗大量 token），
      // 改为截断预览（前 1500 字）+ 报告总长度提示，AI 可修正路径后重试重新生成完整报告。
      const preview =
        emptyReport.length > 1500 ? emptyReport.slice(0, 1500) + '\n…(预览截断)' : emptyReport;
      return {
        id: uuidv4(),
        success: false,
        content: [
          {
            type: 'text',
            text:
              `⚠️ 校对报告已生成但**写入文件失败**，本次校对未完成落盘！\n\n` +
              `目标路径: ${output_file ?? '(未指定)'}\n` +
              `失败原因: ${writeError}\n\n` +
              `会话 ${session_id} 已保留，请修正路径后重新调用 generateProofreadReport（传 output_file）重试，` +
              `或改用 SKILL Step 3 的 writeFile 方案落盘。` +
              `报告全文 ${emptyReport.length} 字，本次仅返回预览：\n\n${preview}`,
          },
        ],
        error: `报告写入文件失败: ${writeError}`,
      };
    }
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
    const metric = metricForIssue(issue);
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

  // ═══════════════════════════════════════════
  // 批次完整性 + 统计准确性校验（Issue #151 校对重构，决策 3/5）
  //  - 批次完整性：存在未完成批次时标注告警，禁止"假完整"报告
  //  - 交叉校验：issue 数 vs 修订记录数（每次替换≈2 条），疑似缺失告警
  // ═══════════════════════════════════════════
  const batchAllocations = loadBatchAllocations(session_id);
  // R2-3：报告批次完整性复用 getIncompleteBatches 语义（status !== done 或 done 但步骤凭证不完整）。
  // 避免批次被谎报 done 但凭证缺失时，报告误判"全部完成"不告警（防幻觉盲区）。
  const incompleteBatches = getIncompleteBatches(session_id);
  const incompleteBatchCount = incompleteBatches.length;
  const hasIncompleteBatches = incompleteBatchCount > 0;
  // R4-2：并行区间重叠最终防线——若仍有 running 批次且段落区间相交，提示调度异常（并行隔离被破坏）
  const hasRangeConflict = hasParallelRangeConflict(session_id);
  // R11-2：并行度超限提示——WPS 单进程 COM 约束并行度 ≤3，running 批次数超过 3 时提示调度异常
  const runningBatchCount = batchAllocations.filter(b => b.status === 'running').length;
  const hasParallelOverLimit = runningBatchCount > 3;

  // R6-1：批次区间覆盖完整性校验——批次区间应连续覆盖 1..totalParagraphs 且互不重叠。
  // 若规划 agent 分批计划有遗漏/重叠，管理 agent 照单调度会漏校或重复校对。
  // 合并所有批次区间，检查是否存在未被覆盖的段落段（静态校验，不依赖 running 状态）。
  let coverageGaps: Array<{ start: number; end: number }> = [];
  const totalParagraphsNum = docInfo?.totalParagraphs ?? 0;
  if (totalParagraphsNum > 0 && batchAllocations.length > 0) {
    // 按起始位置排序，逐段合并检查缺口
    const sorted = batchAllocations.map(b => b.range).sort((a, b) => a.start - b.start);
    let cursor = 1;
    for (const r of sorted) {
      if (r.start > cursor) {
        coverageGaps.push({ start: cursor, end: r.start - 1 }); // 缺口
      }
      cursor = Math.max(cursor, r.end + 1);
    }
    if (cursor <= totalParagraphsNum) {
      coverageGaps.push({ start: cursor, end: totalParagraphsNum }); // 尾部缺口
    }
    // 去掉负向/无效区间（防御）
    coverageGaps = coverageGaps.filter(g => g.start <= g.end);
  }
  const hasCoverageGap = coverageGaps.length > 0;

  // R10-3：批次区间超出文档总段数检测（规划 agent 多登记批次）——超出部分无对应文档段落，属规划异常。
  let hasExceedRange = false;
  if (totalParagraphsNum > 0 && batchAllocations.length > 0) {
    hasExceedRange = batchAllocations.some(b => b.range.end > totalParagraphsNum);
  }

  // R8-2：批次区间重叠检测（不论状态）——规划阶段批次重叠且都已 done 时，
  // hasParallelRangeConflict（只查 running）不会触发，此处补查任意状态的区间重叠。
  let hasOverlap = false;
  if (batchAllocations.length > 0) {
    const ranges = batchAllocations.map(b => b.range);
    outer: for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i];
        const b = ranges[j];
        if (a.start <= b.end && b.start <= a.end) {
          hasOverlap = true;
          break outer;
        }
      }
    }
  }

  // 交叉校验：修订记录可解释的修复量上限 = totalRevisions
  // 每条 issue（一次修复）至少消耗 1 条修订（删除类=1，替换类=2），故 totalRevisions 条修订最多解释 totalRevisions 个 issue。
  // 当累计 issue 数 > 修订可解释的修复量时，存在"累加未落盘/批次丢失"的疑似缺失风险
  let crossCheckWarning: string | null = null;
  // 交叉校验仅在存在真实修订基线（totalRevisions > 0）时启用：
  //  - totalRevisions === 0 表示会话尚未获得修订基线数据（如 planner 初始化显式传 0），
  //    此时不能据此判定"批次丢失"，否则会对合法会话误报"疑似统计缺失"（评审第 2 轮 R2-1）。
  //  - totalRevisions === undefined 表示未提供修订数据，同样不判定。
  if (typeof totalRevisions === 'number' && totalRevisions > 0 && issues.length > 0) {
    // 每条 issue 至少对应 1 条修订（删除类 1 条 / 替换类 2 条），即 issue 数 ≤ totalRevisions 恒成立；
    // 若累计 issue 数 > totalRevisions，则必然有批次未正确累加（修订数不够解释这么多修复）。
    // 注：修正自评审第 1 轮 R1-1——旧阈值 totalRevisions*2 方向取反，漏检 2 倍。
    const maxExplainableByRevisions = totalRevisions; // 每条 issue 至少消耗 1 条修订的保守上界
    if (issues.length > maxExplainableByRevisions) {
      const suspectedMissing = issues.length - totalRevisions;
      crossCheckWarning =
        `⚠️ **疑似统计缺失**：累计 issue ${issues.length} 处，但修订记录仅 ${totalRevisions} 条。` +
        `即使按最紧口径（每条 issue 至少消耗 1 条修订，删除类修复）也无法解释 ${suspectedMissing} 处，` +
        `存在批次未正确累加/丢失的可能，请人工核对修订记录与问题清单，必要时重跑缺失批次。`;
    }
    // R7-1：反向校验——修订数远多于 issue 数（全替换修复下修订≈2×issue），可能存在未记录的修复或非校对修订。
    // 用宽松倍数（3 倍）避免 normal baseline/手动编辑误报（修订可能含校对开始前的既有修订基线）。
    const reverseThreshold = issues.length * 3;
    if (totalRevisions > reverseThreshold) {
      crossCheckWarning =
        `⚠️ **疑似未记录修复**：修订记录 ${totalRevisions} 条，但仅累计 ${issues.length} 处问题（全替换修复下修订约 2×问题数=${issues.length * 2}）。` +
        `修订数明显多于问题数，可能存在未累加的修复或非校对产生的修订，请人工核对修订记录与问题清单。`;
    }
  }

  report += `# 校对报告\n\n`;
  report += `- **文档**: ${docInfo.fileName ?? '未知'}\n`;
  report += `- **路径**: \`${docInfo.filePath ?? '未知'}\`\n`;
  report += `- **校对时间**: ${reportDate}\n`;
  report += `- **总段数**: ${docInfo.totalParagraphs ?? 0}\n`;
  report += `- **总字数**: ${docInfo.totalWords ?? 0}\n`;
  if (batchAllocations.length === 0) {
    // R10-2：未检测到批次分配表——4-subagent 重构下规划 agent 应登记批次，空分配表可能是异常
    report += `- **⚠️ 未检测到批次分配表**: 未找到任何批次（规划 agent 应通过 _batch_allocations 登记分批计划），本报告无法核验批次完整性/断点续跑\n`;
  }
  if (hasIncompleteBatches) {
    report += `- **⚠️ 批次完整性**: 仍有 ${incompleteBatchCount} 批未完成（共 ${batchAllocations.length} 批），**统计可能不全**，请先完成剩余批次再重新生成报告\n`;
  }
  if (hasRangeConflict) {
    report += `- **⚠️ 并行区间冲突**: 仍有 running 批次的段落区间相交（并行隔离被破坏），请修正调度后重新校对/生成报告\n`;
  }
  if (hasParallelOverLimit) {
    report += `- **⚠️ 并行度超限**: 当前 ${runningBatchCount} 个批次并行运行（上限 3，WPS 单进程 COM 约束），请减少并行批次或排队\n`;
  }
  if (hasCoverageGap) {
    const gaps = coverageGaps
      .map(g => (g.start === g.end ? `${g.start}` : `${g.start}-${g.end}`))
      .join(', ');
    report += `- **⚠️ 批次区间未覆盖完整**: 段落 ${gaps} 未被任何批次分配，可能漏校，请修正分批计划后重新校对/生成报告\n`;
  }
  if (hasOverlap) {
    report += `- **⚠️ 批次区间重叠**: 批次分配表中存在段落区间相交的批次（可能重复校对），请修正分批计划后重新校对/生成报告\n`;
  }
  if (hasExceedRange) {
    report += `- **⚠️ 批次区间超出文档总段数**: 存在批次结束段大于文档总段数 ${totalParagraphsNum}，规划 agent 多登记了批次，请修正分批计划后重新校对/生成报告\n`;
  }
  if (totalRevisions !== undefined) {
    // TC-12 口径：WPS 修订模式下每次替换 = 1 次删除 + 1 次插入，即 2 条修订记录。
    // 报告「发现问题」与「修订总数」是两个独立维度：发现问题按 issue 条数计；
    // 修订总数是 WPS 实际修订记录数，二者非直接相等（仅全替换类修复时修订 ≈ 问题 × 2）。
    const half = totalRevisions / 2;
    const isInteger = Number.isInteger(half);
    // 评审建议：奇数修订时显示 ≈31.5 而非向下取整的 31，避免与"不整除"提示并存造成误导
    const halfDisplay = isInteger ? String(half) : `≈${half.toFixed(1)}`;
    report += `- **修订总数**: ${totalRevisions}（修订模式实际记录数；若全部为替换类修复，等价于问题数 × 2 = ${halfDisplay}`;
    report += isInteger
      ? `，每次替换产生删除+插入 2 条修订）\n`
      : `；⚠️ 修订数为奇数（删除类修复只产生 1 条修订），不等价于问题数 × 2，请人工核对）\n`;
    report += `- **发现问题**: ${issues.length} 处（按 AI 累计 issue 条数计）\n`;
  } else {
    report += `- **发现问题**: ${issues.length} 处（问题数按 issue 条数计）\n`;
  }
  if (unknownTypeIssues.length > 0) {
    report += `- **⚠️ 未分类问题**: ${unknownTypeIssues.length} 处（未计入五维评分，见下方"未分类问题"节；请检查 AI 层是否输出 type 字段）\n`;
  }
  if (crossCheckWarning) {
    report += `\n> ${crossCheckWarning}\n`;
  }
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
      metrics: metricOrder.map(m => ({
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
      const location = formatIssueLocation(issue);
      // Issue #116 问题一：original/suggestion 缺字段时兜底为空串，避免 .replace() 读 undefined 崩溃
      const escapedOriginal = (issue.original || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const escapedSuggestion = (issue.suggestion || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      report += `| ${idx + 1} | ${location} | ${escapedOriginal} | ${escapedSuggestion} | ${issue.type} | ${issue.source === 'ai' ? 'AI' : 'MCP'} |\n`;
    });

    report += `\n`;
  }

  // 未知类型问题（兜底）— T2：降级提示，不重复计入五维（metricForIssue 返回 null 才入此列）
  if (unknownTypeIssues.length > 0) {
    report += `### ⚠️ 未分类问题（未计入五维评分） — ${unknownTypeIssues.length} 处\n\n`;
    // #55 T2：未分类问题不计入五维评分，提示补充 type 以便纳入统计
    report +=
      `> **提示**：以下问题未携带有效的 type 字段（或 type 不在 TYPE_METRIC_MAP 映射表中），` +
      `无法归入五维评分。请检查 AI 层（Layer 2）输出是否携带正确的 type 字段，` +
      `或补充 TYPE_METRIC_MAP 映射。\n\n`;
    report += `| # | 位置 | 原文 | 建议修改 | 类型 | 来源 |\n`;
    report += `|---|------|------|---------|------|------|\n`;
    unknownTypeIssues.forEach((issue, idx) => {
      const location = formatIssueLocation(issue);
      // Issue #116 问题一：original/suggestion 缺字段时兜底为空串，避免 .replace() 读 undefined 崩溃
      const escapedOriginal = (issue.original || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const escapedSuggestion = (issue.suggestion || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      report += `| ${idx + 1} | ${location} | ${escapedOriginal} | ${escapedSuggestion} | ${issue.type || '（空）'} | ${issue.source === 'ai' ? 'AI' : 'MCP'} |\n`;
    });
    report += `\n`;
  }

  // 疑似问题（Issue #116 问题十一）：AI 识别但未确认的问题，单独列出「待确认」
  if (session.suspectedIssues && session.suspectedIssues.length > 0) {
    report += `### ⚠️ 待确认问题（未修改，请人工核对） — ${session.suspectedIssues.length} 处\n\n`;
    report += `> **说明**：以下问题由 AI 在校对过程中识别为疑似问题，但尚未确认是否为真实错误，未进行修改。请人工核对后决定是否处理。\n\n`;
    report += `| # | 位置 | 原文 | 疑为 | 类型 | 来源 |\n`;
    report += `|---|------|------|------|------|------|\n`;
    session.suspectedIssues.forEach((issue, idx) => {
      const location = formatIssueLocation(issue);
      // Issue #116 问题一：兜底为空串，避免 .replace() 读 undefined 崩溃
      const escapedOriginal = (issue.original || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const escapedSuggestion = (issue.suggestion || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      report += `| ${idx + 1} | ${location} | ${escapedOriginal} | ${escapedSuggestion} | ${issue.type || '（空）'} | ${issue.source === 'ai' ? 'AI' : 'MCP'} |\n`;
    });
    report += `\n`;
  }

  // 统计摘要（T2，#55：source 缺失时单独列出，防止"正则 0 处 + AI 0 处"失真假象）
  report += `## 统计摘要\n\n`;
  const mcpCount = issues.filter(i => i.source === 'mcp').length;
  const aiCount = issues.filter(i => i.source === 'ai').length;
  const unknownSourceCount = issues.filter(i => i.source !== 'mcp' && i.source !== 'ai').length;
  report += `| 来源 | 数量 |\n`;
  report += `|------|------|\n`;
  report += `| 正则基础校对 (MCP) | ${mcpCount} 处 |\n`;
  report += `| AI 智能校对 | ${aiCount} 处 |\n`;
  if (unknownSourceCount > 0) {
    report += `| ⚠️ 未标注来源 | ${unknownSourceCount} 处 |\n`;
  }
  report += `| **合计** | **${issues.length} 处** |\n`;
  report += `| 全部已修复 | ✅ |\n`;
  if (session.suspectedIssues && session.suspectedIssues.length > 0) {
    report += `| 待确认问题 | ${session.suspectedIssues.length} 处（见「待确认问题」节） |\n`;
  }
  if (totalRevisions !== undefined) {
    const half = totalRevisions / 2;
    const isInteger = Number.isInteger(half);
    report += `\n> **TC-12 口径说明**：本报告「发现问题」按 AI 累计的 issue 条数计（共 ${issues.length} 处）；「修订总数」${totalRevisions} 条为 WPS 修订模式实际记录数（每次替换 = 删除 + 插入各 1 条修订，即若全部为替换类修复，修订记录数 ≈ 问题数 × 2）`;
    report += isInteger
      ? `。二者非直接相等关系，修订数 = 问题数 × 2 仅在所有修复均为「替换」类时成立，请以「发现问题」清单为准。\n`
      : `。⚠️ 当前修订数为奇数（删除类修复只产生 1 条修订，如“存在着→空”），修订数 ≠ 问题数 × 2，请人工核对修订记录与问题清单。\n`;
  }

  // 写入文件（如果指定）——仅当写入成功（或未指定 output_file）后才回收会话；
  // 写失败时保留会话，AI 可修正 output_file 后重试生成（评审建议：落盘失败必须向上游暴露信号，
  // 禁止静默吞错——否则 AI 误判"报告已生成"，用户多次遇到"落盘失败但提示已生成校对报告"）
  let wroteFile = false;
  let writeError: string | undefined;
  if (output_file) {
    try {
      const safePath = validateFilePath(output_file, ALLOWED_WRITE_ROOTS);
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(safePath, report, 'utf-8');
      wroteFile = true;
    } catch (err) {
      writeError = err instanceof Error ? err.message : String(err);
    }
  }

  // 报告生成后回收会话，释放内存（报告文本已固化，会话数据不再需要）
  if (!output_file || wroteFile) {
    releaseSession(session_id);
  }

  if (writeError) {
    // 落盘失败：明确返回失败（success=false + error），AI 必须重试落盘才能进入 Step 4 收尾；
    // 会话已保留（未回收），可直接修正 output_file 后重新生成。
    // 评审建议：失败返回不内嵌完整报告全文（长文档时消耗大量 token），改为截断预览。
    const preview = report.length > 1500 ? report.slice(0, 1500) + '\n…(预览截断)' : report;
    return {
      id: uuidv4(),
      success: false,
      content: [
        {
          type: 'text',
          text:
            `⚠️ 校对报告已生成但**写入文件失败**，本次校对未完成落盘！\n\n` +
            `目标路径: ${output_file}\n` +
            `失败原因: ${writeError}\n\n` +
            `会话 ${session_id} 已保留，请修正路径后重新调用 generateProofreadReport（传 output_file）重试；` +
            `或改用 SKILL Step 3 的 writeFile 方案落盘。` +
            `报告全文 ${report.length} 字，本次仅返回预览：\n\n${preview}`,
        },
      ],
      error: `报告写入文件失败: ${writeError}`,
    };
  }

  return {
    id: uuidv4(),
    success: true,
    content: [{ type: 'text', text: report }],
  };
};

// ==================== 辅助函数 ====================

/**
 * 构建「待确认问题」节（评审第 6 轮 C3 提取）：疑似问题单独列出供人工核对，不纳入五维评分。
 * 用于空 issues + 有疑似问题，以及主分支（issues > 0 时）共用。
 */
function buildSuspectedSection(suspectedIssues: ProofreadIssueEntry[]): string {
  let section = `## ⚠️ 待确认问题（未修改，请人工核对） — ${suspectedIssues.length} 处\n\n`;
  section += `> **说明**：以下问题由 AI 在校对过程中识别为疑似问题，但尚未确认是否为真实错误，未进行修改。请人工核对后决定是否处理。\n\n`;
  section += `| # | 位置 | 原文 | 疑为 | 类型 | 来源 |\n`;
  section += `|---|------|------|------|------|------|\n`;
  suspectedIssues.forEach((issue, idx) => {
    const location = formatIssueLocation(issue);
    // Issue #116 问题一：original/suggestion 缺字段时兜底为空串，避免 .replace() 读 undefined 崩溃
    const escapedOriginal = (issue.original || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const escapedSuggestion = (issue.suggestion || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    section += `| ${idx + 1} | ${location} | ${escapedOriginal} | ${escapedSuggestion} | ${issue.type || '（空）'} | ${issue.source === 'ai' ? 'AI' : 'MCP'} |\n`;
  });
  section += `\n`;
  return section;
}

/**
 * 构建空报告（0 个问题时）
 * @param hasSuspected 是否存在待确认疑似问题（评审第 8 轮 W8：有则用中性提示，
 *   避免「✅ 未发现问题」与「⚠️ 待确认问题」语义并置）
 */
function buildEmptyReport(docInfo: DocInfo, _createdAt: string, hasSuspected = false): string {
  const reportDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const summaryLine = hasSuspected
    ? `正式问题 0 处；另有待确认疑似问题，见下方「待确认问题」节，请人工核对。`
    : `✅ 文档质量优秀，未发现任何问题。`;
  return [
    `# 校对报告`,
    ``,
    `- **文档**: ${docInfo.fileName ?? '未知'}`,
    `- **路径**: \`${docInfo.filePath ?? '未知'}\``,
    `- **校对时间**: ${reportDate}`,
    `- **总段数**: ${docInfo.totalParagraphs ?? 0}`,
    `- **总字数**: ${docInfo.totalWords ?? 0}`,
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
    summaryLine,
  ].join('\n');
}

// ==================== 导出 ====================

export const proofreadReportTools: RegisteredTool[] = [
  { definition: proofreadAccumulateDefinition, handler: proofreadAccumulateHandler },
  { definition: generateProofreadReportDefinition, handler: generateProofreadReportHandler },
];

export default proofreadReportTools;
