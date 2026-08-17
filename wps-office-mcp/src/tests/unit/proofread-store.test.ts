/**
 * Unit tests for proofread-store.ts batch allocation & step-log persistence
 *
 * Covers the Issue #151 校对 subagent 并行重构 additions:
 * - saveBatchAllocations / loadBatchAllocations (批次分配表落盘/读回)
 * - appendStepRecord (逐步凭证追加)
 * - updateBatchStatus (批次状态更新)
 * - getMissingSteps (标准步骤链完整性校验)
 * - getIncompleteBatches (断点续跑时未完成批次)
 * - hasParallelRangeConflict (并行区间重叠检测)
 *
 * 使用带随机后缀的 sessionId，并在 afterAll 清理，避免污染真实会话文件。
 */

import {
  ensureProofreadDir,
  saveSessionToDisk,
  removeSessionFromDisk,
  saveBatchAllocations,
  loadBatchAllocations,
  appendStepRecord,
  updateBatchStatus,
  getMissingSteps,
  getIncompleteBatches,
  hasParallelRangeConflict,
  isValidBatchTransition,
  getProofreadDir,
  PROOFREAD_STEP_CHAIN,
  StepRecord,
  BatchAllocation,
} from '../../tools/word/proofread-store';

const SUFFIX = Date.now().toString(36);

function sid(label: string): string {
  return `test-${label}-${SUFFIX}`;
}

function fullAllocation(batchId: string, range: { start: number; end: number }): BatchAllocation {
  return {
    batchId,
    range,
    status: 'done',
    stepsLog: PROOFREAD_STEP_CHAIN.map(s => ({
      step: s,
      timestamp: Date.now(),
      paragraphIndex: range.end,
      revisionsBefore: 0,
      revisionsAfter: 2,
      issuesCount: 2,
    })),
  };
}

