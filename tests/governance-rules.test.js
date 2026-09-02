/**
 * governance.js 校对治理规则回归测试（Issue #223）
 *
 * 校验 governance.js 中新增的校对治理规则存在且逻辑正确：
 *  - P16 补充：findText 含截断标记（.../…/……）即拦截（Issue #223 问题 P0-1，零修复根因）
 *  - P23：首次实际累加必须携带 doc_info；禁止用空 issues 上报进度（Issue #223 问题 P0-2/P0-3）
 *  - P24：覆盖全文后未生成报告即禁止新开批次（Issue #223 问题 P0-4）
 *
 * governance.js 是 OpenCode Plugin Hooks 模块（export const WpsGovernancePlugin），
 * 无法直接 import 单测，故采用"源码规则存在性 + 关键逻辑白盒"双重校验，
 * 防止后续重构误删/误改这些规则（与 security.test.js 维护生产逻辑副本的出发点一致）。
 */

// ==================== 测试框架 ====================

var testCount = 0;
var passCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log('✓ ' + name);
  } catch (e) {
    console.error('✗ ' + name + ' —— ' + e.message);
  }
}

function assertTrue(cond, msg) {
  if (!cond) {
    throw new Error(msg || '断言失败');
  }
}

function assertContains(haystack, needle, msg) {
  if (typeof haystack !== 'string' || haystack.indexOf(needle) === -1) {
    throw new Error((msg || '未找到指定内容') + '：' + needle);
  }
}

// ==================== 加载 governance.js 源码 ====================

var fs = require('fs');
var path = require('path');
var govSource = fs.readFileSync(
  path.resolve(__dirname, '../.opencode/plugins/governance.js'),
  'utf8'
);

// ==================== P16 补充：截断标记拦截（Issue #223 P0-1） ====================

test('P16 补充：findText 含截断标记即拦截', function () {
  assertContains(govSource, 'hasTruncationMarker', '应定义截断检测函数');
  assertContains(govSource, 'ellipsisPattern', '应定义省略号正则');
  assertContains(govSource, 'hasTruncation', '应检测是否含截断标记');
  assertContains(govSource, '含截断标记（.../…/……）', '应输出含截断标记的拦截提示');
  assertContains(
    govSource,
    '请改用 proofreadBasic / getDocumentParagraphs 返回的完整 original 原文',
    '应引导使用 original 原文作为 findText'
  );
});

test('P16 补充：截断检测逻辑正确（白盒，精确判定）', function () {
  // 从源码抽取截断标记判定逻辑做白盒验证（与 governance.js 内 hasTruncationMarker 一致）：
  // 省略号出现处之后若不紧跟中文字符（即位于末尾或后跟数字/) /；/空格等非中文），判为截断符；
  // 若省略号后紧跟中文字符，则为文档正文合法省略号（引文/列举），不误拦。
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
  // 截断场景（省略号后无中文或后跟非中文）→ true
  assertTrue(hasTruncationMarker('省公共资...'), '末尾 "..." 应判定为截断');
  assertTrue(hasTruncationMarker('财库〔2019〕9号）；...'), '末尾省略号应判定为截断');
  assertTrue(hasTruncationMarker('银行行号：...029-88224928...'), '省略号后跟数字应判定为截断');
  assertTrue(hasTruncationMarker('……（此处省略）'), '省略号后跟左括号应判定为截断');
  // 正常原文（省略号后紧跟中文，为正文合法省略号）→ false，不误拦
  assertTrue(!hasTruncationMarker('省公共资源交易平台'), '正常原文不应判定为截断');
  assertTrue(!hasTruncationMarker('一致的'), '短原文不应误判');
  assertTrue(
    !hasTruncationMarker('我们一致地……认真执行'),
    '省略号后紧跟中文（正文省略号）不应误拦'
  );
});

test('P16 补充：截断标记但匹配 issue.original 时放行（R8-1）', function () {
  // R8-1：修复省略号问题（findText=真实 original）不应被截断拦截误伤。
  // 治理实现：截断拦截条件为 hasTruncation && !matchesIssue（matchesIssue=findText 匹配已知 issue.original）。
  assertContains(
    govSource,
    'if (hasTruncation && !matchesIssue)',
    '截断拦截应仅在 不匹配任何 known issue 时触发'
  );
  assertContains(
    govSource,
    '若 findText 匹配已知 issue.original（即使含省略号，如合法省略号修复），则放行不误拦',
    '应说明省略号修复放行语义'
  );

  // 白盒验证：findText=含省略号的真实 original（如修复中英混排标点），能匹配 issue.original → 不拦截
  function shouldBlockForTruncation(findText, issueOriginals, hasTruncationFn) {
    var hasTruncation = hasTruncationFn(findText);
    var matchesIssue = issueOriginals.some(function (orig) {
      return orig && (orig.indexOf(findText) !== -1 || findText.indexOf(orig) !== -1);
    });
    return hasTruncation && !matchesIssue;
  }
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
  // 修复省略号：findText="……" 匹配 original="……" → 放行（不拦截）
  assertTrue(
    !shouldBlockForTruncation('……', ['……'], hasTruncationMarker),
    '修复省略号（匹配 original）不应被截断拦截'
  );
  // 截断展示文本：findText="省公共资..." 不匹配任何 original → 拦截
  assertTrue(
    shouldBlockForTruncation('省公共资...', ['省公共资源交易平台'], hasTruncationMarker),
    '截断展示文本（不匹配 original）应被拦截'
  );
});

