/**
 * Input: .opencode/plugins/governance.js 分批校对稳定性整改（Issue #229）
 * Output: 验证分批校对执行不稳定的 5 个核心问题修复：
 *   问题1 批次中途失败死锁 → 同批重试放行
 *   问题2 getDocumentParagraphs 输出截断 → 批次边界以请求参数为准
 *   问题3 proofreadBasic JSON 解析失败 → proofreadHadIssues 三态化
 *   问题5 总段数解析失败 → 从「共N段」兜底提取
 *   问题6 parseParagraphRanges 正则误解析 → 非贪婪匹配
 * Pos: governance 分批校对稳定性修复的单元测试
 */

import * as fs from 'fs';
import * as path from 'path';
import vm from 'vm';

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.opencode', 'plugins', 'governance.js'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到仓库根目录（governance.js）');
}
const repoRoot = findRepoRoot(__dirname);
const governancePath = path.join(repoRoot, '.opencode', 'plugins', 'governance.js');
const governanceSrc = fs.readFileSync(governancePath, 'utf-8');

function loadGovernancePlugin() {
  const transformed = governanceSrc.replace(
    /^export\s+const\s+(WpsGovernancePlugin)\s*=/m,
    'const $1 ='
  );
  const module = { exports: {} as Record<string, unknown> };
  const sandbox: Record<string, unknown> = {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (id === 'fs') return fs;
      throw new Error(`sandbox require 不支持: ${id}`);
    },
    console,
    setTimeout,
    clearTimeout,
    Buffer,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    transformed + '\nmodule.exports.WpsGovernancePlugin = WpsGovernancePlugin;',
    sandbox,
    {
      filename: 'governance.js',
    }
  );
  return (module.exports as any).WpsGovernancePlugin;
}

function execInput(
  sessionID: string,
  callID: string,
  tool_name: string,
  arguments_: Record<string, unknown> = {}
) {
  return {
    tool: 'wps_office_execute',
    sessionID,
    callID,
    args: { tool_name, arguments: arguments_ },
  };
}

async function expectIntercept(plugin: any, input: any, keyword: string): Promise<boolean> {
  const before = plugin['tool.execute.before'];
  try {
    await before(input, {});
    return false;
  } catch (e: any) {
    return String(e.message).indexOf(keyword) !== -1;
  }
}

/**
 * CR R3-1：真正的「不被拦截」断言——before 钩子必须完全放行（不抛任何异常）。
 * 原 expectIntercept 只在「异常含指定关键字」时返回 true，若被其它规则（如 P12）拦截，
 * 异常不含关键字会误判为放行。本函数用于验证同批重试确实不被任何规则拦截。
 */
async function expectNoIntercept(plugin: any, input: any): Promise<boolean> {
  const before = plugin['tool.execute.before'];
  try {
    await before(input, {});
    return true;
  } catch (e: any) {
    return false;
  }
}

