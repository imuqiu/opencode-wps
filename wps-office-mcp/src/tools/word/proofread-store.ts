/**
 * 校对会话落盘存储模块
 *
 * 解决校对数据「依赖进程内存 + AI 上下文」双重易失问题：
 * - `proofreadAccumulate` 每次累加后增量写盘
 * - `generateProofreadReport` 优先从磁盘读取（进程 Map 命中则快路径）
 * - MCP 服务重启后按 session_id 从磁盘恢复
 *
 * 存储路径: ~/.opencode-wps/proofread-sessions/{sessionId}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ==================== 类型 ====================

/** 会话存储数据（与 proofread-report.ts 的 SessionData 结构对齐，兼容旧版无 suspectedIssues 的 JSON） */
export interface ProofreadSessionData {
  issues: Array<{
    offset?: number;
    length: number;
    original: string;
    suggestion: string;
    type: string;
    context: string;
    source: 'mcp' | 'ai';
    paragraphIndex?: number;
    reason?: string;
  }>;
  /** 疑似/待确认问题（未修改，仅供报告"待确认问题"节列出） */
  suspectedIssues?: Array<{
    offset?: number;
    length: number;
    original: string;
    suggestion: string;
    type: string;
    context: string;
    source: 'mcp' | 'ai';
    paragraphIndex?: number;
    reason?: string;
  }>;
  docInfo: {
    fileName: string;
    filePath: string;
    totalParagraphs: number;
    totalWords: number;
  };
  createdAt: string;
  totalRevisions?: number;
}

// ==================== 路径与工具 ====================

/** 存储根目录（~/.opencode-wps/proofread-sessions） */
function getStoreDir(): string {
  const home = os.homedir();
  return path.join(home, '.opencode-wps', 'proofread-sessions');
}

/** 单会话文件路径 */
function getSessionFilePath(sessionId: string): string {
  // 仅允许合法的 sessionId（UUID/含连字符/下划线的标识符），防止路径穿越
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error(`非法 session_id: ${sessionId}`);
  }
  return path.join(getStoreDir(), `${sessionId}.json`);
}

/** 确保存储目录存在 */
function ensureStoreDir(): void {
  const dir = getStoreDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ==================== 核心 API ====================

/**
 * 将会话数据写入磁盘（覆盖写该 session 的 JSON 文件）。
 * 每次 proofreadAccumulate 累加后调用，确保数据持久化。
 */
export function saveSessionToDisk(sessionId: string, data: ProofreadSessionData): boolean {
  try {
    ensureStoreDir();
    const filePath = getSessionFilePath(sessionId);
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, json, 'utf-8');
    return true;
  } catch {
    // 落盘失败不向上抛（由调用方决定是否提示），返回 false 供上层感知
    return false;
  }
}

/**
 * 从磁盘加载会话数据（sessionId 合法且文件存在时返回数据，否则返回 null）。
 * 用于 MCP 服务重启后按 session_id 恢复。
 */
export function loadSessionFromDisk(sessionId: string): ProofreadSessionData | null {
  try {
    const filePath = getSessionFilePath(sessionId);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as ProofreadSessionData;
    // 基础结构校验：必须含 issues 数组和 docInfo
    if (!Array.isArray(data.issues) || !data.docInfo) {
      return null;
    }
    // 深度校验（#116 第 2 轮评审）：每条 issue 的 original/suggestion 必须为非空字符串，
    // 避免旧版本或手工编辑的磁盘 JSON 绕过 proofreadAccumulate 的必填字段校验
    const invalidIssue = data.issues.find(
      (i) => typeof i.original !== 'string' || !i.original.trim() || typeof i.suggestion !== 'string' || !i.suggestion.trim()
    );
    if (invalidIssue) {
      return null;
    }
    // suspectedIssues 同样深度校验（若存在）
    if (data.suspectedIssues) {
      const invalidSuspected = data.suspectedIssues.find(
        (i) => typeof i.original !== 'string' || !i.original.trim() || typeof i.suggestion !== 'string' || !i.suggestion.trim()
      );
      if (invalidSuspected) {
        return null;
      }
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * 删除会话的磁盘文件（报告生成完成后清理，防止磁盘文件膨胀）。
 */
export function deleteSessionFromDisk(sessionId: string): boolean {
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
 * 列出磁盘上已有的会话 ID 列表（LRU 淘汰 / 调试用）。
 */
export function listSessionsOnDisk(): string[] {
  try {
    const dir = getStoreDir();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}
