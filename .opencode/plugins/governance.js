/**
 * governance.js — WPS 执行治理插件
 *
 * 统一管控所有 MCP 工具调用，阻止"随心所欲"的执行模式。
 *
 * ── 通用执行规则（始终生效） ──
 * 规则 G1：所有双路径工具强制走网关（DIRECT_TO_GATEWAY）
 * 规则 G2：wps_execute_method 严格受限（仅允许白名单 API）
 * 规则 G3：写操作前必须先执行读操作（readBeforeWrite）
 * 规则 G4：破坏性操作必须传递 confirm: true
 * 规则 G5：文件路径参数校验（防路径穿越）
 * 规则 G6：密码参数保护（日志脱敏 + 使用限制）
 * 规则 G7：参数范围校验（行号/列号/索引 ≥ 1）
 *
 * ── 分批校对规则（校对激活时生效） ──
 * 规则 P1-P16：继承 enforce-batch.js 的全部 11 条规则 + P12-P16 严格逐批（P12：周期未完成禁止获取下一批；P13：getDocumentTextByRange 限本批范围；P14：confirmBatchAiProofread 前必须 proofreadBasic；P15：基础校对无 issue 时禁止 AI 自行大量修复；P16：替换内容与已知 issue 交叉校验）
 * 规则 P17：禁止 AI 手动 write 伪造校对报告（报告必须走 generateProofreadReport）
 * 规则 P18：禁止重复获取已处理段落范围（回卷重扫）
 * 规则 P19-P21（Issue #151 校对 subagent 并行重构）：P19 批次归属校验（执行 agent 只取分配区间，越界拦截）；P20 逐步凭证落盘防幻觉（携带 _batch_id 必须同时携带 _steps_log）；P21 并行区间重叠检测（同一会话内并行执行 agent 区间不得相交）
 *
 * ── 模板填写工作流规则（模板填写时生效） ──
 * 规则 T1：填写前必须调用 getActiveDocument 评估文档规模
 * 规则 T2：填写前必须调用 getDocumentParagraphs 分批（≤200 段/批）
 * 规则 T3：填写前必须调用 enableTrackChanges(true) 开启修订模式
 * 规则 T4：填写后建议调用 findInDocument 检查遗漏
 * 规则 T5：批次连续性检查（同 P2，复用 getDocumentParagraphs 规则）
 * 规则 T6：禁止子串重复填写 — 若新 keyword 是已填 keyword 的子串或超串，拦截
 * 规则 T7：禁止编造 — 首次填写前必须输出"文档字段 ↔ 用户值"对照表并获用户确认
 * 规则 T8：跳过签字字段 — 含"签字/签名/签章"的关键字无需填写（需手动签章）
 * 规则 T9：日期字段推荐 underline 模式（T11 保证所有模式的值都加下划线，故 afterColon 也允许）
 * 规则 T10：禁止同一 (keyword, value) 重复填写（仅同一段落内，由 wps-com.ps1 每段落正则校验，governance 层不做跨段落拦截）
 * 规则 T11：所有填入的值必须加下划线（smartFillField 工具层自动执行，填值后立即设置 Font.Underline=1）
 */

// ==================== 常量定义 ====================

const DIRECT_TO_GATEWAY = {
  'wps-office_wps_get_active_document': 'getActiveDocument',
  'wps-office_wps_insert_text': 'insertText',
  'wps-office_wps_get_active_workbook': 'getActiveWorkbook',
  'wps-office_wps_get_cell_value': 'getCellValue',
  'wps-office_wps_set_cell_value': 'setCellValue',
  'wps-office_wps_get_active_presentation': 'getActivePresentation',
  // 五维评分校对报告工具（#25 TC-13）：MCP 侧不直连注册，但仍加入 G1 兜底拦截，
  // 若未来误注册为直接 MCP 工具也会被强制改走 wps_office_execute 网关
  'wps-office_wps_word_proofread_accumulate': 'proofreadAccumulate',
  'wps-office_wps_word_generate_proofread_report': 'generateProofreadReport',
};

const WRITE_TOOLS = new Set([
  'setCellValue',
  'setRangeData',
  'setFormula',
  'setArrayFormula',
  'insertText',
  'insertTable',
  'insertImage',
  'insertExcelImage',
  'insertPptImage',
  'insertRows',
  'insertColumns',
  'deleteRows',
  'deleteColumns',
  'clearRange',
  'mergeCells',
  'unmergeCells',
  'replaceInParagraph',
  'findReplace',
  'replaceInSheet',
  'setCellFormat',
  'setCellStyle',
  'setBorder',
  'setNumberFormat',
  'setColumnWidth',
  'setRowHeight',
  'setFont',
  'setParagraph',
  'applyStyle',
  'setSlideTitle',
  'setSlideContent',
  'setSlideNotes',
  'setSlideBackground',
  'addSlide',
  'deleteSlide',
  'duplicateSlide',
  'moveSlide',
  'addShape',
  'deleteShape',
  'addTextBox',
  'setTextBoxText',
  'deleteTextBox',
  'addComment',
  'beautifySlide',
  'beautifyAllSlides',
  'save',
  'saveAs',
  'closeDocument',
  'closePresentation',
  'closeWorkbook',
  'smartFillField',
  'replaceBookmarkContent',
]);

const READ_TOOLS = new Set([
  'getActiveDocument',
  'getActiveWorkbook',
  'getActivePresentation',
  'getDocumentText',
  'getDocumentParagraphs',
  'getDocumentStats',
  'getCellValue',
  'getRangeData',
  'getFormula',
  'getSheetList',
  'getCellInfo',
  'getSelection',
  'getSlideCount',
  'getSlideInfo',
  'getSlideTitle',
  'getSlideNotes',
  'getShapes',
  'getTextBoxes',
  'getBookmarks',
  'getComments',
  'findInDocument',
  'findInSheet',
]);

const DESTRUCTIVE_TOOLS = new Set([
  'deleteSheet',
  'deleteSlide',
  'deleteRows',
  'deleteColumns',
  'deleteShape',
  'deleteTextBox',
  'deletePptImage',
  'deleteCellComment',
  'clearRange',
  'clearFormats',
  'unmergeCells',
  'removeConditionalFormat',
  'removeDataValidation',
  'removeAnimation',
  'removeSlideTransition',
  'removePptHyperlink',
  'closeDocument',
  'closePresentation',
  'closeWorkbook',
]);

const PASSWORD_TOOLS = new Set(['protectSheet', 'unprotectSheet', 'protectWorkbook']);

const FILE_PATH_PARAMS = new Set(['filePath', 'imagePath', 'outputPath', 'path']);

const PARAM_RANGES = {
  getCellValue: { row: [1, null], col: [1, null] },
  setCellValue: { row: [1, null], col: [1, null] },
  getCellInfo: { row: [1, null], col: [1, null] },
  addCellComment: { row: [1, null], col: [1, null] },
  deleteCellComment: { row: [1, null], col: [1, null] },
  insertRows: { row: [1, null] },
  deleteRows: { row: [1, null] },
  hideRows: { row: [1, null] },
  showRows: { row: [1, null] },
  setRowHeight: { row: [1, null], height: [1, null] },
  deleteSlide: { slideIndex: [1, null] },
  switchSlide: { slideIndex: [1, null] },
  getSlideInfo: { slideIndex: [1, null] },
  getSlideTitle: { slideIndex: [1, null] },
  getSlideNotes: { slideIndex: [1, null] },
  setSlideTitle: { slideIndex: [1, null] },
  setSlideSubtitle: { slideIndex: [1, null] },
  setSlideContent: { slideIndex: [1, null] },
  setSlideNotes: { slideIndex: [1, null] },
  setSlideBackground: { slideIndex: [1, null] },
  setSlideTransition: { slideIndex: [1, null] },
  removeSlideTransition: { slideIndex: [1, null] },
  addAnimation: { slideIndex: [1, null], shapeIndex: [1, null] },
  removeAnimation: { slideIndex: [1, null], animationIndex: [1, null] },
  deleteShape: { index: [1, null] },
  duplicateShape: { index: [1, null] },
  insertTable: { rows: [1, 100], cols: [1, 100] },
  insertPptTable: { rows: [1, 100], cols: [1, 100] },
  groupRows: { startRow: [1, null], endRow: [1, null] },
};

const AI_FIXES_NO_ISSUES_LIMIT = 1;
// CR R11-1：同批重试上限（proofreadBasic 失败或 batchTruncated 输出被截断时最多允许重试 3 次），
// 超过上限后不再放行同批重试，防止 AI 无限循环。
const MAX_BATCH_RETRY_LIMIT = 3;
// Issue #229 R3-2（PR238）：单批段落数上限（getDocumentParagraphs 单次请求、P28 跳变阈值、
// P13 文本上限、R12-1 消息共用），统一抽取避免魔法数字重复导致日后调整批量上限时不一致。
const MAX_PARAGRAPHS_PER_BATCH = 200;

// 校对标准步骤链（与 wps-office-mcp proofread-store 的 PROOFREAD_STEP_CHAIN 保持一致，R4-2）
// 用于 P20 校验 _steps_log 的 step 名合法性，杜绝编造任意步骤名。
const PROOFREAD_STEP_CHAIN = [
  'getDocumentParagraphs',
  'getDocumentTextByRange',
  'proofreadBasic',
  'confirmBatchAiProofread',
  'replaceInParagraph',
  'proofreadAccumulate',
];

// P24（Issue #223 实际校对问题 P0-4）：覆盖全文后禁止继续推进校对流程的工具集合
// （PROOFREAD_STEP_CHAIN 中除 proofreadAccumulate 外——覆盖全文正是通过它上报，不能拦本动作）。
const PROOFREAD_ADVANCE_TOOLS = PROOFREAD_STEP_CHAIN.filter(function (t) {
  return t !== 'proofreadAccumulate';
});

// P16（Issue #223 实际校对问题 P0-1）：判定 findText 是否含截断展示标记（.../…/……）。
// 精确判定：省略号出现处之后若不紧跟中文字符（位于末尾或后跟数字/) /；/空格等非中文），
// 判定为「截断展示符」；若省略号后紧跟中文字符，则为文档正文合法省略号（引文/列举），不误拦。
function hasTruncationMarker(text) {
  const ellipsisPattern = /(\.\.\.|…+)/g;
  let m;
  while ((m = ellipsisPattern.exec(text)) !== null) {
    const after = text[m.index + m[0].length];
    if (after === undefined || !/[\u4e00-\u9fff]/.test(after)) {
      return true;
    }
  }
  return false;
}

const EXECUTE_METHOD_WHITELIST = new Set([
  'Application.ActiveDocument',
  'Application.ActiveWorkbook',
  'Application.ActivePresentation',
]);

// ==================== 会话隔离状态管理 ====================
// 使用 Map<sessionId, SessionState> 隔离多会话状态，防止并发污染