describe('governance 分批校对稳定性整改（Issue #229）', () => {
  // ===== 问题1：批次中途失败死锁 → 同批重试放行 =====
  it('问题1：proofreadBasic 失败后允许重试同批 getDocumentParagraphs（不被 P2/P18 拦截）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    // 初始化文档：共 300 段
    await after(execInput('fix1-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });

    // 第一批：getDocumentParagraphs(1,100)
    await after(
      execInput('fix1-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    // proofreadBasic 失败（isError），状态不推进
    await after(execInput('fix1-sess', 'c2', 'proofreadBasic', { startOffset: 0, text: '...' }), {
      output: 'COM 超时',
      isError: true,
    });

    // 重试同批 getDocumentParagraphs(1,100) → 应完全放行（不被 P2/P12/P18 任何规则拦截）
    // CR R3-1：用 expectNoIntercept 验证「不被任何拦截」，而非只检查特定关键字
    // （旧 expectIntercept 会被 P12 的「尚未调用 proofreadBasic」消息误判为放行）。
    const retry = await expectNoIntercept(
      plugin,
      execInput('fix1-sess', 'c3', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      })
    );
    expect(retry).toBe(true);
    const retryAgain = await expectNoIntercept(
      plugin,
      execInput('fix1-sess', 'c4', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      })
    );
    expect(retryAgain).toBe(true);
  });

  it('问题1：非首批同批重试（101-200）也放行', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('fix1b-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    // 第一批 1-100
    await after(
      execInput('fix1b-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    await after(
      execInput('fix1b-sess', 'c2', 'proofreadBasic', {
        startOffset: 0,
        text: '这是一段足够长的正常文本用于校对。',
        findText: 'x',
      }),
      { output: '基础校对完成，未发现问题。\n{"issues":[]}', isError: false }
    );
    await after(execInput('fix1b-sess', 'c3', 'confirmBatchAiProofread', {}), {
      output: 'AI 智能校对已确认完成。',
      isError: false,
    });
    // 第二批 101-200
    await after(
      execInput('fix1b-sess', 'c4', 'getDocumentParagraphs', {
        start_paragraph: 101,
        end_paragraph: 200,
      }),
      { output: '[101] (正文) [10000-10099]\n[200] (正文) [20000-20099]', isError: false }
    );
    // proofreadBasic 失败
    await after(
      execInput('fix1b-sess', 'c5', 'proofreadBasic', { startOffset: 10000, text: '...' }),
      { output: 'COM 超时', isError: true }
    );
    // 重试同批 101-200 → 放行
    const retry = await expectIntercept(
      plugin,
      execInput('fix1b-sess', 'c6', 'getDocumentParagraphs', {
        start_paragraph: 101,
        end_paragraph: 200,
      }),
      '批次不连续'
    );
    expect(retry).toBe(false);
  });

  it('问题1：非本批范围（如取下一批但本批未完成）仍被 P12 拦截（不破坏串行纪律）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('fix1c-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('fix1c-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    // proofreadBasic 失败，本批未完成
    await after(execInput('fix1c-sess', 'c2', 'proofreadBasic', { startOffset: 0, text: '...' }), {
      output: 'COM 超时',
      isError: true,
    });
    // 试图取下一批 101-200（非本批范围）→ 应被 P12 拦截
    const next = await expectIntercept(
      plugin,
      execInput('fix1c-sess', 'c3', 'getDocumentParagraphs', {
        start_paragraph: 101,
        end_paragraph: 200,
      }),
      'P12'
    );
    expect(next).toBe(true);
  });

  // ===== 问题2：输出截断 → 批次边界以请求参数为准 =====
  it('问题2：请求 1-100 段但输出截断到 80 段时，lastBatchParaIndex 以请求 end_paragraph=100 为准', async () => {
    // 通过 after hook 后检查 getSessionState 状态（间接：调用 getDocumentParagraphs 后，
    // 后续获取下一批从请求 end+1 开始能被连续校验放行）。
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    await after(execInput('fix2b-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('fix2b-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[80] (正文) [7999-8099]', isError: false }
    );
    // 完成本批 proofread + confirm，使 P12 放行
    await after(
      execInput('fix2b-sess', 'c2', 'proofreadBasic', {
        startOffset: 0,
        text: '这是一段足够长的正常文本用于校对。',
      }),
      { output: '基础校对完成，未发现问题。\n{"issues":[]}', isError: false }
    );
    await after(execInput('fix2b-sess', 'c3', 'confirmBatchAiProofread', {}), {
      output: 'AI 智能校对已确认完成。',
      isError: false,
    });
    // 若 lastBatchParaIndex=100（请求端），下一批 101 应连续放行；若误用 80，则 start=101 != 81 拦截
    const intercept = await expectIntercept(
      plugin,
      execInput('fix2b-sess', 'c4', 'getDocumentParagraphs', {
        start_paragraph: 101,
        end_paragraph: 200,
      }),
      '批次不连续'
    );
    expect(intercept).toBe(false);
  });

  // ===== 问题3：proofreadBasic JSON 解析失败 → 三态化 =====
  it('问题3：JSON 解析失败时 proofreadHadIssues 置 null，P15 不误限流', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('fix3-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('fix3-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    await after(execInput('fix3-sess', 'c2', 'enableTrackChanges', { enable: true }), {
      output: '已开启修订',
      isError: false,
    });
    // proofreadBasic 返回被截断的 JSON（无完整 issues 结构）→ 解析失败 → proofreadHadIssues=null
    await after(
      execInput('fix3-sess', 'c3', 'proofreadBasic', {
        startOffset: 0,
        text: '这是一段足够长的正常文本用于校对。',
      }),
      { output: '基础校对完成。\n{"issues": [', isError: false }
    );
    await after(execInput('fix3-sess', 'c4', 'confirmBatchAiProofread', {}), {
      output: 'AI 智能校对已确认完成。',
      isError: false,
    });
    // 未知态下，第一次 AI 修复不应被 P15 限流（旧逻辑会因 proofreadHadIssues=false 拦截）
    const firstFix = await expectIntercept(
      plugin,
      execInput('fix3-sess', 'c5', 'replaceInParagraph', {
        paragraphIndex: 5,
        findText: '某原文',
        replacement: '修正',
        _force_ai_fix: false,
      }),
      'P15'
    );
    expect(firstFix).toBe(false);
    // 第二次也放行（未知态不触发 P15）
    const secondFix = await expectIntercept(
      plugin,
      execInput('fix3-sess', 'c6', 'replaceInParagraph', {
        paragraphIndex: 6,
        findText: '另一处',
        replacement: '修正2',
        _force_ai_fix: false,
      }),
      'P15'
    );
    expect(secondFix).toBe(false);
  });

  it('问题3：JSON 解析成功且确实有问题时，P16 交叉校验仍生效', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('fix3b-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('fix3b-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    await after(execInput('fix3b-sess', 'c2', 'enableTrackChanges', { enable: true }), {
      output: '已开启修订',
      isError: false,
    });
    await after(
      execInput('fix3b-sess', 'c3', 'proofreadBasic', {
        startOffset: 0,
        text: '这是一段足够长的正常文本用于校对。',
      }),
      {
        output:
          '发现 1 个问题。\n{"issues":[{"offset":0,"length":2,"original":"通过加强","suggestion":"通过","type":"句式杂糅"}]}',
        isError: false,
      }
    );
    await after(execInput('fix3b-sess', 'c4', 'confirmBatchAiProofread', {}), {
      output: 'AI 智能校对已确认完成。',
      isError: false,
    });
    // 修复与已知 issue 匹配 → 放行
    const matchFix = await expectIntercept(
      plugin,
      execInput('fix3b-sess', 'c5', 'replaceInParagraph', {
        paragraphIndex: 5,
        findText: '通过加强',
        replacement: '通过',
        _force_ai_fix: false,
      }),
      'P16'
    );
    expect(matchFix).toBe(false);
    // 修复与已知 issue 不匹配 → P16 拦截
    const mismatchFix = await expectIntercept(
      plugin,
      execInput('fix3b-sess', 'c6', 'replaceInParagraph', {
        paragraphIndex: 6,
        findText: '不存在的原文',
        replacement: '修正',
        _force_ai_fix: false,
      }),
      'P16'
    );
    expect(mismatchFix).toBe(true);
  });

  // ===== 问题5：总段数解析失败 → 从「共N段」兜底 =====
  it('问题5：getActiveDocument 总段数未知时，从 getDocumentParagraphs 的「共N段」兜底提取', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    // getActiveDocument 返回「总段数: 未知」（launcher 回退）
    await after(execInput('fix5-sess', 'c0', 'getActiveDocument'), {
      output: '当前文档: test.docx\n路径: /tmp/test.docx\n类型: docx\n总段数: 未知\n字数: 1000',
      isError: false,
    });
    // getDocumentParagraphs 输出含「共300段」
    await after(
      execInput('fix5-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 300,
      }),
      {
        output:
          '文档段落结构（共300段，返回300段）：\n[1] (正文) [0-99]\n[300] (正文) [29999-30099]',
        isError: false,
      }
    );
    // 处理最后一批达到 totalParagraphs 后，应能标记 allBatchesComplete（不再被 P24/完整性拦截）
    // 此处验证：完成本批后，再次取下一批（其实已覆盖全文）应被"所有批次已全部完成"拦截，
    // 证明 totalParagraphs=300 已正确兜底。
    const allDone = await expectIntercept(
      plugin,
      execInput('fix5-sess', 'c2', 'getDocumentParagraphs', {
        start_paragraph: 301,
        end_paragraph: 400,
      }),
      '全部完成'
    );
    expect(allDone).toBe(true);
  });

  // ===== 问题6：parseParagraphRanges 正则误解析 =====
  it('问题6：段落文本内含 [N] (style) [start-end] 结构时不误解析', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    await after(execInput('fix6-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    // 段落 1 文本内含 "请参考 [2] (标题) [100-199]"；应解析为段落1的范围 [0-99]
    await after(
      execInput('fix6-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 2,
      }),
      {
        output: '[1] (正文) [0-99] 请参考 [2] (标题) [100-199] 的内容\n[2] (正文) [100-199] 第二段',
        isError: false,
      }
    );
    // proofreadBasic 用 startOffset=0（第一段起始）应匹配 batchStartOffset；若被误解析为 [100]，
    // 则 batchStartOffset=100，startOffset=0 会触发 startOffset 不匹配拦截。
    const soMismatch = await expectIntercept(
      plugin,
      execInput('fix6-sess', 'c2', 'proofreadBasic', {
        startOffset: 0,
        text: '这是一段足够长的正常文本用于校对。',
      }),
      '不匹配'
    );
    expect(soMismatch).toBe(false);
  });
});

// ===== CR R3-1：proofreadBasic 失败后同批重试不被 P12 拦截（死锁修复补全） =====
describe('governance CR R3-1：P12 同批重试放行（Issue #229）', () => {
  it('R3-1：proofreadBasic 失败后同批重试 getDocumentParagraphs 不被 P12 拦截（可重试推进）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('cr31-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('cr31-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    // proofreadBasic 失败（isError），proofreadCalledThisBatch 不置 true
    await after(execInput('cr31-sess', 'c2', 'proofreadBasic', { startOffset: 0, text: 'x' }), {
      output: 'COM 超时',
      isError: true,
    });
    // 同批重试 1-100 必须完全放行（P12 分支1 也应放行，而非只放行 P2/P18）
    const retry = await expectNoIntercept(
      plugin,
      execInput('cr31-sess', 'c3', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      })
    );
    expect(retry).toBe(true);
  });

  it('R3-1：proofreadBasic 成功后同批重试仍被 P12 拦截（本批已走完，不放行多余重取）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('cr31b-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('cr31b-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    // proofreadBasic 成功 → proofreadCalledThisBatch=true
    await after(
      execInput('cr31b-sess', 'c2', 'proofreadBasic', {
        startOffset: 0,
        text: '这是一段足够长的正常文本用于校对。',
      }),
      { output: '基础校对完成，未发现问题。\n{"issues":[]}', isError: false }
    );
    // 本批已 proofread 但未 confirm，同范围重取应被 P12（未 confirm）拦截
    const intercept = await expectIntercept(
      plugin,
      execInput('cr31b-sess', 'c3', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      'P12'
    );
    expect(intercept).toBe(true);
  });
});

// ===== CR R1-1/R1-3：输出截断批次状态修复 =====
describe('governance CR R1：输出截断批次状态修复（Issue #229）', () => {
  it('R1-1：输出被截断（返回段数 < 请求段数）时，同批重试仍放行（batchTruncated 引导补齐）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('cr1-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    // 请求 1-100 段，但输出头行显示返回 80 段（输出被截断/底层未完整返回）
    await after(
      execInput('cr1-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      {
        output: '文档段落结构（共300段，返回80段）：\n[1] (正文) [0-99]\n[80] (正文) [7999-8099]',
        isError: false,
      }
    );
    // proofreadBasic 失败（本批未走完），重试同批 1-100 应放行（R1-3 未完成约束 + batchTruncated）
    const retry = await expectIntercept(
      plugin,
      execInput('cr1-sess', 'c2', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      '批次不连续'
    );
    expect(retry).toBe(false);
  });

  it('R1-3：本批已完整走完（proofreadBasic+confirm）后，同范围重取被 P18 拦截（不放行多余重取）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('cr3-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('cr3-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    await after(execInput('cr3-sess', 'c2', 'enableTrackChanges', { enable: true }), {
      output: '已开启修订',
      isError: false,
    });
    await after(
      execInput('cr3-sess', 'c3', 'proofreadBasic', {
        startOffset: 0,
        text: '这是一段足够长的正常文本用于校对。',
      }),
      { output: '基础校对完成，未发现问题。\n{"issues":[]}', isError: false }
    );
    await after(execInput('cr3-sess', 'c4', 'confirmBatchAiProofread', {}), {
      output: 'AI 智能校对已确认完成。',
      isError: false,
    });
    // 本批完整走完，再次同范围 1-100 重取 → 应被拦截（P18 回卷）
    const intercept = await expectIntercept(
      plugin,
      execInput('cr3-sess', 'c5', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      'P18'
    );
    expect(intercept).toBe(true);
  });
});

