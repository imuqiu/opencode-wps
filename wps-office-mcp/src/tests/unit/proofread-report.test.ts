/**
 * Unit tests for proofread-report.ts
 *
 * Tests the TYPE_METRIC_MAP, METRIC_WEIGHT_FORMULA, normalizeToTwoPointScale,
 * session management, and the two new MCP tools.
 */

// We need to import directly from the module — but we first need to
// set up mocks since the module uses uuid, fs, etc.
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-12345'),
}));

// 包装 fs.writeFileSync 为可控 mock（默认调用真实实现），用于确定性模拟写入失败
// （评审 Critical：原 /tmp/not-a-file-dir 会被 writeFileSync 自动创建文件，导致 flaky）
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    writeFileSync: jest.fn(actual.writeFileSync),
  };
});

jest.mock('../../utils/path-safety', () => ({
  validateFilePath: jest.fn((p: string) => p),
  ALLOWED_WRITE_ROOTS: [],
}));

import {
  proofreadAccumulateHandler,
  generateProofreadReportHandler,
  sessionIssues,
  inferIssueType,
  inferTypeFromContent,
  normalizeIssueType,
  normalizeIssueSource,
  normalizeIssueLocation,
  AI_ONLY_PATTERN,
} from '../../tools/word/proofread-report';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as proofreadStore from '../../tools/word/proofread-store';

// 评审建议：重试用例真实写盘不再用 /tmp（Windows 上解析为盘符根，且残留垃圾文件），
// 改用 os.tmpdir() 并每次生成唯一子目录，用例结束后清理。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofread-report-test-'));

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // 清理失败不影响测试结果
  }
});

// Reset sessionIssues before each test
beforeEach(() => {
  sessionIssues.clear();
  // Issue #116 落盘持久化：同时清理磁盘上可能残留的测试会话文件，
  // 避免 getSessionOrLoad 从磁盘恢复旧数据导致测试隔离失效
  // Issue #151 QA 6/12：改用 getProofreadDir() 获取实际存储目录（可能被测试隔离到
  // 每 worker 临时目录），而非硬编码默认路径，避免并发 worker 间删除干扰。
  const proofreadDir = proofreadStore.getProofreadDir();
  try {
    if (fs.existsSync(proofreadDir)) {
      const files = fs.readdirSync(proofreadDir);
      for (const f of files) {
        fs.rmSync(path.join(proofreadDir, f), { force: true });
      }
    }
  } catch {
    // 清理失败不影响测试执行
  }
});

// ==================== Session Management & Accumulate ====================

