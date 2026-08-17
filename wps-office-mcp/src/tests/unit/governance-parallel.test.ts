/**
 * Input: .opencode/plugins/governance.js 的 P19-P21 并行模式适配（Issue #151 R1-2/R1-3）
 * Output: 验证并行执行 agent（携带 _batch_id + _batch_range）不被旧 P1/P2/P12 会话级单值误拦截，
 *         以及 replaceInParagraph 按批次分配区间校验越界。
 * Pos: governance 并行批次的隔离与防误拦截单元测试
 *
 * Issue #151 R1-2/R1-3 背景：
 * - R1-2：旧 P1/P2/P12/P18 分批规则基于会话级单值（lastBatchParaIndex/batchStarted 等），
 *   并行多执行 agent 各处理独立区间时会被互相覆盖而误拦截（如 agent B 的 start=101 不满足
 *   「start = lastBatchParaIndex+1」）。修复：并行模式（携带 _batch_id）跳过这些串行连续性校验，
 *   由 P19 的 _batch_range 区间隔离承担正确校验。
 * - R1-3：replaceInParagraph 段落边界校验在并行模式改用批次分配区间（assignedRanges[batchId]）。
 */

import * as fs from 'fs';
import * as path from 'path';
import vm from 'vm';

// 读取根目录 governance.js 源码
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
    { filename: 'governance.js' }
  );
  return (module.exports as any).WpsGovernancePlugin;
}

// 构造 wps_office_execute 网关输入
function execInput(sessionID: string, callID: string, tool_name: string, arguments_: Record<string, unknown> = {}) {
  return {
    tool: 'wps_office_execute',
    sessionID,
    callID,
    args: { tool_name, arguments: arguments_ },
  };
}

// 运行 before 钩子，返回是否被拦截（抛错）
async function expectIntercept(plugin: any, input: any, keyword: string): Promise<boolean> {
  const before = plugin['tool.execute.before'];
  try {
    await before(input, {});
    return false;
  } catch (e: any) {
    return String(e.message).indexOf(keyword) !== -1;
  }
}

