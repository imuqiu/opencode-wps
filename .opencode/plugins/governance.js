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
  "wps-office_wps_get_active_document":     "getActiveDocument",
  "wps-office_wps_insert_text":             "insertText",
  "wps-office_wps_get_active_workbook":     "getActiveWorkbook",
  "wps-office_wps_get_cell_value":          "getCellValue",
  "wps-office_wps_set_cell_value":          "setCellValue",
  "wps-office_wps_get_active_presentation": "getActivePresentation",
  // 五维评分校对报告工具（#25 TC-13）：MCP 侧不直连注册，但仍加入 G1 兜底拦截，
  // 若未来误注册为直接 MCP 工具也会被强制改走 wps_office_execute 网关
  "wps-office_wps_word_proofread_accumulate":        "proofreadAccumulate",
  "wps-office_wps_word_generate_proofread_report":   "generateProofreadReport",
};

const WRITE_TOOLS = new Set([
  "setCellValue", "setRangeData", "setFormula", "setArrayFormula",
  "insertText", "insertTable", "insertImage", "insertExcelImage",
  "insertPptImage", "insertRows", "insertColumns", "deleteRows", "deleteColumns",
  "clearRange", "mergeCells", "unmergeCells",
  "replaceInParagraph", "findReplace", "replaceInSheet",
  "setCellFormat", "setCellStyle", "setBorder", "setNumberFormat",
  "setColumnWidth", "setRowHeight",
  "setFont", "setParagraph", "applyStyle",
  "setSlideTitle", "setSlideContent", "setSlideNotes", "setSlideBackground",
  "addSlide", "deleteSlide", "duplicateSlide", "moveSlide",
  "addShape", "deleteShape", "addTextBox", "setTextBoxText", "deleteTextBox",
  "addComment", "beautifySlide", "beautifyAllSlides",
  "save", "saveAs", "closeDocument", "closePresentation", "closeWorkbook",
  "smartFillField", "replaceBookmarkContent",
]);

const READ_TOOLS = new Set([
  "getActiveDocument", "getActiveWorkbook", "getActivePresentation",
  "getDocumentText", "getDocumentParagraphs", "getDocumentStats",
  "getCellValue", "getRangeData", "getFormula",
  "getSheetList", "getCellInfo", "getSelection",
  "getSlideCount", "getSlideInfo", "getSlideTitle", "getSlideNotes",
  "getShapes", "getTextBoxes", "getBookmarks", "getComments",
  "findInDocument", "findInSheet",
]);

const DESTRUCTIVE_TOOLS = new Set([
  "deleteSheet", "deleteSlide", "deleteRows", "deleteColumns",
  "deleteShape", "deleteTextBox", "deletePptImage", "deleteCellComment",
  "clearRange", "clearFormats",
  "unmergeCells",
  "removeConditionalFormat", "removeDataValidation",
  "removeAnimation", "removeSlideTransition", "removePptHyperlink",
  "closeDocument", "closePresentation", "closeWorkbook",
]);

const PASSWORD_TOOLS = new Set([
  "protectSheet", "unprotectSheet", "protectWorkbook",
]);

const FILE_PATH_PARAMS = new Set([
  "filePath", "imagePath", "outputPath", "path",
]);

const PARAM_RANGES = {
  "getCellValue":    { row: [1, null], col: [1, null] },
  "setCellValue":    { row: [1, null], col: [1, null] },
  "getCellInfo":     { row: [1, null], col: [1, null] },
  "addCellComment":  { row: [1, null], col: [1, null] },
  "deleteCellComment": { row: [1, null], col: [1, null] },
  "insertRows":      { row: [1, null] },
  "deleteRows":      { row: [1, null] },
  "hideRows":        { row: [1, null] },
  "showRows":        { row: [1, null] },
  "setRowHeight":    { row: [1, null], height: [1, null] },
  "deleteSlide":     { slideIndex: [1, null] },
  "switchSlide":     { slideIndex: [1, null] },
  "getSlideInfo":    { slideIndex: [1, null] },
  "getSlideTitle":   { slideIndex: [1, null] },
  "getSlideNotes":   { slideIndex: [1, null] },
  "setSlideTitle":   { slideIndex: [1, null] },
  "setSlideSubtitle": { slideIndex: [1, null] },
  "setSlideContent": { slideIndex: [1, null] },
  "setSlideNotes":   { slideIndex: [1, null] },
  "setSlideBackground": { slideIndex: [1, null] },
  "setSlideTransition": { slideIndex: [1, null] },
  "removeSlideTransition": { slideIndex: [1, null] },
  "addAnimation":    { slideIndex: [1, null], shapeIndex: [1, null] },
  "removeAnimation": { slideIndex: [1, null], animationIndex: [1, null] },
  "deleteShape":     { index: [1, null] },
  "duplicateShape":  { index: [1, null] },
  "insertTable":     { rows: [1, 100], cols: [1, 100] },
  "insertPptTable":  { rows: [1, 100], cols: [1, 100] },
  "groupRows":       { startRow: [1, null], endRow: [1, null] },
};

