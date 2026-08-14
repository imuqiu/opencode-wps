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

/** 校对会话存储根目录 */
const PROOFREAD_DIR = path.join(os.homedir(), '.opencode-wps', 'proofread-sessions');

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
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
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
