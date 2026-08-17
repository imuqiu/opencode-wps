/**
 * Input: 校对会话数据（sessionIssues Map + docInfo）
 * Output: 落盘持久化存储模块
 * Pos: 校对报告生成模块的配套存储层。一旦被修改，请更新头部注释，以及所属文件夹的md。
 *
 * 落盘持久化存储 — 解决校对数据易失问题（Issue #116 问题七/九/十二）
 *
 * 背景：校对问题原本只存在进程内 Map（sessionIssues），服务重启/会话压缩后
 * 数据即丢失。本模块将校对会话数据增量落盘到 JSON 文件，实现：
 * - proofreadAccumulate 每次累加后增量写盘
 * - generateProofreadReport 从磁盘读取（进程 Map 优先，磁盘兜底）
 * - 服务重启后按 session_id 恢复，彻底切断"数据依赖进程内存 + AI 上下文"两个易失点
 *
 * 存储路径：~/.opencode-wps/proofread-sessions/{sessionId}.json
 * 清理：releaseSession 同时删除磁盘文件
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** 校对会话存储根目录
 *
 * 支持通过环境变量 OPENCODE_WPS_PROOFREAD_DIR 覆盖存储根目录（默认 ~/.opencode-wps/proofread-sessions）。
 * 用途（Issue #151 QA 6/12）：Jest 并行 worker 默认共享同一 PROOFREAD_DIR，多测试文件
 * 并发做真实文件读写（saveBatchAllocations/updateBatchStatus 等 RMW）时存在跨 worker 文件系统
 * 竞争，导致读-改-写出现偶发陈旧读/丢失更新（proofread-store.test.ts R3-2/R6-1/R7-1 偶发失败）。
 * 测试可在 setup 中为每个 worker 设置独立临时目录以隔离，消除并行不稳定。生产环境不设置该
 * 环境变量时行为不变（兼容既有 ~/.opencode-wps/proofread-sessions）。 */
const PROOFREAD_DIR =
  process.env.OPENCODE_WPS_PROOFREAD_DIR ||
  path.join(os.homedir(), '.opencode-wps', 'proofread-sessions');

/** 确保存储目录存在 */
export function ensureProofreadDir(): void {
  try {
    if (!fs.existsSync(PROOFREAD_DIR)) {
      // 评审第 5 轮 W7：设置显式目录权限（POSIX 0o700，仅 owner 可读写执行），
      // 收敛含文档路径/原文片段的敏感数据的可读范围
      fs.mkdirSync(PROOFREAD_DIR, { recursive: true, mode: 0o700 });
    }
  } catch {
    // 目录创建失败时静默降级——调用方会捕获并返回错误
  }
}

/** 获取某会话的磁盘文件路径 */
function getSessionFilePath(sessionId: string): string {
  // 仅允许安全字符，防止路径注入
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  // 评审第 1 轮 W2：不同 sessionId 经安全化可能映射到同一 safeId（如 a/b 与 a_b 都变 a_b），
  // 导致会话数据互相覆盖。故对**原始 sessionId** 取确定性 hash 追加到文件名后缀，
  // 使含特殊字符但 safeId 相同的 sessionId 也具备唯一文件；读回/删除用同样映射保证一致性。
  const hash = fnv1a(sessionId);
  return path.join(PROOFREAD_DIR, `${safeId.slice(0, 8)}-${hash}.json`);
}

/** FNV-1a 32bit 哈希（轻量、确定性，用于生成唯一会话文件名） */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 增量写入会话数据到磁盘（覆盖写，因为每次都是全量会话数据）
 * @returns 成功返回 true，失败返回 false（不抛出，由调用方处理）
 */