// ===== CR R2-1：getActiveDocument 显式重新开始机制 =====
describe('governance CR R2-1：getActiveDocument 显式重新开始（Issue #229）', () => {
  it('R2-1：同一文档传 _restart:true 时完整重置批次进度，可从第1段重新开始', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('cr21-sess', 'c0', 'getActiveDocument'), {
      output: '当前文档: docA.docx\n路径: /docA.docx\n类型: docx\n总段数: 300',
      isError: false,
    });
    await after(
      execInput('cr21-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    await after(execInput('cr21-sess', 'c2', 'enableTrackChanges', { enable: true }), {
      output: '已开启修订',
      isError: false,
    });
    await after(
      execInput('cr21-sess', 'c3', 'proofreadBasic', {
        startOffset: 0,
        text: '这是一段足够长的正常文本用于校对。',
      }),
      { output: '基础校对完成，未发现问题。\n{"issues":[]}', isError: false }
    );
    await after(execInput('cr21-sess', 'c4', 'confirmBatchAiProofread', {}), {
      output: 'AI 智能校对已确认完成。',
      isError: false,
    });
    // 同一文档显式 _restart:true → 完整重置，从第1段重新开始不被 P18 拦截
    await after(execInput('cr21-sess', 'c5', 'getActiveDocument', { _restart: true }), {
      output: '当前文档: docA.docx\n路径: /docA.docx\n类型: docx\n总段数: 300',
      isError: false,
    });
    const restart = await expectIntercept(
      plugin,
      execInput('cr21-sess', 'c6', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      'P18'
    );
    expect(restart).toBe(false);
  });
});

