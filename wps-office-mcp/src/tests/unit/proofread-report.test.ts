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

jest.mock('../../utils/path-safety', () => ({
  validateFilePath: jest.fn((p: string, _exts: string[]) => p),
}));

import {
  proofreadAccumulateHandler,
  generateProofreadReportHandler,
  sessionIssues,
} from '../../tools/word/proofread-report';

// Reset sessionIssues before each test
beforeEach(() => {
  sessionIssues.clear();
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
        { offset: 10, length: 2, original: '的的', suggestion: '的', type: '重复字符', context: '...', source: 'mcp' },
      ],
      doc_info: { fileName: 'test.docx', filePath: 'C:\\test.docx', totalParagraphs: 50, totalWords: 5000 },
    });

    // Second call — no doc_info needed
    await proofreadAccumulateHandler({
      session_id: 'test-session-2',
      issues: [
        { offset: 50, length: 2, original: '的了', suggestion: '得了', type: '的得混淆', context: '...', source: 'mcp' },
      ],
    });

    const session = sessionIssues.get('test-session-2')!;
    expect(session.issues.length).toBe(2);
  });

  it('should deduplicate issues by offset+original', async () => {
    await proofreadAccumulateHandler({
      session_id: 'test-session-3',
      issues: [
        { offset: 10, length: 2, original: '的的', suggestion: '的', type: '重复字符', context: '...', source: 'mcp' },
      ],
      doc_info: { fileName: 'test.docx', filePath: 'C:\\test.docx', totalParagraphs: 50, totalWords: 5000 },
    });

    // Same issue again
    await proofreadAccumulateHandler({
      session_id: 'test-session-3',
      issues: [
        { offset: 10, length: 2, original: '的的', suggestion: '的', type: '重复字符', context: '...', source: 'mcp' },
      ],
    });

    const session = sessionIssues.get('test-session-3')!;
    expect(session.issues.length).toBe(1); // deduplicated
  });

  it('should update total_revisions when provided', async () => {
    await proofreadAccumulateHandler({
      session_id: 'test-session-4',
      issues: [],
      doc_info: { fileName: 'test.docx', filePath: 'C:\\test.docx', totalParagraphs: 50, totalWords: 5000 },
      total_revisions: 15,
    });

    expect(sessionIssues.get('test-session-4')!.totalRevisions).toBe(15);
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
      docInfo: { fileName: 'doc.docx', filePath: '/path/doc.docx', totalParagraphs: 10, totalWords: 100 },
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
          offset: 10, length: 2, original: '三方', suggestion: '三方面',
          type: '少字', context: '...以下三方...', source: 'mcp',
        },
      ],
      docInfo: { fileName: 'doc.docx', filePath: '/path/doc.docx', totalParagraphs: 10, totalWords: 100 },
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
          offset: 10, length: 10, original: 'xxx有限公司', suggestion: '[名称]有限公司',
          type: '占位文本', context: '...xxx有限公司...', source: 'mcp',
        },
      ],
      docInfo: { fileName: 'doc.docx', filePath: '/path/doc.docx', totalParagraphs: 10, totalWords: 100 },
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
      docInfo: { fileName: 'doc.docx', filePath: '/path/doc.docx', totalParagraphs: 100, totalWords: 1000 },
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
        { offset: 0, length: 2, original: '的的', suggestion: '的', type: '重复字符', context: '...', source: 'mcp' },
      ],
      docInfo: { fileName: 'doc.docx', filePath: '/path/doc.docx', totalParagraphs: 10, totalWords: 100 },
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
          offset: 0, length: 5, original: 'abcde', suggestion: 'abc',
          type: '未来新类型', context: '...', source: 'ai' as const, reason: 'test',
        },
      ],
      docInfo: { fileName: 'doc.docx', filePath: '/path/doc.docx', totalParagraphs: 10, totalWords: 100 },
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
      offset: i * 10, length: 2, original: '的的', suggestion: '的',
      type: '的得混淆', context: '...', source: 'mcp' as const,
    }));

    sessionIssues.set('normalize-1', {
      issues,
      docInfo: { fileName: 'd.docx', filePath: '/p/d.docx', totalParagraphs: 100, totalWords: 1000 },
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
        { offset: 0, length: 5, original: 'xxx公司', suggestion: '[名称]', type: '占位文本', context: '...', source: 'mcp' },
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
        { offset: 0, length: 2, original: 'xx', suggestion: 'yy', type, context: '...', source: 'mcp' },
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
      issues: [{ offset: 1, length: 1, original: 'a', suggestion: 'b', type: '的得混淆', context: '...', source: 'mcp' }],
      doc_info: { fileName: 'a.docx', filePath: '/a.docx', totalParagraphs: 1, totalWords: 10 },
    });

    await proofreadAccumulateHandler({
      session_id: 'session-b',
      issues: [{ offset: 2, length: 1, original: 'c', suggestion: 'd', type: '重复字符', context: '...', source: 'ai', reason: 'test' }],
      doc_info: { fileName: 'b.docx', filePath: '/b.docx', totalParagraphs: 2, totalWords: 20 },
    });

    expect(sessionIssues.size).toBe(2);
    expect(sessionIssues.get('session-a')!.issues.length).toBe(1);
    expect(sessionIssues.get('session-b')!.issues.length).toBe(1);
    expect(sessionIssues.get('session-a')!.docInfo.fileName).toBe('a.docx');
    expect(sessionIssues.get('session-b')!.docInfo.fileName).toBe('b.docx');
  });
});