// ==================== P23：首次 doc_info + 禁止空 issues（Issue #223 P0-2/P0-3） ====================

test('P23：首次累加强制 doc_info 逻辑存在', function () {
  assertContains(govSource, 'accumulateCount', '应跟踪累加次数以判断首次');
  assertContains(
    govSource,
    '首次 proofreadAccumulate 必须携带 doc_info',
    '应输出首次必带 doc_info 提示'
  );
  assertContains(govSource, 'innerArgs.doc_info.fileName', '应校验 fileName');
  assertContains(govSource, 'innerArgs.doc_info.filePath', '应校验 filePath');
  assertContains(govSource, 'hasTotalParagraphs', '应校验 totalParagraphs');
  assertContains(
    govSource,
    'totalParagraphs（正整数，文档总段数）',
    '应强制 totalParagraphs 为正整数'
  );
});

test('P23：禁止空 issues 上报进度逻辑存在', function () {
  assertContains(govSource, '但 issues 为空数组', '应输出空 issues 拦截提示');
  assertContains(govSource, '报了进度但丢了数据', '应指出是进度造假');
  assertContains(govSource, '禁止用空 issues 填充进度', '应明确禁止空 issues 填充');
});

test('P23：空 issues 上报判定逻辑正确（白盒）', function () {
  // 模拟 P23 的判定：上报了 _processed_to_paragraph 且 issues 为空数组 → 拦截
  function isFakeProgress(innerArgs, isFirstRealAccumulate) {
    var issuesArg = innerArgs.issues;
    var hasIssuesArg = Array.isArray(issuesArg) && issuesArg.length > 0;
    return (
      innerArgs._processed_to_paragraph !== undefined && !hasIssuesArg && !isFirstRealAccumulate
    );
  }
  // 空 issues 上报进度 → 造假
  assertTrue(
    isFakeProgress({ _processed_to_paragraph: 2400, issues: [] }, false),
    '空 issues + 上报进度应为造假'
  );
  // 有 issues 上报 → 正常
  assertTrue(
    !isFakeProgress(
      { _processed_to_paragraph: 2400, issues: [{ original: 'a', suggestion: 'b' }] },
      false
    ),
    '有 issues 上报应为正常'
  );
  // 首次累加（带 doc_info）空 issues → 豁免（初始化场景）
  assertTrue(
    !isFakeProgress({ _processed_to_paragraph: 100, issues: [] }, true),
    '首次累加空 issues 应豁免'
  );
  // 未上报进度 → 不触发
  assertTrue(!isFakeProgress({ issues: [] }, false), '未上报进度不应触发');
});

test('P23：首次累加失败重试后 doc_info 强制不失效（R4-1）', function () {
  // 关键点：accumulateCount 只在「全部校验通过后」递增；
  // 若首次累加因缺 doc_info 被拦截，accumulateCount 保持 0，重试时 isFirstRealAccumulate 仍为 true，
  // 继续强制 doc_info，不会被"失败重试"绕过。
  assertContains(govSource, 'R4-1', '应标注 R4-1 修复');
  assertContains(
    govSource,
    'isFirstRealAccumulate = (st.accumulateCount || 0) === 0',
    '首次判定应基于成功累加计数为 0'
  );
  assertContains(govSource, '成功调用后递增累加计数', '应在校验通过后递增计数');

  // 白盒验证时序：模拟失败重试——首次因缺 doc_info 被拦，accumulateCount 不应递增
  var accumulateCount = 0;
  function attemptAccumulate(args, docInfoValid) {
    if (!docInfoValid) throw new Error('P23 拦截：缺 doc_info');
    accumulateCount += 1;
    return true;
  }
  // 首次失败（缺 doc_info）→ 抛错，计数不变
  var failed = false;
  try {
    attemptAccumulate({}, false);
  } catch (e) {
    failed = true;
  }
  assertTrue(failed, '首次缺 doc_info 应被拦截');
  assertTrue(accumulateCount === 0, '失败后 accumulateCount 不应递增（保持 0）');
  // 重试成功（补上 doc_info）→ 计数+1
  assertTrue(attemptAccumulate({}, true), '重试成功应放行');
  assertTrue(accumulateCount === 1, '成功后 accumulateCount 应递增为 1');
});