export function saveSessionToDisk(sessionId: string, data: unknown): boolean {
  try {
    ensureProofreadDir();
    const filePath = getSessionFilePath(sessionId);
    // Issue #151 R3-1：session 与 batchAllocations 共用同一文件，而 batchAllocations
    // 由 saveBatchAllocations/appendStepRecord 独立写盘（批次分配表 + 逐步凭证）。
    // 此处若直接整体覆盖，会清掉已落盘的批次分配表/步骤凭证，导致管理 agent 监督/断点续跑失效。
    // 因此写盘前读取既有 batchAllocations，若本次 data 未携带则合并保留，避免被覆盖。
    let existingBatchAllocations: unknown;
    if (fs.existsSync(filePath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
        existingBatchAllocations = existing?.batchAllocations;
      } catch {
        existingBatchAllocations = undefined; // 旧数据损坏，不阻塞本次写入
      }
    }
    const dataObj = (data ?? {}) as Record<string, unknown>;
    if (existingBatchAllocations !== undefined && dataObj.batchAllocations === undefined) {
      dataObj.batchAllocations = existingBatchAllocations;
    }
    fs.writeFileSync(filePath, JSON.stringify(dataObj, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 从磁盘加载会话数据
 * @returns 存在且解析成功返回数据，否则返回 null
 */
export function loadSessionFromDisk<T>(sessionId: string): T | null {
  try {
    const filePath = getSessionFilePath(sessionId);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * 删除某会话的磁盘文件
 * @returns 成功删除（或文件不存在）返回 true，删除失败返回 false
 */
export function removeSessionFromDisk(sessionId: string): boolean {
  try {
    const filePath = getSessionFilePath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取存储目录路径（供测试/调试使用）
 */
export function getProofreadDir(): string {
  return PROOFREAD_DIR;
}

// ==================== 批次分配表 + 逐步执行凭证（校对 subagent 并行重构） ====================

/**
 * 校对批次分配表与逐步凭证持久化（Issue #151 文档校对重构）
 *
 * 背景：重构为「规划/管理/执行/报告」4 个 subagent 协同后，需要：
 * 1. 批次分配表落盘——管理 agent 据其调度执行 agent（并行度≤3）并支持断点续跑；
 * 2. 逐步执行凭证（stepsLog）落盘——管理 agent 监督每个执行 agent 每完成一步都逐一记录，
 *    防"大模型假装批量校对"（缺任何一步即判定该批未完成并重新派发）。
 *
 * 存储路径：~/.opencode-wps/proofread-sessions/{sessionId}.json
 * 与既有 saveSessionToDisk 共用同一文件（BatchAllocation 挂到 SessionData 上）。
 */

/** 标准校对步骤链（每批必须完整走完，管理 agent 据此校验凭证完整性） */
export const PROOFREAD_STEP_CHAIN = [
  'getDocumentParagraphs',
  'getDocumentTextByRange',
  'proofreadBasic',
  'confirmBatchAiProofread',
  'replaceInParagraph',
  'proofreadAccumulate',
] as const;

export type ProofreadStep = (typeof PROOFREAD_STEP_CHAIN)[number];

/** 单步执行凭证 */
export interface StepRecord {
  step: ProofreadStep;
  timestamp: number;
  /** 本轮处理到的段落（用于定位） */
  paragraphIndex?: number;
  /** 修订数（步骤执行前） */
  revisionsBefore?: number;
  /** 修订数（步骤执行后） */
  revisionsAfter?: number;
  /** 本步累加/发现的问题数 */
  issuesCount?: number;
}

/** 批次状态 */
export type BatchStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * 批次合法状态转换（R3-2 状态机约束，防管理 agent 绕过标准步骤链直接置 done）：
 * - pending → running（开始执行）
 * - running → done（完成，须凭证完整）
 * - 任意 → failed（异常）
 * - failed/pending → pending（重派/续跑）
 * - running → pending（重派，如凭证缺失判定未完成）
 * - done → pending（R6-1：done 但凭证不完整的批次回退重派，配合 getIncompleteBatches 防幻觉机制）
 * 禁止：pending → done（跳过执行直接完成）、done → running（已完成批次不回退直接开始）、
 *       done → failed（已完成不因后续失败误标 failed，异常用 pending 重派处理）
 */
const BATCH_STATUS_TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = {
  pending: ['running', 'failed', 'pending'],
  running: ['done', 'failed', 'pending'],
  done: ['pending'],
  failed: ['pending', 'failed'],
};

/**
 * 校验批次状态转换是否合法（R3-2）
 * @returns 合法返回 null，非法返回错误描述
 */
export function isValidBatchTransition(from: BatchStatus, to: BatchStatus): string | null {
  if (from === to) return null; // 状态不变视为合法（幂等）
  const allowed = BATCH_STATUS_TRANSITIONS[from];
  if (!allowed) return `未知状态 ${from}`;
  if (!allowed.includes(to)) {
    return `非法批次状态转换：${from} → ${to}（仅允许 ${allowed.join('/')}）`;
  }
  return null;
}

/** 单批次分配信息 */
export interface BatchAllocation {
  batchId: string;
  /** 段落区间（隔离核心：执行 agent 只修自己区间，互不重叠） */
  range: { start: number; end: number };
  status: BatchStatus;
  /** 负责的执行 agent 标识 */
  assignee?: string;
  /** 逐步执行凭证（防幻觉核心） */
  stepsLog: StepRecord[];
}

/**
 * 写入批次分配表到 session 磁盘文件
 * 调用方（管理 agent / 规划 agent）需先确保 session 已存在（含 docInfo）再合并批次分配表。
 * R8-1：写入前校验批次区间合法性（start≥1、end≥start）与批次间区间不重叠，
 * 非法/重叠批次表拒绝落盘（返回 false），避免规划阶段带病调度。
 * @returns 成功返回 true，失败返回 false
 */
export function saveBatchAllocations(sessionId: string, allocations: BatchAllocation[]): boolean {
  try {
    // R8-1：批次区间合法性 + 重叠校验
    if (Array.isArray(allocations)) {
      for (let i = 0; i < allocations.length; i++) {
        const r = allocations[i].range;
        if (
          !r ||
          typeof r.start !== 'number' ||
          typeof r.end !== 'number' ||
          r.start < 1 ||
          r.end < r.start
        ) {
          return false; // 非法区间（start<1 或 end<start）拒绝落盘
        }
        // 与已检查的批次区间判重叠
        for (let j = 0; j < i; j++) {
          const other = allocations[j].range;
          if (r.start <= other.end && other.start <= r.end) {
            return false; // 批次区间重叠拒绝落盘
          }
        }
      }
    }
    ensureProofreadDir();
    const filePath = getSessionFilePath(sessionId);
    // 读取既有 session 数据，合并 batchAllocations 后整体写回
    let data: Record<string, unknown> = {};
    if (fs.existsSync(filePath)) {
      try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      } catch {
        // 旧数据损坏时从空对象重建，避免覆盖合法批次数据
      }
    }
    data.batchAllocations = allocations;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 从磁盘读取批次分配表
 * @returns 存在且解析成功返回批次分配表，否则返回空数组
 */
export function loadBatchAllocations(sessionId: string): BatchAllocation[] {
  try {
    const data = loadSessionFromDisk<{ batchAllocations?: BatchAllocation[] }>(sessionId);
    return Array.isArray(data?.batchAllocations) ? data.batchAllocations : [];
  } catch {
    return [];
  }
}

/**
 * 追加一步执行凭证到指定批次的 stepsLog，并落盘
 * @returns 成功返回 true，批次不存在或落盘失败返回 false
 */
export function appendStepRecord(sessionId: string, batchId: string, record: StepRecord): boolean {
  try {
    const allocations = loadBatchAllocations(sessionId);
    const batch = allocations.find(b => b.batchId === batchId);
    if (!batch) return false;
    // R3-3：批次已 done 时拒绝追加步骤凭证（已完成批次不应再有新步骤，掩盖状态流转异常）；
    // 如需补充须先置回 pending 重派。
    if (batch.status === 'done') return false;
    if (!Array.isArray(batch.stepsLog)) batch.stepsLog = [];
    // R11-1：追加前对 step 名 trim，保证与服务端 getMissingSteps 的 Set 判定一致（避免带空白步骤名
    // 落盘后完整性判定缺失）。
    const normalizedRecord: StepRecord =
      record.step && typeof record.step === 'string' && record.step !== record.step.trim()
        ? { ...record, step: record.step.trim() as ProofreadStep }
        : record;
    batch.stepsLog.push(normalizedRecord);
    // 校验标准步骤链：某步骤已存在时，追加仍允许（支持多批迭代，按 timestamp/paragraphIndex 区分）。
    // 评审第 1 轮 R1-5：getMissingSteps 用 Set 对 step 名去重，同一批内同步骤名重复追加不影响
    // 完整性判定（仍视为已覆盖该步骤），timestamp 仅作审计溯源，不参与完整度判定。
    return saveBatchAllocations(sessionId, allocations);
  } catch {
    return false;
  }
}

/**
 * 更新批次状态，并落盘
 * @returns 成功返回 true，批次不存在或落盘失败返回 false
 */
export function updateBatchStatus(
  sessionId: string,
  batchId: string,
  status: BatchStatus,
  assignee?: string
): boolean {
  try {
    const allocations = loadBatchAllocations(sessionId);
    const batch = allocations.find(b => b.batchId === batchId);
    if (!batch) return false;
    // R3-2：状态机约束——拒绝非法转换（如 pending→done 跳过执行），防止绕过步骤链直接完成
    const transitionError = isValidBatchTransition(batch.status, status);
    if (transitionError) {
      return false;
    }
    batch.status = status;
    if (assignee !== undefined) batch.assignee = assignee;
    return saveBatchAllocations(sessionId, allocations);
  } catch {
    return false;
  }
}

/**
 * 校验指定批次的步骤凭证是否完整覆盖标准步骤链
 * @returns 缺失的步骤名数组（空 = 完整）
 */
export function getMissingSteps(sessionId: string, batchId: string): ProofreadStep[] {
  const allocations = loadBatchAllocations(sessionId);
  const batch = allocations.find(b => b.batchId === batchId);
  if (!batch) return [...PROOFREAD_STEP_CHAIN];
  // R11-1：对已落盘步骤名 trim 后判定，避免历史带空白步骤名被误判缺失
  const done = new Set(
    (batch.stepsLog || []).map(r => (typeof r.step === 'string' ? r.step.trim() : r.step))
  );
  return PROOFREAD_STEP_CHAIN.filter(s => !done.has(s));
}

/**
 * 获取所有未完成批次，供管理 agent 断点续跑时重新入队。
 * R7-1：未完成定义 = status !== 'done' 或 (status === 'done' 但步骤凭证不完整)。
 * 防"谎报 done / 异常标记 done 但步骤链缺失"的批次被断点续跑跳过而漏校。
 */
export function getIncompleteBatches(sessionId: string): BatchAllocation[] {
  return loadBatchAllocations(sessionId).filter(b => {
    if (b.status !== 'done') return true;
    // done 但步骤凭证不完整 → 仍视为未完成（防幻觉缺口，R7-1）
    // R11-1：对步骤名 trim 后判定
    const doneSteps = new Set(
      (b.stepsLog || []).map(r => (typeof r.step === 'string' ? r.step.trim() : r.step))
    );
    return PROOFREAD_STEP_CHAIN.some(s => !doneSteps.has(s));
  });
}

/**
 * 判断是否存在并行区间重叠（P21 并行隔离校验）
 * 若同一会话存在两个 running 批次的段落区间相交，视为并行冲突。
 */
export function hasParallelRangeConflict(sessionId: string): boolean {
  const allocations = loadBatchAllocations(sessionId);
  const running = allocations.filter(b => b.status === 'running');
  for (let i = 0; i < running.length; i++) {
    for (let j = i + 1; j < running.length; j++) {
      const a = running[i].range;
      const b = running[j].range;
      // 区间相交判定：start <= other.end && other.start <= end
      if (a.start <= b.end && b.start <= a.end) return true;
    }
  }
  return false;
}