describe('proofreadAccumulateHandler', () => {
  it('should reject empty session_id', async () => {
    const result = await proofreadAccumulateHandler({ session_id: '', issues: [] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('session_id');
  });

  it('should reject non-array issues', async () => {
    const result = await proofreadAccumulateHandler({
      session_id: 'test-session-1',
      issues: 'not-an-array' as unknown as any[],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('格式错误');
  });

  it('should require doc_info on first call', async () => {
    const result = await proofreadAccumulateHandler({
      session_id: 'test-session-1',
      issues: [],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('doc_info');
  });

  it('should create a new session with doc_info', async () => {
    const result = await proofreadAccumulateHandler({
      session_id: 'test-session-1',
      issues: [
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...测试的的内容...',
          source: 'mcp',
        },
      ],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });

    expect(result.success).toBe(true);
    expect(sessionIssues.has('test-session-1')).toBe(true);
    expect(sessionIssues.get('test-session-1')!.issues.length).toBe(1);
    expect(sessionIssues.get('test-session-1')!.docInfo.fileName).toBe('test.docx');
  });

  it('should accumulate issues on repeated calls', async () => {
    // First call
    await proofreadAccumulateHandler({
      session_id: 'test-session-2',
      issues: [
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });

    // Second call — no doc_info needed
    await proofreadAccumulateHandler({
      session_id: 'test-session-2',
      issues: [
        {
          offset: 50,
          length: 2,
          original: '的了',
          suggestion: '得了',
          type: '的得混淆',
          context: '...',
          source: 'mcp',
        },
      ],
    });

    const session = sessionIssues.get('test-session-2')!;
    expect(session.issues.length).toBe(2);
  });

  it('should deduplicate issues by offset+original', async () => {
    await proofreadAccumulateHandler({
      session_id: 'test-session-3',
      issues: [
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });

    // Same issue again
    await proofreadAccumulateHandler({
      session_id: 'test-session-3',
      issues: [
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
    });

    const session = sessionIssues.get('test-session-3')!;
    expect(session.issues.length).toBe(1); // deduplicated
  });

  it('offset 缺失时不去重（评审 warning：退化 undefined|原文 键会误判重复丢弃）', async () => {
    await proofreadAccumulateHandler({
      session_id: 'test-session-3b',
      issues: [
        {
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });

    // 同原文但无 offset：无法确认同一位置，保守保留（不再误并）
    await proofreadAccumulateHandler({
      session_id: 'test-session-3b',
      issues: [
        {
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
    });

    const session = sessionIssues.get('test-session-3b')!;
    expect(session.issues.length).toBe(2); // 不去重，两条都保留
  });

  it('offset 相同才去重：不同 offset 同原文不误并', async () => {
    await proofreadAccumulateHandler({
      session_id: 'test-session-3c',
      issues: [
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
        {
          offset: 25,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });

    const session = sessionIssues.get('test-session-3c')!;
    expect(session.issues.length).toBe(2); // 不同位置同原文，不误并
  });

  it('同 offset 同 original 不同 source 合并为 1 条，且 AI 优先覆盖 MCP（三轮评审 warning）', async () => {
    await proofreadAccumulateHandler({
      session_id: 'test-session-3d',
      issues: [
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的的',
          type: '重复字符',
          context: '...',
          source: 'ai' as const,
          reason: '重复字符',
        },
      ],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });

    const session = sessionIssues.get('test-session-3d')!;
    expect(session.issues.length).toBe(1); // 同位置同原文合并为 1 条
    expect(session.issues[0].source).toBe('ai'); // AI 条目优先
    expect(session.issues[0].reason).toBe('重复字符');
  });

  it('AI 覆盖 MCP 时保留 Layer 1 的具体 type（四轮评审 warning：type 失真）', async () => {
    await proofreadAccumulateHandler({
      session_id: 'test-session-3d2',
      issues: [
        // MCP：Layer 1 手工指定具体 type（假设规则命中）
        {
          offset: 10,
          length: 6,
          original: '完全陌生词XYZ',
          suggestion: '陌生词',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
        // AI：type 无法由规则推断 → 兜底为「未分类」→ 应保留 MCP 的「重复字符」
        {
          offset: 10,
          length: 6,
          original: '完全陌生词XYZ',
          suggestion: '陌生词',
          type: '未分类',
          context: '...',
          source: 'ai' as const,
          reason: 'AI 判定',
        },
      ],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });

    const session = sessionIssues.get('test-session-3d2')!;
    expect(session.issues.length).toBe(1);
    expect(session.issues[0].source).toBe('ai'); // AI 条目仍优先
    expect(session.issues[0].type).toBe('重复字符'); // 但 type 保留 Layer 1 的
  });

  it('AI 条目自身有具体 type 时不被 MCP 的 type 覆盖', async () => {
    await proofreadAccumulateHandler({
      session_id: 'test-session-3d3',
      issues: [
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '口语化',
          context: '...',
          source: 'ai' as const,
          reason: 'AI 认为口语化',
        },
      ],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });

    const session = sessionIssues.get('test-session-3d3')!;
    expect(session.issues.length).toBe(1);
    expect(session.issues[0].source).toBe('ai');
    expect(session.issues[0].type).toBe('口语化'); // AI 自己的 type 保留
  });

  it('跨批：AI 未分类先入 + MCP 后到具体 type，AI 优先保留且 type 被 MCP 提升（四轮评审 edge 修复）', async () => {
    await proofreadAccumulateHandler({
      session_id: 'edge-session-1',
      issues: [
        {
          offset: 10,
          length: 6,
          original: '完全陌生词XYZ',
          suggestion: '陌生词',
          type: '未分类',
          context: '...',
          source: 'ai' as const,
          reason: 'AI 判定',
        },
      ],
      doc_info: { fileName: 't.docx', filePath: '/p/t.docx', totalParagraphs: 5, totalWords: 100 },
    });
    await proofreadAccumulateHandler({
      session_id: 'edge-session-1',
      issues: [
        {
          offset: 10,
          length: 6,
          original: '完全陌生词XYZ',
          suggestion: '陌生词',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
    });
    const session = sessionIssues.get('edge-session-1')!;
    expect(session.issues.length).toBe(1); // 同键合并为 1 条
    expect(session.issues[0].source).toBe('ai'); // AI 条目优先（先入者）
    expect(session.issues[0].type).toBe('重复字符'); // MCP 具体 type 提升 AI 的「未分类」
  });

  it('跨批：MCP 先入具体 type + AI 后到未分类，AI 覆盖时保留 MCP 的 type（四轮评审 warning 修复验证）', async () => {
    await proofreadAccumulateHandler({
      session_id: 'edge-session-2',
      issues: [
        {
          offset: 20,
          length: 6,
          original: '完全陌生词XYZ',
          suggestion: '陌生词',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
      doc_info: { fileName: 't.docx', filePath: '/p/t.docx', totalParagraphs: 5, totalWords: 100 },
    });
    await proofreadAccumulateHandler({
      session_id: 'edge-session-2',
      issues: [
        {
          offset: 20,
          length: 6,
          original: '完全陌生词XYZ',
          suggestion: '陌生词',
          type: '未分类',
          context: '...',
          source: 'ai' as const,
          reason: 'AI 判定',
        },
      ],
    });
    const session = sessionIssues.get('edge-session-2')!;
    expect(session.issues.length).toBe(1);
    expect(session.issues[0].source).toBe('ai'); // AI 覆盖 MCP
    expect(session.issues[0].type).toBe('重复字符'); // 保留 MCP 的具体 type
  });

  it('同 offset 同 original（含 | 字符）仍正确合并为 1 条（四轮评审 info：去重键鲁棒性）', async () => {
    await proofreadAccumulateHandler({
      session_id: 'test-session-3d4',
      issues: [
        {
          offset: 10,
          length: 3,
          original: 'A|B',
          suggestion: 'AB',
          type: '用词统一',
          context: '...',
          source: 'mcp',
        },
        {
          offset: 10,
          length: 3,
          original: 'A|B',
          suggestion: 'A、B',
          type: '用词统一',
          context: '...',
          source: 'mcp',
        },
      ],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });

    const session = sessionIssues.get('test-session-3d4')!;
    expect(session.issues.length).toBe(1); // 同位置同原文合并为 1 条
    expect(session.issues[0].original).toBe('A|B');
  });

  it('累加返回文本暴露 offset 缺失计数（三轮评审 warning：可观测性）', async () => {
    const result = await proofreadAccumulateHandler({
      session_id: 'test-session-3e',
      issues: [
        {
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });

    const text = result.content[0].text!;
    expect(text).toContain('1 条未携带绝对 offset，未参与去重');
  });

  it('dedupedCount 只统计本批新增导致的去重（三轮评审 info：不把历史累计重复计入）', async () => {
    // 第一批：1 条（无重复）
    await proofreadAccumulateHandler({
      session_id: 'test-session-3f',
      issues: [
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });
    // 第二批：与第一批重复 1 条（跨批重复） + 本批内重复 1 条 → 本批去重数应只计 1（本批内重复）
    const result = await proofreadAccumulateHandler({
      session_id: 'test-session-3f',
      issues: [
        {
          offset: 10,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
        {
          offset: 20,
          length: 2,
          original: '的了',
          suggestion: '得了',
          type: '的得混淆',
          context: '...',
          source: 'mcp',
        },
        {
          offset: 20,
          length: 2,
          original: '的了',
          suggestion: '得了',
          type: '的得混淆',
          context: '...',
          source: 'mcp',
        },
      ],
    });

    const session = sessionIssues.get('test-session-3f')!;
    // 第1批 1 条 + 第2批（重复的 offset=10 被丢弃、offset=20 去重剩 1） = 2 条
    expect(session.issues.length).toBe(2);
    const text = result.content[0].text!;
    expect(text).toContain('本批去重 1 条'); // 只计本批内重复，不计跨批重复
  });

  it('should update total_revisions when provided', async () => {
    await proofreadAccumulateHandler({
      session_id: 'test-session-4',
      issues: [],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
      total_revisions: 15,
    });

    expect(sessionIssues.get('test-session-4')!.totalRevisions).toBe(15);
  });

  it('should keep the maximum total_revisions across concurrent writers（评审第 2 轮 R2-2）', async () => {
    // 并行 executor 各自上报不同时刻的全局修订数，直接整体覆盖会产生"最后写入者胜出"的写竞争。
    // 修订记录单调累积，应取最大值（只增不减），后续较小上报不得回退基线。
    const s = 'test-session-r2-2';
    await proofreadAccumulateHandler({
      session_id: s,
      issues: [],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
      total_revisions: 10,
    });
    expect(sessionIssues.get(s)!.totalRevisions).toBe(10);

    // 并行 executor A 观察到 18
    await proofreadAccumulateHandler({
      session_id: s,
      issues: [],
      total_revisions: 18,
    });
    expect(sessionIssues.get(s)!.totalRevisions).toBe(18);

    // 并行 executor B 因时序较晚/快照较早只观察到 12 —— 不得把基线回退到 12（旧实现整体覆盖会回退）
    await proofreadAccumulateHandler({
      session_id: s,
      issues: [],
      total_revisions: 12,
    });
    expect(sessionIssues.get(s)!.totalRevisions).toBe(18);
  });

  it('随 proofreadAccumulate 提交的 _steps_log 落盘到批次凭证（评审第 3 轮 R3-1）', async () => {
    // 执行 agent 按 executor.md 在 proofreadAccumulate 时携带 _batch_id + _steps_log 提交逐步凭证，
    // 服务端必须消费并落盘到批次 stepsLog（供管理 agent getMissingSteps 监督/断点续跑）。
    const s = 'test-session-r3-1';
    const batchId = 'batch-1';
    // 先初始化会话 + 登记批次分配表
    await proofreadAccumulateHandler({
      session_id: s,
      issues: [],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });
    proofreadStore.saveBatchAllocations(s, [
      { batchId, range: { start: 1, end: 100 }, status: 'running', stepsLog: [] },
    ]);

    // 执行 agent 提交本批逐步凭证
    const result = await proofreadAccumulateHandler({
      session_id: s,
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp',
          context: '...',
        },
      ],
      _batch_id: batchId,
      _steps_log: [
        { step: 'getDocumentParagraphs', paragraphIndex: 1 },
        { step: 'getDocumentTextByRange', paragraphIndex: 1 },
        { step: 'proofreadBasic', paragraphIndex: 1 },
        { step: 'confirmBatchAiProofread', paragraphIndex: 1 },
        { step: 'replaceInParagraph', paragraphIndex: 1 },
        { step: 'proofreadAccumulate', paragraphIndex: 1, issuesCount: 1 },
      ],
    });

    // 凭证应落盘到批次 stepsLog
    expect(result.success).toBe(true);
    expect(result.data!.stepsPersisted).toBe(true);
    const allocations = proofreadStore.loadBatchAllocations(s);
    const batch = allocations.find(b => b.batchId === batchId)!;
    expect(batch.stepsLog.length).toBe(6);
    // 管理 agent 监督：标准 6 步全链条完整，getMissingSteps 应无缺失
    expect(proofreadStore.getMissingSteps(s, batchId)).toEqual([]);

    // 清理
    proofreadStore.removeSessionFromDisk(s);
  });

  it('批次不存在时 _steps_log 落盘失败但主流程仍成功（评审第 3 轮 R3-1 防御性）', async () => {
    const s = 'test-session-r3-1b';
    await proofreadAccumulateHandler({
      session_id: s,
      issues: [],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 50,
        totalWords: 5000,
      },
    });
    // 未登记批次分配表，_batch_id 指向不存在的批次 → appendStepRecord 返回 false，stepsPersisted=false
    const result = await proofreadAccumulateHandler({
      session_id: s,
      issues: [],
      _batch_id: 'ghost-batch',
      _steps_log: [{ step: 'proofreadBasic', paragraphIndex: 1 }],
    });
    expect(result.success).toBe(true); // 主流程不阻塞
    expect(result.data!.stepsPersisted).toBe(false);
    proofreadStore.removeSessionFromDisk(s);
  });

  it('规划 agent 初始化时通过 _batch_allocations 登记批次分配表（评审第 3 轮 R3-2）', async () => {
    const s = 'test-session-r3-2';
    // 规划 agent 首次初始化 session 时携带分批计划
    const result = await proofreadAccumulateHandler({
      session_id: s,
      issues: [],
      doc_info: {
        fileName: 'test.docx',
        filePath: 'C:\\test.docx',
        totalParagraphs: 300,
        totalWords: 3000,
      },
      _batch_allocations: [
        { batchId: 'batch-1', range: { start: 1, end: 100 }, status: 'pending' },
        { batchId: 'batch-2', range: { start: 101, end: 200 }, status: 'pending' },
        { batchId: 'batch-3', range: { start: 201, end: 300 }, status: 'pending' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.batchAllocationsPersisted).toBe(true);
    // 批次分配表应落盘，管理 agent 可读
    const allocations = proofreadStore.loadBatchAllocations(s);
    expect(allocations.length).toBe(3);
    expect(allocations.map(a => a.batchId)).toEqual(['batch-1', 'batch-2', 'batch-3']);
    // 管理 agent 断点续跑：pending 批次都应重新入队
    expect(proofreadStore.getIncompleteBatches(s).length).toBe(3);
    proofreadStore.removeSessionFromDisk(s);
  });
});

// ==================== Report Generation ====================

describe('generateProofreadReportHandler', () => {
  it('should reject empty session_id', async () => {
    const result = await generateProofreadReportHandler({ session_id: '' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('session_id');
  });

  it('should reject non-existent session', async () => {
    const result = await generateProofreadReportHandler({ session_id: 'nonexistent' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('会话不存在');
  });

  it('should generate empty report for session with no issues', async () => {
    sessionIssues.set('empty-session', {
      issues: [],
      docInfo: {
        fileName: 'doc.docx',
        filePath: '/path/doc.docx',
        totalParagraphs: 10,
        totalWords: 100,
      },
      createdAt: new Date().toISOString(),
    });

    const result = await generateProofreadReportHandler({ session_id: 'empty-session' });
    expect(result.success).toBe(true);
    const text = result.content[0].text!;
    expect(text).toContain('校对报告');
    expect(text).toContain('0 处');
    expect(text).toContain('10.0/10');
    expect(text).toContain('未发现任何问题');
  });

  it('should classify 少字 as fluency', async () => {
    sessionIssues.set('fluency-test', {
      issues: [
        {
          offset: 10,
          length: 2,
          original: '三方',
          suggestion: '三方面',
          type: '少字',
          context: '...以下三方...',
          source: 'mcp',
        },
      ],
      docInfo: {
        fileName: 'doc.docx',
        filePath: '/path/doc.docx',
        totalParagraphs: 10,
        totalWords: 100,
      },
      createdAt: new Date().toISOString(),
    });

    const result = await generateProofreadReportHandler({ session_id: 'fluency-test' });
    const text = result.content[0].text!;
    // Verify fluency has 1 issue
    expect(text).toContain('流畅度');
    expect(text).toContain('1'); // count
  });

  it('should classify 占位文本 as completeness and score 0', async () => {
    sessionIssues.set('completeness-test', {
      issues: [
        {
          offset: 10,
          length: 10,
          original: 'xxx有限公司',
          suggestion: '[名称]有限公司',
          type: '占位文本',
          context: '...xxx有限公司...',
          source: 'mcp',
        },
      ],
      docInfo: {
        fileName: 'doc.docx',
        filePath: '/path/doc.docx',
        totalParagraphs: 10,
        totalWords: 100,
      },
      createdAt: new Date().toISOString(),
    });

    const result = await generateProofreadReportHandler({ session_id: 'completeness-test' });
    const text = result.content[0].text!;
    // completeness should be 0/10 due to placeholder
    expect(text).toContain('完整度');
    expect(text).toContain('0.0/10');
  });

  it('should calculate fluency score correctly (25 issues → 0)', async () => {
    const issues = Array.from({ length: 25 }, (_, i) => ({
      offset: i * 10,
      length: 2,
      original: '的得',
      suggestion: '得',
      type: '的得混淆',
      context: '...',
      source: 'mcp' as const,
    }));

    sessionIssues.set('fluency-25', {
      issues,
      docInfo: {
        fileName: 'doc.docx',
        filePath: '/path/doc.docx',
        totalParagraphs: 100,
        totalWords: 1000,
      },
      createdAt: new Date().toISOString(),
    });

    const result = await generateProofreadReportHandler({ session_id: 'fluency-25' });
    const text = result.content[0].text!;
    // fluency raw score = 5 - 25*0.2 = 0; normalized = 0; display = 0.0
    expect(text).toContain('0.0/10');
  });

  it('should include radar chart JSON data', async () => {
    sessionIssues.set('radar-test', {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
      docInfo: {
        fileName: 'doc.docx',
        filePath: '/path/doc.docx',
        totalParagraphs: 10,
        totalWords: 100,
      },
      createdAt: new Date().toISOString(),
    });

    const result = await generateProofreadReportHandler({ session_id: 'radar-test' });
    const text = result.content[0].text!;
    expect(text).toContain('雷达图数据');
    expect(text).toContain('"key": "fluency"');
    expect(text).toContain('"name": "流畅度"');
  });

  it('should handle unknown types gracefully', async () => {
    sessionIssues.set('unknown-test', {
      issues: [
        {
          offset: 0,
          length: 5,
          original: 'abcde',
          suggestion: 'abc',
          type: '未来新类型',
          context: '...',
          source: 'ai' as const,
          reason: 'test',
        },
      ],
      docInfo: {
        fileName: 'doc.docx',
        filePath: '/path/doc.docx',
        totalParagraphs: 10,
        totalWords: 100,
      },
      createdAt: new Date().toISOString(),
    });

    const result = await generateProofreadReportHandler({ session_id: 'unknown-test' });
    const text = result.content[0].text!;
    expect(text).toContain('未分类问题');
  });
});

// ==================== normalizeToTwoPointScale ====================

// Import the function via a workaround (it's not exported, but we can test indirectly through reports)
// We bake a separate describe that tests it via the weight formula results

describe('normalizeToTwoPointScale (indirect)', () => {
  // Test via the report output: we know rawScore=5 → normalized=2.0 → display=10.0
  // rawScore=3 → normalized=1.0 → display=5.0
  // rawScore=1 → normalized=0.0 → display=0.0

  it('maps rawScore=5 → 10.0/10 (5 conciseness issues = 5-5*0.3=3.5 → norm=1.25 → 6.3)', async () => {
    // Actually let's use a precise test: 0 issues → rawScore=5 → norm=2 → 10.0/10
    sessionIssues.set('normalize-5', {
      issues: [],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
      createdAt: new Date().toISOString(),
    });

    const result = await generateProofreadReportHandler({ session_id: 'normalize-5' });
    const text = result.content[0].text!;
    // All dimensions should be 10.0/10
    expect(text).toContain('10.0/10');
    expect(text).toContain('5.0'); // raw
    expect(text).toContain('2.00'); // normalized
  });

  it('maps rawScore=1 → normalized=0 → 0.0/10 (20 fluency issues = 5-4=1 → norm=0)', async () => {
    const issues = Array.from({ length: 20 }, (_, i) => ({
      offset: i * 10,
      length: 2,
      original: '的的',
      suggestion: '的',
      type: '的得混淆',
      context: '...',
      source: 'mcp' as const,
    }));

    sessionIssues.set('normalize-1', {
      issues,
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 100,
        totalWords: 1000,
      },
      createdAt: new Date().toISOString(),
    });

    const result = await generateProofreadReportHandler({ session_id: 'normalize-1' });
    const text = result.content[0].text!;
    // fluency: 20 issues → raw = 5-20*0.2 = 1 → norm = 0 → display = 0.0/10
    expect(text).toContain('0.0/10');
    expect(text).toContain('0.00'); // normalized
  });

  it('handles the completeness blocker (hasPlaceholder → 0)', async () => {
    sessionIssues.set('blocker', {
      issues: [
        {
          offset: 0,
          length: 5,
          original: 'xxx公司',
          suggestion: '[名称]',
          type: '占位文本',
          context: '...',
          source: 'mcp',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
      createdAt: new Date().toISOString(),
    });

    const result = await generateProofreadReportHandler({ session_id: 'blocker' });
    const text = result.content[0].text!;
    // completeness: hasPlaceholder → raw=0 → norm=0 → display=0.0/10
    expect(text).toContain('完整度');
    expect(text).toContain('0.0');
  });
});

// ==================== TYPE_METRIC_MAP verification ====================

describe('TYPE_METRIC_MAP classification', () => {
  // We verify via report output which bucket each type falls into

  const testTypeClassification = async (type: string, expectedMetric: string) => {
    sessionIssues.clear();
    sessionIssues.set('cls-test', {
      issues: [
        {
          offset: 0,
          length: 2,
          original: 'xx',
          suggestion: 'yy',
          type,
          context: '...',
          source: 'mcp',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
      createdAt: new Date().toISOString(),
    });

    const result = await generateProofreadReportHandler({ session_id: 'cls-test' });
    const text = result.content[0].text!;
    const lines = text.split('\n');

    // The metric section line should show count of 1
    const metricLabels: Record<string, string> = {
      fluency: '流畅度',
      conciseness: '简洁度',
      accuracy: '准确性',
      consistency: '一致性',
      completeness: '完整度',
    };
    const expectedLabel = metricLabels[expectedMetric];

    // Check that the expected metric row has count 1
    let found = false;
    for (const line of lines) {
      if (line.includes(expectedLabel) && line.includes('| 1 |')) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  };

  // ── fluency ──
  it('少字 → fluency', async () => {
    await testTypeClassification('少字', 'fluency');
  });

  it('的得混淆 → fluency', async () => {
    await testTypeClassification('的得混淆', 'fluency');
  });

  it('口语化 → fluency', async () => {
    await testTypeClassification('口语化', 'fluency');
  });

  it('常见错别字 → fluency', async () => {
    await testTypeClassification('常见错别字', 'fluency');
  });

  // ── conciseness ──
  it('重复字符 → conciseness', async () => {
    await testTypeClassification('重复字符', 'conciseness');
  });

  it('句式冗余 → conciseness', async () => {
    await testTypeClassification('句式冗余', 'conciseness');
  });

  // ── accuracy ──
  it('法律术语 → accuracy', async () => {
    await testTypeClassification('法律术语', 'accuracy');
  });

  it('工程术语 → accuracy', async () => {
    await testTypeClassification('工程术语', 'accuracy');
  });

  // ── consistency ──
  it('中英混排 → consistency', async () => {
    await testTypeClassification('中英混排', 'consistency');
  });

  it('用词统一 → consistency', async () => {
    await testTypeClassification('用词统一', 'consistency');
  });

  // ── completeness ──
  it('占位文本 → completeness', async () => {
    await testTypeClassification('占位文本', 'completeness');
  });
});

// ==================== Session isolation ====================

describe('Session isolation', () => {
  it('sessions should be independent (different session_ids)', async () => {
    await proofreadAccumulateHandler({
      session_id: 'session-a',
      issues: [
        {
          offset: 1,
          length: 1,
          original: 'a',
          suggestion: 'b',
          type: '的得混淆',
          context: '...',
          source: 'mcp',
        },
      ],
      doc_info: { fileName: 'a.docx', filePath: '/a.docx', totalParagraphs: 1, totalWords: 10 },
    });

    await proofreadAccumulateHandler({
      session_id: 'session-b',
      issues: [
        {
          offset: 2,
          length: 1,
          original: 'c',
          suggestion: 'd',
          type: '重复字符',
          context: '...',
          source: 'ai',
          reason: 'test',
        },
      ],
      doc_info: { fileName: 'b.docx', filePath: '/b.docx', totalParagraphs: 2, totalWords: 20 },
    });

    expect(sessionIssues.size).toBe(2);
    expect(sessionIssues.get('session-a')!.issues.length).toBe(1);
    expect(sessionIssues.get('session-b')!.issues.length).toBe(1);
    expect(sessionIssues.get('session-a')!.docInfo.fileName).toBe('a.docx');
    expect(sessionIssues.get('session-b')!.docInfo.fileName).toBe('b.docx');
  });
});

// ==================== inferIssueType 兜底推断（T2，#55） ====================

describe('inferIssueType — type 兜底推断（#55 P0-2）', () => {
  it('有效 type 直接返回（不推断）', () => {
    expect(inferIssueType({ type: '的得混淆', original: '跑的很快' })).toBe('的得混淆');
    expect(inferIssueType({ type: '重复字符', original: '了了' })).toBe('重复字符');
  });

  it('type 缺失（undefined）时按文本推断', () => {
    expect(inferIssueType({ original: '进行了研究', suggestion: '研究' })).toBe('冗余词');
    expect(inferIssueType({ original: '通过加强监督使', suggestion: '加强监督使' })).toBe(
      '句式杂糅'
    );
    expect(inferIssueType({ original: '根据调查结果显示', suggestion: '调查结果' })).toBe(
      '句式杂糅'
    );
    expect(inferIssueType({ original: '由于天气的原因导致', suggestion: '由于天气导致' })).toBe(
      '句式杂糅'
    );
  });

  it('type 为占位值 ai（旧代码覆盖 bug）时兜底推断', () => {
    // 旧 SKILL 合并代码把 Layer 2 的 type 覆盖为 'ai' → 需兜底
    expect(
      inferIssueType({ type: 'ai', original: '加强重视安全问题', suggestion: '重视安全问题' })
    ).toBe('动宾不当');
    expect(
      inferIssueType({
        type: 'ai',
        original: '他取得了显著的进步提高',
        suggestion: '他取得了显著的进步',
      })
    ).toBe('语义重复');
    expect(
      inferIssueType({
        type: 'ai',
        original: '会议讨论了很多丰富的内容',
        suggestion: '会议讨论了很多内容',
      })
    ).toBe('修饰不当');
    expect(
      inferIssueType({
        type: 'ai',
        original: '这一发现具有着深远的意义',
        suggestion: '这一发现具有深远的意义',
      })
    ).toBe('搭配冗余');
    expect(
      inferIssueType({
        type: 'ai',
        original: '这个方案存在着很多不足之处',
        suggestion: '这个方案有很多不足之处',
      })
    ).toBe('搭配冗余');
  });

  it('F11–F15 语料推断为 fluency 类型', () => {
    const f11 = inferIssueType({
      original: '这个方案存在着很多不足之处',
      suggestion: '这个方案有很多不足之处',
    });
    expect(['搭配冗余', '冗余+搭配', '冗余搭配']).toContain(f11);
    expect(
      inferIssueType({ original: '我们需要加强重视安全问题', suggestion: '我们需要重视安全问题' })
    ).toBe('动宾不当');
    expect(
      inferIssueType({ original: '他取得了显著的进步提高', suggestion: '他取得了显著的进步' })
    ).toBe('语义重复');
    expect(
      inferIssueType({ original: '会议讨论了很多丰富的内容', suggestion: '会议讨论了很多内容' })
    ).toBe('修饰不当');
    expect(
      inferIssueType({ original: '这一发现具有着深远的意义', suggestion: '这一发现具有深远的意义' })
    ).toBe('搭配冗余');
  });

  it('完全无法推断时返回未分类', () => {
    expect(inferIssueType({ original: '未知内容abc', suggestion: 'def' })).toBe('未分类');
  });

  it('占位文本推断为占位文本（completeness）', () => {
    expect(inferIssueType({ original: 'xxx有限公司', suggestion: '[名称]有限公司' })).toBe(
      '占位文本'
    );
  });
});

// ==================== proofreadAccumulate type 兜底（T2，#55） ====================

describe('proofreadAccumulateHandler — type 兜底累加（#55 P0-2）', () => {
  it('缺 type 的 issue 累加时自动补齐 type', async () => {
    await proofreadAccumulateHandler({
      session_id: 't2-infer-1',
      issues: [
        {
          offset: 0,
          length: 5,
          original: '加强重视安全问题',
          suggestion: '重视安全问题',
          context: '...',
          source: 'ai',
          reason: '动宾不当',
          // 无 type 字段
        } as any,
      ],
      doc_info: { fileName: 'd.docx', filePath: '/d.docx', totalParagraphs: 1, totalWords: 10 },
    });

    const session = sessionIssues.get('t2-infer-1')!;
    expect(session.issues.length).toBe(1);
    expect(session.issues[0].type).toBe('动宾不当');
  });

  it('type 为 ai 占位值（旧 SKILL 合并 bug）时兜底推断', async () => {
    await proofreadAccumulateHandler({
      session_id: 't2-infer-2',
      issues: [
        {
          offset: 0,
          length: 6,
          original: '进行了研究',
          suggestion: '研究',
          context: '...',
          source: 'ai',
          type: 'ai',
        } as any,
      ],
      doc_info: { fileName: 'd.docx', filePath: '/d.docx', totalParagraphs: 1, totalWords: 10 },
    });

    const session = sessionIssues.get('t2-infer-2')!;
    expect(session.issues[0].type).toBe('冗余词');
  });

  it('报告五维评分不再全 10 分（AI 层无 type 也能归入 fluency）', async () => {
    await proofreadAccumulateHandler({
      session_id: 't2-report',
      issues: [
        {
          offset: 0,
          length: 8,
          original: '加强重视安全问题',
          suggestion: '重视安全问题',
          context: '...',
          source: 'ai',
          reason: '动宾不当',
        } as any,
      ],
      doc_info: { fileName: 'd.docx', filePath: '/d.docx', totalParagraphs: 1, totalWords: 10 },
    });

    const result = await generateProofreadReportHandler({ session_id: 't2-report' });
    const text = result.content[0].text!;
    // fluency 问题数为 1，原始分 = 5 - 1*0.2 = 4.8 → 归一化 (4.8-1)/2 = 1.9 → 9.5/10
    expect(text).toContain('流畅度');
    expect(text).toContain('| 1 |');
    // 不再是全 10.0/10（至少 fluency 因 1 个问题降分）
    expect(text).toContain('9.5/10');
    // 统计摘要：AI 1 处，合计 1 处
    expect(text).toContain('| AI 智能校对 | 1 处 |');
    expect(text).toContain('| **合计** | **1 处** |');
  });

  it('完全无法推断的 issue 进未分类并降级提示', async () => {
    await proofreadAccumulateHandler({
      session_id: 't2-unclassified',
      issues: [
        {
          offset: 0,
          length: 4,
          original: 'zzzz',
          suggestion: 'yyyy',
          context: '...',
          source: 'ai',
          reason: 'x',
        } as any,
      ],
      doc_info: { fileName: 'd.docx', filePath: '/d.docx', totalParagraphs: 1, totalWords: 10 },
    });

    const result = await generateProofreadReportHandler({ session_id: 't2-unclassified' });
    const text = result.content[0].text!;
    expect(text).toContain('未分类问题');
    expect(text).toContain('未计入五维评分');
  });
});

// ==================== TC-12 修订数口径（T3，#55） ====================

describe('TC-12 修订数口径（#55 P1-3）', () => {
  it('报告展示修订总数与口径说明', async () => {
    await proofreadAccumulateHandler({
      session_id: 't3-tc12',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          context: '...',
          source: 'mcp',
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/d.docx', totalParagraphs: 1, totalWords: 10 },
      total_revisions: 2,
    });

    const result = await generateProofreadReportHandler({ session_id: 't3-tc12' });
    const text = result.content[0].text!;
    expect(text).toContain('修订总数');
    expect(text).toContain('2');
    expect(text).toContain('问题数 × 2');
  });
});

describe('releaseSession 时序：文件写入失败时保留会话', () => {
  const sessId = 'retry-session';

  const setupSession = (issues: Array<Record<string, unknown>> = []) => {
    sessionIssues.set(sessId, {
      issues: issues as any,
      docInfo: {
        fileName: 'doc.docx',
        filePath: '/path/doc.docx',
        totalParagraphs: 10,
        totalWords: 100,
      },
      createdAt: new Date().toISOString(),
    });
  };

  it('不指定 output_file 时：报告生成后会话被回收', async () => {
    setupSession([
      {
        offset: 0,
        length: 2,
        original: 'xx',
        suggestion: 'yy',
        type: '的得混淆',
        context: '...',
        source: 'mcp',
      },
    ]);
    const result = await generateProofreadReportHandler({ session_id: sessId });
    expect(result.success).toBe(true);
    expect(sessionIssues.has(sessId)).toBe(false);
  });

  it('output_file 写入成功时：报告生成后会话被回收', async () => {
    setupSession([
      {
        offset: 0,
        length: 2,
        original: 'xx',
        suggestion: 'yy',
        type: '的得混淆',
        context: '...',
        source: 'mcp',
      },
    ]);
    const result = await generateProofreadReportHandler({
      session_id: sessId,
      output_file: path.join(tmpDir, `proofread-report-${Date.now()}.md`),
    });
    expect(result.success).toBe(true);
    expect(sessionIssues.has(sessId)).toBe(false);
  });

  it('output_file 写入失败时：返回 success=false + 失败原因，会话保留（可重试）', async () => {
    // mock fs.writeFileSync 必抛错，保证写入失败确定性（评审 Critical：原 /tmp/not-a-file-dir 会被
    // writeFileSync 自动创建文件导致 flaky；评审建议：不用硬编码 /path 根目录路径——
    // 主分支 mkdirSync(recursive) 会在根目录真实创建 /path 目录，与 PR 自己修复
    // /tmp 残留的方向矛盾）；用 mock 而非真实路径，跨平台（Linux/Windows）均稳定
    setupSession([
      {
        offset: 0,
        length: 2,
        original: 'xx',
        suggestion: 'yy',
        type: '的得混淆',
        context: '...',
        source: 'mcp',
      },
    ]);
    (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });
    const result = await generateProofreadReportHandler({
      session_id: sessId,
      output_file: path.join(tmpDir, 'unwritable-report.md'),
    });
    // 评审建议：落盘失败必须向上游暴露明确信号，禁止静默吞错（用户多次遇到"落盘失败但提示已生成"）
    expect(result.success).toBe(false); // 不再伪装成功
    expect(result.error).toContain('写入文件失败');
    expect(result.content[0].text).toContain('写入文件失败');
    expect(result.content[0].text).toContain('未完成落盘');
    expect(sessionIssues.has(sessId)).toBe(true); // 会话保留，可重试
  });

  it('output_file 写入失败后：修正路径重试可成功，且会话回收', async () => {
    setupSession([
      {
        offset: 0,
        length: 2,
        original: 'xx',
        suggestion: 'yy',
        type: '的得混淆',
        context: '...',
        source: 'mcp',
      },
    ]);
    // 第一次写入失败
    (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });
    const failed = await generateProofreadReportHandler({
      session_id: sessId,
      output_file: path.join(tmpDir, 'unwritable-report.md'),
    });
    expect(failed.success).toBe(false);
    expect(sessionIssues.has(sessId)).toBe(true); // 会话保留
    // 第二次（不 mock → 真实写入）重试成功：写入 os.tmpdir() 唯一目录，用例结束后统一清理
    const retry = await generateProofreadReportHandler({
      session_id: sessId,
      output_file: path.join(tmpDir, `proofread-report-retry-${Date.now()}.md`),
    });
    expect(retry.success).toBe(true);
    expect(sessionIssues.has(sessId)).toBe(false); // 成功后回收
  });

  it('空报告（0 问题）+ output_file 写入失败：返回 success=false，会话保留', async () => {
    setupSession([]);
    (fs.writeFileSync as jest.Mock).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });
    const result = await generateProofreadReportHandler({
      session_id: sessId,
      output_file: path.join(tmpDir, 'unwritable-report.md'),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('写入文件失败');
    expect(sessionIssues.has(sessId)).toBe(true);
  });

  it('评审建议：空报告（0 问题）+ output_file 父目录不存在 → 自动创建父目录并写盘成功', async () => {
    // 与主分支（L936-937）行为一致：同一 output_file 因问题数不同不应出现建目录/不建目录的差异
    setupSession([]);
    const nestedDir = path.join(tmpDir, 'nested-empty', 'sub');
    const outFile = path.join(nestedDir, 'empty-report.md');
    const result = await generateProofreadReportHandler({
      session_id: sessId,
      output_file: outFile,
    });
    expect(result.success).toBe(true);
    expect(fs.existsSync(outFile)).toBe(true); // 父目录被自动创建并成功落盘
    expect(sessionIssues.has(sessId)).toBe(false); // 写盘成功 → 回收会话
  });
});

// ==================== AI_ONLY_PATTERN 模块级常量（评审建议 #70） ====================

describe('AI_ONLY_PATTERN（评审建议：不再每条重建 RegExp）', () => {
  it('F11–F15 AI 专属模式全部命中', () => {
    expect(AI_ONLY_PATTERN.test('这个方案存在着很多不足之处')).toBe(true); // F11 搭配冗余
    expect(AI_ONLY_PATTERN.test('这一发现具有着深远的意义')).toBe(true); // F15 搭配冗余
    expect(AI_ONLY_PATTERN.test('我们需要加强重视安全问题')).toBe(true); // F12 动宾不当
    expect(AI_ONLY_PATTERN.test('他取得了显著的进步提高')).toBe(true); // F13 语义重复
    expect(AI_ONLY_PATTERN.test('会议讨论了很多丰富的内容')).toBe(true); // F14 修饰不当
  });

  it('F14 修正：正常表达“丰富的经验”不命中（数量词+丰富/充分 需同时出现）', () => {
    expect(AI_ONLY_PATTERN.test('他有着丰富的经验')).toBe(false);
    expect(AI_ONLY_PATTERN.test('他经验丰富')).toBe(false);
  });

  it('普通表达不误命中', () => {
    expect(AI_ONLY_PATTERN.test('会议讨论了丰富的内容')).toBe(false); // 无数词+充分/丰富 双修
    expect(AI_ONLY_PATTERN.test('的的')).toBe(false);
  });
});

// ==================== #55 T2：type/metric 兜底推断 ====================

describe('inferTypeFromContent（#55 T2 兜底推断）', () => {
  it('原文含"通过…使" → 句式杂糅', () => {
    expect(inferTypeFromContent('通过这次学习使我受益匪浅', '这次学习使我受益匪浅')).toBe(
      '句式杂糅'
    );
  });

  it('原文含"根据…显示" → 句式杂糅', () => {
    expect(inferTypeFromContent('根据调查结果显示', '调查结果')).toBe('句式杂糅');
  });

  it('原文含"进行…研究" → 冗余词', () => {
    expect(inferTypeFromContent('进行了研究', '研究')).toBe('冗余词');
  });

  it('原文含"由于…的原因导致" → 句式杂糅', () => {
    expect(inferTypeFromContent('由于天气的原因导致了航班延误', '由于天气导致了航班延误')).toBe(
      '句式杂糅'
    );
  });

  it('原文含"并（非|不）是" → 多字', () => {
    expect(inferTypeFromContent('并不是', '并不')).toBe('多字');
  });

  it('原文含"占位文本" → 占位文本', () => {
    expect(inferTypeFromContent('check test sample', '[需补充正式内容]')).toBe('占位文本');
  });

  it('评审建议：F14 不再误判正常表达——"丰富的经验"不被推断为修饰不当', () => {
    // 原模式 `(很多|许多|大量|丰富).{0,6}(内容|经验|知识)` 会把"丰富的经验"（丰富→经验
    // 间隔 0）命中为修饰不当；修正后 F14 需数量词+丰富/充分 同时出现（如"很多丰富的内容"）。
    expect(inferTypeFromContent('他有着丰富的经验', '他经验丰富')).toBeUndefined();
    // F14 真阳性：数量词+丰富/充分 修饰名词 → 修饰不当
    expect(inferTypeFromContent('会议讨论了很多丰富的内容', '会议讨论了很多内容')).toBe('修饰不当');
  });

  it('评审建议：F14 修正同时影响 inferIssueType（F14_MODIFIER_PATTERN 复用）', () => {
    // "丰富的经验"（正常搭配）不再推断为修饰不当，落入后续规则（占位/重复等不命中 → 未分类）
    expect(inferIssueType({ original: '他有着丰富的经验', suggestion: '他经验丰富' })).toBe(
      '未分类'
    );
    // 真阳性仍命中
    expect(
      inferIssueType({ original: '会议讨论了很多丰富的内容', suggestion: '会议讨论了很多内容' })
    ).toBe('修饰不当');
  });

  it('无法推断 → undefined', () => {
    expect(inferTypeFromContent('完全陌生的内容xyz', '也陌生')).toBeUndefined();
  });
});

describe('normalizeIssueType（#55 T2）', () => {
  it('缺 type 的 issue 被兜底推断', () => {
    const issue: any = {
      offset: 0,
      length: 4,
      original: '进行了研究',
      suggestion: '研究',
      source: 'mcp',
    };
    const normalized = normalizeIssueType(issue);
    expect(normalized.type).toBe('冗余词');
  });

  it('type="ai"（SKILL 合并 bug 产物）被兜底推断', () => {
    const issue: any = {
      offset: 0,
      length: 4,
      original: '通过管理使效率提升',
      suggestion: '管理使效率提升',
      type: 'ai',
      source: 'ai',
    };
    const normalized = normalizeIssueType(issue);
    expect(normalized.type).toBe('句式杂糅');
  });

  it('type 正常时保持不变', () => {
    const issue: any = {
      offset: 0,
      length: 4,
      original: '的的',
      suggestion: '的',
      type: '重复字符',
      source: 'mcp',
    };
    const normalized = normalizeIssueType(issue);
    expect(normalized.type).toBe('重复字符');
  });

  it('评审建议：type 带前后空格时 trim 归一化，TYPE_METRIC_MAP 查表不再落入未分类', () => {
    // 与 normalizeIssueSource 对称：有效 type 返回 trim 后归一化值，
    // 避免 ' 的得混淆 ' 在报告 metricForIssue 严格 === 查表时落入"未分类"（TC-13 同源）
    const issue: any = {
      offset: 0,
      length: 4,
      original: '的的',
      suggestion: '的',
      type: ' 重复字符 ',
      source: 'mcp',
    };
    const normalized = normalizeIssueType(issue);
    expect(normalized.type).toBe('重复字符');
  });

  it('无法推断 → 未分类', () => {
    const issue: any = {
      offset: 0,
      length: 4,
      original: '完全陌生的内容xyz',
      suggestion: '也陌生',
      source: 'ai',
    };
    const normalized = normalizeIssueType(issue);
    expect(normalized.type).toBe('未分类');
  });

  it('F11–F15 不合理搭配缺 type 时兜底为细粒度类型（#55 T3 凭据同步）', () => {
    expect(
      normalizeIssueType({
        offset: 0,
        length: 8,
        original: '这个方案存在着很多不足之处',
        suggestion: '这个方案存在很多不足之处',
        source: 'ai',
      } as any).type
    ).toBe('搭配冗余');
    expect(
      normalizeIssueType({
        offset: 0,
        length: 6,
        original: '我们需要加强重视安全问题',
        suggestion: '我们需要重视安全问题',
        source: 'ai',
      } as any).type
    ).toBe('动宾不当');
    expect(
      normalizeIssueType({
        offset: 0,
        length: 6,
        original: '他取得了显著的进步提高',
        suggestion: '他取得了显著的进步',
        source: 'ai',
      } as any).type
    ).toBe('语义重复');
    expect(
      normalizeIssueType({
        offset: 0,
        length: 10,
        original: '会议讨论了很多丰富的内容',
        suggestion: '会议讨论了很多内容',
        source: 'ai',
      } as any).type
    ).toBe('修饰不当');
    expect(
      normalizeIssueType({
        offset: 0,
        length: 8,
        original: '这一发现具有着深远的意义',
        suggestion: '这一发现具有深远的意义',
        source: 'ai',
      } as any).type
    ).toBe('搭配冗余');
  });
});

describe('normalizeIssueSource（验收遗留 TC-13）', () => {
  it('source 已为 mcp / ai 时保持不变', () => {
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 2,
        original: '的的',
        suggestion: '的',
        type: '重复字符',
        source: 'mcp',
      } as any).source
    ).toBe('mcp');
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 2,
        original: '存在着',
        suggestion: '',
        type: '搭配冗余',
        source: 'ai',
      } as any).source
    ).toBe('ai');
  });

  it('评审建议：大小写变体（MCP/AI）归一化为小写，报告统计 === 不再失真', () => {
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 2,
        original: '的的',
        suggestion: '的',
        type: '重复字符',
        source: 'MCP',
      } as any).source
    ).toBe('mcp');
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 2,
        original: '的的',
        suggestion: '的',
        type: '重复字符',
        source: 'Mcp',
      } as any).source
    ).toBe('mcp');
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 2,
        original: '存在着',
        suggestion: '',
        type: '搭配冗余',
        source: 'AI',
      } as any).source
    ).toBe('ai');
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 2,
        original: '存在着',
        suggestion: '',
        type: '搭配冗余',
        source: 'Ai',
      } as any).source
    ).toBe('ai');
  });

  it('缺 source 时，Layer 1 规则命中（如 的的/句式杂糅）兜底为 mcp', () => {
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 2,
        original: '的的',
        suggestion: '的',
        type: '重复字符',
      } as any).source
    ).toBe('mcp');
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 7,
        original: '通过加强监督使效率提升',
        suggestion: '加强监督使效率提升',
      } as any).source
    ).toBe('mcp');
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 4,
        original: '进行了研究',
        suggestion: '研究',
      } as any).source
    ).toBe('mcp');
  });

  it('评审建议：两层判断顺序——先 AI 专属后 Layer 1，F11–F15 不因 inferTypeFromContent 命中而误归 mcp', () => {
    // inferTypeFromContent 也能命中 F11–F15 模式（加强重视→动宾不当/存在着→搭配冗余），
    // 旧实现"非 AI 专属 → 全部 mcp"若先走 Layer 1 判断，会把这类 AI 专属问题误计为 MCP
    // （TC-13 来源失真反向复现）。修复后必须先判 AI 专属模式再判 Layer 1。
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 6,
        original: '我们需要加强重视安全问题',
        suggestion: '我们需要重视安全问题',
      } as any).source
    ).toBe('ai'); // F12 动宾不当（AI 专属）→ ai，而非 mcp
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 8,
        original: '这个方案存在着很多不足之处',
        suggestion: '这个方案存在很多不足之处',
      } as any).source
    ).toBe('ai'); // F11 搭配冗余（AI 专属）→ ai
  });

  it('评审建议：无法识别的未知内容（Layer 1 不命中、非 F11–F15）保守兜底为 mcp', () => {
    // 口语化/语序不当等 Layer 1 规则与 F11–F15 正则均不检出的语义类问题，
    // 按注释第 4 步保守兜底为 mcp（Layer 1 规则引擎命中优先，AI 补充场景由 SKILL 约束）。
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 4,
        original: '语气很口语化呢',
        suggestion: '语气较为书面',
      } as any).source
    ).toBe('mcp');
  });

  it('评审建议：F14 不再误判正常表达——"丰富的经验"（丰富直接修饰经验）不归为 ai', () => {
    // 原 aiOnlyPattern `(很多|许多|大量|丰富).{0,6}(内容|经验|知识)` 会把正常搭配
    // "丰富的经验" 命中（丰富→经验 间隔 0）→ 误判 ai。修正后 F14 需数量词+丰富/充分
    // 同时出现（如"很多丰富的内容"），"丰富的经验"正常表达不再被 AI 专属模式捕获。
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 5,
        original: '他有着丰富的经验',
        suggestion: '他经验丰富',
      } as any).source
    ).toBe('mcp');
    // F14 真阳性：数量词+丰富/充分 修饰名词 → ai
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 10,
        original: '会议讨论了很多丰富的内容',
        suggestion: '会议讨论了很多内容',
      } as any).source
    ).toBe('ai');
  });

  it('缺 source 时，F11–F15 AI 专属模式（存在着/加强重视/进步提高等）兜底为 ai', () => {
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 8,
        original: '这个方案存在着很多不足之处',
        suggestion: '这个方案存在很多不足之处',
      } as any).source
    ).toBe('ai');
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 6,
        original: '我们需要加强重视安全问题',
        suggestion: '我们需要重视安全问题',
      } as any).source
    ).toBe('ai');
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 6,
        original: '他取得了显著的进步提高',
        suggestion: '他取得了显著的进步',
      } as any).source
    ).toBe('ai');
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 10,
        original: '会议讨论了很多丰富的内容',
        suggestion: '会议讨论了很多内容',
      } as any).source
    ).toBe('ai');
  });

  it('缺 source 且无法按内容推断时，保守兜底为 mcp', () => {
    expect(
      normalizeIssueSource({
        offset: 0,
        length: 2,
        original: '完全陌生的内容xyz',
        suggestion: '也陌生',
      } as any).source
    ).toBe('mcp');
  });
});