describe('proofread-store batch allocation & step-log', () => {
  beforeAll(() => {
    ensureProofreadDir();
  });

  afterAll(() => {
    // 清理所有测试 session 文件
    for (const label of [
      'roundtrip',
      'preserve',
      'append',
      'missing',
      'incomplete',
      'conflict',
      'noconflict',
      'partial',
      'nonexist',
      'badbatch',
      'state-machine',
      'done-append',
      'done-redispatch',
      'bad-overlap',
      'bad-range',
      'trim-step',
    ]) {
      removeSessionFromDisk(sid(label));
    }
  });

  test('save & load batch allocations round-trip', () => {
    const s = sid('roundtrip');
    const allocs: BatchAllocation[] = [
      fullAllocation('batch-1', { start: 1, end: 100 }),
      { batchId: 'batch-2', range: { start: 101, end: 200 }, status: 'pending', stepsLog: [] },
    ];
    expect(saveBatchAllocations(s, allocs)).toBe(true);
    const loaded = loadBatchAllocations(s);
    expect(loaded.length).toBe(2);
    expect(loaded[0].batchId).toBe('batch-1');
    expect(loaded[0].status).toBe('done');
    expect(loaded[1].range).toEqual({ start: 101, end: 200 });
    expect(loaded[1].status).toBe('pending');
  });

  test('saveBatchAllocations preserves existing session data', () => {
    const s = sid('preserve');
    saveSessionToDisk(s, {
      issues: [],
      docInfo: {
        fileName: 'a.docx',
        filePath: '/tmp/a.docx',
        totalParagraphs: 200,
        totalWords: 1000,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 0,
    });
    saveBatchAllocations(s, [fullAllocation('b1', { start: 1, end: 100 })]);
    expect(loadBatchAllocations(s).length).toBe(1);
  });

  test('saveSessionToDisk does NOT wipe existing batchAllocations（评审第 3 轮 R3-1 回归）', () => {
    // R3-1：session 与 batchAllocations 共用同一 JSON 文件，saveBatchAllocations 落盘后，
    // 后续 proofreadAccumulate 每次 saveSessionToDisk(session) 若整体覆盖会清掉批次分配表/步骤凭证，
    // 导致管理 agent 监督/断点续跑失效。saveSessionToDisk 必须合并保留既有 batchAllocations。
    const s = sid('preserve');
    saveBatchAllocations(s, [fullAllocation('b1', { start: 1, end: 100 })]);
    // 模拟 executor 每次 proofreadAccumulate 后写 session（不含 batchAllocations 字段）
    saveSessionToDisk(s, {
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
        fileName: 'a.docx',
        filePath: '/tmp/a.docx',
        totalParagraphs: 200,
        totalWords: 1000,
      },
      createdAt: new Date().toISOString(),
      totalRevisions: 2,
    });
    // 批次分配表必须仍保留（不被覆盖清空）
    expect(loadBatchAllocations(s).length).toBe(1);
  });

  test('appendStepRecord appends to stepsLog of a batch', () => {
    const s = sid('append');
    saveBatchAllocations(s, [
      { batchId: 'batch-2', range: { start: 101, end: 200 }, status: 'pending', stepsLog: [] },
    ]);
    const rec: StepRecord = {
      step: 'replaceInParagraph',
      timestamp: Date.now(),
      paragraphIndex: 150,
      revisionsBefore: 2,
      revisionsAfter: 4,
      issuesCount: 2,
    };
    expect(appendStepRecord(s, 'batch-2', rec)).toBe(true);
    const batch2 = loadBatchAllocations(s).find(b => b.batchId === 'batch-2');
    expect(batch2?.stepsLog).toHaveLength(1);
    expect(batch2?.stepsLog[0].step).toBe('replaceInParagraph');
    expect(batch2?.stepsLog[0].revisionsAfter).toBe(4);
  });

  test('appendStepRecord returns false for non-existent batch', () => {
    const s = sid('badbatch');
    saveBatchAllocations(s, [fullAllocation('b1', { start: 1, end: 100 })]);
    expect(
      appendStepRecord(s, 'batch-999', { step: 'proofreadBasic', timestamp: Date.now() })
    ).toBe(false);
  });

  test('updateBatchStatus updates status & assignee', () => {
    const s = sid('append'); // 复用已有批次
    expect(updateBatchStatus(s, 'batch-2', 'running', 'executor-3')).toBe(true);
    const batch2 = loadBatchAllocations(s).find(b => b.batchId === 'batch-2');
    expect(batch2?.status).toBe('running');
    expect(batch2?.assignee).toBe('executor-3');
  });

  test('getMissingSteps returns empty for complete batch', () => {
    const s = sid('roundtrip'); // batch-1 是完整步骤链
    expect(getMissingSteps(s, 'batch-1')).toEqual([]);
  });

  test('getMissingSteps returns all steps for batch with no logs', () => {
    const s = sid('roundtrip'); // batch-2 无步骤日志
    const missing = getMissingSteps(s, 'batch-2');
    expect(missing).toEqual([...PROOFREAD_STEP_CHAIN]);
  });

  test('getMissingSteps detects partial step logs', () => {
    const s = sid('partial');
    saveBatchAllocations(s, [
      {
        batchId: 'b1',
        range: { start: 1, end: 50 },
        status: 'running',
        stepsLog: [
          { step: 'getDocumentParagraphs', timestamp: Date.now() },
          { step: 'getDocumentTextByRange', timestamp: Date.now() },
        ],
      },
    ]);
    const missing = getMissingSteps(s, 'b1');
    expect(missing).toContain('proofreadBasic');
    expect(missing).toContain('confirmBatchAiProofread');
    expect(missing).toContain('replaceInParagraph');
    expect(missing).toContain('proofreadAccumulate');
    expect(missing).not.toContain('getDocumentParagraphs');
  });

  test('getIncompleteBatches filters out done batches with complete step logs', () => {
    const s = sid('incomplete');
    saveBatchAllocations(s, [
      fullAllocation('a', { start: 1, end: 50 }), // done 且步骤链完整 → 应跳过
      { batchId: 'b', range: { start: 51, end: 100 }, status: 'pending', stepsLog: [] },
      { batchId: 'c', range: { start: 101, end: 150 }, status: 'failed', stepsLog: [] },
    ]);
    const ids = getIncompleteBatches(s)
      .map(b => b.batchId)
      .sort();
    expect(ids).toEqual(['b', 'c']); // pending + failed 重新入队，完整 done 跳过
  });

  test('getIncompleteBatches treats done batch with incomplete step logs as incomplete（评审第 6 轮 R7-1）', () => {
    const s = sid('incomplete');
    // done 但步骤链不完整（只走了 2 步）→ 防幻觉：不得被断点续跑跳过，应重新入队
    saveBatchAllocations(s, [
      {
        batchId: 'd',
        range: { start: 151, end: 200 },
        status: 'done',
        stepsLog: [
          { step: 'getDocumentParagraphs', timestamp: Date.now() },
          { step: 'proofreadAccumulate', timestamp: Date.now() },
        ],
      },
    ]);
    const incomplete = getIncompleteBatches(s);
    expect(incomplete.map(b => b.batchId)).toContain('d'); // 谎报/异常 done 但凭证不全 → 重派
  });

  test('hasParallelRangeConflict detects overlapping running ranges', () => {
    const s = sid('conflict');
    // R8-1 后 saveBatchAllocations 拒绝重叠，故用 saveSessionToDisk 直接写重叠数据（模拟异常/历史数据）
    saveSessionToDisk(s, {
      issues: [],
      batchAllocations: [
        { batchId: 'x', range: { start: 1, end: 100 }, status: 'running', stepsLog: [] },
        { batchId: 'y', range: { start: 90, end: 190 }, status: 'running', stepsLog: [] },
      ],
    });
    expect(hasParallelRangeConflict(s)).toBe(true);
  });

  test('hasParallelRangeConflict returns false for non-overlapping running ranges', () => {
    const s = sid('noconflict');
    saveBatchAllocations(s, [
      { batchId: 'x', range: { start: 1, end: 100 }, status: 'running', stepsLog: [] },
      { batchId: 'y', range: { start: 101, end: 200 }, status: 'running', stepsLog: [] },
    ]);
    expect(hasParallelRangeConflict(s)).toBe(false);
  });

  test('R3-2：updateBatchStatus 拒绝非法状态转换（pending→done 跳过执行）', () => {
    const s = sid('state-machine');
    saveBatchAllocations(s, [
      { batchId: 'b1', range: { start: 1, end: 100 }, status: 'pending', stepsLog: [] },
    ]);
    // pending → done 非法（绕过标准步骤链直接完成）
    expect(updateBatchStatus(s, 'b1', 'done')).toBe(false);
    expect(loadBatchAllocations(s)[0].status).toBe('pending'); // 状态不变
    // pending → running 合法
    expect(updateBatchStatus(s, 'b1', 'running')).toBe(true);
    expect(loadBatchAllocations(s)[0].status).toBe('running');
    // running → done 合法
    expect(updateBatchStatus(s, 'b1', 'done')).toBe(true);
    expect(loadBatchAllocations(s)[0].status).toBe('done');
  });

  test('R3-2：isValidBatchTransition 校验函数正确', () => {
    expect(isValidBatchTransition('pending', 'running')).toBeNull();
    expect(isValidBatchTransition('pending', 'done')).not.toBeNull(); // 非法
    expect(isValidBatchTransition('running', 'done')).toBeNull();
    expect(isValidBatchTransition('running', 'pending')).toBeNull(); // 重派合法
    expect(isValidBatchTransition('done', 'pending')).toBeNull(); // R6-1：凭证不完整回退重派合法
    expect(isValidBatchTransition('done', 'running')).not.toBeNull(); // 已完成不回退直接开始
    expect(isValidBatchTransition('done', 'failed')).not.toBeNull();
    expect(isValidBatchTransition('failed', 'pending')).toBeNull(); // 重派合法
    expect(isValidBatchTransition('pending', 'pending')).toBeNull(); // 幂等
  });

  test('R6-1：done 但凭证不完整的批次可回退 pending 重派（配合 getIncompleteBatches 防幻觉）', () => {
    const s = sid('done-redispatch');
    saveBatchAllocations(s, [
      {
        batchId: 'b1',
        range: { start: 1, end: 100 },
        status: 'done',
        stepsLog: [
          { step: 'getDocumentParagraphs', timestamp: Date.now() },
          { step: 'proofreadAccumulate', timestamp: Date.now() }, // 凭证不完整
        ],
      },
    ]);
    // getIncompleteBatches 判定该批次未完成（done 但凭证不全）
    expect(getIncompleteBatches(s).map(b => b.batchId)).toContain('b1');
    // 状态机允许 done → pending 回退重派
    expect(updateBatchStatus(s, 'b1', 'pending')).toBe(true);
    expect(loadBatchAllocations(s)[0].status).toBe('pending');
    // 回退后可以重新 running → done
    expect(updateBatchStatus(s, 'b1', 'running')).toBe(true);
    expect(updateBatchStatus(s, 'b1', 'done')).toBe(true);
  });

  test('R3-3：appendStepRecord 对 done 批次拒绝追加', () => {
    const s = sid('done-append');
    saveBatchAllocations(s, [fullAllocation('b1', { start: 1, end: 100 })]); // status: done
    expect(appendStepRecord(s, 'b1', { step: 'proofreadAccumulate', timestamp: Date.now() })).toBe(
      false
    );
    // 未 done 批次正常追加
    saveBatchAllocations(s, [
      { batchId: 'b2', range: { start: 101, end: 200 }, status: 'running', stepsLog: [] },
    ]);
    expect(appendStepRecord(s, 'b2', { step: 'proofreadBasic', timestamp: Date.now() })).toBe(true);
  });

  test('R8-1：saveBatchAllocations 拒绝非法区间（start<1 或 end<start）', () => {
    const s = sid('bad-range');
    expect(
      saveBatchAllocations(s, [
        { batchId: 'b1', range: { start: 0, end: 100 }, status: 'pending', stepsLog: [] }, // start<1
      ])
    ).toBe(false);
    expect(
      saveBatchAllocations(s, [
        { batchId: 'b1', range: { start: 100, end: 50 }, status: 'pending', stepsLog: [] }, // end<start
      ])
    ).toBe(false);
    // 合法区间正常
    expect(
      saveBatchAllocations(s, [
        { batchId: 'b1', range: { start: 1, end: 100 }, status: 'pending', stepsLog: [] },
      ])
    ).toBe(true);
  });

  test('R8-1：saveBatchAllocations 拒绝重叠批次区间', () => {
    const s = sid('bad-overlap');
    expect(
      saveBatchAllocations(s, [
        { batchId: 'b1', range: { start: 1, end: 100 }, status: 'pending', stepsLog: [] },
        { batchId: 'b2', range: { start: 90, end: 200 }, status: 'pending', stepsLog: [] }, // 与 b1 在 90-100 重叠
      ])
    ).toBe(false);
    // 不重叠正常
    expect(
      saveBatchAllocations(s, [
        { batchId: 'b1', range: { start: 1, end: 100 }, status: 'pending', stepsLog: [] },
        { batchId: 'b2', range: { start: 101, end: 200 }, status: 'pending', stepsLog: [] },
      ])
    ).toBe(true);
  });

  test('R11-1：getMissingSteps 对带空白步骤名 trim 后判定完整（不误判缺失）', () => {
    const s = sid('trim-step');
    saveBatchAllocations(s, [
      {
        batchId: 'b1',
        range: { start: 1, end: 100 },
        status: 'done',
        // 步骤名带空白（历史/异常数据），trim 后应判定为完整
        stepsLog: PROOFREAD_STEP_CHAIN.map((step, idx) => ({
          step: idx % 2 === 0 ? ` ${step}` : `${step} `,
          timestamp: Date.now() + idx,
        })) as unknown as StepRecord[],
      },
    ]);
    expect(getMissingSteps(s, 'b1')).toEqual([]);
    expect(getIncompleteBatches(s).length).toBe(0); // done 且步骤名 trim 后完整 → 不算未完成
  });

  test('QA6/12：OPENCODE_WPS_PROOFREAD_DIR 环境变量覆盖存储目录（并行隔离回归）', () => {
    // 根因（Issue #151 QA 6/12）：Jest 并行 worker 共享同一默认 PROOFREAD_DIR，且
    // proofread-report.test.ts 的 beforeEach 会清空该目录下所有文件，导致并发 worker 中
    // proofread-store.test.ts 的真实文件 RMW 被删除/干扰而偶发陈旧读。修复为通过环境变量
    // OPENCODE_WPS_PROOFREAD_DIR 为每个 worker 隔离独立目录。本用例验证该覆盖机制生效。
    const dir = getProofreadDir();
    expect(dir.length).toBeGreaterThan(0);
    // 在 Jest 环境下（setup.ts 已设置隔离目录）应指向带 worker 标识的临时目录，
    // 而非默认 ~/.opencode-wps/proofread-sessions（避免跨 worker 共享干扰）。
    if (process.env.JEST_WORKER_ID) {
      expect(dir).toContain('opencode-wps-proofread-test-');
    }
  });
});
