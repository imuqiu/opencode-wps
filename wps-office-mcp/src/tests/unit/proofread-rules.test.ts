/**
 * Input: proofread.ts 导出的 runBasicProofreading 函数与 Rule/ProofreadIssue 类型
 * Output: 测试覆盖 — 7 条新规则 + metric 字段 + P16 original 完整短语
 * Pos: unit test for proofread rule engine. Once I'm modified, update my header comment and the folder md.
 *
 * 测试 proofread 规则引擎 — 通顺/简洁规则与 metric 字段
 * @author 架构师 NPC
 * @date 2026-08-01
 */

// Mock uuid ESM to avoid Jest transform issue
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

import { runBasicProofreading } from '../../tools/word/proofread';

// ---- fluent rules (句式杂糅) ----
// Rule 1: 通过(.*?)(使|让|令)  — original 捕获 full pattern "通过A使"
// Rule 2: 根据(.*?)显示      — original 捕获 full pattern "根据A显示"

// ---- conciseness rules (冗余词) ----
// Rule 3: 进行(了)?(研究|分析|讨论|处理|调查)
// Rule 4: 作出(了)?(决定|部署|安排)
// Rule 5: 予以(了)?(解决|处理|落实)
// Rule 6: 加以(了)?(解决|完善|规范)
// Rule 7: 针对(.*?)这一问题