// ==================== 「偏移 undefined」展示瑕疵（PR #43 评审遗留 + 架构复盘收敛） ====================

describe('normalizeIssueLocation — 位置字段归一化（偏移 undefined 展示瑕疵）', () => {
  it('paragraph_index（蛇形旧别名）→ paragraphIndex（驼峰）', () => {
    const issue: any = {
      paragraph_index: 3,
      original: '的的',
      suggestion: '的',
      type: '重复字符',
      source: 'mcp',
    };
    const normalized = normalizeIssueLocation(issue);
    expect(normalized.paragraphIndex).toBe(3);
  });

  it('已有驼峰 paragraphIndex 时优先保留，不被蛇形覆盖', () => {
    const issue: any = {
      paragraphIndex: 5,
      paragraph_index: 9, // 冲突时优先驼峰
      offset: 100,
      original: '的的',
      suggestion: '的',
      type: '重复字符',
      source: 'mcp',
    };
    const normalized = normalizeIssueLocation(issue);
    expect(normalized.paragraphIndex).toBe(5);
    expect(normalized.offset).toBe(100);
  });

  it('仅提供 offset_in_paragraph（无 offset）时，offset 不再兜底（段落内偏移 ≠ 绝对偏移）', () => {
    const issue: any = {
      original: '加强重视安全问题',
      suggestion: '重视安全问题',
      type: '动宾不当',
      source: 'ai',
      offset_in_paragraph: 7,
    };
    const normalized = normalizeIssueLocation(issue);
    // 评审 warning：offset_in_paragraph 语义与绝对 offset 不同，绝不互相兜底
    expect(normalized.offset).toBeUndefined();
  });

  it('offset 与 paragraph_index 均缺失时，offset 为 undefined（展示层兜底「位置未知」）', () => {
    const issue: any = {
      original: '的的',
      suggestion: '的',
      type: '重复字符',
      source: 'mcp',
    };
    const normalized = normalizeIssueLocation(issue);
    expect(normalized.offset).toBeUndefined();
    expect(normalized.paragraphIndex).toBeUndefined();
  });

  it('offset 为 0（合法值）时保留，不因 falsy 被覆盖', () => {
    const issue: any = {
      offset: 0,
      offset_in_paragraph: 5,
      original: '的的',
      suggestion: '的',
      type: '重复字符',
      source: 'mcp',
    };
    const normalized = normalizeIssueLocation(issue);
    expect(normalized.offset).toBe(0);
  });

  it('字符串数字兼容：offset="3" / paragraph_index="4" 归一化为数值（评审 warning：AI 层可能输出字符串）', () => {
    const issue: any = {
      paragraph_index: '4',
      offset: '3',
      original: '的的',
      suggestion: '的',
      type: '重复字符',
      source: 'ai',
    };
    const normalized = normalizeIssueLocation(issue);
    expect(normalized.paragraphIndex).toBe(4);
    expect(normalized.offset).toBe(3);
  });

  it('非法字符串（非数字）不采纳，offset/paragraphIndex 保持 undefined', () => {
    const issue: any = {
      paragraph_index: 'abc',
      offset: 'xyz',
      original: '的的',
      suggestion: '的',
      type: '重复字符',
      source: 'ai',
    };
    const normalized = normalizeIssueLocation(issue);
    expect(normalized.paragraphIndex).toBeUndefined();
    expect(normalized.offset).toBeUndefined();
  });
});