const AI_FIXES_NO_ISSUES_LIMIT = 1;

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

const EXECUTE_METHOD_WHITELIST = new Set([
  "Application.ActiveDocument",
  "Application.ActiveWorkbook",
  "Application.ActivePresentation",
]);

// ==================== 会话隔离状态管理 ====================
// 使用 Map<sessionId, SessionState> 隔离多会话状态，防止并发污染

function createSessionState() {
  return {
    lastBatchParaIndex: 0,
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
    proofreadCalledThisBatch: false,
    replaceCalledThisBatch: false,
    proofreadHadIssues: false,
    proofreadIssueOriginals: [],
    replaceCountThisBatch: 0,
    // P17（session_ffa8 问题一）：记录服务端是否已成功生成过校对报告，
    // 用于区分「合法 writeFile 落盘服务端报告」与「AI 手动 write 伪造报告」。
    reportGenerated: false,
    reportSessionId: '',
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

function getSessionState(input) {
  // input.sessionID 是钩子回调的顶层字段；input.args.sessionID 由调用方手动注入
  var sessionId = (input && (input.sessionID || (input.args && input.args.sessionID))) || 'default';
  if (!sessions.has(sessionId)) {
    if (sessions.size >= MAX_SESSIONS) {
      var firstKey = sessions.keys().next().value;
      sessions.delete(firstKey);
    }
    sessions.set(sessionId, createSessionState());
  }
  return sessions.get(sessionId);
}

// ==================== 辅助函数 ====================

function parseParagraphRanges(outputText) {
  const regex = /^\s*\[(\d+)\] \((.+)\)\s*\[(\d+)-(\d+)\]/gm;
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
    } catch (_e) { /* fallthrough */ }
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
  if (toolName.startsWith('getActivePresentation') || toolName.startsWith('wps_ppt_') || toolName.startsWith('wpp_')) return 'ppt';
  if (toolName.startsWith('getActiveWorkbook') || toolName.startsWith('wps_excel_') || toolName.startsWith('et_')) return 'excel';
  if (toolName.startsWith('getCell') || toolName.startsWith('setCell') || toolName.startsWith('getRange') || toolName.startsWith('setRange')) return 'excel';
  if (toolName.startsWith('getSheet') || toolName.startsWith('createSheet') || toolName.startsWith('deleteSheet')) return 'excel';
  if (toolName.startsWith('renameSheet') || toolName.startsWith('copySheet') || toolName.startsWith('switchSheet') || toolName.startsWith('moveSheet')) return 'excel';
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
        `【执行治理】${toolName} ${param}=${val} 过大（允许 ≤ ${max}）。` +
        `请减小 ${param} 值。`
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
      `【执行治理】${toolName} 使用了密码参数（已脱敏）。` +
      `密码不会记录日志，请确认操作范围。`
    );
  }
}

// ==================== 插件导出 ====================