test('P24：getActiveDocument 重置覆盖状态（R4-2）', function () {
  // getActiveDocument 是「重新开始」信号，应重置 fullCoverageReached / accumulateCount / maxReportedParagraph，
  // 避免报告失败后 fullCoverageReached 锁死后续所有校对推进工具（死锁）。
  assertContains(govSource, 'R4-2', '应标注 R4-2 修复');
  assertContains(govSource, 'st.fullCoverageReached = false;', '应重置 fullCoverageReached');
  assertContains(govSource, 'st.accumulateCount = 0;', '应重置 accumulateCount');
  assertContains(govSource, 'st.maxReportedParagraph = 0;', '应重置 maxReportedParagraph');
});

// ==================== P24：覆盖全文后强制报告（Issue #223 P0-4） ====================

test('P24：覆盖全文后强制生成报告逻辑存在', function () {
  assertContains(govSource, 'fullCoverageReached', '应跟踪是否已覆盖全文');
  assertContains(govSource, '覆盖全文后必须调用 generateProofreadReport', '应强制生成报告');
  assertContains(govSource, 'P24', '应标识 P24 规则');
});

test('P24：覆盖全文判定逻辑正确（白盒）', function () {
  // 模拟 P24 的判定：进度达 totalParagraphs 且未生成报告 → 标记 fullCoverageReached
  var totalParagraphs = 2518;
  var maxReportedParagraph = 2518;
  var reportGenerated = false;
  var fullCoverageReached =
    totalParagraphs > 0 && maxReportedParagraph >= totalParagraphs && !reportGenerated;
  assertTrue(fullCoverageReached, '覆盖全文且未生成报告应标记 fullCoverageReached');

  // 已生成报告（reportGenerated=true）→ 不再标记（P24 不强制重复生成）
  var reportGeneratedTrue = true;
  var fullCoverageReportedDone =
    totalParagraphs > 0 && maxReportedParagraph >= totalParagraphs && !reportGeneratedTrue;
  assertTrue(!fullCoverageReportedDone, '已生成报告不应再强制拦截');
  // 未覆盖全文（进度不足）→ 不标记
  var notFullCoverage = totalParagraphs > 0 && 2300 >= totalParagraphs && !reportGenerated;
  assertTrue(!notFullCoverage, '未覆盖全文不应标记');
});

test('P24：拦截范围覆盖全部校对推进工具（排除收尾/报告类）', function () {
  // 模拟 P24 的真实拦截判定（R5-1 修复，避免恒真断言）：
  // shouldBlock(toolName) = PROOFREAD_ADVANCE_TOOLS 命中 && 未生成报告 && 已覆盖全文
  var PROOFREAD_STEP_CHAIN = [
    'getDocumentParagraphs',
    'getDocumentTextByRange',
    'proofreadBasic',
    'confirmBatchAiProofread',
    'replaceInParagraph',
    'proofreadAccumulate',
  ];
  var PROOFREAD_ADVANCE_TOOLS = PROOFREAD_STEP_CHAIN.filter(function (t) {
    return t !== 'proofreadAccumulate';
  });
  function shouldBlock(toolName, reportGenerated, fullCoverageReached) {
    return (
      PROOFREAD_ADVANCE_TOOLS.indexOf(toolName) !== -1 && !reportGenerated && fullCoverageReached
    );
  }
  // 场景1：覆盖全文 + 未生成报告 → 所有推进工具都应被拦截
  PROOFREAD_ADVANCE_TOOLS.forEach(function (tool) {
    assertTrue(shouldBlock(tool, false, true), '覆盖全文+未报告：推进工具 ' + tool + ' 应被拦截');
  });
  // 场景2：覆盖全文 + 未生成报告 → 报告/收尾/上报类不应被拦
  [
    'proofreadAccumulate',
    'generateProofreadReport',
    'getActiveDocument',
    'enableTrackChanges',
    'getTrackChangesStatus',
    'save',
  ].forEach(function (tool) {
    assertTrue(
      !shouldBlock(tool, false, true),
      '覆盖全文+未报告：收尾/报告类 ' + tool + ' 不应被拦截'
    );
  });
  // 场景3：覆盖全文 + 已生成报告 → 推进工具不再拦截
  assertTrue(
    !shouldBlock('getDocumentParagraphs', true, true),
    '覆盖全文+已报告：推进工具不应再拦截'
  );
  // 场景4：未覆盖全文（fullCoverageReached=false）→ 不拦截
  assertTrue(!shouldBlock('getDocumentParagraphs', false, false), '未覆盖全文：不应拦截');
});

// ==================== 汇总 ====================

console.log('======================================');
console.log('治理规则测试结果: ' + passCount + '/' + testCount + ' 通过');
console.log('======================================');

process.exit(passCount === testCount ? 0 : 1);