function createSessionState() {
  return {
    // Issue #229 问题4：跟踪当前活动文档路径，用于检测文档切换并自动重置状态。
    activeDocPath: '',
    // Issue #229 问题4：记录最近访问时间，用于 MAX_SESSIONS LRU 淘汰（最久未用优先淘汰，
    // 避免进行中的校对会话被新会话挤掉导致批次状态丢失）。
    lastAccessTime: Date.now(),
    lastBatchParaIndex: 0,
    // P25/P26（Issue #229）：本批 getDocumentParagraphs **实际返回**的末段索引（ranges 末段 index），
    // 区别于 lastBatchParaIndex（逻辑请求末段，截断/超界时可能大于实际返回末段）。
    // P25/P26 以实际返回末段为基准校验假进度/陈旧 issue，避免"宣称校对到未实际获取段落"。
    batchActualEndParaIndex: 0,
    // P25/P26（R4-1）：本批 getDocumentParagraphs **实际返回**的首段索引（ranges 首段 index）。
    // 用于 P26 issue 窗口下界。窗口应以「实际返回」的段落区间为准（batchActualStartParaIndex ..
    // batchActualEndParaIndex），而非「请求」的起始段——若本批实际返回从更靠后的段落开始
    // （起始截断/未显式给 start 时回退 ranges[0].index），以请求起始段为下界会放行「未实际
    // 返回段落」的陈旧 issue。
    batchActualStartParaIndex: 0,
    batchStartParaIndex: 0,
    docInfoFetched: false,
    batchStarted: false,
    batchCount: 0,
    trackChangesOn: false,
    aiProofreadDoneThisBatch: false,
    lastRevisionCount: 0,
    totalParagraphs: 0,
    allBatchesComplete: false,
    batchStartOffset: null,
    batchEndOffset: null,
    // Issue #229：记录本批实际请求的段落范围，用于「同批重试」放行（proofreadBasic 失败后重取本批），
    // 以及批次边界以请求参数为准（不信任输出截断处）。
    batchRequestedStart: null,
    batchRequestedEnd: null,
    // 【Issue #229 复盘修复】R5-1：本批 getDocumentParagraphs 实际返回的最后一段索引（rangeEndIdx），
    // 供 R12-1 拦截消息精确展示「未返回段落范围」，避免用原始请求 end 造成误导（如"200 之后"越过文档末尾）。
    // 注（R6-1）：与 P25/P26 用的 batchActualEndParaIndex 语义一致（均为 ranges 末段 index），
    // 分属两个 PR 引入；合并后为同一值的两个字段，仅用途不同（R12-1 消息展示 / P25/P26 窗口基准），
    // 不构成逻辑冲突，可后续统一命名。
    batchActualEndPara: 0,
    // CR R1-1：标记本批 getDocumentParagraphs 输出是否被截断（返回段数 < 请求段数），
    // 提示 AI 应用同批重试补齐段落后再校对，避免静默漏检。
    batchTruncated: false,
    // CR R11-2：同批重试计数（当 batchTruncated 或 proofreadBasic 失败时递增，
    // 超过 MAX_BATCH_RETRY_LIMIT 后不再放行同批重试，防止 AI 无限循环）。
    // CR R15-2：仅串行模式使用（retryingSameBatch/wasRetrying 在 isParallelBatch 时不生效），
    // 并行模式下由 P20 凭证校验兜底，本计数不参与并行行为判定。
    batchRetryCount: 0,
    proofreadCalledThisBatch: false,
    replaceCalledThisBatch: false,
    proofreadHadIssues: null,
    proofreadIssueOriginals: [],
    replaceCountThisBatch: 0,
    // P17（session_ffa8 问题一）：记录服务端是否已成功生成过校对报告，
    // 用于区分「合法 writeFile 落盘服务端报告」与「AI 手动 write 伪造报告」。
    reportGenerated: false,
    reportSessionId: '',
    // P23（Issue #223 实际校对问题 P0-2/P0-4）：
    // accumulateCount 记录 proofreadAccumulate 实际累加次数（首次强制 doc_info）；
    // maxReportedParagraph / fullCoverageReached 用于判定覆盖全文后强制生成收尾报告（P0-4）。
    accumulateCount: 0,
    maxReportedParagraph: 0,
    fullCoverageReached: false,
    // P19-P21（Issue #151 校对 subagent 并行重构）：执行 agent 被分配的段落区间与并行隔离
    // 管理 agent 派发执行 agent 时，通过 getDocumentParagraphs 参数 _batch_range 声明区间；
    // governance 缓存并校验后续段落请求/替换不越界，并检测同一会话内并行区间重叠。
    // R4-1：assignedRange 由单值改为按 batchId 的映射，避免并行多执行 agent 区间串扰（单值会被后声明者覆盖，
    // 导致未带 _batch_range 的请求用错误区间校验而误判越界）。
    assignedRanges: {}, // { [batchId]: { start, end } } 各执行 agent 分配的区间（按批次隔离）
    registeredRanges: [], // [{ start, end, batchId }] 会话内已登记的区间（并行隔离用，区分批次避免同批重扫误判）
    appReadState: {
      word: { activeDocRead: false },
      excel: { activeWorkbookRead: false },
      ppt: { activePresentationRead: false },
    },
    templateFilling: {
      active: false,
      docFetched: false,
      paragraphsFetched: false,
      trackChangesEnabled: false,
      fieldsFilled: 0,
      lastParagraphIndex: 0,
      fillKeywords: [],
      userConfirmed: false,
      fillHistory: [],
    },
  };
}

var sessions = new Map();
const MAX_SESSIONS = 50;

// Issue #229 问题4：完整重置校对/模板状态（文档切换时调用）。
// getActiveDocument 原有的重置逻辑只覆盖部分字段（lastBatchParaIndex/batchCount/
// fullCoverageReached 等），遗漏了 batchStarted/batchStartOffset/proofreadCalledThisBatch/
// assignedRanges/reportGenerated 等字段——若这些残留状态在切换到新文档后继续生效，
// 会与 P2/P12/P15/P16/P18/P19/P24 等规则产生误拦截。
function resetProofreadState(st) {
  st.lastBatchParaIndex = 0;
  st.batchActualEndParaIndex = 0;
  st.batchActualStartParaIndex = 0;
  st.batchStartParaIndex = 0;
  st.docInfoFetched = false;
  st.batchStarted = false;
  st.batchCount = 0;
  st.trackChangesOn = false;
  st.aiProofreadDoneThisBatch = false;
  st.lastRevisionCount = 0;
  st.totalParagraphs = 0;
  st.allBatchesComplete = false;
  st.batchStartOffset = null;
  st.batchEndOffset = null;
  st.batchRequestedStart = null;
  st.batchRequestedEnd = null;
  st.batchActualEndPara = 0;
  st.batchTruncated = false;
  // CR R11-2：重置同批重试计数。
  st.batchRetryCount = 0;
  st.proofreadCalledThisBatch = false;
  st.replaceCalledThisBatch = false;
  st.proofreadHadIssues = null;
  st.proofreadIssueOriginals = [];
  st.replaceCountThisBatch = 0;
  st.reportGenerated = false;
  st.reportSessionId = '';
  st.accumulateCount = 0;
  st.maxReportedParagraph = 0;
  st.fullCoverageReached = false;
  st.assignedRanges = {};
  st.registeredRanges = [];
}

// Issue #229 R1-1/R1-2（PR238）：真正的「规划 agent 初始化 session 首次登记」判定（P22/P23/P27 共用）。
// 仅当：串行模式（无 _batch_id）、从未实际累加（accumulateCount===0）、未上报 _processed_to_paragraph
// （初始化登记不报进度）、带非空 _batch_allocations、且无 issues 时，才视为规划初始化，豁免
// 「必须先调 proofreadBasic / 必带 _processed_to_paragraph / 必带 doc_info」等要求。
// 防止 AI 通过伪造 _batch_allocations 数组反复绕过 P27（Issue #229 R1-1：必须每批先调 proofreadBasic）。
function isPlannerInitAccumulate(innerArgs, st) {
  if (!!innerArgs._batch_id) return false; // 并行模式不豁免（由 P20 凭证兜底）
  if ((st.accumulateCount || 0) !== 0) return false; // 已实际累加过，不再是初始化登记
  if (innerArgs._processed_to_paragraph !== undefined) return false; // 初始化登记不报进度
  return (
    Array.isArray(innerArgs._batch_allocations) &&
    innerArgs._batch_allocations.length > 0 &&
    (!Array.isArray(innerArgs.issues) || innerArgs.issues.length === 0)
  );
}

function getSessionState(input) {
  // input.sessionID 是钩子回调的顶层字段；input.args.sessionID 由调用方手动注入
  var sessionId = (input && (input.sessionID || (input.args && input.args.sessionID))) || 'default';
  if (!sessions.has(sessionId)) {
    if (sessions.size >= MAX_SESSIONS) {
      // Issue #229 问题4：从 FIFO 淘汰改为 LRU 淘汰（最久未访问优先淘汰），
      // 避免正在进行的校对会话被新会话挤掉导致批次追踪状态丢失。
      var lruKey = null;
      var lruTime = Infinity;
      sessions.forEach(function (st, key) {
        var t = st.lastAccessTime || 0;
        if (t < lruTime) {
          lruTime = t;
          lruKey = key;
        }
      });
      if (lruKey) sessions.delete(lruKey);
    }
    sessions.set(sessionId, createSessionState());
  }
  var st = sessions.get(sessionId);
  st.lastAccessTime = Date.now();
  return st;
}

// ==================== 辅助函数 ====================

function parseParagraphRanges(outputText) {
  // Issue #229 问题6：用非贪婪 (.+?) 匹配 style，避免段落文本内含 [N] (style) [start-end]
  // 结构时被贪婪吞并而取错段落范围。行首锚定+非贪婪：只匹配行首首个结构。
  const regex = /^\s*\[(\d+)\] \((.+?)\)\s*\[(\d+)-(\d+)\]/gm;
  const matches = [];
  let m;
  while ((m = regex.exec(outputText)) !== null) {
    matches.push({ index: parseInt(m[1], 10), start: parseInt(m[3], 10), end: parseInt(m[4], 10) });
  }
  return matches;
}

function getOutputText(output) {
  if (!output) return '';
  if (typeof output === 'string') return output;
  // after hook format: { output: "string result", title, metadata }
  if (typeof output.output === 'string' && output.output.length > 0) return output.output;
  const result = output.result || output;
  if (typeof result === 'string') return result;
  if (typeof result?.text === 'string') return result.text;
  if (Array.isArray(result?.content)) {
    const textBlock = result.content.find(c => c?.type === 'text');
    if (textBlock?.text) return textBlock.text;
  }
  if (Array.isArray(result)) {
    const textBlock = result.find(c => c?.type === 'text');
    if (textBlock?.text) return textBlock.text;
  }
  return '';
}

/**
 * T1（#55）：从返回文本中提取可 JSON.parse 的结构化对象。
 *
 * proofreadBasic 返回格式 = 文本展示 + 末尾 JSON 行（{ "issues": [...] }）。
 * governance 需要提取最后一行 JSON（整个 JSON.stringify 单行输出）来解析 issues。
 * 兼容旧格式（整段文本即 JSON）与文本内嵌 JSON 两种场景。
 */
function extractJsonFromOutput(outputText) {
  if (!outputText) return null;
  const trimmed = outputText.trim();
  // 场景 1：整段文本就是 JSON（旧格式/直接返回 JSON 的场景）
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (_e) {
      /* fallthrough */
    }
  }
  // 场景 2：文本展示 + 末尾 JSON 行（proofreadBasic T1 新格式）
  // 从后往前找以 { 开头的行，取其后缀整块尝试 parse
  const lines = outputText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = lines.slice(i).join('\n').trim();
    if (candidate.startsWith('{')) {
      try {
        return JSON.parse(candidate);
      } catch (_e) {
        // 继续往前找
      }
    }
  }
  return null;
}

function getAppType(toolName) {
  if (
    toolName.startsWith('getActivePresentation') ||
    toolName.startsWith('wps_ppt_') ||
    toolName.startsWith('wpp_')
  )
    return 'ppt';
  if (
    toolName.startsWith('getActiveWorkbook') ||
    toolName.startsWith('wps_excel_') ||
    toolName.startsWith('et_')
  )
    return 'excel';
  if (
    toolName.startsWith('getCell') ||
    toolName.startsWith('setCell') ||
    toolName.startsWith('getRange') ||
    toolName.startsWith('setRange')
  )
    return 'excel';
  if (
    toolName.startsWith('getSheet') ||
    toolName.startsWith('createSheet') ||
    toolName.startsWith('deleteSheet')
  )
    return 'excel';
  if (
    toolName.startsWith('renameSheet') ||
    toolName.startsWith('copySheet') ||
    toolName.startsWith('switchSheet') ||
    toolName.startsWith('moveSheet')
  )
    return 'excel';
  return 'word';
}

function appTypeFromConfig(appType) {
  if (appType === 'et') return 'excel';
  if (appType === 'wpp') return 'ppt';
  if (appType === 'wps') return 'word';
  return appType;
}

function requiresReadBeforeWrite(toolName) {
  if (toolName.startsWith('get')) return false;
  if (toolName.startsWith('find')) return false;
  if (toolName.startsWith('ping') || toolName.startsWith('wireCheck')) return false;
  if (READ_TOOLS.has(toolName)) return false;
  if (WRITE_TOOLS.has(toolName)) return true;
  return false;
}

function checkParamRange(toolName, toolArgs) {
  const ranges = PARAM_RANGES[toolName];
  if (!ranges) return;
  for (const [param, [min, max]] of Object.entries(ranges)) {
    const val = toolArgs[param];
    if (val === undefined || val === null) continue;
    if (typeof val !== 'number') continue;
    if (val < min) {
      throw new Error(
        `【执行治理】${toolName} ${param}=${val} 过小（允许 ≥ ${min}）。` +
          `请确保 ${param} 从 ${min} 开始。`
      );
    }
    if (max !== null && val > max) {
      throw new Error(
        `【执行治理】${toolName} ${param}=${val} 过大（允许 ≤ ${max}）。` + `请减小 ${param} 值。`
      );
    }
  }
}

