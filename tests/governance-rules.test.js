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

test('P16 补充：findText 含 ... 截断标记即拦截', function () {
  assertContains(govSource, "var truncationMarkers = ['...', '…', '……'];", '应定义截断标记列表');
  assertContains(govSource, 'hasTruncation', '应检测是否含截断标记');
  assertContains(
    govSource,
    '含截断标记（.../…/……）',
    '应输出含截断标记的拦截提示'
  );
  assertContains(
    govSource,
    '请改用 proofreadBasic / getDocumentParagraphs 返回的完整 original 原文',
    '应引导使用 original 原文作为 findText'
  );
});

test('P16 补充：截断检测逻辑正确（白盒）', function () {
  // 从源码抽取截断标记判定逻辑做白盒验证
  var truncationMarkers = ['...', '…', '……'];
  function hasTruncation(findText) {
    return truncationMarkers.some(function (m) {
      return findText.indexOf(m) !== -1;
    });
  }
  // 含截断标记 → true
  assertTrue(hasTruncation('省公共资...'), '含 "..." 应判定为截断');
  assertTrue(hasTruncation('财库〔2019〕9号）；...'), '含省略号应判定为截断');
  assertTrue(hasTruncation('……（此处省略）'), '含 "……" 应判定为截断');
  // 不含截断标记（正常原文）→ false
  assertTrue(!hasTruncation('省公共资源交易平台'), '正常原文不应判定为截断');
  assertTrue(!hasTruncation('一致的'), '短原文不应误判');
});

// ==================== P23：首次 doc_info + 禁止空 issues（Issue #223 P0-2/P0-3） ====================

test('P23：首次累加强制 doc_info 逻辑存在', function () {
  assertContains(govSource, 'accumulateCount', '应跟踪累加次数以判断首次');
  assertContains(govSource, '首次 proofreadAccumulate 必须携带 doc_info', '应输出首次必带 doc_info 提示');
  assertContains(govSource, 'innerArgs.doc_info.fileName', '应校验 fileName');
  assertContains(govSource, 'innerArgs.doc_info.filePath', '应校验 filePath');
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
      innerArgs._processed_to_paragraph !== undefined &&
      !hasIssuesArg &&
      !isFirstRealAccumulate
    );
  }
  // 空 issues 上报进度 → 造假
  assertTrue(
    isFakeProgress({ _processed_to_paragraph: 2400, issues: [] }, false),
    '空 issues + 上报进度应为造假'
  );
  // 有 issues 上报 → 正常
  assertTrue(
    !isFakeProgress({ _processed_to_paragraph: 2400, issues: [{ original: 'a', suggestion: 'b' }] }, false),
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
  var notFullCoverage =
    totalParagraphs > 0 && 2300 >= totalParagraphs && !reportGenerated;
  assertTrue(!notFullCoverage, '未覆盖全文不应标记');
});

// ==================== 汇总 ====================

console.log('======================================');
console.log('治理规则测试结果: ' + passCount + '/' + testCount + ' 通过');
console.log('======================================');

process.exit(passCount === testCount ? 0 : 1);