describe('proofread rule engine — fluency & conciseness rules', () => {
  // ================================================================
  // 通顺规则（fluency）
  // ================================================================

  describe('fluency rules', () => {
    test('Rule 1: 通过(.*?)(使|让|令) — 检测"通过A使B"句式杂糅', () => {
      const issues = runBasicProofreading('通过加强监督使产品质量提升');
      expect(issues).toHaveLength(1);
      const issue = issues[0];
      expect(issue.type).toBe('句式杂糅');
      expect(issue.metric).toBe('fluency');
      expect(issue.original).toBe('通过加强监督使');
      expect(issue.suggestion).toBe('加强监督使');
    });

    test('Rule 1: 通过(.*?)(让) — 检测"通过A让B"', () => {
      const issues = runBasicProofreading('通过优化流程让效率大幅提高');
      expect(issues).toHaveLength(1);
      const issue = issues[0];
      expect(issue.original).toBe('通过优化流程让');
      expect(issue.metric).toBe('fluency');
    });

    test('Rule 1: 通过(.*?)(令) — 检测"通过A令B"', () => {
      const issues = runBasicProofreading('通过严格管控令违规现象减少');
      const issue = issues[0];
      expect(issue.original).toBe('通过严格管控令');
      expect(issue.metric).toBe('fluency');
    });

    test('Rule 2: 根据(.*?)显示 — 检测"根据A显示"句式杂糅', () => {
      const issues = runBasicProofreading('根据调查结果显示，满意度达90%');
      expect(issues).toHaveLength(1);
      const issue = issues[0];
      expect(issue.type).toBe('句式杂糅');
      expect(issue.metric).toBe('fluency');
      expect(issue.original).toBe('根据调查结果显示');
      expect(issue.suggestion).toBe('调查结果');
    });

    test('Rule 2: 根据(.*?)显示 — 不应误报正常"根据"用法', () => {
      const issues = runBasicProofreading('根据合同约定，甲方应向乙方支付');
      expect(issues.filter(i => i.metric === 'fluency')).toHaveLength(0);
    });

    test('fluency: 不应误报正常"通过"用法（非杂糅）', () => {
      const issues = runBasicProofreading('通过验收的项目可以投入运营');
      const fluencyIssues = issues.filter(i => i.metric === 'fluency');
      expect(fluencyIssues).toHaveLength(0);
    });
  });

  // ================================================================
  // 简洁规则（conciseness）
  // ================================================================

  describe('conciseness rules', () => {
    test('Rule 3: 进行(了)?(研究|分析|讨论|处理|调查) — 检测"进行研究"', () => {
      const issues = runBasicProofreading('我们对数据进行了研究');
      expect(issues).toHaveLength(1);
      const issue = issues[0];
      expect(issue.type).toBe('冗余词');
      expect(issue.metric).toBe('conciseness');
      // original MUST capture full phrase "进行了研究" not just "研究"
      expect(issue.original).toBe('进行了研究');
      expect(issue.suggestion).toBe('研究');
    });

    test('Rule 3: 进行(了)?(分析) — 检测"进行分析"', () => {
      const issues = runBasicProofreading('需要对样本进行分析');
      const issue = issues[0];
      expect(issue.original).toBe('进行分析');
      expect(issue.metric).toBe('conciseness');
    });

    test('Rule 3: 进行(了)?(讨论) — 检测"进行了讨论"', () => {
      const issues = runBasicProofreading('会议对方案进行了讨论');
      const issue = issues[0];
      expect(issue.original).toBe('进行了讨论');
    });

    test('Rule 3: 进行(了)?(处理) — 检测"进行处理"', () => {
      const issues = runBasicProofreading('系统会自动进行处理');
      const issue = issues[0];
      expect(issue.original).toBe('进行处理');
    });

    test('Rule 3: 进行(了)?(调查) — 检测"进行调查"', () => {
      const issues = runBasicProofreading('已经展开进行调查');
      const issue = issues[0];
      expect(issue.original).toBe('进行调查');
    });

    test('Rule 4: 作出(了)?(决定|部署|安排) — 检测"作出决定"', () => {
      const issues = runBasicProofreading('董事会作出决定：增加投资');
      expect(issues).toHaveLength(1);
      const issue = issues[0];
      expect(issue.type).toBe('冗余词');
      expect(issue.metric).toBe('conciseness');
      expect(issue.original).toBe('作出决定');
      expect(issue.suggestion).toBe('决定');
    });

    test('Rule 4: 作出(了)?(部署) — 检测"作出了部署"', () => {
      const issues = runBasicProofreading('领导作出了部署');
      const issue = issues[0];
      expect(issue.original).toBe('作出了部署');
    });

    test('Rule 4: 作出(了)?(安排) — 检测"作出安排"', () => {
      const issues = runBasicProofreading('请尽快作出安排');
      const issue = issues[0];
      expect(issue.original).toBe('作出安排');
    });

    test('Rule 5: 予以(了)?(解决|处理|落实) — 检测"予以解决"', () => {
      const issues = runBasicProofreading('问题已经予以解决');
      expect(issues).toHaveLength(1);
      const issue = issues[0];
      expect(issue.type).toBe('冗余词');
      expect(issue.metric).toBe('conciseness');
      expect(issue.original).toBe('予以解决');
      expect(issue.suggestion).toBe('解决');
    });

    test('Rule 5: 予以(了)?(处理) — 检测"予以处理"', () => {
      const issues = runBasicProofreading('违规行为将予以处理');
      const issue = issues[0];
      expect(issue.original).toBe('予以处理');
    });

    test('Rule 5: 予以(了)?(落实) — 检测"予以落实"', () => {
      const issues = runBasicProofreading('政策必须予以落实');
      const issue = issues[0];
      expect(issue.original).toBe('予以落实');
    });

    test('Rule 6: 加以(了)?(解决|完善|规范) — 检测"加以解决"', () => {
      const issues = runBasicProofreading('存在的问题必须加以解决');
      expect(issues).toHaveLength(1);
      const issue = issues[0];
      expect(issue.type).toBe('冗余词');
      expect(issue.metric).toBe('conciseness');
      expect(issue.original).toBe('加以解决');
      expect(issue.suggestion).toBe('解决');
    });

    test('Rule 6: 加以(了)?(完善) — 检测"加以完善"', () => {
      const issues = runBasicProofreading('制度需要加以完善');
      const issue = issues[0];
      expect(issue.original).toBe('加以完善');
    });

    test('Rule 6: 加以(了)?(规范) — 检测"加以规范"', () => {
      const issues = runBasicProofreading('流程应当加以规范');
      const issue = issues[0];
      expect(issue.original).toBe('加以规范');
    });

    test('Rule 7: 针对(.*?)这一问题 — 检测"针对A这一问题"', () => {
      const issues = runBasicProofreading('针对质量下滑这一问题，我们制定了方案');
      expect(issues).toHaveLength(1);
      const issue = issues[0];
      expect(issue.type).toBe('冗余词');
      expect(issue.metric).toBe('conciseness');
      // original MUST capture full phrase "针对质量下滑这一问题"
      expect(issue.original).toBe('针对质量下滑这一问题');
      expect(issue.suggestion).toBe('对质量下滑');
    });
  });

  // ================================================================
  // P16 兼容性验证：original 必须捕获完整短语
  // ================================================================

  describe('P16 cross-validation compatibility (original captures full phrase)', () => {
    test('P16: original="进行研究" — findText="研究"(子串) 可以匹配', () => {
      const issues = runBasicProofreading('对数据进行研究');
      const issue = issues[0];
      // original 包含子串 "研究" — P16 子串校验会放行
      expect(issue.original.includes('研究')).toBe(true);
      expect(issue.original).toBe('进行研究');
    });

    test('P16: original="通过加强监督使" — findText="加强监督使"(子串) 可以匹配', () => {
      const issues = runBasicProofreading('通过加强监督使质量提升');
      const issue = issues[0];
      expect(issue.original.includes('加强监督使')).toBe(true);
      expect(issue.original).toBe('通过加强监督使');
    });

    test('P16: original="根据调查结果显示" — findText="调查结果显示"(子串) 可以匹配', () => {
      const issues = runBasicProofreading('根据调查结果显示，满意度高');
      const issue = issues[0];
      expect(issue.original.includes('调查结果显示')).toBe(true);
      expect(issue.original).toBe('根据调查结果显示');
    });

    test('P16: original="作出了部署" — findText="部署"(子串) 可以匹配', () => {
      const issues = runBasicProofreading('领导作出了部署');
      const issue = issues[0];
      expect(issue.original.includes('部署')).toBe(true);
      expect(issue.original).toBe('作出了部署');
    });

    test('P16: original="针对质量下滑这一问题" — findText="这一问题"(子串) 可以匹配', () => {
      const issues = runBasicProofreading('针对质量下滑这一问题');
      const issue = issues[0];
      expect(issue.original.includes('这一问题')).toBe(true);
      expect(issue.original).toBe('针对质量下滑这一问题');
    });

    test('P16: findText not in any original — 不匹配场景（验证 original 不含无关内容）', () => {
      const issues = runBasicProofreading('进行研究并作出决定');
      const originals = issues.map(i => i.original);
      // "随意编造的文本" 不应匹配任何 original
      expect(originals.some(o => o.includes('随意编造的文本'))).toBe(false);
    });
  });

  // ================================================================
  // 向后兼容：旧规则不填 metric
  // ================================================================

  describe('backward compatibility — old rules without metric', () => {
    test('旧规则（的得混淆）不携带 metric 字段', () => {
      const issues = runBasicProofreading('跑的很快');
      const issue = issues[0];
      expect(issue.type).toBe('的得混淆');
      expect(issue.metric).toBeUndefined();
    });

    test('旧规则（重复标点）不携带 metric 字段', () => {
      const issues = runBasicProofreading('你好。。');
      const issue = issues[0];
      expect(issue.type).toBe('重复标点');
      expect(issue.metric).toBeUndefined();
    });

    test('旧规则（句式冗余：原因是）不携带 metric 字段', () => {
      const issues = runBasicProofreading('失败的原因是因为准备不足');
      const issue = issues[0];
      expect(issue.type).toBe('句式冗余');
      expect(issue.metric).toBeUndefined();
    });

    test('旧规则（多字：涉及到）不携带 metric 字段', () => {
      const issues = runBasicProofreading('这涉及到多方利益');
      const issue = issues[0];
      expect(issue.type).toBe('多字');
      expect(issue.metric).toBeUndefined();
    });
  });

  // ================================================================
  // 多 issue 混合场景
  // ================================================================

  describe('mixed scenarios', () => {
    test('同一条文本同时命中 fluency + conciseness + 旧规则', () => {
      const text = '通过优化流程进行分析使效率提升，跑的很快。';
      const issues = runBasicProofreading(text);

      const fluencyIssues = issues.filter(i => i.metric === 'fluency');
      const concisenessIssues = issues.filter(i => i.metric === 'conciseness');
      const oldIssues = issues.filter(i => i.metric === undefined);

      expect(fluencyIssues.length).toBeGreaterThanOrEqual(1);
      expect(concisenessIssues.length).toBeGreaterThanOrEqual(1);
      expect(oldIssues.length).toBeGreaterThanOrEqual(1);

      // 验证 fluency 的 original（.*? 为 lazy，所以 "通过优化流程进行分析使"）
      expect(fluencyIssues.some(i => i.original === '通过优化流程进行分析使')).toBe(true);

      // 验证 conciseness 的 original
      expect(concisenessIssues.some(i => i.original === '进行分析')).toBe(true);

      // 验证旧规则的 original（regex (/（做|搞|…|喝）的(太|很|…) 匹配 "跑的很"）
      expect(oldIssues.some(i => i.original === '跑的很')).toBe(true);
    });

    test('多条 conciseness 规则可同时命中', () => {
      const text = '需要进行研究并作出部署，予以落实并加以完善';
      const issues = runBasicProofreading(text);
      const concisenessIssues = issues.filter(i => i.metric === 'conciseness');
      expect(concisenessIssues).toHaveLength(4);
    });

    test('7 条新规则不误报正常文本', () => {
      const cleanText = '经过充分调查，研究团队通过深入分析并决定实施新方案。根据以上结果，针对该问题已经妥善处理。';
      const issues = runBasicProofreading(cleanText);
      const newRuleIssues = issues.filter(i => i.metric === 'fluency' || i.metric === 'conciseness');
      // "经过..." 不触发"通过A使B"，"根据以上结果"后面没有"显示"
      // "针对该问题"后面没有"这一问题"
      // "决定"前面没有"作出"，"处理"前面没有"进行/予以"
      expect(newRuleIssues).toHaveLength(0);
    });
  });

  // ================================================================
  // 边界条件
  // ================================================================

  describe('edge cases', () => {
    test('空文本应返回空数组', () => {
      const issues = runBasicProofreading('');
      expect(issues).toHaveLength(0);
    });

    test('纯英文文本不触发新规则', () => {
      const issues = runBasicProofreading('The team conducted research and made decisions.');
      const newRuleIssues = issues.filter(i => i.metric === 'fluency' || i.metric === 'conciseness');
      expect(newRuleIssues).toHaveLength(0);
    });

    test('offset 参数正确传递', () => {
      const issues = runBasicProofreading('通过培训使员工成长', 100);
      expect(issues[0].offset).toBe(100);
    });

    test('suggestion 不等于 original — 规则有效', () => {
      const issues = runBasicProofreading('进行了研究');
      const issue = issues[0];
      expect(issue.original).not.toBe(issue.suggestion);
      expect(issue.original).toBe('进行了研究');
      expect(issue.suggestion).toBe('研究');
    });
  });

  // ================================================================
  // 与现有"多字"规则的 non-overlap 验证
  // ================================================================

  describe('non-overlap with existing "多字" rules', () => {
    test('涉及到 仍由旧规则"多字"处理，不触发新规则', () => {
      const issues = runBasicProofreading('这涉及到多方利益');
      const multiWordIssues = issues.filter(i => i.type === '多字');
      expect(multiWordIssues.length).toBeGreaterThanOrEqual(1);
      // 不应被 conciseness 规则重复命中
      const concisenessIssues = issues.filter(i => i.metric === 'conciseness');
      expect(concisenessIssues.some(i => i.original.includes('涉及'))).toBe(false);
    });

    test('并非是 仍由旧规则"多字"处理', () => {
      const issues = runBasicProofreading('这并非是正确的');
      const multiWordIssues = issues.filter(i => i.type === '多字');
      expect(multiWordIssues.some(i => i.original.includes('并非'))).toBe(true);
    });

    test('全部都 仍由旧规则"多字"处理', () => {
      const issues = runBasicProofreading('全部都完成了');
      const multiWordIssues = issues.filter(i => i.type === '多字');
      expect(multiWordIssues.some(i => i.original.includes('全部都'))).toBe(true);
    });
  });
});