function checkFilePathSafety(args) {
  for (const key of Object.keys(args)) {
    if (!FILE_PATH_PARAMS.has(key)) continue;
    const val = String(args[key] || '');
    if (val.includes('..')) {
      throw new Error(
        `【执行治理】文件路径含路径穿越符号（..），已拒绝：${key}="${val}"。` +
          `请使用绝对路径且不含 ".."。`
      );
    }
  }
}

function checkPasswordProtection(toolName, toolArgs) {
  if (!PASSWORD_TOOLS.has(toolName)) return;
  if (toolArgs.password && toolArgs.password.length > 0) {
    console.warn(
      `【执行治理】${toolName} 使用了密码参数（已脱敏）。` + `密码不会记录日志，请确认操作范围。`
    );
  }
}

// ==================== 插件导出 ====================

export const WpsGovernancePlugin = async () => {
  return {
    // ── 执行后钩子：输出成功后才提交可变状态 ──
    // 回调签名: (input: { tool: string, sessionID: string, callID: string, args: object }, output: { content: array, isError?: boolean }) => Promise<void>
    'tool.execute.after': async (input, output) => {
      const outerTool = input.tool;

      if (outerTool === 'wps-office_wps_office_execute' || outerTool === 'wps_office_execute') {
        if (output?.isError) return;

        const toolArgs = input.args || {};
        const toolName = toolArgs.tool_name;
        const innerArgs = toolArgs.arguments || {};
        var st = getSessionState(input);

        if (toolName === 'getActiveDocument') {
          const outText = getOutputText(output);
          if (!outText) return;
          // Issue #229 问题4：解析文档路径，检测文档切换。
          // 同一 OpenCode 会话中校对多个文档时，若切换到不同文档而状态未重置，
          // P2/P18 会基于上一文档的批次进度误拦截。通过路径检测实现自动切换重置——
          // 即使 AI 在切换到新文档后未显式要求重置，治理层也能识别并隔离。
          const docPathMatch = outText.match(/路径[：:]/i)
            ? outText.match(/路径[：:]\s*(.+)/i)
            : null;
          const currentDocPath = docPathMatch ? docPathMatch[1].trim() : '';
          // 文档切换检测：已跟踪过路径且与当前不同 → 完整重置校对状态。
          // 注意：st.docInfoFetched 初始为 false，首次 getActiveDocument 也会走完整重置路径，
          // 但不影响正确性（只是重复重置空状态）。
          const docSwitched =
            !!st.activeDocPath && !!currentDocPath && currentDocPath !== st.activeDocPath;
          // CR R2-1（评审）：getActiveDocument 支持显式「重新开始」信号。
          // R1-2 为避免「同文档重复调用打断进度」移除了无条件重置 lastBatchParaIndex，
          // 但同时破坏了 R4-2「getActiveDocument 作为重新开始信号」的语义——同一文档想
          // 重新从头校对时会被 P18 回卷拦截。修复：AI 传 _restart:true 时显式完整重置
          // 批次进度（重新开始），不传则保留进度（同文档刷新）。
          const restartRequested = innerArgs._restart === true || innerArgs.restart === true;
          if (docSwitched || restartRequested) {
            resetProofreadState(st);
          }
          st.activeDocPath = currentDocPath;

          st.docInfoFetched = true;
          st.appReadState.word.activeDocRead = true;
          const paraMatch =
            outText.match(/总段数[：:]\s*(\d+)/i) || outText.match(/[Pp]aragraphs?[:\s]+(\d+)/i);
          if (paraMatch) {
            st.totalParagraphs = parseInt(paraMatch[1], 10);
          } else {
            st.totalParagraphs = 0;
          }
          st.templateFilling.active = false;
          st.templateFilling.docFetched = true;
          // R1-2（CR R1-2，Issue #229）：批次进度（lastBatchParaIndex/batchCount/batchStarted）
          // 仅在文档切换时由 resetProofreadState 完整重置；同一文档重复调用 getActiveDocument
          // 不重置批次进度，避免打断已处理的校对批次（问题4「同文档不打断」语义）。
          // allBatchesComplete 仍允许置 false：同一文档全部完成后重新 getActiveDocument，
          // 可视为重新开始收尾（P24 完整性判定不受影响）。
          st.allBatchesComplete = false;
          // R4-2（Issue #223 评审）：getActiveDocument 是「重新开始」的信号，
          // 重置 P23/P24 会话级校对状态（覆盖全文标记/累加计数/最大上报段），
          // 避免报告失败后 fullCoverageReached 锁死后续所有校对推进工具（死锁）。
          st.fullCoverageReached = false;
          st.accumulateCount = 0;
          st.maxReportedParagraph = 0;
          st.templateFilling.paragraphsFetched = false;
          st.templateFilling.trackChangesEnabled = false;
          st.templateFilling.userConfirmed = false;
          st.templateFilling.fillKeywords = [];
          st.templateFilling.fillHistory = [];
          st.templateFilling.fieldsFilled = 0;
          return;
        }

        if (toolName === 'getActiveWorkbook') {
          const outText = getOutputText(output);
          if (!outText) return;
          st.appReadState.excel.activeWorkbookRead = true;
          return;
        }

        if (toolName === 'getActivePresentation') {
          const outText = getOutputText(output);
          if (!outText) return;
          st.appReadState.ppt.activePresentationRead = true;
          return;
        }

        if (toolName === 'getDocumentParagraphs') {
          const outText = getOutputText(output);
          if (!outText) return;
          const ranges = parseParagraphRanges(outText);
          if (ranges.length === 0) return;
          // Issue #229 问题2：批次边界以「请求参数」为准，不信任输出截断处。
          // getParagraphsHandler 输出含完整段落文本，大段请求易被 MCP 截断（SKILL 已知风险）。
          // 若请求 1-100 段而输出只到 80 段，旧逻辑把 lastBatchParaIndex=80，导致 P2 连续性校验
          // 在后续批次错乱。修复：以请求的 end_paragraph 作为本批逻辑结束，使批次边界始终与
          // AI 实际请求一致。
          // CR R1-1：batchEndOffset 与 lastBatchParaIndex 保持语义一致——取 ranges 中
          // lastIndex 对应段的 end（当展示覆盖到请求 end 时）；若展示被截断（ranges 末段
          // index < 请求 end），则 batchEndOffset 回退为输出末段 end，并通过本批输出
          // 「不完整」标记引导 AI 用同批重试补齐，避免 81-100 段被静默漏检。
          const requestedStart = Number(innerArgs.start_paragraph);
          const requestedEnd = Number(innerArgs.end_paragraph);
          const hasReqStart = Number.isInteger(requestedStart) && requestedStart >= 1;
          const hasReqEnd = Number.isInteger(requestedEnd) && requestedEnd >= requestedStart;
          // Issue #229 问题5：getActiveDocument 走 launcher 回退输出 [总段数: 未知] 时 totalParagraphs=0，
          // 导致 allBatchesComplete 永不置 true、报告完整性门禁失效。
          // 兜底：从 getDocumentParagraphs 输出的 [共N段] 提取文档总段数（仅当尚未确定时）。
          // 【Issue #229 复盘修复】totalParagraphs 提取提前到 lastIndex 计算之前，
          // 以便在计算批次边界时就能感知文档实际总段数，避免请求超界被误判。
          if (!st.totalParagraphs) {
            const totalMatch = outText.match(/共(\d+)段/i);
            if (totalMatch) {
              st.totalParagraphs = parseInt(totalMatch[1], 10);
            }
          }
          // 【Issue #229 复盘修复】批次边界 clamp：当请求的 end_paragraph 超出文档实际总段数
          // （如文档 150 段却请求 1-200）时，lastBatchParaIndex 应记录实际存在的末段（150），
          // 而非超界的请求 end（200）。避免 P2 连续性/覆盖判定基于错误的超界值。
          // 输出末段索引（ranges 实际覆盖到的最后一段）。
          const rangeEndIdx = ranges[ranges.length - 1].index;
          // 本批逻辑末段：total 已知时按文档实际末段 clamp；total 未知（0）时不能把请求 end
          // 之外的推断当成文档末尾，保持按请求 end 记录（由 batchTruncated 提示补齐）。
          // 注意：total 未知时不做 clamp，避免把"请求内真实截断"误判为"已达文档末尾"（R1-1 说明）。
          const lastIndex = hasReqEnd
            ? st.totalParagraphs > 0
              ? Math.min(requestedEnd, st.totalParagraphs)
              : requestedEnd
            : rangeEndIdx;
          st.lastBatchParaIndex = lastIndex;
          // P25/P26（Issue #229）：记录本批**实际返回**末段（ranges 实际覆盖到的最后一段），
          // 供 proofreadAccumulate 的 P25/P26 以"实际获取到的段落"为基准校验假进度。
          // 注意：截断/超界时 lastBatchParaIndex（逻辑请求末段）可能大于实际返回末段，
          // 若以 lastBatchParaIndex 为基准会放行"宣称校对到未实际获取段落"的假进度。
          st.batchActualEndParaIndex = ranges[ranges.length - 1].index;
          st.batchActualStartParaIndex = ranges[0].index;
          st.batchStartParaIndex = ranges[0].index;
          st.batchStarted = true;
          st.batchCount++;
          st.batchStartOffset = ranges[0].start;
          // CR R1-1：优先用 lastIndex 对应段的 end；展示截断时用输出末段 end（AI 将据此发现
          // 本批文本不完整而重试同批补齐）。
          const endParaForLast = ranges.find(function (r) {
            return r.index === lastIndex;
          });
          st.batchEndOffset = endParaForLast ? endParaForLast.end : ranges[ranges.length - 1].end;
          // Issue #229 问题1：记录本批实际请求段落范围，供 P2/P18 「同批重试」放行（死锁修复）。
          // CR R11-1：若本次请求范围与上次记录的本批请求范围一致，则视为「同批重试」，递增计数。
          // 注意：st.batchRequestedStart 在首次调用时为 null，不算重试。
          const wasRetrying =
            !innerArgs._batch_id &&
            st.batchRequestedStart != null &&
            hasReqStart &&
            requestedStart === st.batchRequestedStart &&
            requestedEnd === st.batchRequestedEnd;
          if (wasRetrying) {
            st.batchRetryCount = (st.batchRetryCount || 0) + 1;
          } else {
            // 新批次（或首次调用）重置重试计数。
            st.batchRetryCount = 0;
          }
          st.batchRequestedStart = hasReqStart ? requestedStart : ranges[0].index;
          // 【Issue #229 复盘修复】R2-1：batchRequestedEnd 记录**原始请求的 end_paragraph**（非 clamp 值），
          // 供「同批重试」识别（AI 用相同的 start/end 重试补齐）与 R12-1 拦截消息使用。
          // 若这里记录被 clamp 的 lastIndex，则超界请求(1,200)的 batchRequestedEnd 会被记为 150，
          // AI 按消息提示用 (1,200) 重试时 batchEndArg=200 ≠ 150，永远不被识别为同批重试 → 死锁。
          st.batchRequestedEnd = hasReqEnd ? requestedEnd : rangeEndIdx;
          // 【Issue #229 复盘修复】R5-1：记录本批实际返回末段索引，供截断消息精确展示未返回范围。
          st.batchActualEndPara = rangeEndIdx;
          // CR R1-1：检测本批输出是否「不完整」（返回段数 < 请求段数，或展示未覆盖到请求 end）。
          // 输出不完整时，lastBatchParaIndex 仍按请求 end 记录以便连续性，但标记 truncationDetected
          // 提示 AI 应用同批重试补齐段落后再校对，杜绝静默漏检。proofreadBasic 文本长度校验
          // （P6b）也会因 batchEndOffset 偏小而提示文本不足，双重保险。
          {
            const requestCount =
              hasReqStart && hasReqEnd ? requestedEnd - requestedStart + 1 : null;
            const returnMatch = outText.match(/返回(\d+)段/i);
            const returnedCount = returnMatch ? parseInt(returnMatch[1], 10) : null;
            // 【Issue #229 复盘修复】修正截断判定：当返回末段已达到文档实际末尾
            // （rangeEndIdx >= totalParagraphs，前提 totalParagraphs 已知）时，说明请求超界
            // 但所有存在的段落都已返回，**不是**输出截断——不应标记 batchTruncated 引导
            // 无谓重试（重试也补不出不存在的段落）。只有确实还有段落未返回
            // （rangeEndIdx < totalParagraphs）时，才可能是 MCP 输出截断，需同批重试补齐。
            const reachedDocEnd = st.totalParagraphs > 0 && rangeEndIdx >= st.totalParagraphs;
            const truncated =
              ((returnedCount != null && requestCount != null && returnedCount < requestCount) ||
                (hasReqEnd && rangeEndIdx < requestedEnd)) &&
              !reachedDocEnd;
            st.batchTruncated = !!truncated;
          }
          st.proofreadCalledThisBatch = false;
          st.aiProofreadDoneThisBatch = false;
          st.replaceCalledThisBatch = false;
          st.proofreadHadIssues = null;
          st.proofreadIssueOriginals = [];
          st.replaceCountThisBatch = 0;
          st.templateFilling.paragraphsFetched = true;
          st.templateFilling.lastParagraphIndex = lastIndex;
          // 【Issue #229 复盘修复】R2-1：allBatchesComplete 必须以**实际返回末段 rangeEndIdx**
          // 是否覆盖到文档末尾为准，而非被 clamp 的请求末段 lastIndex。若请求超界(1,200)但输出
          // 只返回 100/150（真截断），lastIndex 被 clamp 成 150 会让本判定误置位为"已覆盖全文"，
          // 从而拦截同批重试补齐，与 batchTruncated 一起造成死锁（R2-1 复现）。
          if (st.totalParagraphs > 0 && rangeEndIdx >= st.totalParagraphs) {
            st.allBatchesComplete = true;
          }
          return;
        }

        if (toolName === 'enableTrackChanges') {
          const outText = getOutputText(output);
          if (!outText) return;
          st.trackChangesOn = innerArgs.enable === true;
          st.templateFilling.trackChangesEnabled = innerArgs.enable === true;
          return;
        }

        if (toolName === 'proofreadBasic') {
          const outText = getOutputText(output);
          if (!outText) return;
          st.proofreadCalledThisBatch = true;
          st.aiProofreadDoneThisBatch = false;
          st.replaceCalledThisBatch = false;
          // Issue #229 问题3：三态化 proofreadHadIssues，防 JSON 解析失败被误判为「无问题」。
          // 旧逻辑初始置 false，解析失败时保持 false → P15 误限流、P16 失效。
          // 现：null=未知（解析失败），false=确实无问题，true=确实有问题。
          st.proofreadHadIssues = null;
          st.proofreadIssueOriginals = [];
          // T1（#55）：proofreadBasic 返回 = 文本展示 + 末尾 JSON 行（{ issues: [...] }），
          // 从返回文本中提取 JSON 解析，P15/P16 才能拿到真实 issue 列表
          const parsed = extractJsonFromOutput(outText);
          if (parsed && Array.isArray(parsed.issues)) {
            st.proofreadHadIssues = parsed.issues.length > 0;
            st.proofreadIssueOriginals = parsed.issues.map(i => i.original).filter(Boolean);
          }
          return;
        }

        if (toolName === 'replaceInParagraph') {
          st.replaceCalledThisBatch = true;
          st.replaceCountThisBatch++;
          return;
        }

        if (toolName === 'confirmBatchAiProofread') {
          st.aiProofreadDoneThisBatch = true;
          return;
        }

        if (toolName === 'getTrackChangesStatus') {
          const outText = getOutputText(output);
          if (!outText) return;
          const match = outText.match(/当前修订数量:\s*(\d+)/);
          if (match) {
            st.lastRevisionCount = parseInt(match[1], 10);
          }
          return;
        }

        // P17（session_ffa8 问题一）：记录服务端报告生成成功状态与校对会话 ID，
        // 供 write 拦截规则区分「合法落盘服务端报告」与「AI 手动 write 伪造报告」。
        // 关键：必须区分 generateProofreadReport 的「成功」与「失败」（如未找到会话/落盘失败），
        // 否则 AI 在报告失败后仍可 write 伪造——故同时检查 success 与失败标记文本。
        if (toolName === 'generateProofreadReport') {
          const outText = getOutputText(output);
          const failureMarkers = [
            '未找到会话',
            '写入文件失败',
            '落盘失败',
            'success:false',
            '生成报告失败',
            '写文件失败',
          ];
          const hasFailureMarker = failureMarkers.some(m => outText.indexOf(m) !== -1);
          const ok = output && !output.isError && output.success !== false && !hasFailureMarker;
          st.reportGenerated = !!ok;
          st.reportSessionId = innerArgs.session_id || st.reportSessionId || '';
          return;
        }
        if (toolName === 'proofreadAccumulate') {
          // 记录会话 ID（用于识别校对流程会话），即便未生成报告也便于 P17 判断在校对流程中
          st.reportSessionId = innerArgs.session_id || st.reportSessionId || '';
          // P20（Issue #151 校对重构，决策 5）：逐步凭证落盘防幻觉——
          // 执行 agent 在并行校对中调用 proofreadAccumulate 时，若携带了 _batch_id 声明批次，
          // 则必须同时携带 _steps_log（本批逐步执行凭证），供管理 agent 审计完整步骤链，
          // 防止"大模型假装批量校对"（缺任何一步即判定该批未完成并重新派发）。
          // R8-2：校验 _steps_log 为非空数组（空数组/缺数组均拦截，避免用空凭证绕过 P20）。
          const hasStepsLog =
            Array.isArray(innerArgs._steps_log) && innerArgs._steps_log.length > 0;
          if (innerArgs._batch_id && !hasStepsLog) {
            throw new Error(
              `【执行治理】【P20】本批 ${innerArgs._batch_id} 缺少逐步执行凭证（_steps_log 需为非空数组）。\n` +
                `执行 agent 必须在校对过程中逐步落盘凭证，完整覆盖标准步骤链：\n` +
                `getDocumentParagraphs → getDocumentTextByRange → proofreadBasic → ` +
                `confirmBatchAiProofread → replaceInParagraph → proofreadAccumulate。\n` +
                `缺少任一步即视为本批未完成，将重新派发。请补充非空的 _steps_log 后再累加。`
            );
          }
          // R4-2：校验 _steps_log 的 step 名合法性——必须落在标准步骤链内，杜绝编造任意步骤名
          // （如谎报"aiDeepScan"这类不存在的步骤名绕过步骤链完整性判定）。
          // R11-1：对 step 名 trim 后校验，避免执行 agent 提交带空白步骤名被误拦。
          if (innerArgs._batch_id && hasStepsLog) {
            const illegalStep = innerArgs._steps_log.find(function (r) {
              const s = typeof r.step === 'string' ? r.step.trim() : '';
              return s === '' || PROOFREAD_STEP_CHAIN.indexOf(s) === -1;
            });
            if (illegalStep) {
              throw new Error(
                `【执行治理】【P20】本批 ${innerArgs._batch_id} 的 _steps_log 含非法步骤名 "${String(illegalStep && illegalStep.step)}"。\n` +
                  `标准步骤链：${PROOFREAD_STEP_CHAIN.join(' → ')}。`
              );
            }
          }
          // P22（Issue #151 遗留问题彻底修复）：
          // 串行/并行 proofreadAccumulate 必须上报 _processed_to_paragraph（本批已校对到的最末段落），
          // 否则服务端无法追踪真实覆盖进度，报告硬性完整性门禁无法生效（防"中途结束就假装完成"）。
          // 豁免：规划 agent 初始化 session 时的首次登记（无 issues 且带 _batch_allocations），
          // 此时尚无实际校对，不必上报进度。
          const isPlannerInit = isPlannerInitAccumulate(innerArgs, st);
          if (
            !isPlannerInit &&
            (typeof innerArgs._processed_to_paragraph !== 'number' ||
              !Number.isFinite(innerArgs._processed_to_paragraph) ||
              innerArgs._processed_to_paragraph < 1)
          ) {
            throw new Error(
              `【执行治理】【P22】proofreadAccumulate 必须携带 _processed_to_paragraph（本批已校对到的最末段落索引，≥1）。\n` +
                `服务端据此追踪文档覆盖进度；缺此字段则无法判定校对是否覆盖全文，` +
                `generateProofreadReport 将因完整性门禁拒绝生成报告。\n` +
                `请在本批校对完成后，将实际处理到的段落索引作为 _processed_to_paragraph 传入。`
            );
          }
          // P23（Issue #223 实际校对问题 P0-2/P0-3）：
          // 1) 首次实际累加（非规划初始化）必须携带 doc_info（fileName/filePath/totalParagraphs），
          //    否则服务端无法建立会话上下文，携带的 issues 会被丢弃（真实会话中前两批 7 条因此丢失）。
          // 2) 携带了 _processed_to_paragraph 上报进度却 issues 为空数组：说明 AI 在"报了进度但丢了数据"
          //    （为绕过单批 200 段上限把合并大批拆成多次空 issues 上报），直接拦截防进度造假。
          const issuesArg = innerArgs.issues;
          const hasIssuesArg = Array.isArray(issuesArg) && issuesArg.length > 0;
          if (!isPlannerInit) {
            // R4-1（Issue #223 评审）：accumulateCount 只在「全部校验通过后」递增，
            // 避免首次累加因缺 doc_info / totalParagraphs 被拦截后，重试时 isFirstRealAccumulate
            // 已变 false 导致 doc_info 强制被跳过（P0-2 可被“失败重试”绕过）。
            const isFirstRealAccumulate = (st.accumulateCount || 0) === 0;
            if (isFirstRealAccumulate) {
              const hasDocInfo =
                innerArgs.doc_info &&
                typeof innerArgs.doc_info === 'object' &&
                innerArgs.doc_info.fileName &&
                innerArgs.doc_info.filePath;
              const hasTotalParagraphs =
                innerArgs.doc_info &&
                typeof innerArgs.doc_info === 'object' &&
                typeof innerArgs.doc_info.totalParagraphs === 'number' &&
                Number.isFinite(innerArgs.doc_info.totalParagraphs) &&
                innerArgs.doc_info.totalParagraphs > 0;
              if (!hasDocInfo) {
                throw new Error(
                  `【执行治理】【P23】首次 proofreadAccumulate 必须携带 doc_info（{ fileName, filePath, totalParagraphs }）。\n` +
                    `服务端据此建立校对会话上下文；缺 doc_info 时本批携带的 issues 会被丢弃（真实会话中因此丢失 7 条）。\n` +
                    `请在首次实际累加时补齐 doc_info 后再调用。`
                );
              }
              if (!hasTotalParagraphs) {
                throw new Error(
                  `【执行治理】【P23】首次 proofreadAccumulate 的 doc_info 必须携带 totalParagraphs（正整数，文档总段数）。\n` +
                    `服务端据此判定全文覆盖进度；缺 totalParagraphs 时覆盖全文判定无法生效，` +
                    `P24 收尾报告强制将失效（P0-4）。请先 getActiveDocument 获取总段数后携带。`
                );
              }
              // 记录文档总段数（用于后续判定是否覆盖全文并强制收尾报告 P0-4）
              // CR R14-1：若 st.totalParagraphs 已通过 getActiveDocument 或 getDocumentParagraphs
              // 的「共N段」确定，则校验 doc_info.totalParagraphs 是否一致——AI 传入的总段数
              // 若与已知文档总段数不符，说明 AI 编造/写错了 doc_info，会导致覆盖判定错乱
              // （fullCoverageReached 提前触发、段落被 P24 错误拦截）。
              if (
                st.totalParagraphs > 0 &&
                st.totalParagraphs !== innerArgs.doc_info.totalParagraphs
              ) {
                throw new Error(
                  `【执行治理】【P23】doc_info.totalParagraphs=${innerArgs.doc_info.totalParagraphs} ` +
                    `与已确认的文档总段数 ${st.totalParagraphs} 不一致。\n` +
                    `请从 getActiveDocument 获取正确的总段数后重试。`
                );
              }
              st.totalParagraphs = innerArgs.doc_info.totalParagraphs;
            }
            if (
              innerArgs._processed_to_paragraph !== undefined &&
              !hasIssuesArg &&
              !isFirstRealAccumulate
            ) {
              throw new Error(
                `【执行治理】【P23】proofreadAccumulate 上报了 _processed_to_paragraph=${innerArgs._processed_to_paragraph} 但 issues 为空数组。\n` +
                  `这属于"报了进度但丢了数据"的进度造假（为绕过单批增量上限把大批拆成多次空上报）。\n` +
                  `禁止用空 issues 填充进度。请把本批真实发现的校对问题放入 issues 后再累加；` +
                  `若本批确实无问题，请核对是否有未修复/未累加的 issue。`
              );
            }
            // ── P25/P26（Issue #229 实际校对问题：假装校对 / 假进度 / 提前出报告）──
            // 根因回顾：真实会话中 AI 对第 13 批及之后（1201-4468 段）仅 getDocumentParagraphs
            // 视觉扫描、不调 proofreadBasic 就跳过；又用「空 issues」+ 跳跃式 _processed_to_paragraph
            // （100→600→800→1500→2500→3500→4468）上报假进度，并反复塞入第 644/899 段的陈旧 issue
            // 填充 issues 数组绕过 P23 空数组拦截，最终伪造覆盖全文并生成虚假报告。此处强制：
            //  P25：_processed_to_paragraph 不得超过本批实际获取到的段落（batchActualEndParaIndex），
            //       杜绝「没取到 N 段却宣称校对到 N 段」的假进度。
            //  P26：本批上报的 issues 其 paragraphIndex 必须落在「当前批窗口」内
            //       （batchRequestedStart .. batchActualEndParaIndex），禁止复用旧批次的陈旧 issue 来
            //       填充 issues 数组以绕过 P23 空数组校验（假进度）。
            // 串行模式才做这两项严格校验（并行模式由 P19 区间归属 + P20 凭证兜底）。
            // 【联动修复】基准用 batchActualEndParaIndex（本批**实际返回**末段）而非 lastBatchParaIndex
            // （逻辑请求末段）——截断/超界时 lastBatchParaIndex 可能大于实际返回末段，若以其为基准
            // 会放行「宣称校对到未实际获取段落」的假进度（与超界/截断治理 PR233 联动的一致基准）。
            const isParallelBatch = !!innerArgs._batch_id;
            if (!isParallelBatch) {
              const actualEndParaIndex = st.batchActualEndParaIndex || st.lastBatchParaIndex || 0;
              // P25：进度不得超实际获取段落
              if (
                innerArgs._processed_to_paragraph !== undefined &&
                actualEndParaIndex > 0 &&
                innerArgs._processed_to_paragraph > actualEndParaIndex
              ) {
                throw new Error(
                  `【执行治理】【P25】_processed_to_paragraph=${innerArgs._processed_to_paragraph} ` +
                    `超过本批实际获取到的段落 ${actualEndParaIndex}。\n` +
                    `你尚未通过 getDocumentParagraphs 获取到段落 ${innerArgs._processed_to_paragraph}，` +
                    `不能宣称已校对到该段落（假进度）。请逐批真实获取并校对，本批进度应 ≤ ${actualEndParaIndex}。`
                );
              }
              // P25b（R5-1）：进度不得回退（会话内单调不减）。本批上报的 _processed_to_paragraph
              // 若小于本会话此前已上报的最大进度，说明 AI 在重新上报旧批次/乱序上报，会破坏 P24
              // 全文覆盖判定（fullCoverageReached 依赖 maxReportedParagraph 单调推进）。
              // 同批重试（失败后重报同一批）会上报相同值，不受影响；仅拦截「回退到更小值」。
              if (
                innerArgs._processed_to_paragraph !== undefined &&
                (st.maxReportedParagraph || 0) > 0 &&
                innerArgs._processed_to_paragraph < st.maxReportedParagraph
              ) {
                throw new Error(
                  `【执行治理】【P25b】_processed_to_paragraph=${innerArgs._processed_to_paragraph} ` +
                    `小于本会话已上报的最大进度 ${st.maxReportedParagraph}（进度回退）。\n` +
                    `请按批次顺序逐批推进进度，禁止重新上报更早批次的旧进度（会破坏全文覆盖判定）。`
                );
              }
              // P28（Issue #229 实际校对问题：批次跳跃式假进度）：
              // 本批上报的 _processed_to_paragraph 相对上次成功上报的最大进度，必须逐批连续推进
              // （跳变 ≤ 单批上限 200 段）。真实会话（ses_fb8c）中 AI 在最后阶段从 1400 直接
              // 跳到 5550（跳变 4150 段），宣称已校对全文——即使中间批次调用了 getDocumentParagraphs
              // 获取过段落但从未调用 proofreadBasic 校对，也属于假进度。P28 强制：进度只能
              // 逐批（≤200 段/批）连续推进，禁止一次跳过多个批次。
              // 豁免：首次上报（maxReportedParagraph=0）时允许任意值（这是第一批）；同批重试
              // 上报相同值不受影响（P25b 已覆盖回退拦截）。
              if (
                innerArgs._processed_to_paragraph !== undefined &&
                (st.maxReportedParagraph || 0) > 0 &&
                innerArgs._processed_to_paragraph - (st.maxReportedParagraph || 0) >
                  MAX_PARAGRAPHS_PER_BATCH
              ) {
                throw new Error(
                  `【执行治理】【P28】_processed_to_paragraph=${innerArgs._processed_to_paragraph} ` +
                    `相对上次上报的最大进度 ${st.maxReportedParagraph} 跳变 ` +
                    `${innerArgs._processed_to_paragraph - st.maxReportedParagraph} 段，超过单批上限 ${MAX_PARAGRAPHS_PER_BATCH}。\n` +
                    `进度必须逐批连续推进，禁止跳过中间批次。请先获取并校对中间批次段落 ` +
                    `（每批 ≤${MAX_PARAGRAPHS_PER_BATCH} 段，调用 getDocumentParagraphs → proofreadBasic 完整走链），再逐批上报。`
                );
              }
              // P26：issues 必须属于当前批窗口（防复用陈旧 issue 填充）
              if (Array.isArray(issuesArg) && issuesArg.length > 0 && actualEndParaIndex > 0) {
                // 批窗口下界：以本批**实际返回**的首段（batchActualStartParaIndex）为准，
                // 使窗口 = [实际返回首段 .. 实际返回末段]，与 P25 的末段基准一致。
                // （R4-1：不要用 batchRequestedStart——若本批实际返回从更靠后的段落开始，
                //  用请求起始段为下界会放行「未实际返回段落」的陈旧 issue。）
                const winStart =
                  st.batchActualStartParaIndex > 0
                    ? st.batchActualStartParaIndex
                    : st.batchRequestedStart || actualEndParaIndex;
                for (const it of issuesArg) {
                  const pid =
                    it &&
                    (typeof it.paragraphIndex === 'number'
                      ? it.paragraphIndex
                      : typeof it.paragraph_index === 'number'
                        ? it.paragraph_index
                        : undefined);
                  if (pid !== undefined && (pid < winStart || pid > actualEndParaIndex)) {
                    throw new Error(
                      `【执行治理】【P26】本批上报的 issue 段落索引 ${pid} 不在当前批窗口 ` +
                        `（段落 ${winStart}..${actualEndParaIndex}）内。\n` +
                        `禁止复用其它批次的陈旧 issue 填充 issues 数组来伪装本批进度。` +
                        `请只上报本批真实发现的校对问题。`
                    );
                  }
                }
              }
            }
            // P23 补充（Issue #223 实际校对问题 P0-4）：跟踪最大上报段落。
            // 放在 P25/P26 全部校验通过之后更新，确保 maxReportedParagraph 只反映
            // **校验通过**的进度——被 P25/P26 拦截的上报不得计入，避免污染 P25b 的
            // 单调回退基准（R5-1：被 P25 拦截的首次上报若计入 max，会误伤合法重试）。
            if (typeof innerArgs._processed_to_paragraph === 'number') {
              if (innerArgs._processed_to_paragraph > (st.maxReportedParagraph || 0)) {
                st.maxReportedParagraph = innerArgs._processed_to_paragraph;
              }
              if (
                st.totalParagraphs > 0 &&
                st.maxReportedParagraph >= st.totalParagraphs &&
                !st.reportGenerated
              ) {
                st.fullCoverageReached = true;
              }
            }
            // 全部校验通过后才递增成功累加计数（保证失败重试时首次判定不失效）
            st.accumulateCount = (st.accumulateCount || 0) + 1;
          }
          return;
        }

        if (toolName === 'smartFillField') {
          st.templateFilling.active = true;
          st.templateFilling.fieldsFilled++;
          const keyword = innerArgs.keyword;
          const value = innerArgs.value;
          if (keyword) {
            st.templateFilling.fillKeywords.push(keyword);
          }
          if (keyword && value !== undefined) {
            st.templateFilling.fillHistory.push({ keyword, value, underline: true });
          }
          if (innerArgs._field_mapping_confirmed) {
            st.templateFilling.userConfirmed = true;
          }
          return;
        }

        if (toolName === 'replaceBookmarkContent') {
          st.templateFilling.active = true;
          st.templateFilling.fieldsFilled++;
          if (innerArgs.keyword) {
            st.templateFilling.fillKeywords.push(innerArgs.keyword);
          }
          if (innerArgs.keyword && innerArgs.value !== undefined) {
            st.templateFilling.fillHistory.push({
              keyword: innerArgs.keyword,
              value: innerArgs.value,
              underline: true,
            });
          }
          return;
        }
      }
    },

    // ── 执行前钩子：所有规则校验 ──
    // 回调签名: (input: { tool: string, sessionID: string, callID: string, args: object }, output: never) => Promise<void>
    // rules: G1-G7 通用规则, P1-P16 校对规则, T1-T11 模板填写规则
    'tool.execute.before': async (input, output) => {
      const outerTool = input.tool;

      // ==================== 规则 G1：网关强制 ====================
      const gatewayName = DIRECT_TO_GATEWAY[outerTool];
      if (gatewayName) {
        throw new Error(
          `【执行治理】请通过网关调用 ${gatewayName}，不要直接调用 ${outerTool}。` +
            `使用方法：wps_office_execute({ tool_name: "${gatewayName}", arguments: {...} })`
        );
      }

      // ==================== 规则 G2：wps_execute_method 白名单 ====================
      if (outerTool === 'wps-office_wps_execute_method' || outerTool === 'wps_execute_method') {
        const args = input.args || {};
        const method = args.method || '';
        const allowed = Array.from(EXECUTE_METHOD_WHITELIST).some(a => method.startsWith(a));
        if (!allowed) {
          throw new Error(
            `【执行治理】wps_execute_method 只允许白名单 API。` +
              `当前 method="${method}" 不在白名单中。` +
              `允许的 API：${Array.from(EXECUTE_METHOD_WHITELIST).join(', ')}。` +
              `其他操作请通过 wps_office_execute 使用已注册工具。`
          );
        }
      }

      // ── 规则 P17（原生 write 分支）：禁止 AI 手动 write 伪造校对报告（session_ffa8 问题一，P0）──
      // 背景：真实会话中 AI 在 generateProofreadReport 失败后，直接用 OpenCode 原生 write 工具
      // 手动构造 Markdown 报告写入目标路径，绕过服务端真实累计的数据。此前 P17 只对
      // wps_office_execute 网关内 tool_name=write 生效，而原生 write（outerTool='write'）
      // 在上方「非网关调用直接 return」闸门就被放行，P17 根本执行不到。此处把原生 write 的
      // 拦截提升到闸门之前：写「校对报告」路径时，除非服务端已成功生成报告
      // （st.reportGenerated=true，即合法方案 B 落盘服务端返回文本），否则一律拦截。
      const isReportPath = pathStr =>
        typeof pathStr === 'string' && pathStr.indexOf('校对报告') !== -1;
      const NATIVE_WRITE_TOOLS = ['write', 'writeText', 'writeFile', 'edit'];
      if (NATIVE_WRITE_TOOLS.indexOf(outerTool) !== -1) {
        const nativeArgs = input.args || {};
        const nativePath =
          nativeArgs.path || nativeArgs.filePath || nativeArgs.file_path || nativeArgs.file;
        if (isReportPath(nativePath)) {
          const st = getSessionState(input);
          if (!st.reportGenerated) {
            throw new Error(
              `【执行治理】【P17】检测到直接写入“校对报告”路径（${nativePath}），但服务端尚未成功生成报告。\n` +
                `校对报告必须由服务端真实累计的数据生成，禁止 AI 手动 write 伪造报告。\n` +
                `请先调用 generateProofreadReport（走 wps_office_execute 网关，传 session_id + output_file）\n` +
                `由服务端生成并落盘；若需自行落盘，请用其返回的 content 文本（不得手动构造报告体）。`
            );
          }
        }
      }

      // 以下规则仅针对 wps_office_execute 网关调用
      if (outerTool !== 'wps-office_wps_office_execute' && outerTool !== 'wps_office_execute')
        return;

      const toolArgs = input.args || {};
      const toolName = toolArgs.tool_name;
      const innerArgs = toolArgs.arguments || {};
      var st = getSessionState(input);

      // 跳过检测/信息类工具
      if (!toolName) return;

      // ==================== 规则 G5：文件路径安全检查 ====================
      checkFilePathSafety(innerArgs);

      // ==================== 规则 G6：密码参数保护 ====================
      checkPasswordProtection(toolName, innerArgs);

      // ==================== 规则 G3：读前必写 ====================
      if (requiresReadBeforeWrite(toolName)) {
        const appType = appTypeFromConfig(innerArgs.appType) || getAppType(toolName);
        const state = st.appReadState[appType];
        if (state && !state.activeDocRead) {
          throw new Error(
            `【执行治理】执行 ${toolName} 前必须先读取文档状态。` +
              `请先调用 getActiveDocument(Word) / getActiveWorkbook(Excel) / ` +
              `getActivePresentation(PPT) 了解当前文档信息。`
          );
        }
      }

      // ==================== 规则 G4：破坏性操作确认 ====================
      if (DESTRUCTIVE_TOOLS.has(toolName)) {
        const confirm = innerArgs.confirm;
        if (confirm !== true) {
          throw new Error(
            `【执行治理】${toolName} 是破坏性操作，必须传递 confirm: true 确认。` +
              `请在调用参数中添加 arguments: { ..., confirm: true } 以确认此操作。`
          );
        }
      }

      // ==================== 规则 G7：参数范围校验 ====================
      checkParamRange(toolName, innerArgs);

      // ── 规则 P17：禁止 AI 手动 write 伪造校对报告（session_ffa8 问题一，P0） ──
      // 背景：真实会话中 AI 在 generateProofreadReport 失败后，直接用 writeFile/write 手动
      // 构造 Markdown 报告写入桌面（3 份数据互相矛盾），绕过了服务端真实累计的数据。
      // 处理：写「校对报告」路径时，除非服务端已成功生成报告（reportGenerated=true，
      // 即合法方案 B 落盘服务端返回文本），否则一律拦截——强制走 generateProofreadReport
      // 网关（返回 success=true 才算报告完成），而非手动 write 拼报告。
      const reportPathArg = innerArgs.filePath || innerArgs.path || innerArgs.file_path;
      if (toolName === 'writeFile' || toolName === 'write' || toolName === 'writeText') {
        if (isReportPath(reportPathArg)) {
          // 区分两种场景：
          // 1. 合法：服务端已成功生成报告（generateProofreadReport 返回 success），
          //    writeFile 落盘其返回文本（SKILL Step 3 方案 B）——放行。
          // 2. 非法：AI 从未让服务端生成报告就手动 write 自拼 Markdown 到校对报告路径
          //    （session_ffa8 问题一，AI 伪造 3 份矛盾报告）——拦截。
          if (!st.reportGenerated) {
            throw new Error(
              `【执行治理】【P17】检测到直接写入“校对报告”路径（${reportPathArg}），但服务端尚未成功生成报告。\n` +
                `校对报告必须由服务端真实累计的数据生成，禁止 AI 手动 write 伪造报告。\n` +
                `请先调用 generateProofreadReport（走 wps_office_execute 网关，传 session_id + output_file）\n` +
                `由服务端生成并落盘；若需自行落盘，请用其返回的 content 文本（不得手动构造报告体）。`
            );
          }
        }
      }

      // ── 以下为分批校对专用规则（P1-P11） ──

      if (toolName === 'getActiveDocument' || toolName === 'enableTrackChanges') {
        return;
      }

      // P24（Issue #223 实际校对问题 P0-4）：覆盖全文后强制生成报告
      // 真实会话中 AI 空上报到 2518（覆盖全文）后未调用 generateProofreadReport 就直接结束，
      // 用户拿到的只是 AI 编造的内容而非服务端真实报告。当累计进度已达 totalParagraphs 且
      // 服务端尚未成功生成报告时，禁止继续推进校对流程（获取段落/基础校对/确认/替换），
      // 强制先生成收尾报告。
      // 注意：不拦截 proofreadAccumulate（覆盖全文正是通过它上报，不能拦本动作）、
      //       generateProofreadReport（收尾报告本身）、getActiveDocument / enableTrackChanges /
      //       getTrackChangesStatus / save（结束前收尾/保存类操作）。
      if (
        PROOFREAD_ADVANCE_TOOLS.indexOf(toolName) !== -1 &&
        !st.reportGenerated &&
        st.fullCoverageReached
      ) {
        throw new Error(
          `【执行治理】【P24】文档已覆盖全文（累计到段落 ${st.maxReportedParagraph}/${st.totalParagraphs}），` +
            `但尚未调用 generateProofreadReport 生成收尾报告。\n` +
            `覆盖全文后必须调用 generateProofreadReport（走 wps_office_execute 网关，传 session_id + output_file）\n` +
            `生成服务端真实累计数据的六维报告，禁止继续推进校对流程。`
        );
      }

      // ── 规则 P1 + P2：getDocumentParagraphs ──
      if (toolName === 'getDocumentParagraphs') {
        // Issue #151 R1-2：并行模式（执行 agent 携带 _batch_id）下，P1/P2/P12/P18 这些
        // **基于会话级单值**（st.batchStarted/st.lastBatchParaIndex 等）的串行连续性校验不适用——
        // 并行多执行 agent 各处理独立区间，会话级单值会被互相覆盖而误拦截（如 agent B 的
        // start=101 不满足「start = lastBatchParaIndex+1」）。并行模式下由 P19 的 _batch_range
        // 区间隔离承担正确校验，故此处跳过程序级单值的串行连续性检查。
        const isParallelBatch = !!innerArgs._batch_id;
        // CR R3-1（评审）：提前计算本批请求范围与「同批重试」判定，供 P12/P2/P18 共用。
        // 原实现 start/end 在 P12 之后才定义，导致 proofreadBasic 失败后同批重试
        // getDocumentParagraphs 被 P12 拦截（未走完 P2/P18 的 retryingSameBatch 放行）——
        // 问题1 死锁修复不完整。修复：提前定义并让 P12 同批重试放行。
        // CR R11-3：统一做 Number 转换，防止 MCP 网关传递字符串参数时发生字符串拼接/比较失败。
        const batchStartArg = Number(innerArgs.start_paragraph) ?? 1;
        const batchEndArg = Number(innerArgs.end_paragraph) ?? batchStartArg + 199;
        const batchNotCompleted = !st.proofreadCalledThisBatch || st.batchTruncated === true;
        // CR R11-1：同批重试次数上限。batchRetryCount 在 after hook 的 getDocumentParagraphs
        // 成功处理中递增（当 retryingSameBatch 为 true 时），超过上限后不再放行同批重试，
        // 防止 AI 因 batchTruncated 持续为 true 而陷入无限循环。
        const retryingSameBatch =
          !isParallelBatch &&
          st.batchRequestedStart != null &&
          batchStartArg === st.batchRequestedStart &&
          batchEndArg === st.batchRequestedEnd &&
          batchNotCompleted &&
          (st.batchRetryCount || 0) < MAX_BATCH_RETRY_LIMIT;
        if (!isParallelBatch && st.allBatchesComplete) {
          throw new Error(
            `【执行治理】所有 ${st.batchCount} 批已全部完成（段落 1-${st.lastBatchParaIndex}/${st.totalParagraphs}）。\n` +
              `请直接生成校对报告（.校对报告.md），不要再调用 getDocumentParagraphs。`
          );
        }
        if (
          !isParallelBatch &&
          st.batchStarted &&
          !st.proofreadCalledThisBatch &&
          !retryingSameBatch
        ) {
          throw new Error(
            `【执行治理】【P12】当前批（段落 ${st.batchStartParaIndex}-${st.lastBatchParaIndex}）` +
              `尚未调用 proofreadBasic，不得获取下一批。\n` +
              `每批必须先调 proofreadBasic 进行基础校对，禁止仅凭视觉判断跳过。`
          );
        }
        if (
          !isParallelBatch &&
          st.batchStarted &&
          st.proofreadCalledThisBatch &&
          !st.aiProofreadDoneThisBatch &&
          !retryingSameBatch
        ) {
          throw new Error(
            `【执行治理】【P12】当前批的 AI 智能校对尚未确认。` +
              `调完 proofreadBasic 后必须调用 confirmBatchAiProofread 确认 AI 校对完成。`
          );
        }
        if (
          !isParallelBatch &&
          st.batchStarted &&
          st.proofreadCalledThisBatch &&
          st.proofreadHadIssues === true &&
          !st.replaceCalledThisBatch &&
          !retryingSameBatch
        ) {
          throw new Error(
            `【执行治理】【P12】当前批（段落 ${st.batchStartParaIndex}-${st.lastBatchParaIndex}）` +
              `的校对问题尚未修复，不得获取下一批。\n` +
              `请先调用 replaceInParagraph 完成本批修复。`
          );
        }
        if (!st.docInfoFetched) {
          throw new Error(
            `【执行治理】请先调用 getActiveDocument 了解文档总段落数，` + `再获取段落列表。`
          );
        }
        const start = batchStartArg;
        const end = batchEndArg;
        const count = end - start + 1;
        if (start < 1) {
          throw new Error(`【执行治理】start_paragraph 必须 ≥ 1（当前值: ${start}）。`);
        }
        if (end < start) {
          throw new Error(
            `【执行治理】end_paragraph（${end}）必须 ≥ start_paragraph（${start}）。`
          );
        }
        if (count > MAX_PARAGRAPHS_PER_BATCH) {
          throw new Error(
            `【执行治理】getDocumentParagraphs 单次请求 ${count} 段，` +
              `超过上限 200 段。请分多次获取。`
          );
        }
        if (!isParallelBatch && st.lastBatchParaIndex === 0 && start !== 1) {
          throw new Error(
            `【执行治理】首次 getDocumentParagraphs 必须从第 1 段开始（当前 start=${start}）。`
          );
        }
        // Issue #229 问题1（死锁修复）：「同批重试」放行。
        // 当 getDocumentParagraphs 成功后 proofreadBasic 连续失败（COM 超时）时，AI 需重新获取
        // 当前批段落文本重试。旧逻辑因 start !== lastBatchParaIndex+1 拦截同批重取，且取下一批被
        // P12 拦截、回卷被 P18 拦截，唯一出路是 getActiveDocument 重置（丢失全部进度）——死锁。
        // 修复：请求范围与本批实际请求范围一致时视为「重试同批」，放行 P2/P18 的连续性与回卷检查。
        // CR R1-3：同批重试仅在本批「尚未走完」时放行——即本批尚未调用 proofreadBasic，
        // 或本批输出被截断（batchTruncated，需重取补齐段落）。若本批已完整走完
        // （proofreadCalledThisBatch=true 且未截断），则不再放行同范围重取，避免多余重复获取。
        if (
          !isParallelBatch &&
          st.lastBatchParaIndex > 0 &&
          start !== st.lastBatchParaIndex + 1 &&
          !retryingSameBatch
        ) {
          if (start !== 1) {
            throw new Error(
              `【执行治理】批次不连续：上一批结束于段落 ${st.lastBatchParaIndex}，` +
                `当前批从段落 ${start} 开始。批次必须连续或从第 1 段重新开始。`
            );
          }
        }
        // ── 规则 P18：禁止重复获取已处理段落范围（session_ffa8 问题四）──
        // 真实会话中 AI 在已处理完第 1-2 批后，再次 getDocumentParagraphs(start=1, end=201)
        // 把已检查过的段落重复跑了一遍，浪费 token 且使批次语义混乱。
        // 这里拦截「start=1 且已有已处理批次」的重复回卷获取；如需重新开始请先 getActiveDocument 重置。
        // Issue #151 R1-2：并行模式下跳过（P19 的 _batch_range 区间隔离已按批次校验归属，
        // 各执行 agent 独立区间不适用全局 lastBatchParaIndex 的回卷判断）。
        // Issue #229 问题1（死锁修复）：第一批（start=1）同批重试不受 P18 回卷拦截。
        if (!isParallelBatch && st.lastBatchParaIndex > 0 && start === 1 && !retryingSameBatch) {
          throw new Error(
            `【执行治理】【P18】禁止重复获取已处理段落：已处理到段落 ${st.lastBatchParaIndex}，` +
              `当前又从段落 1 重新获取。\n` +
              `批次必须严格连续（从段落 ${st.lastBatchParaIndex + 1} 继续），` +
              `禁止回卷重复扫描已检查过的段落范围。`
          );
        }

        // ── 规则 P19：批次归属校验（Issue #151 校对 subagent 并行重构）──
        // 执行 agent 并行校对时，只允许获取自己被分配的段落区间（管理 agent 通过 _batch_range 声明）。
        // 越界获取（试图获取其它执行 agent 的区间）直接拦截，防止并行冲突与越权扫描。
        // R4-1：区间按 batchId 隔离登记到 assignedRanges，未带 _batch_range 的请求用自己 batchId 的区间校验，
        // 避免并行多执行 agent 因单值 assignedRange 被覆盖而误判越界。
        const currentBatchId = innerArgs._batch_id || 'unset-batch';
        if (typeof innerArgs._batch_range === 'object' && innerArgs._batch_range !== null) {
          const declaredRange = innerArgs._batch_range;
          const declStart = Number(declaredRange.start);
          const declEnd = Number(declaredRange.end);
          if (
            Number.isInteger(declStart) &&
            Number.isInteger(declEnd) &&
            declStart >= 1 &&
            declEnd >= declStart
          ) {
            // 登记本批次的分配区间（R4-1：按 batchId 隔离，不覆盖其它批次）
            st.assignedRanges[currentBatchId] = { start: declStart, end: declEnd };
            // 请求区间必须落在分配区间内，否则越界（P19）
            if (start < declStart || end > declEnd) {
              throw new Error(
                `【执行治理】【P19】批次归属越界：本执行 agent 分配区间为段落 ${declStart}-${declEnd}，` +
                  `当前请求 ${start}-${end} 超出该区间。\n` +
                  `执行 agent 只能获取自己被分配的段落区间，不得越界扫描其它区间。`
              );
            }
            // 并行区间登记：若请求区间与其它**不同批次**已登记的区间重叠，判定并行冲突（P21）
            // 评审第 1 轮 R1-3/R1-4：以 _batch_id 区分批次。同一批次（同一 _batch_id）的
            // 顺序/续扫请求不算并行冲突（避免断点续跑重扫误判）；仅不同批次区间相交才拦截。
            const overlap = st.registeredRanges.some(function (r) {
              // 同批次（同 _batch_id）视为顺序处理，不判重叠；不同批次区间相交才判冲突
              return r.batchId !== currentBatchId && !(end < r.start || start > r.end);
            });
            if (overlap) {
              throw new Error(
                `【执行治理】【P21】并行区间重叠：请求区间 ${start}-${end}（批次 ${currentBatchId}）与其它批次已登记的区间 ${JSON.stringify(st.registeredRanges)} 相交。\n` +
                  `并行执行 agent 必须处理互不重叠的段落区间，防止 COM 修订冲突。`
              );
            }
            // 登记当前请求区间（供后续并行重叠检测，按批次标识）
            st.registeredRanges.push({ start: start, end: end, batchId: currentBatchId });
          }
        } else if (currentBatchId !== 'unset-batch' && st.assignedRanges[currentBatchId]) {
          // 未带 _batch_range 但携带 _batch_id 且已登记过区间 → 按本批次区间校验（R4-1：不再用会话级单值）
          const mine = st.assignedRanges[currentBatchId];
          if (start < mine.start || end > mine.end) {
            throw new Error(
              `【执行治理】【P19】批次归属越界：本执行 agent（批次 ${currentBatchId}）分配区间为段落 ${mine.start}-${mine.end}，` +
                `当前请求 ${start}-${end} 超出该区间。`
            );
          }
        }
        // 未带 _batch_range 且未带 _batch_id（或批次未登记区间）→ 不做区间兜底校验（避免单值误判），
        // 交由管理 agent 调度约束 + replaceInParagraph 段落级校验兜底。
        return;
      }

      // ── 规则 P3 + P5 + P7 + P8 + P9：proofreadBasic ──
      if (toolName === 'proofreadBasic') {
        if (!st.docInfoFetched) {
          throw new Error(
            `【执行治理】请先调用 getActiveDocument 了解文档总段落数，` +
              `输出分批校对计划后，再开始校对。`
          );
        }
        // Issue #151 R1-2：并行模式下（携带 _batch_id），st.batchStarted/st.proofreadCalledThisBatch/
        // batchStartOffset 等**会话级单值**状态会被各执行 agent 互相覆盖，不适用串行连续性校验。
        // 并行下各执行 agent 独立处理自己的批次，会话级批次状态无意义，故跳过（由 P19 区间隔离
        // + P20 凭证落盘承担正确校验）。保留 docInfoFetched/startOffset 等全局基本校验。
        const isParallelBatchProofread = !!innerArgs._batch_id;
        if (!isParallelBatchProofread && !st.batchStarted) {
          throw new Error(
            `【执行治理】请先调用 getDocumentParagraphs 获取第一批段落，` +
              `确认分批计划后再调 proofreadBasic。`
          );
        }
        const so = innerArgs.startOffset;
        if (so === undefined || so === null) {
          throw new Error(
            `【执行治理】proofreadBasic 缺少 startOffset 参数。` +
              `必须传入本批第一段的字符起始位置。`
          );
        }
        if (!isParallelBatchProofread && st.proofreadCalledThisBatch) {
          throw new Error(
            `【执行治理】本批已调过 proofreadBasic，禁止再次调用。` + `每批只准调 1 次。`
          );
        }
        if (
          !isParallelBatchProofread &&
          st.batchStartOffset !== null &&
          so !== st.batchStartOffset
        ) {
          throw new Error(
            `【执行治理】proofreadBasic startOffset=${so} 与本批第一段起始位置 ` +
              `${st.batchStartOffset} 不匹配。`
          );
        }
        // 【Issue #229 复盘修复】R12-1 截断保护需同样作用于 file_path 传参路径：
        // SKILL 推荐用 file_path 传文本给 proofreadBasic，但原实现把 R12-1 截断拦截放在
        // !innerArgs.file_path 分支内，导致 file_path 时截断保护失效——AI 可校对不完整文本，
        // 截断的段落（如请求 1-100 只返回 80 段，段落 81-100）被静默漏检。
        // 修复：将截断拦截独立于 file_path 分支，任何传参方式下 batchTruncated 都拦截。
        if (
          !isParallelBatchProofread &&
          st.batchTruncated &&
          (st.batchRetryCount || 0) < MAX_BATCH_RETRY_LIMIT
        ) {
          // R5-1：精确展示未返回段落范围，避免用原始请求 end 造成误导（如超界请求"200 之后"越过文档末尾）。
          // 未返回范围 = (实际返回末段+1) .. min(请求 end, 文档总段数)；total 未知时以请求 end 收口。
          const missFrom = (st.batchActualEndPara || 0) + 1;
          const missTo =
            st.totalParagraphs > 0
              ? Math.min(st.batchRequestedEnd, st.totalParagraphs)
              : st.batchRequestedEnd;
          throw new Error(
            `【执行治理】本批段落输出不完整（batchTruncated=true，请求段落 ${st.batchRequestedStart}-${st.batchRequestedEnd} 但只返回至段落 ${st.batchActualEndPara || 0}）。\n` +
              `禁止直接校对不完整的段落文本，段落 ${missFrom}..${missTo}（实际未返回）会被静默漏检。\n` +
              `请先用相同的 start_paragraph/end_paragraph 重试 getDocumentParagraphs 补齐段落（剩余重试次数：${MAX_BATCH_RETRY_LIMIT - (st.batchRetryCount || 0)} 次），再进入 proofreadBasic。`
          );
        }

        if (!isParallelBatchProofread && !innerArgs.file_path && st.batchEndOffset !== null) {
          const text = innerArgs.text || '';
          if (text.length === 0) {
            throw new Error(
              `【执行治理】proofreadBasic 传入文本为空。` +
                `请用 getDocumentTextByRange(startOffset=${so}, length=${st.batchEndOffset - so}) 获取文本。`
            );
          }
          if (text.length < 20) {
            throw new Error(
              `【执行治理】proofreadBasic 传入文本仅 ${text.length} 字符，` +
                `明显不足（预期约 ${st.batchEndOffset - so} 字符）。`
            );
          }
          if (st.batchStartOffset !== null) {
            const expectedLen = st.batchEndOffset - st.batchStartOffset;
            const maxLen = Math.max(expectedLen * 2, 50000);
            if (text.length > maxLen) {
              throw new Error(
                `【执行治理】【P6b】proofreadBasic 传入文本 ${text.length} 字符 ` +
                  `远超本批预期范围 ${expectedLen} 字符。` +
                  `禁止一次性校对多批。请严格每批 ≤200 段、单次 proofreadBasic 只传本批文本。`
              );
            }
          }
        }
        return;
      }

      // ── 规则 P13：getDocumentTextByRange 范围上限 ──
      if (toolName === 'getDocumentTextByRange') {
        // Issue #151 R1-2：并行模式下跳过会话级 batchStartOffset/batchEndOffset 单值校验
        // （各执行 agent 独立区间，会话级 offset 会被互相覆盖），P19 已按 _batch_range 隔离。
        const isParallelBatchText = !!innerArgs._batch_id;
        if (
          !isParallelBatchText &&
          st.batchStarted &&
          st.batchStartOffset !== null &&
          st.batchEndOffset !== null
        ) {
          const requestedLen = innerArgs.length;
          if (requestedLen !== undefined && requestedLen !== null) {
            const expectedBatchLen = st.batchEndOffset - st.batchStartOffset;
            const maxLen = Math.max(expectedBatchLen * 2, 50000);
            if (requestedLen > maxLen) {
              throw new Error(
                `【执行治理】【P13】getDocumentTextByRange length=${requestedLen} ` +
                  `远超本批预期范围长度 ${expectedBatchLen}。` +
                  `禁止一次性拉取多批文本。请只获取本批范围内的文本（≤200 段）。`
              );
            }
          }
        }
        // R7-2：并行模式下（携带 _batch_id）对 length 设兜底上限，防止执行 agent 拉取远超
        // 自己批次的超长文本（如整篇文档）导致上下文超限。兜底按每批 ≤200 段、每段约 50 字符
        // 的保守估算（上限 200×50=10000 字符）；执行 agent 应只拉自己批次文本。
        if (isParallelBatchText) {
          const requestedLen = innerArgs.length;
          if (requestedLen !== undefined && requestedLen !== null && Number(requestedLen) > 10000) {
            throw new Error(
              `【执行治理】【P13】getDocumentTextByRange length=${requestedLen} 在并行校对模式下超出单批文本上限（10000 字符，约 200 段）。` +
                `执行 agent 只能获取自己被分配批次的文本，禁止一次性拉取多批或整篇文档。`
            );
          }
        }
        return;
      }

      // ── 规则 P14：confirmBatchAiProofread 必须 proofreadBasic 已调用 ──
      if (toolName === 'confirmBatchAiProofread') {
        // Issue #151 R1-2：并行模式下跳过会话级 batchStarted/proofreadCalledThisBatch 单值校验
        const isParallelBatchConfirm = !!innerArgs._batch_id;
        if (!isParallelBatchConfirm && st.batchStarted && !st.proofreadCalledThisBatch) {
          throw new Error(
            `【执行治理】【P14】confirmBatchAiProofread 必须在 proofreadBasic 之后调用。\n` +
              `当前批尚未进行基础校对，请先调用 proofreadBasic。` +
              `（禁止跳过基础校对直接确认 AI 校对）`
          );
        }
        return;
      }

      // ── 规则 P27：proofreadAccumulate 必须先调 proofreadBasic（Issue #229 实际校对问题）──
      // 根因回顾：真实会话（ses_fb8c）中 AI 对大量批次仅 getDocumentParagraphs 视觉扫描
      // （不调 proofreadBasic 就跳过），直接 proofreadAccumulate 上报进度——P22/P23/P25/P26
      // 虽拦截空 issues 和跳跃式进度，但**没有任何规则要求「每批必须先调 proofreadBasic」**。
      // 于是 AI 可以：视觉扫描 → 直接 proofreadAccumulate（带窗口内 issue 绕过 P23/P26）→
      // 全程从不真校对但进度一路推进。此处强制：串行模式下 proofreadAccumulate 之前
      // 必须本批已调用过 proofreadBasic（proofreadCalledThisBatch=true）。
      // 豁免：规划 agent 初始化 session 时的首次登记（带 _batch_allocations 且无 issues），
      // 此时尚无实际校对，不需要 proofreadBasic。并行模式由 P20 凭证兜底，不在此强制。
      if (toolName === 'proofreadAccumulate') {
        const isParallelBatchAccumulate = !!innerArgs._batch_id;
        const isPlannerInit = isPlannerInitAccumulate(innerArgs, st);
        // R3-1（Issue #229 PR238）：P27 不仅在有批次（batchStarted）时要求先调 proofreadBasic，
        // 也在「上报了进度（_processed_to_paragraph）却从未开始批次 / 未调 proofreadBasic」时拦截。
        // 修复绕过路径：AI 不调 getDocumentParagraphs（batchStarted=false）时，P25/P26/P27 原本
        // 全部因 batchStarted 守卫短路而跳过，可凭伪造 doc_info + issue 一次上报整篇假进度。
        // 现：串行模式上报进度（_processed_to_paragraph 存在）且非规划初始化时，必须已调 proofreadBasic。
        const reportingProgress = innerArgs._processed_to_paragraph !== undefined;
        if (
          !isParallelBatchAccumulate &&
          !isPlannerInit &&
          !st.proofreadCalledThisBatch &&
          (st.batchStarted || reportingProgress)
        ) {
          throw new Error(
            `【执行治理】【P27】${
              st.batchStarted
                ? `本批（段落 ${st.batchStartParaIndex}-${st.lastBatchParaIndex}）尚未调用 proofreadBasic`
                : `尚未通过 getDocumentParagraphs 获取任何批次段落，却上报进度 ${innerArgs._processed_to_paragraph}`
            }，` +
              `禁止直接 proofreadAccumulate 上报进度。\n` +
              `每批必须完整走链：getDocumentParagraphs → getDocumentTextByRange → proofreadBasic → ` +
              `confirmBatchAiProofread → replaceInParagraph → proofreadAccumulate。\n` +
              `仅 getDocumentParagraphs 视觉扫描 + 上报进度 ≠ 校对；未获取段落就报进度更是假进度。` +
              `请先 getActiveDocument → getDocumentParagraphs 获取本批段落，再对本批调用 proofreadBasic ` +
              `完成基础校对后再累加进度。`
          );
        }
      }

      // ── 规则 P4 + P6 + P10 + P11：替换操作 ──
      if (toolName === 'replaceInParagraph' || toolName === 'findReplace') {
        if (!st.trackChangesOn) {
          throw new Error(
            `【执行治理】请先调用 enableTrackChanges(true) 开启修订模式，` + `再执行替换操作。`
          );
        }
        if (toolName === 'findReplace') {
          if (st.batchStarted) {
            throw new Error(
              `【执行治理】分批校对流程中禁止使用 findReplace（不支持修订标记）。` +
                `请改用 replaceInParagraph。`
            );
          }
          const findTextFR = innerArgs.findText || innerArgs.find || innerArgs.find_text || '';
          const colonMatchFR = findTextFR.match(/^[\u4e00-\u9fff]+[：:]/);
          if (colonMatchFR && findTextFR.length >= 2 && findTextFR.length <= 20) {
            throw new Error(
              `【执行治理·禁止低级替换】检测到用 findReplace 做模板填写。\n` +
                `findText="${findTextFR}" 看起来是一个模板字段标签。\n` +
                `请改用 smartFillField 填写模板字段。`
            );
          }
          return;
        }
        if (toolName === 'replaceInParagraph') {
          const findText = innerArgs.findText || innerArgs.find || innerArgs.find_text || '';
          const colonMatch = findText.match(/^[\u4e00-\u9fff]+[：:]/);
          if (colonMatch && findText.length >= 2 && findText.length <= 20) {
            throw new Error(
              `【执行治理·禁止低级替换】检测到用 replaceInParagraph 做模板填写。\n` +
                `findText="${findText}" 看起来是一个模板字段标签。\n` +
                `请改用 smartFillField 填写模板字段。`
            );
          }
          // P10/P11：仅在校对流程中强制 proofreadBeforeReplace
          // 模板填写/修复场景（templateFilling.active）跳过此检查
          // Issue #151 R1-2/R1-3：并行模式下（携带 _batch_id）会话级 batchStarted/proofreadCalledThisBatch/
          // aiProofreadDoneThisBatch 单值会被各执行 agent 互相覆盖，不适用；改由 P20 逐步凭证落盘校验完整性。
          const isParallelBatchReplace = !!innerArgs._batch_id;
          if (
            !isParallelBatchReplace &&
            !st.templateFilling.active &&
            st.batchStarted &&
            !st.proofreadCalledThisBatch
          ) {
            throw new Error(
              `【执行治理】replaceInParagraph 必须在同一批的 proofreadBasic 之后调用。`
            );
          }
          if (
            !isParallelBatchReplace &&
            !st.templateFilling.active &&
            st.batchStarted &&
            !st.aiProofreadDoneThisBatch
          ) {
            throw new Error(
              `【执行治理】AI 智能校对未完成。请在 proofreadBasic 之后调用 ` +
                `confirmBatchAiProofread 确认 AI 校对已完成，再执行替换操作。`
            );
          }
          // P15：基础校对无 issue 时，禁止 AI 自行大量修复
          // 当 proofreadHadIssues = false（基础校对未发现问题），最多允许 1 次 AI 自定修复
          // 超过限制需传 _force_ai_fix: true 显式确认
          if (
            !isParallelBatchReplace &&
            !st.templateFilling.active &&
            st.batchStarted &&
            st.proofreadHadIssues === false
          ) {
            if (st.replaceCountThisBatch >= AI_FIXES_NO_ISSUES_LIMIT) {
              if (!innerArgs._force_ai_fix) {
                throw new Error(
                  `【执行治理】【P15】基础校对未发现本批存在任何问题，` +
                    `AI 已自行修复 ${st.replaceCountThisBatch} 处。\n` +
                    `禁止 AI 编造不存在的校对问题。如确认此处确需修复，` +
                    `请在参数中添加 _force_ai_fix: true 以强制放行。`
                );
              }
            }
          }
          // P16：交叉校验 — 替换内容应与已知校对 issue 对应
          // 防止 AI 擅自修复 proofreadBasic 未发现的问题（"把正确的改成错误的"）
          if (
            !isParallelBatchReplace &&
            !st.templateFilling.active &&
            st.batchStarted &&
            st.proofreadHadIssues === true &&
            st.proofreadIssueOriginals.length > 0
          ) {
            // 参数名兼容：AI 走网关时可能传 camelCase（findText）或 snake_case（find_text），
            // 两者都需兜底，否则 P16 会因 findText 为空而跳过校验（#55 遗留：F11–F15 零拦截）
            const findText = innerArgs.findText || innerArgs.find || innerArgs.find_text || '';
            if (findText && !innerArgs._force_ai_fix) {
              // P16 补充（Issue #223 实际校对问题 P0-1，R8-1 精确化）：
              // 含截断标记 且 不匹配任何已知 issue.original → 判定为 context 截断展示文本（非原文），
              // 文档中必然不存在，拦截并引导改用 proofreadBasic 返回的 original。
              // 若 findText 匹配已知 issue.original（即使含省略号，如合法省略号修复），则放行不误拦。
              const hasTruncation = hasTruncationMarker(findText);
              const matchesIssue = st.proofreadIssueOriginals.some(function (orig) {
                return orig && (orig.indexOf(findText) !== -1 || findText.indexOf(orig) !== -1);
              });
              if (hasTruncation && !matchesIssue) {
                throw new Error(
                  `【执行治理】【P16】replaceInParagraph findText="${findText}" 含截断标记（.../…/……）且不匹配任何已知问题原文，` +
                    `该文本在文档中不存在，替换必然失败。\n` +
                    `请改用 proofreadBasic / getDocumentParagraphs 返回的完整 original 原文作为 findText，` +
                    `不得使用带截断标记的 context 展示文本。如需强制修复请传 _force_ai_fix: true。`
                );
              }
              if (!matchesIssue) {
                const maxShow = 5;
                const shown = st.proofreadIssueOriginals.slice(0, maxShow);
                const more =
                  st.proofreadIssueOriginals.length > maxShow
                    ? `...等共 ${st.proofreadIssueOriginals.length} 条`
                    : '';
                throw new Error(
                  `【执行治理】【P16】replaceInParagraph findText="${findText}" ` +
                    `与 proofreadBasic 找到的任何 issue 原文都不匹配。\n` +
                    `已知问题原文：${shown.join('、')}${more}\n` +
                    `AI 不应修复基础校对未发现的问题。如需强制修复请传 _force_ai_fix: true。`
                );
              }
            }
          }
          if (st.batchStarted || isParallelBatchReplace) {
            const paraIdx = innerArgs.paragraphIndex;
            if (paraIdx !== undefined) {
              // Issue #151 R1-3：并行模式下会话级 batchStartParaIndex/lastBatchParaIndex 会被各执行
              // agent 互相覆盖，改用**按批次隔离的分配区间**（assignedRanges[batchId]，由 P19 登记）校验，
              // 防止并行替换越权到其它执行 agent 区间。未登记区间时跳过（由管理 agent 调度兜底）。
              if (isParallelBatchReplace) {
                const batchId = innerArgs._batch_id;
                const mine = st.assignedRanges[batchId];
                if (mine) {
                  if (paraIdx < mine.start || paraIdx > mine.end) {
                    throw new Error(
                      `【执行治理】【P19】replaceInParagraph paragraphIndex=${paraIdx} 超出本执行 agent（批次 ${batchId}）分配区间 ${mine.start}-${mine.end}。`
                    );
                  }
                }
              } else if (st.batchStarted) {
                if (paraIdx < st.batchStartParaIndex) {
                  throw new Error(
                    `【执行治理】replaceInParagraph paragraphIndex=${paraIdx} 在本批起始段落 ${st.batchStartParaIndex} 之前。`
                  );
                }
                if (paraIdx > st.lastBatchParaIndex) {
                  throw new Error(
                    `【执行治理】replaceInParagraph paragraphIndex=${paraIdx} 超出本批结束段落 ${st.lastBatchParaIndex}。`
                  );
                }
              }
            }
          }
        }
        return;
      }

      // ── 模板填写工作流规则（T1-T11） ──
      if (toolName === 'smartFillField' || toolName === 'replaceBookmarkContent') {
        // T1：评估文档
        if (!st.templateFilling.active && !st.templateFilling.docFetched) {
          throw new Error(
            `【执行治理】模板填写前请先评估文档规模。` +
              `请先调用 getActiveDocument 了解文档总段落数。`
          );
        }
        // T2：分批
        if (!st.templateFilling.active && !st.templateFilling.paragraphsFetched) {
          throw new Error(
            `【执行治理】模板填写前请先分批。` +
              `请先调用 getDocumentParagraphs 以每批 ≤200 段评估文档结构，再逐批填写。`
          );
        }
        // T7：首次填写前必须输出字段对照表并获用户确认
        if (toolName === 'smartFillField' && !st.templateFilling.userConfirmed) {
          if (!innerArgs._field_mapping_confirmed) {
            throw new Error(
              `【执行治理·禁止编造】首次 smartFillField 前，你必须：\n` +
                `1. 列出文档中所有待填写字段与用户提供值的对照表\n` +
                `2. 标记出用户未提供的字段（如缺少"采购项目编号"的值）\n` +
                `3. 要求用户补充缺失值，不得自行编造\n` +
                `4. 用户确认后，在首次 smartFillField 参数中添加 ` +
                `_field_mapping_confirmed: true 即可放行`
            );
          }
        }
        // T3：修订模式
        if (!st.templateFilling.trackChangesEnabled) {
          throw new Error(
            `【执行治理】模板填写前请先调用 enableTrackChanges(true) 开启修订模式，` +
              `以便追踪填写变更。`
          );
        }
        // T8：跳过签字字段
        if (innerArgs.keyword) {
          const signaturePatterns = ['签字', '签名', '签章', '盖章'];
          for (var s = 0; s < signaturePatterns.length; s++) {
            if (innerArgs.keyword.indexOf(signaturePatterns[s]) !== -1) {
              throw new Error(
                `【执行治理·跳过签字】"${innerArgs.keyword}" 包含"${signaturePatterns[s]}"，` +
                  `属于手工签章字段，不应由AI填写。请跳过此字段。`
              );
            }
          }
        }
        // T6：禁止子串重复填写（可传 _substring_confirmed: true 绕过）
        const newKeyword = innerArgs.keyword;
        if (
          newKeyword &&
          !innerArgs._substring_confirmed &&
          st.templateFilling.fillKeywords.length > 0
        ) {
          for (var k = 0; k < st.templateFilling.fillKeywords.length; k++) {
            const existingKwd = st.templateFilling.fillKeywords[k];
            if (existingKwd.indexOf(newKeyword) !== -1 || newKeyword.indexOf(existingKwd) !== -1) {
              if (existingKwd !== newKeyword) {
                throw new Error(
                  `【执行治理·禁止重复】"${newKeyword}" 与已填写字段 "${existingKwd}" ` +
                    `存在包含关系（子串/超串）。请确认这是否是同一字段：\n` +
                    `- 如果是同一字段（如"包号"是"采购包号"的一部分），不要再次填写\n` +
                    `- 如果是不同字段，请向用户确认后在参数中添加 _substring_confirmed: true 绕过`
                );
              }
            }
          }
        }
        return;
      }
    },
  };
};
