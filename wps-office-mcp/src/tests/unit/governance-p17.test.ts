/**
 * Input: .opencode/plugins/governance.js 的 P17 规则（session_ffa8 问题一：禁止 AI 手动 write 伪造校对报告）
 * Output: 验证 P17 在两种场景下的拦截/放行逻辑
 * Pos: governance P17 拦截「AI 手动 write 校对报告路径」的单元测试
 *
 * session_ffa8 问题一（P0）：AI 在 generateProofreadReport 失败后，直接用 writeFile 手动
 * 构造 Markdown 报告写入桌面（3 份数据互相矛盾），绕过服务端真实累计的数据。
 * P17 修复：写「校对报告」路径时，若服务端尚未成功生成报告（st.reportGenerated !== true），
 * 则拦截并提示走 generateProofreadReport。
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

/**
 * 在 vm 沙箱中执行 governance.js，暴露其 plugin 工厂对象。
 * governance.js 是 ESM（`export const WpsGovernancePlugin = async () => {...}`），
 * 无法直接在 vm 沙箱解析 `export`，故把 `export const` 替换为 `const`，
 * 再在沙箱末尾追加 `module.exports.WpsGovernancePlugin = WpsGovernancePlugin;` 暴露工厂。
 */
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

describe('governance P17 — 禁止 AI 手动 write 伪造校对报告（session_ffa8 问题一）', () => {
  it('服务端未生成报告时，writeFile 写入「校对报告」路径被拦截', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];
    expect(typeof before).toBe('function');

    const input = {
      tool: 'wps_office_execute',
      sessionID: 'p17-test-session',
      callID: 'call-1',
      args: {
        tool_name: 'writeFile',
        arguments: {
          filePath: 'C:\\Users\\test\\桌面\\文档.校对报告.md',
          content: '# 伪造的校对报告\n问题 16 处，五维评分…',
        },
      },
    };

    let threw = false;
    try {
      await before(input, {});
    } catch (e: any) {
      threw = true;
      expect(String(e.message)).toContain('P17');
      expect(String(e.message)).toContain('校对报告');
      expect(String(e.message)).toContain('禁止 AI 手动 write 伪造报告');
    }
    expect(threw).toBe(true);
  });

  it('服务端未生成报告时，直接 write（非网关）写校对报告路径也被拦截', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];
    const input = {
      tool: 'wps_office_execute',
      sessionID: 'p17-test-session-2',
      callID: 'call-2',
      args: {
        tool_name: 'write',
        arguments: { path: 'C:/Users/test/桌面/合同.校对报告.md', content: '手动拼的报告' },
      },
    };
    let threw = false;
    try {
      await before(input, {});
    } catch (e: any) {
      threw = true;
      expect(String(e.message)).toContain('P17');
    }
    expect(threw).toBe(true);
  });

  it('非校对报告路径的 writeFile 正常放行', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];
    const input = {
      tool: 'wps_office_execute',
      sessionID: 'p17-test-session-3',
      callID: 'call-3',
      args: {
        tool_name: 'writeFile',
        arguments: { filePath: 'C:\\Users\\test\\batch_1.txt', content: '正文文本' },
      },
    };
    // 不应抛 P17（可能因其他规则抛错，但只要不含 P17 即视为本规则放行）
    let threwP17 = false;
    try {
      await before(input, {});
    } catch (e: any) {
      if (String(e.message).indexOf('P17') !== -1) threwP17 = true;
    }
    expect(threwP17).toBe(false);
  });

  it('服务端已成功生成报告后，writeFile 落盘服务端报告路径放行（合法方案 B）', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];

    // 先模拟 generateProofreadReport 成功 → st.reportGenerated = true
    const genInput = {
      tool: 'wps_office_execute',
      sessionID: 'p17-test-session-4',
      callID: 'call-4a',
      args: {
        tool_name: 'generateProofreadReport',
        arguments: { session_id: 's1', output_file: 'C:\\Users\\test\\文档.校对报告.md' },
      },
    };
    const after = plugin['tool.execute.after'];
    // 模拟 after 钩子标记报告已生成（content 非空 → ok）
    await after(genInput, { content: [{ type: 'text', text: '报告已生成' }], isError: false });

    // 现在 writeFile 同一校对报告路径 → 应放行（不抛 P17）
    const writeInput = {
      tool: 'wps_office_execute',
      sessionID: 'p17-test-session-4',
      callID: 'call-4b',
      args: {
        tool_name: 'writeFile',
        arguments: {
          filePath: 'C:\\Users\\test\\文档.校对报告.md',
          content: '服务端返回的报告文本',
        },
      },
    };
    let threwP17 = false;
    try {
      await before(writeInput, {});
    } catch (e: any) {
      if (String(e.message).indexOf('P17') !== -1) threwP17 = true;
    }
    expect(threwP17).toBe(false);
  });

  it('generateProofreadReport 失败（未找到会话）后 writeFile 仍被拦截（P17 防绕过）', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];
    const after = plugin['tool.execute.after'];

    // 模拟 generateProofreadReport 返回失败（未找到会话）→ st.reportGenerated 应保持 false
    const genFailInput = {
      tool: 'wps_office_execute',
      sessionID: 'p17-fail-session',
      callID: 'call-f1',
      args: {
        tool_name: 'generateProofreadReport',
        arguments: { session_id: 'nosuch', output_file: 'C:\\Users\\test\\文档.校对报告.md' },
      },
    };
    await after(genFailInput, {
      output: '未找到会话 nosuch。请先使用 wps_word_proofread_accumulate 累加校对问题。',
      isError: false,
    });

    // 此时 AI 想 writeFile 伪造校对报告 → 应仍被 P17 拦截
    const writeInput = {
      tool: 'wps_office_execute',
      sessionID: 'p17-fail-session',
      callID: 'call-f2',
      args: {
        tool_name: 'writeFile',
        arguments: { filePath: 'C:\\Users\\test\\文档.校对报告.md', content: 'AI 手拼的报告' },
      },
    };
    let threwP17 = false;
    try {
      await before(writeInput, {});
    } catch (e: any) {
      if (String(e.message).indexOf('P17') !== -1) threwP17 = true;
    }
    expect(threwP17).toBe(true);
  });

  it('P18：已处理到 N 段后再次从段落 1 回卷获取被拦截（session_ffa8 问题四）', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];
    const after = plugin['tool.execute.after'];

    // 先模拟 getActiveDocument + getDocumentParagraphs 第一批（1-100），标记已处理
    await after(
      {
        tool: 'wps_office_execute',
        sessionID: 'p18-session',
        callID: 'c1',
        args: { tool_name: 'getActiveDocument', arguments: {} },
      },
      { output: '总段数: 201', isError: false }
    );
    await after(
      {
        tool: 'wps_office_execute',
        sessionID: 'p18-session',
        callID: 'c2',
        args: {
          tool_name: 'getDocumentParagraphs',
          arguments: { start_paragraph: 1, end_paragraph: 100 },
        },
      },
      { output: '[1] (正文) [0-100]\n[100] (正文) [9999-10000]', isError: false }
    );

    // 模拟完整批次周期：proofreadBasic（无问题）+ confirmBatchAiProofread，使 P12 放行、P18 可达
    await after(
      {
        tool: 'wps_office_execute',
        sessionID: 'p18-session',
        callID: 'c2b',
        args: {
          tool_name: 'proofreadBasic',
          arguments: { startOffset: 0, text: '这是一段正常文本，长度超过二十字。' },
        },
      },
      { output: '基础校对完成，未发现问题。\n{"issues":[]}', isError: false }
    );
    await after(
      {
        tool: 'wps_office_execute',
        sessionID: 'p18-session',
        callID: 'c2c',
        args: { tool_name: 'confirmBatchAiProofread', arguments: {} },
      },
      { output: 'AI 智能校对已确认完成。', isError: false }
    );

    // 现在 AI 再次 getDocumentParagraphs(start=1) 回卷 → P18 拦截
    const rewindInput = {
      tool: 'wps_office_execute',
      sessionID: 'p18-session',
      callID: 'c3',
      args: {
        tool_name: 'getDocumentParagraphs',
        arguments: { start_paragraph: 1, end_paragraph: 200 },
      },
    };
    let threwP18 = false;
    try {
      await before(rewindInput, {});
    } catch (e: any) {
      if (String(e.message).indexOf('P18') !== -1) threwP18 = true;
    }
    expect(threwP18).toBe(true);
  });

  it('原生 write 工具（非网关）写校对报告路径被拦截（Issue #179 P17 漏洞修复）', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];

    // 原生 write 工具：outerTool='write'，路径直接放顶层 args，不走 wps_office_execute 网关。
    // 此前前置闸门 `if (outerTool !== '...execute') return` 会直接放行，P17 拦截不到。
    const input = {
      tool: 'write',
      sessionID: 'p17-native-write',
      callID: 'call-n1',
      args: {
        path: 'C:/Users/test/桌面/合同.校对报告.md',
        content: '# 手动伪造的校对报告\n问题 42 处，五维评分…',
      },
    };

    let threw = false;
    try {
      await before(input, {});
    } catch (e: any) {
      threw = true;
      expect(String(e.message)).toContain('P17');
      expect(String(e.message)).toContain('校对报告');
      expect(String(e.message)).toContain('禁止 AI 手动 write 伪造报告');
    }
    expect(threw).toBe(true);
  });

  it('原生 writeFile 工具写校对报告路径也被拦截（Issue #179 P17 漏洞修复）', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];

    const input = {
      tool: 'writeFile',
      sessionID: 'p17-native-writefile',
      callID: 'call-n2',
      args: { filePath: 'F:\\2025年度\\文档.校对报告.md', content: '手拼报告' },
    };
    let threw = false;
    try {
      await before(input, {});
    } catch (e: any) {
      threw = true;
      expect(String(e.message)).toContain('P17');
    }
    expect(threw).toBe(true);
  });

  it('原生 edit 工具写校对报告路径也被拦截（Issue #179 P17 覆盖 edit）', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];

    // 原生 edit 工具（P17 NATIVE_WRITE_TOOLS 包含 edit）：改文件内容到校对报告路径
    const input = {
      tool: 'edit',
      sessionID: 'p17-native-edit',
      callID: 'call-ne1',
      args: { filePath: 'C:/Users/test/桌面/合同.校对报告.md', content: '手拼报告' },
    };
    let threw = false;
    try {
      await before(input, {});
    } catch (e: any) {
      threw = true;
      expect(String(e.message)).toContain('P17');
    }
    expect(threw).toBe(true);
  });

  it('原生 write 写非校对报告路径正常放行（不抛 P17）', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];

    const input = {
      tool: 'write',
      sessionID: 'p17-native-write-ok',
      callID: 'call-n3',
      args: { path: 'C:/Users/test/batch_1.txt', content: '正文内容' },
    };
    let threwP17 = false;
    try {
      await before(input, {});
    } catch (e: any) {
      if (String(e.message).indexOf('P17') !== -1) threwP17 = true;
    }
    expect(threwP17).toBe(false);
  });

  it('服务端已成功生成报告后，原生 write 写校对报告路径放行（合法方案 B）', async () => {
    const plugin = await loadGovernancePlugin()();
    const before = plugin['tool.execute.before'];
    const after = plugin['tool.execute.after'];

    // 先模拟 generateProofreadReport 成功 → st.reportGenerated = true
    const genInput = {
      tool: 'wps_office_execute',
      sessionID: 'p17-native-write-ok2',
      callID: 'call-g1',
      args: {
        tool_name: 'generateProofreadReport',
        arguments: { session_id: 's1', output_file: 'C:/Users/test/文档.校对报告.md' },
      },
    };
    await after(genInput, { content: [{ type: 'text', text: '报告已生成' }], isError: false });

    const writeInput = {
      tool: 'write',
      sessionID: 'p17-native-write-ok2',
      callID: 'call-g2',
      args: { path: 'C:/Users/test/文档.校对报告.md', content: '服务端返回的报告文本' },
    };
    let threwP17 = false;
    try {
      await before(writeInput, {});
    } catch (e: any) {
      if (String(e.message).indexOf('P17') !== -1) threwP17 = true;
    }
    expect(threwP17).toBe(false);
  });
});