describe('proofreadAccumulate — 位置字段归一化链路（偏移 undefined 展示瑕疵）', () => {
  it('累加驼峰字段（paragraphIndex/offset）后，报告位置列正确展示「段落 N」', async () => {
    await proofreadAccumulateHandler({
      session_id: 'loc-session-1',
      issues: [
        {
          paragraphIndex: 2,
          offset: 106,
          original: '加强重视安全问题',
          suggestion: '重视安全问题',
          type: '动宾不当',
          source: 'ai' as const,
        },
        {
          paragraphIndex: 1,
          offset: 0,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 3, totalWords: 30 },
    });

    const session = sessionIssues.get('loc-session-1')!;
    expect(session.issues[0].paragraphIndex).toBe(2);
    expect(session.issues[0].offset).toBe(106);
    expect(session.issues[1].paragraphIndex).toBe(1);
    expect(session.issues[1].offset).toBe(0);

    const result = await generateProofreadReportHandler({ session_id: 'loc-session-1' });
    const text = result.content[0].text!;
    // 展示层：段落索引优先 → 不再出现「偏移 undefined」字面量
    expect(text).toContain('段落 2');
    expect(text).toContain('段落 1');
    expect(text).not.toContain('偏移 undefined');
  });

  it('仅传蛇形 paragraph_index（无 offset）时段落索引仍归一化，offset 缺失 → 报告显示「偏移 undefined」不再出现', async () => {
    await proofreadAccumulateHandler({
      session_id: 'loc-session-3',
      issues: [
        {
          paragraph_index: 2,
          original: '加强重视安全问题',
          suggestion: '重视安全问题',
          type: '动宾不当',
          source: 'ai' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 3, totalWords: 30 },
    });

    const session = sessionIssues.get('loc-session-3')!;
    expect(session.issues[0].paragraphIndex).toBe(2);
    expect(session.issues[0].offset).toBeUndefined();

    const result = await generateProofreadReportHandler({ session_id: 'loc-session-3' });
    const text = result.content[0].text!;
    // 段落索引优先展示，不落入 offset 分支 → 无「偏移 undefined」
    expect(text).toContain('段落 2');
    expect(text).not.toContain('偏移 undefined');
  });

  it('offset 与 paragraphIndex 均缺失时，报告展示「位置未知」而非「偏移 undefined」', async () => {
    await proofreadAccumulateHandler({
      session_id: 'loc-session-2',
      issues: [
        {
          original: '完全陌生的内容xyz',
          suggestion: '也陌生',
          type: '未分类',
          source: 'ai' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });

    const result = await generateProofreadReportHandler({ session_id: 'loc-session-2' });
    const text = result.content[0].text!;
    expect(text).toContain('位置未知');
    expect(text).not.toContain('偏移 undefined');
  });

  it('只传 offset_in_paragraph（无 offset）时不再兜底为 offset，报告位置列显示「位置未知」', async () => {
    await proofreadAccumulateHandler({
      session_id: 'loc-session-4',
      issues: [
        {
          offset_in_paragraph: 7,
          original: '加强重视安全问题',
          suggestion: '重视安全问题',
          type: '动宾不当',
          source: 'ai' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 3, totalWords: 30 },
    });

    const session = sessionIssues.get('loc-session-4')!;
    expect(session.issues[0].offset).toBeUndefined();

    const result = await generateProofreadReportHandler({ session_id: 'loc-session-4' });
    const text = result.content[0].text!;
    expect(text).toContain('位置未知');
    expect(text).not.toContain('偏移 undefined');
  });

  it('paragraphIndex=0（非法值）时不展示「段落 0」，降级为偏移展示（四轮评审 info）', async () => {
    await proofreadAccumulateHandler({
      session_id: 'loc-session-5',
      issues: [
        {
          paragraphIndex: 0, // 非法：段落索引从 1 起
          offset: 88,
          original: '加强重视安全问题',
          suggestion: '重视安全问题',
          type: '动宾不当',
          source: 'ai' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 3, totalWords: 30 },
    });

    const session = sessionIssues.get('loc-session-5')!;
    expect(session.issues[0].paragraphIndex).toBe(0); // 归一化保留原值，由展示层降级

    const result = await generateProofreadReportHandler({ session_id: 'loc-session-5' });
    const text = result.content[0].text!;
    expect(text).not.toContain('段落 0');
    expect(text).toContain('偏移 88'); // 降级为偏移展示
    expect(text).not.toContain('偏移 undefined');
  });
});

describe('proofreadAccumulate — 缺 type 自动兜底（#55 T2）', () => {
  it('累加时缺 type 的 issue 自动推断为冗余词，报告不再全 undefined/全 10 分', async () => {
    await proofreadAccumulateHandler({
      session_id: 't2-session-1',
      issues: [
        {
          offset: 0,
          length: 4,
          original: '进行了研究',
          suggestion: '研究',
          source: 'mcp' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });

    const session = sessionIssues.get('t2-session-1')!;
    expect(session.issues[0].type).toBe('冗余词'); // 兜底成功

    const result = await generateProofreadReportHandler({ session_id: 't2-session-1' });
    const text = result.content[0].text!;
    // 简洁度行应有 1 个问题，且不再全 10 分
    expect(text).toContain('简洁度');
    // 冗余词 → conciseness：raw = 5 - 1*0.3 = 4.7 → norm = (4.7-1)/2 = 1.85 → 9.3/10
    expect(text).toContain('9.3/10');
    // 不应有未分类问题
    expect(text).not.toContain('未分类问题');
  });

  it('type="ai" 的 issue 累加时被兜底为真实类型', async () => {
    await proofreadAccumulateHandler({
      session_id: 't2-session-2',
      issues: [
        {
          offset: 0,
          length: 8,
          original: '通过管理使效率提升',
          suggestion: '管理使效率提升',
          type: 'ai',
          source: 'ai' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });
    const session = sessionIssues.get('t2-session-2')!;
    expect(session.issues[0].type).toBe('句式杂糅');
  });
});

// ==================== #55 T3：TC-12 修订数口径 ====================

describe('generateProofreadReport — TC-12 修订数口径（#55 T3）', () => {
  it('报告标注修订数换算口径：问题数 = 修订记录数 ÷ 2', async () => {
    await proofreadAccumulateHandler({
      session_id: 't3-session-1',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
        {
          offset: 10,
          length: 2,
          original: '在去',
          suggestion: '再去',
          type: '在再混淆',
          source: 'mcp' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
      total_revisions: 60, // 30 处问题 × 2 条修订记录
    });

    const result = await generateProofreadReportHandler({ session_id: 't3-session-1' });
    const text = result.content[0].text!;
    expect(text).toContain('修订总数');
    expect(text).toContain('60');
    expect(text).toContain('问题数 × 2');
    expect(text).toContain('30'); // 60 ÷ 2 = 30
  });

  it('验收遗留：奇数修订数（删除类修复只产生 1 条修订）时明确提示不整除、不再硬算整除', async () => {
    await proofreadAccumulateHandler({
      session_id: 't3-session-odd',
      issues: [
        {
          offset: 0,
          length: 8,
          original: '这个方案存在着很多不足之处',
          suggestion: '这个方案存在很多不足之处',
          type: '搭配冗余',
          source: 'ai' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
      total_revisions: 63, // 验收现场：63 条修订（含删除类“存在着→空”等奇数修订）
    });

    const result = await generateProofreadReportHandler({ session_id: 't3-session-odd' });
    const text = result.content[0].text!;
    expect(text).toContain('修订总数');
    expect(text).toContain('63');
    // 评审建议：奇数修订显示 ≈31.5（63 ÷ 2），不再向下取整为 31
    expect(text).toContain('≈31.5');
    expect(text).toContain('修订数为奇数');
    expect(text).toContain('不等价于问题数 × 2');
    expect(text).toContain('人工核对');
    // 不再出现误导性的"等价于修订记录数 ÷ 2"表述
    expect(text).not.toContain('换算不整除');
  });

  it('偶数修订数时无奇数提示（回归：正常成对替换）', async () => {
    await proofreadAccumulateHandler({
      session_id: 't3-session-even',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '在去',
          suggestion: '再去',
          type: '在再混淆',
          source: 'mcp' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
      total_revisions: 2,
    });

    const result = await generateProofreadReportHandler({ session_id: 't3-session-even' });
    const text = result.content[0].text!;
    expect(text).toContain('修订总数');
    expect(text).not.toContain('修订数为奇数');
  });
});

// ==================== Issue #116 新增测试 ====================

// 必填字段校验测试（Issue #116 问题六）
describe('proofreadAccumulate — 必填字段校验（Issue #116 问题六）', () => {
  it('issues 含缺 original 的条目时明确报错，而非静默通过', async () => {
    const result = await proofreadAccumulateHandler({
      session_id: 'required-check-1',
      issues: [
        { offset: 0, length: 2, suggestion: '的', type: '重复字符', source: 'mcp' as const },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('original/suggestion');
  });

  it('issues 含缺 suggestion 的条目时明确报错', async () => {
    const result = await proofreadAccumulateHandler({
      session_id: 'required-check-2',
      issues: [
        { offset: 0, length: 2, original: '的的', type: '重复字符', source: 'mcp' as const },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('original/suggestion');
  });

  it('issues 含空字符串 original 时明确报错', async () => {
    const result = await proofreadAccumulateHandler({
      session_id: 'required-check-3',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('original/suggestion');
  });

  it('issues 含空白字符 original（异常空格）时正常累加（session_ff63 问题一 P0 回归）', async () => {
    // 回归：原实现用 trim() 判断字段缺失，把 original='  '（异常空格）误判为缺字段整批拒绝。
    // 空白字符本身是合法校对发现（异常空格/多余空格），必须允许累加。
    const result = await proofreadAccumulateHandler({
      session_id: 'required-check-blank-1',
      issues: [
        {
          offset: 10,
          length: 2,
          original: '  ',
          suggestion: ' ',
          type: '异常空格',
          source: 'mcp' as const,
        },
      ],
      doc_info: {
        fileName: 'blank.docx',
        filePath: '/p/blank.docx',
        totalParagraphs: 1,
        totalWords: 10,
      },
    });
    expect(result.success).toBe(true);
    expect(result.content[0].text).toContain('已累加 1 条问题');
  });

  it('issues 含全角空格 original 时正常累加（session_ff63 问题一 P0 回归）', async () => {
    const result = await proofreadAccumulateHandler({
      session_id: 'required-check-blank-2',
      issues: [
        {
          offset: 20,
          length: 2,
          original: '\u3000\u3000',
          suggestion: ' ',
          type: '异常空格',
          source: 'mcp' as const,
        },
      ],
      doc_info: {
        fileName: 'blank2.docx',
        filePath: '/p/blank2.docx',
        totalParagraphs: 1,
        totalWords: 10,
      },
    });
    expect(result.success).toBe(true);
    expect(result.content[0].text).toContain('已累加 1 条问题');
  });

  it('issues 全部字段完整时正常累加（回归）', async () => {
    const result = await proofreadAccumulateHandler({
      session_id: 'required-check-4',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });
    expect(result.success).toBe(true);
    expect(result.content[0].text).toContain('已累加 1 条问题');
    // 评审第 4 轮 W6：返回 data.diskPersisted 可编程字段
    expect(result.data).toBeDefined();
    expect(result.data!.diskPersisted).toBe(true);
  });

  it('issues 含有效+无效混合时部分成功：有效条目累加、无效条目跳过并警告（session_ffa8 问题二/三）', async () => {
    const result = await proofreadAccumulateHandler({
      session_id: 'partial-success-1',
      issues: [
        // 有效条目
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
        // 缺 suggestion 的无效条目
        { offset: 10, length: 2, original: '的了', type: '的得混淆', source: 'mcp' as const },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });
    // 部分成功：不再整体拒绝，success=true
    expect(result.success).toBe(true);
    // 只累加了 1 条有效条目
    const session = sessionIssues.get('partial-success-1')!;
    expect(session.issues.length).toBe(1);
    expect(session.issues[0].original).toBe('的的');
    // 返回文本明确警告被跳过的无效条目
    expect(result.content[0].text).toContain('1 条因缺 original/suggestion 被跳过');
    // 会话已建立，后续批次不再要求 doc_info（级联失败根因修复）
    const result2 = await proofreadAccumulateHandler({
      session_id: 'partial-success-1',
      issues: [
        {
          offset: 20,
          length: 2,
          original: '的得',
          suggestion: '的的',
          type: '的得混淆',
          source: 'mcp' as const,
        },
      ],
    });
    expect(result2.success).toBe(true);
    expect(sessionIssues.get('partial-success-1')!.issues.length).toBe(2);
  });

  it('issues 空数组时仍可初始化会话并更新 total_revisions（不误判为全部无效）', async () => {
    const result = await proofreadAccumulateHandler({
      session_id: 'empty-init-session',
      issues: [],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
      total_revisions: 7,
    });
    expect(result.success).toBe(true);
    expect(sessionIssues.get('empty-init-session')!.totalRevisions).toBe(7);
  });
});

// 落盘持久化测试（Issue #116 问题七/九/十二）
describe('proofread-store 落盘持久化（Issue #116 问题十二）', () => {
  const proofreadStore = jest.requireActual('../../tools/word/proofread-store');
  const testSessionId = 'persist-test-session';
  const testData = {
    issues: [
      { offset: 0, length: 2, original: '的的', suggestion: '的', type: '重复字符', source: 'mcp' },
    ],
    docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    createdAt: '2026-08-14T00:00:00.000Z',
  };

  afterEach(() => {
    proofreadStore.removeSessionFromDisk(testSessionId);
  });

  it('存储目录创建时设置 0o700 权限（评审第5轮 W7，POSIX only）', () => {
    const dir = proofreadStore.getProofreadDir();
    proofreadStore.ensureProofreadDir();
    expect(fs.existsSync(dir)).toBe(true);
    if (process.platform !== 'win32') {
      const stat = fs.statSync(dir);
      // 首次创建时 mkdirSync 带 mode:0o700，权限不弱于 0o700（owner 可读写执行，group/other 不读）；
      // 目录可能已被旧逻辑创建为默认权限，故允许权限为 0o700 或更严格（此处仅断言 owner 有读写权限）
      const ownerRwx = stat.mode & 0o700;
      expect(ownerRwx).toBe(0o700); // owner 必须有 rwx
    }
  });

  it('saveSessionToDisk 写入后可 loadSessionFromDisk 读回', () => {
    const ok = proofreadStore.saveSessionToDisk(testSessionId, testData);
    expect(ok).toBe(true);
    const loaded = proofreadStore.loadSessionFromDisk(testSessionId);
    expect(loaded).not.toBeNull();
    expect(loaded.issues.length).toBe(1);
    expect(loaded.issues[0].original).toBe('的的');
    expect(loaded.docInfo.fileName).toBe('d.docx');
  });

  it('loadSessionFromDisk 读取不存在的会话返回 null', () => {
    const loaded = proofreadStore.loadSessionFromDisk('nonexistent-session-xyz');
    expect(loaded).toBeNull();
  });

  it('removeSessionFromDisk 删除后无法再加载', () => {
    proofreadStore.saveSessionToDisk(testSessionId, testData);
    const removed = proofreadStore.removeSessionFromDisk(testSessionId);
    expect(removed).toBe(true);
    const loaded = proofreadStore.loadSessionFromDisk(testSessionId);
    expect(loaded).toBeNull();
  });

  it('saveSessionToDisk 对含特殊字符的 sessionId 做安全文件名处理', () => {
    const specialId = '../../etc/passwd'; // 路径注入尝试
    const ok = proofreadStore.saveSessionToDisk(specialId, testData);
    expect(ok).toBe(true);
    // 应从磁盘读回（不会被路径注入截获）
    const loaded = proofreadStore.loadSessionFromDisk(specialId);
    expect(loaded).not.toBeNull();
    proofreadStore.removeSessionFromDisk(specialId);
  });

  it('两个不同 sessionId 安全化后不互相覆盖（评审第1轮 W2）', () => {
    // a/b 与 a_b 经安全化都会得到 safeId=a_b，若不追加 hash 后缀会互相覆盖
    const idWithSlash = 'a/b';
    const idWithUnderscore = 'a_b';
    const dataA = {
      ...testData,
      issues: [{ ...testData.issues[0], original: '甲', suggestion: '乙' }],
    };
    const dataB = {
      ...testData,
      issues: [{ ...testData.issues[0], original: '丙', suggestion: '丁' }],
    };
    proofreadStore.saveSessionToDisk(idWithSlash, dataA);
    proofreadStore.saveSessionToDisk(idWithUnderscore, dataB);
    const loadedA = proofreadStore.loadSessionFromDisk(idWithSlash);
    const loadedB = proofreadStore.loadSessionFromDisk(idWithUnderscore);
    expect(loadedA).not.toBeNull();
    expect(loadedB).not.toBeNull();
    expect(loadedA.issues[0].original).toBe('甲'); // A 未被 B 覆盖
    expect(loadedB.issues[0].original).toBe('丙');
    proofreadStore.removeSessionFromDisk(idWithSlash);
    proofreadStore.removeSessionFromDisk(idWithUnderscore);
  });
});

// 服务重启后从磁盘恢复测试（Issue #116 问题七/九）
describe('服务重启后从磁盘恢复（Issue #116 问题七/九）', () => {
  const proofreadStore = jest.requireActual('../../tools/word/proofread-store');

  afterEach(() => {
    proofreadStore.removeSessionFromDisk('restore-session');
    sessionIssues.clear();
  });

  it('进程 Map 清空后，磁盘数据可恢复并生成报告', async () => {
    // 先累加问题（会写盘）
    await proofreadAccumulateHandler({
      session_id: 'restore-session',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
        {
          offset: 10,
          length: 2,
          original: '在去',
          suggestion: '再去',
          type: '在再混淆',
          source: 'mcp' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });

    // 模拟服务重启：清空进程内 Map
    sessionIssues.clear();
    expect(sessionIssues.size).toBe(0);

    // 从磁盘恢复并生成报告
    const result = await generateProofreadReportHandler({ session_id: 'restore-session' });
    expect(result.success).toBe(true);
    const text = result.content[0].text!;
    expect(text).toContain('校对报告');
    expect(text).toContain('2 处'); // 2 个问题
    expect(text).toContain('重复字符');
    expect(text).toContain('在再混淆');
  });
});

// 疑似问题机制测试（Issue #116 问题十一）
describe('疑似问题（Issue #116 问题十一）', () => {
  const proofreadStore = jest.requireActual('../../tools/word/proofread-store');

  afterEach(() => {
    proofreadStore.removeSessionFromDisk('suspect-session');
    sessionIssues.clear();
  });

  it('suspected_issues 累加后，报告单独列出待确认问题节', async () => {
    await proofreadAccumulateHandler({
      session_id: 'suspect-session',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
      ],
      suspected_issues: [
        {
          offset: 100,
          length: 4,
          original: '已未形成',
          suggestion: '尚未形成',
          type: '疑似',
          source: 'ai' as const,
        },
        {
          offset: 200,
          length: 5,
          original: '重点下雪',
          suggestion: '重点方向',
          type: '疑似',
          source: 'ai' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });

    const result = await generateProofreadReportHandler({ session_id: 'suspect-session' });
    expect(result.success).toBe(true);
    const text = result.content[0].text!;
    expect(text).toContain('待确认问题');
    expect(text).toContain('2 处');
    expect(text).toContain('已未形成');
    expect(text).toContain('尚未形成');
    expect(text).toContain('重点下雪');
    expect(text).toContain('人工核对');
  });

  it('无疑似问题时报告不出现待确认问题节', async () => {
    await proofreadAccumulateHandler({
      session_id: 'suspect-session',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });

    const result = await generateProofreadReportHandler({ session_id: 'suspect-session' });
    const text = result.content[0].text!;
    expect(text).not.toContain('待确认问题');
  });

  it('空 issues + 有 suspectedIssues 时报告仍列出待确认问题（评审第6轮 C3 / 第8轮 W8）', async () => {
    // 只累加疑似问题，正式 issues 为空
    await proofreadAccumulateHandler({
      session_id: 'suspect-session',
      issues: [],
      suspected_issues: [
        {
          offset: 100,
          length: 4,
          original: '已未形成',
          suggestion: '尚未形成',
          type: '疑似',
          source: 'ai' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });
    const result = await generateProofreadReportHandler({ session_id: 'suspect-session' });
    expect(result.success).toBe(true);
    const text = result.content[0].text!;
    expect(text).toContain('待确认问题');
    expect(text).toContain('1 处');
    expect(text).toContain('已未形成');
    expect(text).toContain('尚未形成');
    // 评审第8轮 W8：有疑似问题时，收尾用中性提示而非「✅ 未发现任何问题」
    expect(text).not.toContain('✅ 文档质量优秀，未发现任何问题');
    expect(text).toContain('待确认疑似问题');
  });

  it('suspected_issues 含缺 original/suggestion 的条目时部分成功（保留有效，跳过无效，评审第1轮 C1 更新）', async () => {
    // 部分成功语义（session_ffa8 问题二/三）：不再整体拒绝整批，而是跳过无效疑似条目、保留有效条目。
    // 本用例中唯一一条疑似缺 suggestion，故被跳过；正式 issues 正常累加，success=true。
    const result = await proofreadAccumulateHandler({
      session_id: 'suspect-session',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
      ],
      suspected_issues: [
        // 缺 suggestion
        { offset: 100, length: 4, original: '已未形成', type: '疑似', source: 'ai' as const },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });
    // 正式 issues 有效 → success=true；被跳过的无效疑似问题在返回文本中警告
    expect(result.success).toBe(true);
    expect(result.content[0].text!).toContain('疑似问题 1 条因缺 original/suggestion 被跳过');
    // 不应累加任何被跳过的疑似问题
    const report = await generateProofreadReportHandler({ session_id: 'suspect-session' });
    const text = report.content[0].text!;
    expect(text).not.toContain('待确认问题');
  });

  it('suspected_issues 含缺字段条目时正式 issues 正常累加、无效疑似被跳过（评审第2轮 C2 更新）', async () => {
    // 先正常累加 1 条正式 issue
    await proofreadAccumulateHandler({
      session_id: 'suspect-session',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });

    // 第二次调用：suspected_issues 缺字段 → 部分成功（跳过无效疑似，正式 issues 正常累加）
    const result = await proofreadAccumulateHandler({
      session_id: 'suspect-session',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
      ],
      suspected_issues: [
        { offset: 100, length: 4, original: '已未形成', type: '疑似', source: 'ai' as const },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });
    expect(result.success).toBe(true);

    // 正式 issues 去重保持 1 条（第二次同 offset+original 被去重），无效疑似问题被跳过不累加
    const session = sessionIssues.get('suspect-session')!;
    expect(session.issues.length).toBe(1); // 去重保持 1 条
    expect(session.suspectedIssues || []).toHaveLength(0); // 无效疑似未累加
  });

  it('suspected_issues 重复提交同 offset+original 时去重（评审第2轮 W4）', async () => {
    await proofreadAccumulateHandler({
      session_id: 'suspect-session',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
      ],
      suspected_issues: [
        {
          offset: 100,
          length: 4,
          original: '已未形成',
          suggestion: '尚未形成',
          type: '疑似',
          source: 'ai' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });
    // 第二次重复提交同一条疑似问题
    await proofreadAccumulateHandler({
      session_id: 'suspect-session',
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
        },
      ],
      suspected_issues: [
        {
          offset: 100,
          length: 4,
          original: '已未形成',
          suggestion: '尚未形成',
          type: '疑似',
          source: 'ai' as const,
        },
      ],
      doc_info: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
    });
    const session = sessionIssues.get('suspect-session')!;
    expect(session.suspectedIssues).toHaveLength(1); // 去重后仍 1 条

    const result = await generateProofreadReportHandler({ session_id: 'suspect-session' });
    const text = result.content[0].text!;
    expect(text).toContain('1 处'); // 待确认问题只列 1 条
  });
});

// 报告生成器 .replace() 兜底测试（Issue #116 问题一）
describe('报告生成器 .replace() 兜底（Issue #116 问题一）', () => {
  const proofreadStore = jest.requireActual('../../tools/word/proofread-store');

  afterEach(() => {
    proofreadStore.removeSessionFromDisk('replace-fallback-session');
    sessionIssues.clear();
  });

  it('即使 issues 中有缺 original 的历史坏数据，报告生成不崩溃', async () => {
    // 直接往 Map 写入缺字段的历史坏数据（绕过校验，模拟历史遗留）
    sessionIssues.set('replace-fallback-session', {
      issues: [
        // @ts-ignore 模拟历史坏数据：缺 original
        { offset: 0, length: 2, suggestion: '的', type: '重复字符', source: 'mcp' },
        // @ts-ignore 模拟历史坏数据：缺 suggestion
        { offset: 10, length: 2, original: '的的', type: '重复字符', source: 'mcp' },
        // 正常数据
        {
          offset: 20,
          length: 2,
          original: '在去',
          suggestion: '再去',
          type: '在再混淆',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 1, totalWords: 10 },
      createdAt: new Date().toISOString(),
    });

    const result = await generateProofreadReportHandler({ session_id: 'replace-fallback-session' });
    expect(result.success).toBe(true);
    const text = result.content[0].text!;
    expect(text).toContain('校对报告');
    // 正常数据仍正确展示
    expect(text).toContain('在去');
    expect(text).toContain('再去');
  });
});

// Issue #151 校对重构：批次完整性 + 交叉校验告警
describe('Issue #151 报告统计校验（批次完整性 + 交叉校验）', () => {
  const proofreadStore = jest.requireActual('../../tools/word/proofread-store');

  // 评审第 1 轮 R1-2：会话 ID 加每次运行唯一后缀，避免与其它并行测试 worker 在共享
  // PROOFREAD_DIR 目录下因跨运行残留/并发写产生偶发失败（稳定并行测试）。
  const SUFFIX = Date.now().toString(36);
  const sid = (label: string): string => `iss151-${label}-${SUFFIX}`;

  afterEach(() => {
    for (const label of [
      'b-inc',
      'b-complete',
      'b-doneincomplete',
      'cross-ok',
      'cross-miss',
      'cross-moderate',
      'cross-zero',
      'cross-reverse',
      'cross-reverse-ok',
      'conflict',
      'gap',
      'nobatch',
      'overlap-report',
      'docinfo-missing',
      'exceed-range',
      'over-limit',
    ]) {
      proofreadStore.removeSessionFromDisk(sid(label));
      sessionIssues.delete(sid(label));
    }
  });

  it('存在未完成批次时报告标注批次完整性告警', async () => {
    const s = sid('b-inc');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 200,
        totalWords: 1000,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    // 登记批次分配表：1 批完成（含完整凭证），1 批未完成
    const FULL_STEPS = [
      { step: 'getDocumentParagraphs', timestamp: 1, paragraphIndex: 1 },
      { step: 'getDocumentTextByRange', timestamp: 2, paragraphIndex: 1 },
      { step: 'proofreadBasic', timestamp: 3, paragraphIndex: 1 },
      { step: 'confirmBatchAiProofread', timestamp: 4, paragraphIndex: 1 },
      { step: 'replaceInParagraph', timestamp: 5, paragraphIndex: 1 },
      { step: 'proofreadAccumulate', timestamp: 6, paragraphIndex: 1 },
    ];
    proofreadStore.saveBatchAllocations(s, [
      { batchId: 'b1', range: { start: 1, end: 100 }, status: 'done', stepsLog: FULL_STEPS },
      { batchId: 'b2', range: { start: 101, end: 200 }, status: 'pending', stepsLog: [] },
    ]);
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    // Issue #151 遗留修复：未完成批次现在是硬性门禁（BLOCK），而非仅告警
    expect(result.success).toBe(false);
    expect(text).toContain('完整性门禁');
    expect(text).toContain('仍有 1 批未完成');
  });

  it('全部批次完成时无批次完整性告警', async () => {
    const s = sid('b-complete');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 500 },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    const FULL_STEPS = [
      { step: 'getDocumentParagraphs', timestamp: 1, paragraphIndex: 1 },
      { step: 'getDocumentTextByRange', timestamp: 2, paragraphIndex: 1 },
      { step: 'proofreadBasic', timestamp: 3, paragraphIndex: 1 },
      { step: 'confirmBatchAiProofread', timestamp: 4, paragraphIndex: 1 },
      { step: 'replaceInParagraph', timestamp: 5, paragraphIndex: 1 },
      { step: 'proofreadAccumulate', timestamp: 6, paragraphIndex: 1 },
    ];
    proofreadStore.saveBatchAllocations(s, [
      { batchId: 'b1', range: { start: 1, end: 100 }, status: 'done', stepsLog: FULL_STEPS },
    ]);
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    expect(text).not.toContain('仍有');
  });

  it('R2-3：done 但步骤凭证不完整的批次在报告中判定为未完成并告警（防幻觉盲区）', async () => {
    const s = sid('b-doneincomplete');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 500 },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    // 批次被谎报 done，但 stepsLog 只覆盖部分步骤（凭证不完整）→ getIncompleteBatches 判为未完成
    proofreadStore.saveBatchAllocations(s, [
      {
        batchId: 'b1',
        range: { start: 1, end: 100 },
        status: 'done',
        stepsLog: [
          { step: 'getDocumentParagraphs', timestamp: 1, paragraphIndex: 1 },
          { step: 'proofreadBasic', timestamp: 2, paragraphIndex: 1 },
          // 缺 getDocumentTextByRange/confirmBatchAiProofread/replaceInParagraph/proofreadAccumulate
        ],
      },
    ]);
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    // Issue #151 遗留修复：done 但凭证不完整现在是硬性门禁（BLOCK）
    expect(result.success).toBe(false);
    expect(text).toContain('完整性门禁');
    expect(text).toContain('仍有 1 批未完成');
  });

  it('存在并行 running 批次区间相交时报告标注并行区间冲突（评审第 3 轮 R4-2）', async () => {
    const s = sid('conflict');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 300,
        totalWords: 1500,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    // 两个 running 批次区间相交（并行隔离被破坏）→ hasParallelRangeConflict 应检测到并提示
    // R8-1 后 saveBatchAllocations 拒绝重叠，故用 saveSessionToDisk 直接写重叠数据（模拟异常/历史数据）
    proofreadStore.saveSessionToDisk(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 300,
        totalWords: 1500,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
      batchAllocations: [
        { batchId: 'b1', range: { start: 1, end: 150 }, status: 'running', stepsLog: [] },
        { batchId: 'b2', range: { start: 100, end: 200 }, status: 'running', stepsLog: [] }, // 与 b1 在 100-150 相交
      ],
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    // Issue #151 遗留修复：running（未完成）批次现在属于硬性门禁（BLOCK）
    expect(result.success).toBe(false);
    expect(result.content[0].text).toContain('完整性门禁');
  });

  it('未登记批次分配表时报告提示未检测到批次（评审第 9 轮 R10-2）', async () => {
    const s = sid('nobatch');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 500 },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    // 不登记批次分配表（batchAllocations 为空）→ 应提示无法核验批次完整性/断点续跑
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    expect(text).toContain('未检测到批次分配表');
  });

  it('批次区间未连续覆盖全文档时报告标注覆盖缺口（评审第 5 轮 R6-1）', async () => {
    const s = sid('gap');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 300,
        totalWords: 1500,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    // 批次只覆盖 1-150 和 250-300，中间 151-249 未被分配（覆盖缺口）
    proofreadStore.saveBatchAllocations(s, [
      { batchId: 'b1', range: { start: 1, end: 150 }, status: 'done', stepsLog: [] },
      { batchId: 'b2', range: { start: 250, end: 300 }, status: 'done', stepsLog: [] },
    ]);
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    expect(text).toContain('批次区间未覆盖完整');
    expect(text).toContain('151-249');
  });

  it('issue 数远超修订数可解释量时输出疑似统计缺失告警', async () => {
    const s = sid('cross-miss');
    // 20 处 issue 但修订记录仅 2 条（每条 issue 至少消耗 1 条修订，20 > 2 → 告警）
    const issues = Array.from({ length: 20 }, (_, i) => ({
      offset: i * 10,
      length: 2,
      original: '的的',
      suggestion: '的',
      type: '重复字符' as const,
      source: 'mcp' as const,
      context: '...',
    }));
    sessionIssues.set(s, {
      issues,
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 500 },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    expect(text).toContain('疑似统计缺失');
  });

  it('issue 数刚超修订数（每 issue 至少 1 条修订）时触发告警（评审第 1 轮 R1-1 回归）', async () => {
    const s = sid('cross-moderate');
    // 3 处 issue，修订 2 条：3 次修复至少需 3 条修订，修订数不足 → 应告警（旧阈值 totalRevisions*2=4 会漏报）
    sessionIssues.set(s, {
      issues: Array.from({ length: 3 }, (_, i) => ({
        offset: i * 10,
        length: 2,
        original: '的的',
        suggestion: '的',
        type: '重复字符' as const,
        source: 'mcp' as const,
        context: '...',
      })),
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 500 },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    expect(text).toContain('疑似统计缺失');
  });

  it('issue 数与修订数可解释量一致时不触发缺失告警', async () => {
    const s = sid('cross-ok');
    // 2 处 issue，修订 2 条（每条 issue 至少 1 条修订，2 <= 2 不告警）
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
        {
          offset: 10,
          length: 2,
          original: '在去',
          suggestion: '再去',
          type: '在再混淆',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 500 },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    expect(text).not.toContain('疑似统计缺失');
  });

  it('修订基线为 0（无修订数据）时不误报缺失告警（评审第 2 轮 R2-1 回归）', async () => {
    const s = sid('cross-zero');
    // planner 初始化显式传 total_revisions:0，随后有真实 issue 累加：
    // 0 仅表示"尚未获得修订基线"，不能据此判定批次丢失 → 不得误报"疑似统计缺失"
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
        {
          offset: 10,
          length: 2,
          original: '在去',
          suggestion: '再去',
          type: '在再混淆',
          source: 'mcp' as const,
          context: '...',
        },
        {
          offset: 20,
          length: 2,
          original: '做的',
          suggestion: '做的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 500 },
      createdAt: new Date().toISOString(),
      totalRevisions: 0, // 无修订基线（旧逻辑会因 3 > 0 误报）
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    expect(text).not.toContain('疑似统计缺失');
  });

  it('R7-1：修订数远多于 issue 数时输出疑似未记录修复提示（反向校验）', async () => {
    const s = sid('cross-reverse');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 500 },
      createdAt: new Date().toISOString(),
      totalRevisions: 50, // 修订 50 条 vs 1 处 issue（3×1=3 < 50）→ 触发反向提示
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    expect(text).toContain('疑似未记录修复');
  });

  it('R7-1：修订数略多于 issue 数（在 3 倍内）不触发反向提示', async () => {
    const s = sid('cross-reverse-ok');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 500 },
      createdAt: new Date().toISOString(),
      totalRevisions: 2, // 修订 2 条 vs 1 issue（3×1=3，2 < 3）→ 不触发
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    expect(text).not.toContain('疑似未记录修复');
  });

  it('R8-2：批次区间重叠时报告提示（不论状态，防规划阶段重叠静默通过）', async () => {
    const s = sid('overlap-report');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 200,
        totalWords: 1000,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    // 用 saveSessionToDisk 直接写入带重叠区间的批次（绕过 saveBatchAllocations 的重叠拦截，模拟历史/异常数据）
    proofreadStore.saveSessionToDisk(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 200,
        totalWords: 1000,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
      batchAllocations: [
        { batchId: 'b1', range: { start: 1, end: 100 }, status: 'done', stepsLog: [] },
        { batchId: 'b2', range: { start: 90, end: 200 }, status: 'done', stepsLog: [] }, // 与 b1 重叠
      ],
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    // Issue #151 遗留修复：done 但无凭证（incomplete）→ 硬性门禁 BLOCK
    expect(result.success).toBe(false);
    expect(result.content[0].text).toContain('完整性门禁');
  });

  it('R10-2：docInfo 字段缺失时报告不显示 undefined（兜底为未知/0）', async () => {
    const s = sid('docinfo-missing');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      // 缺 fileName/totalWords 字段
      docInfo: { filePath: '/p/d.docx', totalParagraphs: 100 } as any,
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    const text = result.content[0].text!;
    expect(text).toContain('**文档**: 未知');
    expect(text).toContain('**总字数**: 0');
  });

  it('R10-3：批次区间超出文档总段数时报告提示', async () => {
    const s = sid('exceed-range');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 200,
        totalWords: 1000,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    proofreadStore.saveSessionToDisk(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 200,
        totalWords: 1000,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
      batchAllocations: [
        { batchId: 'b1', range: { start: 1, end: 100 }, status: 'done', stepsLog: [] },
        { batchId: 'b2', range: { start: 101, end: 300 }, status: 'done', stepsLog: [] }, // end=300 > totalParagraphs=200
      ],
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    // Issue #151 遗留修复：done 但无凭证（incomplete）→ 硬性门禁 BLOCK（含超界提示）
    expect(result.success).toBe(false);
    expect(result.content[0].text).toContain('完整性门禁');
  });

  it('R11-2：running 批次数超过 3 时报告提示并行度超限', async () => {
    const s = sid('over-limit');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 500,
        totalWords: 2500,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    proofreadStore.saveSessionToDisk(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 500,
        totalWords: 2500,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
      batchAllocations: [
        { batchId: 'b1', range: { start: 1, end: 100 }, status: 'running', stepsLog: [] },
        { batchId: 'b2', range: { start: 101, end: 200 }, status: 'running', stepsLog: [] },
        { batchId: 'b3', range: { start: 201, end: 300 }, status: 'running', stepsLog: [] },
        { batchId: 'b4', range: { start: 301, end: 400 }, status: 'running', stepsLog: [] }, // 第 4 个 running
      ],
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    // Issue #151 遗留修复：running（未完成）批次 → 硬性门禁 BLOCK
    expect(result.success).toBe(false);
    expect(result.content[0].text).toContain('完整性门禁');
  });

  it('串行模式：未覆盖全文（processedTo < totalParagraphs）时禁止生成报告（Issue #151 遗留修复）', async () => {
    const s = sid('serial-incomplete');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 200,
        totalWords: 1000,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
      progress: { processedToParagraph: 50, totalParagraphs: 200, allBatchesComplete: false },
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    expect(result.success).toBe(false);
    expect(result.content[0].text).toContain('完整性门禁');
    expect(result.content[0].text).toContain('尚有 150 段未校对');
  });

  it('串行模式：覆盖全文（processedTo >= totalParagraphs）后允许生成报告（Issue #151 遗留修复）', async () => {
    const s = sid('serial-complete');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 500 },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
      progress: { processedToParagraph: 100, totalParagraphs: 100, allBatchesComplete: true },
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    expect(result.success).toBe(true);
  });

  it('串行模式：无进度信息时放行（历史会话兼容，不误伤既有串行流程）', async () => {
    const s = sid('serial-noprogress');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 500 },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    const result = await generateProofreadReportHandler({ session_id: s });
    expect(result.success).toBe(true);
    expect(result.content[0].text).toContain('未检测到批次分配表');
  });

  it('proofreadAccumulate 上报 _processed_to_paragraph 后报告硬门禁联动生效（Issue #151 遗留修复）', async () => {
    const s = sid('accum-progress');
    const acc1 = await proofreadAccumulateHandler({
      session_id: s,
      issues: [],
      doc_info: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 100,
        totalWords: 500,
      },
      _processed_to_paragraph: 40,
    });
    expect(acc1.success).toBe(true);
    const blocked = await generateProofreadReportHandler({ session_id: s });
    expect(blocked.success).toBe(false);
    expect(blocked.content[0].text).toContain('尚有 60 段未校对');
    await proofreadAccumulateHandler({ session_id: s, issues: [], _processed_to_paragraph: 100 });
    const allowed = await generateProofreadReportHandler({ session_id: s });
    expect(allowed.success).toBe(true);
  });

  it('编排模式：批次全部完成+凭证完整但区间未覆盖全文时禁止生成报告（Issue #151 遗留修复）', async () => {
    const s = sid('gap-complete-cred');
    sessionIssues.set(s, {
      issues: [
        {
          offset: 0,
          length: 2,
          original: '的的',
          suggestion: '的',
          type: '重复字符',
          source: 'mcp' as const,
          context: '...',
        },
      ],
      docInfo: {
        fileName: 'd.docx',
        filePath: '/p/d.docx',
        totalParagraphs: 300,
        totalWords: 1500,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    // 两个批次都 done 且凭证完整，但只覆盖 1-100 和 250-300，中间 101-249 有缺口
    const FULL = [
      { step: 'getDocumentParagraphs', timestamp: 1, paragraphIndex: 1 },
      { step: 'getDocumentTextByRange', timestamp: 2, paragraphIndex: 1 },
      { step: 'proofreadBasic', timestamp: 3, paragraphIndex: 1 },
      { step: 'confirmBatchAiProofread', timestamp: 4, paragraphIndex: 1 },
      { step: 'replaceInParagraph', timestamp: 5, paragraphIndex: 1 },
      { step: 'proofreadAccumulate', timestamp: 6, paragraphIndex: 1 },
    ];
    proofreadStore.saveBatchAllocations(s, [
      { batchId: 'b1', range: { start: 1, end: 100 }, status: 'done', stepsLog: FULL },
      { batchId: 'b2', range: { start: 250, end: 300 }, status: 'done', stepsLog: FULL },
    ]);
    const result = await generateProofreadReportHandler({ session_id: s });
    expect(result.success).toBe(false);
    expect(result.content[0].text).toContain('完整性门禁');
    expect(result.content[0].text).toContain('101-249');
  });
});