describe('governance 并行模式适配（Issue #151 R1-2/R1-3）', () => {
  it('R1-2：并行下第二个执行 agent 的 getDocumentParagraphs 不被 P1/P2 会话级单值误拦截', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];
    const after = plugin['tool.execute.after'];

    // 初始化文档
    await after(
      execInput('parallel-sess', 'c0', 'getActiveDocument'),
      { output: '总段数: 300', isError: false }
    );

    // agent A（batch-1，区间 1-100）完整走一批，设置会话级 lastBatchParaIndex=100、batchStarted=true
    await after(
      execInput('parallel-sess', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1, end_paragraph: 100,
        _batch_id: 'batch-1', _batch_range: { start: 1, end: 100 },
      }),
      { output: '[1] (正文) [0-100]\n[100] (正文) [9999-10000]', isError: false }
    );
    await after(
      execInput('parallel-sess', 'c2', 'proofreadBasic', {
        startOffset: 0, text: '这是 agent A 的正常文本，长度超过二十字。',
        _batch_id: 'batch-1',
      }),
      { output: '基础校对完成，未发现问题。\n{"issues":[]}', isError: false }
    );
    await after(
      execInput('parallel-sess', 'c3', 'confirmBatchAiProofread', { _batch_id: 'batch-1' }),
      { output: 'AI 智能校对已确认完成。', isError: false }
    );
    await after(
      execInput('parallel-sess', 'c4', 'replaceInParagraph', {
        paragraphIndex: 50, findText: 'agent A 原文', replacement: '修正',
        _batch_id: 'batch-1',
      }),
      { output: '已替换', isError: false }
    );

    // agent B（batch-2，区间 101-200）调用 getDocumentParagraphs(101,200)
    // 并行模式下不应被 P1/P2 误拦截（A 已推进到 100，B 的 start=101 若不跳过会被 P2 误判）
    const bGetInput = execInput('parallel-sess', 'c5', 'getDocumentParagraphs', {
      start_paragraph: 101, end_paragraph: 200,
      _batch_id: 'batch-2', _batch_range: { start: 101, end: 200 },
    });
    let threw = false;
    try { await before(bGetInput, {}); } catch (e: any) { threw = true; }
    expect(threw).toBe(false); // 不应被拦截
  });

  it('R1-2：并行下越界 getDocumentParagraphs 仍被 P19 拦截（区间隔离有效）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    await after(
      execInput('parallel-sess2', 'c0', 'getActiveDocument'),
      { output: '总段数: 300', isError: false }
    );

    // agent A 声明区间 1-100
    await after(
      execInput('parallel-sess2', 'c1', 'getDocumentParagraphs', {
        start_paragraph: 1, end_paragraph: 100,
        _batch_id: 'batch-1', _batch_range: { start: 1, end: 100 },
      }),
      { output: '[1] (正文) [0-100]', isError: false }
    );

    // agent B 声明区间 101-200，但请求越界到 150-250 → P19 拦截
    const overflow = await expectIntercept(
      plugin,
      execInput('parallel-sess2', 'c2', 'getDocumentParagraphs', {
        start_paragraph: 150, end_paragraph: 250,
        _batch_id: 'batch-2', _batch_range: { start: 101, end: 200 },
      }),
      'P19'
    );
    expect(overflow).toBe(true);
  });

  it('R1-3：并行下 replaceInParagraph 越界（超出批次分配区间）被 P19 拦截', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];
    const after = plugin['tool.execute.after'];

    await after(
      execInput('parallel-sess3', 'c0', 'getActiveDocument'),
      { output: '总段数: 300', isError: false }
    );
    await after(
      execInput('parallel-sess3', 'c0b', 'enableTrackChanges', { enable: true }),
      { output: '修订模式已开启', isError: false }
    );

    // agent A 声明区间 1-100（P19 在 before 阶段登记 assignedRanges['batch-1'] = {1,100}）
    await before(execInput('parallel-sess3', 'c1', 'getDocumentParagraphs', {
      start_paragraph: 1, end_paragraph: 100,
      _batch_id: 'batch-1', _batch_range: { start: 1, end: 100 },
    }), {});

    // agent A 试图替换段落 150（超出自己分配区间 1-100）→ P19 拦截
    const overflowReplace = await expectIntercept(
      plugin,
      execInput('parallel-sess3', 'c2', 'replaceInParagraph', {
        paragraphIndex: 150, findText: '越界替换', replacement: 'x',
        _batch_id: 'batch-1',
      }),
      'P19'
    );
    expect(overflowReplace).toBe(true);
  });

  it('R1-3：并行下 replaceInParagraph 在批次分配区间内放行', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];
    const after = plugin['tool.execute.after'];

    await after(
      execInput('parallel-sess4', 'c0', 'getActiveDocument'),
      { output: '总段数: 300', isError: false }
    );
    await after(
      execInput('parallel-sess4', 'c0b', 'enableTrackChanges', { enable: true }),
      { output: '修订模式已开启', isError: false }
    );
    // 用 before() 触发 P19 登记批次区间（before 阶段执行 _batch_range 登记）
    await before(execInput('parallel-sess4', 'c1', 'getDocumentParagraphs', {
      start_paragraph: 1, end_paragraph: 100,
      _batch_id: 'batch-1', _batch_range: { start: 1, end: 100 },
    }), {});

    // 批次区间内的替换放行（不抛错）
    let threw = false;
    try {
      await before(execInput('parallel-sess4', 'c2', 'replaceInParagraph', {
        paragraphIndex: 50, findText: '区间内替换', replacement: 'x',
        _batch_id: 'batch-1',
      }), {});
    } catch (e: any) { threw = true; }
    expect(threw).toBe(false);
  });

  it('R4-2：proofreadAccumulate 携带 _batch_id 时 _steps_log 含非法步骤名被 P20 拦截', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    let threwP20 = false;
    try {
      await after(execInput('parallel-sess5', 'c1', 'proofreadAccumulate', {
        session_id: 'sess-r42',
        issues: [],
        _batch_id: 'batch-1',
        _steps_log: [
          { step: 'getDocumentParagraphs', paragraphIndex: 1 },
          { step: 'aiDeepScan', paragraphIndex: 1 }, // 非法步骤名
        ],
      }), { content: [{ type: 'text', text: 'ok' }], isError: false });
    } catch (e: any) {
      if (String(e.message).indexOf('P20') !== -1) threwP20 = true;
    }
    expect(threwP20).toBe(true);
  });

  it('R4-2：proofreadAccumulate 携带 _batch_id 且 _steps_log 步骤名全合法则放行（不被 P20 拦截）', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    let threw = false;
    try {
      await after(execInput('parallel-sess6', 'c1', 'proofreadAccumulate', {
        session_id: 'sess-r42b',
        issues: [],
        _batch_id: 'batch-1',
        _steps_log: [
          { step: 'getDocumentParagraphs', paragraphIndex: 1 },
          { step: 'proofreadAccumulate', paragraphIndex: 1 },
        ],
      }), { content: [{ type: 'text', text: 'ok' }], isError: false });
    } catch (e: any) { threw = true; }
    expect(threw).toBe(false); // 步骤名合法，P20 不拦截
  });

  it('R7-2：并行下 getDocumentTextByRange 超长 length 被 P13 拦截（防上下文超限）', async () => {
    const plugin = await loadGovernancePlugin()();

    const overflow = await expectIntercept(
      plugin,
      execInput('parallel-sess7', 'c1', 'getDocumentTextByRange', {
        startOffset: 0, length: 50000,
        _batch_id: 'batch-1',
      }),
      'P13'
    );
    expect(overflow).toBe(true);
  });

  it('R7-2：并行下 getDocumentTextByRange 合理 length 放行', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];

    let threw = false;
    try {
      await before(execInput('parallel-sess8', 'c1', 'getDocumentTextByRange', {
        startOffset: 0, length: 5000,
        _batch_id: 'batch-1',
      }), {});
    } catch (e: any) { threw = true; }
    expect(threw).toBe(false);
  });

  it('R11-1：proofreadAccumulate 的 _steps_log 步骤名带空白时被 P20 trim 后放行', async () => {
    const plugin = await loadGovernancePlugin()();
    const after = plugin['tool.execute.after'];

    let threw = false;
    try {
      await after(execInput('parallel-sess9', 'c1', 'proofreadAccumulate', {
        session_id: 'sess-r111',
        issues: [],
        _batch_id: 'batch-1',
        _steps_log: [
          { step: ' getDocumentParagraphs', paragraphIndex: 1 }, // 带前导空白
          { step: 'proofreadAccumulate ', paragraphIndex: 1 },  // 带尾随空白
        ],
      }), { content: [{ type: 'text', text: 'ok' }], isError: false });
    } catch (e: any) { threw = true; }
    expect(threw).toBe(false); // trim 后步骤名合法，P20 不拦截
  });
});