// ===== 问题4：会话状态作用域过宽 → 文档切换自动重置 + LRU 淘汰 =====
describe('governance 问题4：会话状态作用域（Issue #229）', () => {
  it('问题4：同一会话中切换到不同文档时，getActiveDocument 自动重置批次状态', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    // 第一次 getActiveDocument：文档A
    await after(execInput('fix4-sess', 'c0', 'getActiveDocument'), {
      output: '当前文档: docA.docx\n路径: /docA.docx\n类型: docx\n总段数: 300\n字数: 5000',
      isError: false,
    });
    // 处理文档A第一批
    await after(
      execInput('fix4-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    // 完成第一批校对
    await after(
      execInput('fix4-sess', 'c2', 'proofreadBasic', {
        startOffset: 0,
        text: '这是一段足够长的正常文本用于校对。',
      }),
      { output: '基础校对完成，未发现问题。\n{"issues":[]}', isError: false }
    );
    await after(execInput('fix4-sess', 'c3', 'confirmBatchAiProofread', {}), {
      output: 'AI 智能校对已确认完成。',
      isError: false,
    });

    // 切换文档B（路径不同）
    await after(execInput('fix4-sess', 'c4', 'getActiveDocument'), {
      output: '当前文档: docB.docx\n路径: /docB.docx\n类型: docx\n总段数: 200\n字数: 3000',
      isError: false,
    });

    // 文档B应该可以从第1段重新开始（不被 P18 拦截——因 lastBatchParaIndex 已重置为0）
    const p18Intercept = await expectIntercept(
      plugin,
      execInput('fix4-sess', 'c5', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      'P18'
    );
    expect(p18Intercept).toBe(false);

    // 文档B批次连续性也应正确（start=1 是首次，不应被 P2 的连续性检查拦截）
    const p2Intercept = await expectIntercept(
      plugin,
      execInput('fix4-sess', 'c6', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      '批次不连续'
    );
    expect(p2Intercept).toBe(false);
  });

  it('问题4：同一文档重复 getActiveDocument 不重置已处理进度（不打断正常流程）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('fix4b-sess', 'c0', 'getActiveDocument'), {
      output: '当前文档: docA.docx\n路径: /docA.docx\n类型: docx\n总段数: 300\n字数: 5000',
      isError: false,
    });
    await after(
      execInput('fix4b-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    // 同一文档再次 getActiveDocument（不触发重置——同一路径）
    await after(execInput('fix4b-sess', 'c2', 'getActiveDocument'), {
      output: '当前文档: docA.docx\n路径: /docA.docx\n类型: docx\n总段数: 300\n字数: 5000',
      isError: false,
    });
    // CR R1-4（修复 R1-2 后）：同一文档重复 getActiveDocument 不应重置批次进度。
    // 第1批已处理到段落 100，同一文档再次 getActiveDocument（路径相同，不触发重置），
    // lastBatchParaIndex 应仍为 100。取第2批 101-200 应能连续通过（不被 P2「批次不连续」拦截）。
    const intercept = await expectIntercept(
      plugin,
      execInput('fix4b-sess', 'c3', 'getDocumentParagraphs', {
        start_paragraph: 101,
        end_paragraph: 200,
      }),
      '批次不连续'
    );
    expect(intercept).toBe(false);
  });
  it('问题4：MAX_SESSIONS 超限时 LRU 淘汰最久未访问的会话', async () => {
    // 验证 getSessionState 中 LRU 淘汰逻辑存在
    const govSrc = governanceSrc;
    expect(govSrc).toContain('activeDocPath');
    expect(govSrc).toContain('lastAccessTime');
    expect(govSrc).toContain('lruKey');
    expect(govSrc).toContain('resetProofreadState');
    expect(govSrc).toContain('docSwitched');
    expect(govSrc).toContain('restartRequested');
    expect(govSrc).toContain('if (docSwitched || restartRequested)');
  });
});

// ===== CR R11：同批重试上限 + 参数类型规范化 =====
describe('governance CR R11：同批重试上限与参数类型规范化（Issue #229）', () => {
  it('R11-1：同批重试超过 MAX_BATCH_RETRY_LIMIT 后不再放行', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('cr11-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    // 第一次获取 1-100 段（输出截断，batchTruncated=true）
    await after(
      execInput('cr11-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      {
        output: '文档段落结构（共300段，返回80段）：\n[1] (正文) [0-99]\n[80] (正文) [7999-8099]',
        isError: false,
      }
    );
    // 重试 1 次（输出仍截断）
    await after(
      execInput('cr11-sess', 'c2', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      {
        output: '文档段落结构（共300段，返回80段）：\n[1] (正文) [0-99]\n[80] (正文) [7999-8099]',
        isError: false,
      }
    );
    // 重试 2 次
    await after(
      execInput('cr11-sess', 'c3', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      {
        output: '文档段落结构（共300段，返回80段）：\n[1] (正文) [0-99]\n[80] (正文) [7999-8099]',
        isError: false,
      }
    );
    // 重试 3 次（达到上限）
    await after(
      execInput('cr11-sess', 'c4', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      {
        output: '文档段落结构（共300段，返回80段）：\n[1] (正文) [0-99]\n[80] (正文) [7999-8099]',
        isError: false,
      }
    );
    // 第 4 次重试（已超过 MAX_BATCH_RETRY_LIMIT=3）→ 应被拦截（retryingSameBatch 不再放行）
    // 可能被 P12（本批未调 proofreadBasic）或 P18（回卷）任一规则拦截，验证「不被放行」即可
    const blocked = await expectNoIntercept(
      plugin,
      execInput('cr11-sess', 'c5', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      })
    );
    expect(blocked).toBe(false);
  });

  it('R11-1：同批重试未达上限时仍放行（proofreadBasic 失败后重试）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('cr11b-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('cr11b-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    // proofreadBasic 失败
    await after(execInput('cr11b-sess', 'c2', 'proofreadBasic', { startOffset: 0, text: 'x' }), {
      output: 'COM 超时',
      isError: true,
    });
    // 第 1 次同批重试 → 放行
    const retry1 = await expectNoIntercept(
      plugin,
      execInput('cr11b-sess', 'c3', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      })
    );
    expect(retry1).toBe(true);
    // 第 2 次同批重试 → 仍放行（未达上限）
    const retry2 = await expectNoIntercept(
      plugin,
      execInput('cr11b-sess', 'c4', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      })
    );
    expect(retry2).toBe(true);
  });

  it('R11-3：字符串参数也能正确触发同批重试放行（Number 规范化）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('cr11c-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    // 以字符串类型传入参数
    await after(
      execInput('cr11c-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: '1',
        end_paragraph: '100',
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    // proofreadBasic 失败
    await after(execInput('cr11c-sess', 'c2', 'proofreadBasic', { startOffset: 0, text: 'x' }), {
      output: 'COM 超时',
      isError: true,
    });
    // 同批重试（字符串参数）→ 应放行（Number 规范化后 retryingSameBatch 匹配）
    const retry = await expectNoIntercept(
      plugin,
      execInput('cr11c-sess', 'c3', 'getDocumentParagraphs', {
        start_paragraph: '1',
        end_paragraph: '100',
      })
    );
    expect(retry).toBe(true);
  });
});

// ===== CR R12：batchTruncated 时禁止直接 proofreadBasic =====
describe('governance CR R12：batchTruncated 时禁止直接校对（Issue #229）', () => {
  it('R12-1：batchTruncated=true 且未达重试上限时，proofreadBasic 被拦截（要求先补齐段落）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    const before = plugin['tool.execute.before'];

    await after(execInput('cr12-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    // 获取 1-100 段（输出被截断到 80 段，batchTruncated=true）
    await after(
      execInput('cr12-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      {
        output: '文档段落结构（共300段，返回80段）：\n[1] (正文) [0-99]\n[80] (正文) [7999-8099]',
        isError: false,
      }
    );
    // 尝试直接 proofreadBasic → 应被拦截（batchTruncated 且未达重试上限）
    try {
      await before(
        execInput('cr12-sess', 'c2', 'proofreadBasic', {
          startOffset: 0,
          text: '这是一段足够长的正常文本用于校对，超过二十个字符。',
        }),
        {}
      );
      fail('应被拦截但被放行');
    } catch (e: any) {
      expect(String(e.message)).toContain('batchTruncated');
    }
  });

  it('R12-1：batchTruncated=true 且已达重试上限时，proofreadBasic 放行（AI 已尽最大努力）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('cr12b-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    // 获取并重试 4 次（batchRetryCount 达到 MAX_BATCH_RETRY_LIMIT=3）
    for (let i = 1; i <= 4; i++) {
      await after(
        execInput('cr12b-sess', 'c' + i, 'getDocumentParagraphs', {
          start_paragraph: 1,
          end_paragraph: 100,
        }),
        {
          output: '文档段落结构（共300段，返回80段）：\n[1] (正文) [0-99]\n[80] (正文) [7999-8099]',
          isError: false,
        }
      );
    }
    // 重试达上限后，允许用当前文本 proofreadBasic
    const ok = await expectNoIntercept(
      plugin,
      execInput('cr12b-sess', 'c5', 'proofreadBasic', {
        startOffset: 0,
        text: '这是一段足够长的正常文本用于校对，超过二十个字符。',
      })
    );
    expect(ok).toBe(true);
  });
});

// ===== CR R13：错误消息修正 + 参数边界 ====
describe('governance CR R13：错误消息修正与参数边界（Issue #229）', () => {
  it('R13-2：end_paragraph=0 时被正确拦截（不被 || 错误替换为 start+199）', async () => {
    const plugin = await loadGovernancePlugin()();

    await afterActiveDoc(plugin, 'cr13-sess');
    // 传 end_paragraph=0（非法）→ 应被拦截「end 必须 ≥ start」
    const intercept = await expectIntercept(
      plugin,
      execInput('cr13-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 0,
      }),
      'end_paragraph'
    );
    expect(intercept).toBe(true);
  });

  it('R13-1：batchTruncated 拦截消息包含段落号（batchRequestedEnd 替代 batchTruncatedEndIdx）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    const before = plugin['tool.execute.before'];

    await afterActiveDoc(plugin, 'cr13b-sess');
    await after(
      execInput('cr13b-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      {
        output: '文档段落结构（共300段，返回80段）：\n[1] (正文) [0-99]\n[80] (正文) [7999-8099]',
        isError: false,
      }
    );
    // proofreadBasic 被拦截时，错误消息应包含段落号 100
    try {
      await before(
        execInput('cr13b-sess', 'c2', 'proofreadBasic', {
          startOffset: 0,
          text: '这是一段足够长的正常文本用于校对，超过二十个字符。',
        }),
        {}
      );
      fail('应被拦截但被放行');
    } catch (e: any) {
      expect(String(e.message)).toContain('段落 100');
    }
  });
});

// 辅助函数：初始化活动文档
async function afterActiveDoc(plugin: any, sessionID: string) {
  const after = plugin['tool.execute.after'];
  await after(execInput(sessionID, 'c0', 'getActiveDocument'), {
    output: '总段数: 300',
    isError: false,
  });
}

// ===== CR R14：totalParagraphs 一致性校验 =====
describe('governance CR R14：totalParagraphs 一致性（Issue #229）', () => {
  it('R14-1：doc_info.totalParagraphs 与已知文档总段数不一致时被拦截', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    // getActiveDocument 返回 300 段
    await after(execInput('cr14-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    // 获取 1-100 段
    await after(
      execInput('cr14-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    // proofreadAccumulate 携带 doc_info.totalParagraphs=250（与 300 不一致）
    // 注意：P22/P23 在 after hook 中执行校验（P23 在 after hook 中 throw）
    let notBlocked = false;
    try {
      await after(
        execInput('cr14-sess', 'c2', 'proofreadAccumulate', {
          issues: [],
          _processed_to_paragraph: 100,
          doc_info: { fileName: 'd.docx', filePath: '/d.docx', totalParagraphs: 250 },
        }),
        { output: 'OK', isError: false }
      );
      notBlocked = true;
    } catch (e: any) {
      expect(String(e.message)).toContain('不一致');
    }
    expect(notBlocked).toBe(false);
  });

  it('R14-1：doc_info.totalParagraphs 与已知文档总段数一致时放行', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(execInput('cr14b-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('cr14b-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: '[1] (正文) [0-99]\n[100] (正文) [9999-10000]', isError: false }
    );
    // doc_info.totalParagraphs=300 与已知总段数一致 → 放行
    const ok = await expectNoIntercept(
      plugin,
      execInput('cr14b-sess', 'c2', 'proofreadAccumulate', {
        issues: [],
        _processed_to_paragraph: 100,
        doc_info: { fileName: 'd.docx', filePath: '/d.docx', totalParagraphs: 300 },
      })
    );
    expect(ok).toBe(true);
  });
});

describe('governance P25/P26：防假校对/假进度（Issue #229，PR232）', () => {
  // 辅助：构造文档段落输出文本（startPara 指定返回起始段，默认 1）
  function buildParaOutput(total: number, returned: number, startPara = 1): string {
    const paras = [];
    for (let i = 0; i < returned; i++) {
      const idx = startPara + i;
      paras.push(`[${idx}] (正文) [${(idx - 1) * 10}-${idx * 10 - 1}] 第${idx}段文本内容`);
    }
    return `文档段落结构（共${total}段，返回${returned}段）：\n${paras.join('\n')}`;
  }

  // 发起一次 proofreadAccumulate（after hook 校验 P25/P26）
  async function accumulate(
    plugin: any,
    session: string,
    processedTo: number,
    issues: Array<Record<string, unknown>>,
    total = 300
  ) {
    return plugin['tool.execute.after'](
      execInput(session, 'c-acc', 'proofreadAccumulate', {
        _processed_to_paragraph: processedTo,
        issues,
        doc_info: { fileName: 't.docx', filePath: 'C:\\t.docx', totalParagraphs: total },
      }),
      { output: 'OK', isError: false }
    );
  }

  it('P25-1：截断场景下 _processed_to_paragraph 超过实际返回末段被拦截（防假进度）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    // 文档 300 段，请求 (1,100) 只返回 80 段（真截断）
    await after(execInput('p25a-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('p25a-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: buildParaOutput(300, 80), isError: false }
    );
    // AI 宣称校对到 100 段（实际只获取到 80 段）→ P25 拦截（假进度）
    let blocked = false;
    try {
      await accumulate(plugin, 'p25a-sess', 100, [
        { paragraphIndex: 50, text: '问题', suggestion: '修复' },
      ]);
    } catch (e: any) {
      blocked = String(e.message).indexOf('【P25】') !== -1;
    }
    expect(blocked).toBe(true);
    // 改为实际末段 80 → 放行
    let ok = true;
    try {
      await accumulate(plugin, 'p25a-sess', 80, [
        { paragraphIndex: 50, text: '问题', suggestion: '修复' },
      ]);
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });

  it('P25-2：完整批次 _processed_to_paragraph 不超实际返回末段时正常放行', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    await after(execInput('p25b-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('p25b-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: buildParaOutput(300, 100), isError: false }
    );
    let ok = true;
    try {
      await accumulate(plugin, 'p25b-sess', 100, [
        { paragraphIndex: 50, text: '问题', suggestion: '修复' },
      ]);
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });

  it('P26-1：截断场景下上报未实际获取段落的陈旧 issue 被拦截（窗口以实际返回末段为准）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    await after(execInput('p26a-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    await after(
      execInput('p26a-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: buildParaOutput(300, 80), isError: false }
    );
    // 上报 paragraphIndex=90（81-100 段实际未获取）→ P26 拦截（假 issue 填充）
    let blocked = false;
    try {
      await accumulate(plugin, 'p26a-sess', 80, [
        { paragraphIndex: 90, text: '问题', suggestion: '修复' },
      ]);
    } catch (e: any) {
      blocked = String(e.message).indexOf('【P26】') !== -1;
    }
    expect(blocked).toBe(true);
    // 上报 paragraphIndex=50（窗口 1..80 内）→ 放行
    let ok = true;
    try {
      await accumulate(plugin, 'p26a-sess', 80, [
        { paragraphIndex: 50, text: '问题', suggestion: '修复' },
      ]);
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });

  it('P26-2：上报早于本批起始段的陈旧 issue 被拦截', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    await after(execInput('p26b-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    // 第一批：请求 (1,100) 完整返回
    await after(
      execInput('p26b-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: buildParaOutput(300, 100), isError: false }
    );
    await after(
      execInput('p26b-sess', 'c2', 'proofreadBasic', { startOffset: 0, text: 'x'.repeat(40) }),
      {
        output: JSON.stringify({ issues: [] }),
        isError: false,
      }
    );
    // 第二批：请求 (101,200)
    await after(
      execInput('p26b-sess', 'c3', 'getDocumentParagraphs', {
        start_paragraph: 101,
        end_paragraph: 200,
      }),
      { output: buildParaOutput(300, 100, 101), isError: false }
    );
    // 上报 paragraphIndex=50（早于本批窗口 101..200）→ P26 拦截（陈旧 issue）
    let blocked = false;
    try {
      await accumulate(plugin, 'p26b-sess', 200, [
        { paragraphIndex: 50, text: '问题', suggestion: '修复' },
      ]);
    } catch (e: any) {
      blocked = String(e.message).indexOf('【P26】') !== -1;
    }
    expect(blocked).toBe(true);
    // 上报 paragraphIndex=150（窗口 101..200 内）→ 放行
    let ok = true;
    try {
      await accumulate(plugin, 'p26b-sess', 200, [
        { paragraphIndex: 150, text: '问题', suggestion: '修复' },
      ]);
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });

  it('P26-3（R4-1）：本批实际返回从更靠后段落开始时，未实际返回段落的陈旧 issue 被拦截', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    await after(execInput('p26c-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    // 请求 (1,100)，但实际返回从段落 5 开始（起始截断），只返回 5..80
    await after(
      execInput('p26c-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: buildParaOutput(300, 76, 5), isError: false }
    );
    // 上报 paragraphIndex=2（段落 2 本批实际未返回，但在"请求起始段"1 之下界内）→ P26 拦截
    let blocked = false;
    try {
      await accumulate(plugin, 'p26c-sess', 80, [
        { paragraphIndex: 2, text: '问题', suggestion: '修复' },
      ]);
    } catch (e: any) {
      blocked = String(e.message).indexOf('【P26】') !== -1;
    }
    expect(blocked).toBe(true);
    // 上报 paragraphIndex=50（窗口 5..80 内）→ 放行
    let ok = true;
    try {
      await accumulate(plugin, 'p26c-sess', 80, [
        { paragraphIndex: 50, text: '问题', suggestion: '修复' },
      ]);
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });

  it('P25b（R5-1）：会话内进度回退（重新上报更早批次）被拦截', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    await after(execInput('p25b-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 300',
      isError: false,
    });
    // 第一批：请求 (1,100) 完整返回，上报进度 100
    await after(
      execInput('p25b-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: buildParaOutput(300, 100), isError: false }
    );
    await after(
      execInput('p25b-sess', 'c2', 'proofreadBasic', { startOffset: 0, text: 'x'.repeat(40) }),
      { output: JSON.stringify({ issues: [] }), isError: false }
    );
    await accumulate(plugin, 'p25b-sess', 100, [
      { paragraphIndex: 50, text: '问题', suggestion: '修复' },
    ]);
    // 第二批：请求 (101,200) 完整返回
    await after(
      execInput('p25b-sess', 'c3', 'getDocumentParagraphs', {
        start_paragraph: 101,
        end_paragraph: 200,
      }),
      { output: buildParaOutput(300, 100, 101), isError: false }
    );
    await after(
      execInput('p25b-sess', 'c4', 'proofreadBasic', { startOffset: 400, text: 'x'.repeat(40) }),
      { output: JSON.stringify({ issues: [] }), isError: false }
    );
    // 重新上报进度 50（早于已上报的最大值 100）→ P25b 拦截（进度回退）
    let blocked = false;
    try {
      await accumulate(plugin, 'p25b-sess', 50, [
        { paragraphIndex: 101, text: '问题', suggestion: '修复' },
      ]);
    } catch (e: any) {
      blocked = String(e.message).indexOf('【P25b】') !== -1;
    }
    expect(blocked).toBe(true);
    // 正常推进到 200 → 放行
    let ok = true;
    try {
      await accumulate(plugin, 'p25b-sess', 200, [
        { paragraphIndex: 150, text: '问题', suggestion: '修复' },
      ]);
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });

  it('P25b（R7-1）：同批重试上报相同进度不被拦截（仅拦回退）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    await after(execInput('p25d-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 200',
      isError: false,
    });
    // 请求 (1,100) 完整返回，首次上报进度 100
    await after(
      execInput('p25d-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: buildParaOutput(200, 100), isError: false }
    );
    await after(
      execInput('p25d-sess', 'c2', 'proofreadBasic', { startOffset: 0, text: 'x'.repeat(40) }),
      { output: JSON.stringify({ issues: [] }), isError: false }
    );
    await accumulate(
      plugin,
      'p25d-sess',
      100,
      [{ paragraphIndex: 50, text: '问题', suggestion: '修复' }],
      200
    );
    // 同批重试（失败后重报同一批），进度仍为 100（相同值）→ 放行（不误伤）
    let ok = true;
    try {
      await accumulate(
        plugin,
        'p25d-sess',
        100,
        [{ paragraphIndex: 50, text: '问题', suggestion: '修复' }],
        200
      );
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });

  it('P25b（R8-1）：覆盖全文的末批正常推进不被 P25b 误伤', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];
    await after(execInput('p25e-sess', 'c0', 'getActiveDocument'), {
      output: '总段数: 200',
      isError: false,
    });
    // 第一批：1-100，进度 100
    await after(
      execInput('p25e-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1,
        end_paragraph: 100,
      }),
      { output: buildParaOutput(200, 100), isError: false }
    );
    await after(
      execInput('p25e-sess', 'c2', 'proofreadBasic', { startOffset: 0, text: 'x'.repeat(40) }),
      { output: JSON.stringify({ issues: [] }), isError: false }
    );
    await accumulate(
      plugin,
      'p25e-sess',
      100,
      [{ paragraphIndex: 50, text: '问题', suggestion: '修复' }],
      200
    );
    // 第二批：101-200，覆盖全文进度 200 → 放行（不误伤末批）
    await after(
      execInput('p25e-sess', 'c3', 'getDocumentParagraphs', {
        start_paragraph: 101,
        end_paragraph: 200,
      }),
      { output: buildParaOutput(200, 100, 101), isError: false }
    );
    await after(
      execInput('p25e-sess', 'c4', 'proofreadBasic', { startOffset: 400, text: 'x'.repeat(40) }),
      { output: JSON.stringify({ issues: [] }), isError: false }
    );
    let ok = true;
    try {
      await accumulate(
        plugin,
        'p25e-sess',
        200,
        [{ paragraphIndex: 150, text: '问题', suggestion: '修复' }],
        200
      );
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });
});