export const WpsGovernancePlugin = async () => {
  return {

    // ── 执行后钩子：输出成功后才提交可变状态 ──
    // 回调签名: (input: { tool: string, sessionID: string, callID: string, args: object }, output: { content: array, isError?: boolean }) => Promise<void>
    "tool.execute.after": async (input, output) => {
      const outerTool = input.tool;

      if (outerTool === "wps-office_wps_office_execute" || outerTool === "wps_office_execute") {
        if (output?.isError) return;

        const toolArgs = input.args || {};
        const toolName = toolArgs.tool_name;
        const innerArgs = toolArgs.arguments || {};
        var st = getSessionState(input);

        if (toolName === "getActiveDocument") {
          const outText = getOutputText(output);
          if (!outText) return;
          st.docInfoFetched = true;
          st.appReadState.word.activeDocRead = true;
          const paraMatch = outText.match(/总段数[：:]\s*(\d+)/i)
            || outText.match(/[Pp]aragraphs?[:\s]+(\d+)/i);
          if (paraMatch) {
            st.totalParagraphs = parseInt(paraMatch[1], 10);
          } else {
            st.totalParagraphs = 0;
          }
          st.templateFilling.active = false;
          st.templateFilling.docFetched = true;
          st.allBatchesComplete = false;
          st.batchCount = 0;
          st.lastBatchParaIndex = 0;
          st.templateFilling.paragraphsFetched = false;
          st.templateFilling.trackChangesEnabled = false;
          st.templateFilling.userConfirmed = false;
          st.templateFilling.fillKeywords = [];
          st.templateFilling.fillHistory = [];
          st.templateFilling.fieldsFilled = 0;
          return;
        }

        if (toolName === "getActiveWorkbook") {
          const outText = getOutputText(output);
          if (!outText) return;
          st.appReadState.excel.activeWorkbookRead = true;
          return;
        }

        if (toolName === "getActivePresentation") {
          const outText = getOutputText(output);
          if (!outText) return;
          st.appReadState.ppt.activePresentationRead = true;
          return;
        }

        if (toolName === "getDocumentParagraphs") {
          const outText = getOutputText(output);
          if (!outText) return;
          const ranges = parseParagraphRanges(outText);
          if (ranges.length === 0) return;
          st.lastBatchParaIndex = ranges[ranges.length - 1].index;
          st.batchStartParaIndex = ranges[0].index;
          st.batchStarted = true;
          st.batchCount++;
          st.batchStartOffset = ranges[0].start;
          st.batchEndOffset = ranges[ranges.length - 1].end;
          st.proofreadCalledThisBatch = false;
          st.aiProofreadDoneThisBatch = false;
          st.replaceCalledThisBatch = false;
          st.proofreadHadIssues = false;
          st.proofreadIssueOriginals = [];
          st.replaceCountThisBatch = 0;
          st.templateFilling.paragraphsFetched = true;
          st.templateFilling.lastParagraphIndex = ranges[ranges.length - 1].index;
          if (st.totalParagraphs > 0 && st.lastBatchParaIndex >= st.totalParagraphs) {
            st.allBatchesComplete = true;
          }
          return;
        }

        if (toolName === "enableTrackChanges") {
          const outText = getOutputText(output);
          if (!outText) return;
          st.trackChangesOn = innerArgs.enable === true;
          st.templateFilling.trackChangesEnabled = innerArgs.enable === true;
          return;
        }

        if (toolName === "proofreadBasic") {
          const outText = getOutputText(output);
          if (!outText) return;
          st.proofreadCalledThisBatch = true;
          st.aiProofreadDoneThisBatch = false;
          st.replaceCalledThisBatch = false;
          st.proofreadHadIssues = false;
          st.proofreadIssueOriginals = [];
          // T1（#55）：proofreadBasic 返回 = 文本展示 + 末尾 JSON 行（{ issues: [...] }），
          // 从返回文本中提取 JSON 解析，P15/P16 才能拿到真实 issue 列表
          const parsed = extractJsonFromOutput(outText);
          if (parsed && Array.isArray(parsed.issues)) {
            st.proofreadHadIssues = parsed.issues.length > 0;
            st.proofreadIssueOriginals = parsed.issues
              .map(i => i.original)
              .filter(Boolean);
          }
          return;
        }

        if (toolName === "replaceInParagraph") {
          st.replaceCalledThisBatch = true;
          st.replaceCountThisBatch++;
          return;
        }

        if (toolName === "confirmBatchAiProofread") {
          st.aiProofreadDoneThisBatch = true;
          return;
        }

        if (toolName === "getTrackChangesStatus") {
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
        if (toolName === "generateProofreadReport") {
          const outText = getOutputText(output);
          const failureMarkers = ['未找到会话', '写入文件失败', '落盘失败', 'success:false', '生成报告失败', '写文件失败'];
          const hasFailureMarker = failureMarkers.some((m) => outText.indexOf(m) !== -1);
          const ok = output && !output.isError && output.success !== false && !hasFailureMarker;
          st.reportGenerated = !!ok;
          st.reportSessionId = (innerArgs.session_id || st.reportSessionId || '');
          return;
        }
        if (toolName === "proofreadAccumulate") {
          // 记录会话 ID（用于识别校对流程会话），即便未生成报告也便于 P17 判断在校对流程中
          st.reportSessionId = (innerArgs.session_id || st.reportSessionId || '');
          // P20（Issue #151 校对重构，决策 5）：逐步凭证落盘防幻觉——
          // 执行 agent 在并行校对中调用 proofreadAccumulate 时，若携带了 _batch_id 声明批次，
          // 则必须同时携带 _steps_log（本批逐步执行凭证），供管理 agent 审计完整步骤链，
          // 防止"大模型假装批量校对"（缺任何一步即判定该批未完成并重新派发）。
          // R8-2：校验 _steps_log 为非空数组（空数组/缺数组均拦截，避免用空凭证绕过 P20）。
          const hasStepsLog = Array.isArray(innerArgs._steps_log) && innerArgs._steps_log.length > 0;
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
          return;
        }

        if (toolName === "smartFillField") {
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

        if (toolName === "replaceBookmarkContent") {
          st.templateFilling.active = true;
          st.templateFilling.fieldsFilled++;
          if (innerArgs.keyword) {
            st.templateFilling.fillKeywords.push(innerArgs.keyword);
          }
          if (innerArgs.keyword && innerArgs.value !== undefined) {
            st.templateFilling.fillHistory.push({ keyword: innerArgs.keyword, value: innerArgs.value, underline: true });
          }
          return;
        }
      }
    },

    // ── 执行前钩子：所有规则校验 ──
    // 回调签名: (input: { tool: string, sessionID: string, callID: string, args: object }, output: never) => Promise<void>
    // rules: G1-G7 通用规则, P1-P16 校对规则, T1-T11 模板填写规则
    "tool.execute.before": async (input, output) => {
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
      if (outerTool === "wps-office_wps_execute_method" || outerTool === "wps_execute_method") {
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

      // 以下规则仅针对 wps_office_execute 网关调用
      if (outerTool !== "wps-office_wps_office_execute" && outerTool !== "wps_office_execute") return;

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
      const isReportPath = (pathStr) =>
        typeof pathStr === 'string' && pathStr.indexOf('校对报告') !== -1;
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

      if (toolName === "getActiveDocument" || toolName === "enableTrackChanges") {
        return;
      }

      // ── 规则 P1 + P2：getDocumentParagraphs ──
      if (toolName === "getDocumentParagraphs") {
        // Issue #151 R1-2：并行模式（执行 agent 携带 _batch_id）下，P1/P2/P12/P18 这些
        // **基于会话级单值**（st.batchStarted/st.lastBatchParaIndex 等）的串行连续性校验不适用——
        // 并行多执行 agent 各处理独立区间，会话级单值会被互相覆盖而误拦截（如 agent B 的
        // start=101 不满足「start = lastBatchParaIndex+1」）。并行模式下由 P19 的 _batch_range
        // 区间隔离承担正确校验，故此处跳过程序级单值的串行连续性检查。
        const isParallelBatch = !!innerArgs._batch_id;
        if (!isParallelBatch && st.allBatchesComplete) {
          throw new Error(
            `【执行治理】所有 ${st.batchCount} 批已全部完成（段落 1-${st.lastBatchParaIndex}/${st.totalParagraphs}）。\n` +
            `请直接生成校对报告（.校对报告.md），不要再调用 getDocumentParagraphs。`
          );
        }
        if (!isParallelBatch && st.batchStarted && !st.proofreadCalledThisBatch) {
          throw new Error(
            `【执行治理】【P12】当前批（段落 ${st.batchStartParaIndex}-${st.lastBatchParaIndex}）` +
            `尚未调用 proofreadBasic，不得获取下一批。\n` +
            `每批必须先调 proofreadBasic 进行基础校对，禁止仅凭视觉判断跳过。`
          );
        }
        if (!isParallelBatch && st.batchStarted && st.proofreadCalledThisBatch && !st.aiProofreadDoneThisBatch) {
          throw new Error(
            `【执行治理】【P12】当前批的 AI 智能校对尚未确认。` +
            `调完 proofreadBasic 后必须调用 confirmBatchAiProofread 确认 AI 校对完成。`
          );
        }
        if (!isParallelBatch && st.batchStarted && st.proofreadCalledThisBatch && st.proofreadHadIssues && !st.replaceCalledThisBatch) {
          throw new Error(
            `【执行治理】【P12】当前批（段落 ${st.batchStartParaIndex}-${st.lastBatchParaIndex}）` +
            `的校对问题尚未修复，不得获取下一批。\n` +
            `请先调用 replaceInParagraph 完成本批修复。`
          );
        }
        if (!st.docInfoFetched) {
          throw new Error(
            `【执行治理】请先调用 getActiveDocument 了解文档总段落数，` +
            `再获取段落列表。`
          );
        }
        const start = innerArgs.start_paragraph ?? 1;
        const end = innerArgs.end_paragraph ?? (start + 199);
        const count = end - start + 1;
        if (start < 1) {
          throw new Error(`【执行治理】start_paragraph 必须 ≥ 1（当前值: ${start}）。`);
        }
        if (end < start) {
          throw new Error(`【执行治理】end_paragraph（${end}）必须 ≥ start_paragraph（${start}）。`);
        }
        if (count > 200) {
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
        if (!isParallelBatch && st.lastBatchParaIndex > 0 && start !== st.lastBatchParaIndex + 1) {
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
        if (!isParallelBatch && st.lastBatchParaIndex > 0 && start === 1) {
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
          if (Number.isInteger(declStart) && Number.isInteger(declEnd) && declStart >= 1 && declEnd >= declStart) {
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
            const overlap = st.registeredRanges.some(function(r) {
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
      if (toolName === "proofreadBasic") {
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
            `【执行治理】本批已调过 proofreadBasic，禁止再次调用。` +
            `每批只准调 1 次。`
          );
        }
        if (!isParallelBatchProofread && st.batchStartOffset !== null && so !== st.batchStartOffset) {
          throw new Error(
            `【执行治理】proofreadBasic startOffset=${so} 与本批第一段起始位置 ` +
            `${st.batchStartOffset} 不匹配。`
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
      if (toolName === "getDocumentTextByRange") {
        // Issue #151 R1-2：并行模式下跳过会话级 batchStartOffset/batchEndOffset 单值校验
        // （各执行 agent 独立区间，会话级 offset 会被互相覆盖），P19 已按 _batch_range 隔离。
        const isParallelBatchText = !!innerArgs._batch_id;
        if (!isParallelBatchText && st.batchStarted && st.batchStartOffset !== null && st.batchEndOffset !== null) {
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
      if (toolName === "confirmBatchAiProofread") {
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

      // ── 规则 P4 + P6 + P10 + P11：替换操作 ──
      if (toolName === "replaceInParagraph" || toolName === "findReplace") {
        if (!st.trackChangesOn) {
          throw new Error(
            `【执行治理】请先调用 enableTrackChanges(true) 开启修订模式，` +
            `再执行替换操作。`
          );
        }
        if (toolName === "findReplace") {
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
        if (toolName === "replaceInParagraph") {
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
          if (!isParallelBatchReplace && !st.templateFilling.active && st.batchStarted && !st.proofreadCalledThisBatch) {
            throw new Error(
              `【执行治理】replaceInParagraph 必须在同一批的 proofreadBasic 之后调用。`
            );
          }
          if (!isParallelBatchReplace && !st.templateFilling.active && st.batchStarted && !st.aiProofreadDoneThisBatch) {
            throw new Error(
              `【执行治理】AI 智能校对未完成。请在 proofreadBasic 之后调用 ` +
              `confirmBatchAiProofread 确认 AI 校对已完成，再执行替换操作。`
            );
          }
          // P15：基础校对无 issue 时，禁止 AI 自行大量修复
          // 当 proofreadHadIssues = false（基础校对未发现问题），最多允许 1 次 AI 自定修复
          // 超过限制需传 _force_ai_fix: true 显式确认
          if (!isParallelBatchReplace && !st.templateFilling.active && st.batchStarted && !st.proofreadHadIssues) {
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
          if (!isParallelBatchReplace && !st.templateFilling.active && st.batchStarted && st.proofreadHadIssues && st.proofreadIssueOriginals.length > 0) {
            // 参数名兼容：AI 走网关时可能传 camelCase（findText）或 snake_case（find_text），
            // 两者都需兜底，否则 P16 会因 findText 为空而跳过校验（#55 遗留：F11–F15 零拦截）
            const findText =
              innerArgs.findText || innerArgs.find || innerArgs.find_text || '';
            if (findText && !innerArgs._force_ai_fix) {
              const matchesIssue = st.proofreadIssueOriginals.some(function(orig) {
                return (orig && (orig.indexOf(findText) !== -1 || findText.indexOf(orig) !== -1));
              });
              if (!matchesIssue) {
                const maxShow = 5;
                const shown = st.proofreadIssueOriginals.slice(0, maxShow);
                const more = st.proofreadIssueOriginals.length > maxShow ? `...等共 ${st.proofreadIssueOriginals.length} 条` : '';
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
      if (toolName === "smartFillField" || toolName === "replaceBookmarkContent") {
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
        if (toolName === "smartFillField" && !st.templateFilling.userConfirmed) {
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
        if (newKeyword && !innerArgs._substring_confirmed && st.templateFilling.fillKeywords.length > 0) {
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
    }
  };
};
