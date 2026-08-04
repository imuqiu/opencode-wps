/**
 * Input: WPS 服务地址与保活间隔
 * Output: 服务保活状态
 * Pos: WPS 服务保活器。一旦我被修改，请更新我的头部注释，以及所属文件夹的md。
 * WPS服务保活器 - 老王的保活神器
 * 定期检查WPS服务，断了就自动重启
 * Windows/macOS：探测内置 RelayHttpServer（:58890）
 * Linux：探测 WPS 主进程（wps/et/wpp/wpsoffice，轮询桥无 :58890 服务）
 */

import axios from 'axios';
import { exec, execSync } from 'child_process';
import { log } from '../utils/logger';

const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

// Windows/macOS 通过内置 RelayHttpServer（:58890）暴露 HTTP 服务；
// Linux 无 RelayHttpServer，WPS 加载项走反向轮询桥（MCP 侧 :58891），因此保活探测方式按平台区分。
const WPS_SERVICE_URL = 'http://127.0.0.1:58890';
const CHECK_INTERVAL = 5000; // 5秒检查一次
const STARTUP_PROTOCOL = 'ksoWPSCloudSvr://start=RelayHttpServer';

let keepaliveTimer: NodeJS.Timeout | null = null;
let isStarting = false;

/**
 * 检查Linux下WPS是否在运行
 * Linux 版 WPS 没有 RelayHttpServer（:58890），加载项是轮询 MCP 侧 :58891 的轮询服务器；
 * 因此改为探测 WPS 主进程（wps/et/wpp/wpsoffice）是否存活，避免每 5 秒误判"未运行"反复拉起。
 */
function checkLinuxWpsRunning(): boolean {
  try {
    execSync(
      'pgrep -x wps >/dev/null 2>&1 || pgrep -x et >/dev/null 2>&1 || pgrep -x wpp >/dev/null 2>&1 || pgrep -x wpsoffice >/dev/null 2>&1 || pgrep -x wpspdf >/dev/null 2>&1',
      { timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查WPS服务是否在运行
 */
async function checkService(): Promise<boolean> {
  try {
    const res = await axios.post(`${WPS_SERVICE_URL}/version`, {}, { timeout: 2000 });
    return !!res.data;
  } catch {
    return false;
  }
}

/**
 * 启动WPS内置HTTP服务
 */
function startService(): Promise<void> {
  return new Promise((resolve) => {
    if (isStarting) {
      resolve();
      return;
    }
    isStarting = true;
    log.info('[Keepalive] Starting WPS relay service...');

    if (IS_MAC) {
      // Mac下通过open命令启动WPS
      exec(`open "${STARTUP_PROTOCOL}"`, (error) => {
        if (error) {
          log.error('[Keepalive] Failed to start WPS service on Mac', error);
        }
        setTimeout(() => {
          isStarting = false;
          resolve();
        }, 3000);
      });
      return;
    }

    if (IS_LINUX) {
      // Linux 下按可用性拉起 WPS 家族（优先 wps，回退 et/wpp），避免只装 et/wpp 时 nohup wps 失败
      // 注意：不能用 `cmd && nohup x & || ...` 链式写法（`&` 与 `||` 组合是非法 shell 语法，bash -n 直接报错）
      exec(
        'for c in wps et wpp; do command -v "$c" >/dev/null 2>&1 && { nohup "$c" >/dev/null 2>&1 & break; }; done',
        (error) => {
          if (error) {
            log.error('[Keepalive] Failed to start WPS service on Linux', error);
          }
          setTimeout(() => {
            isStarting = false;
            resolve();
          }, 3000);
        }
      );
      return;
    }

    // Windows下通过start命令启动自定义协议
    exec(`start "" "${STARTUP_PROTOCOL}"`, (error) => {
      if (error) {
        log.error('[Keepalive] Failed to start WPS service', error);
      }
      // 等待服务启动
      setTimeout(() => {
        isStarting = false;
        resolve();
      }, 3000);
    });
  });
}

/**
 * 保活循环
 */
async function keepaliveLoop(): Promise<void> {
  const isRunning = IS_LINUX ? checkLinuxWpsRunning() : await checkService();
  if (!isRunning) {
    log.warn('[Keepalive] WPS service not running, restarting...');
    await startService();
  }
}

/**
 * 启动保活服务
 */
export function startKeepalive(): void {
  if (keepaliveTimer) {
    return;
  }
  log.info('[Keepalive] Starting WPS keepalive service');

  // 立即检查一次
  keepaliveLoop();

  // 定期检查
  keepaliveTimer = setInterval(keepaliveLoop, CHECK_INTERVAL);
}

/**
 * 停止保活服务
 */
export function stopKeepalive(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    log.info('[Keepalive] Stopped WPS keepalive service');
  }
}

/**
 * 确保WPS服务可用（调用前先确保服务启动）
 */
export async function ensureService(): Promise<boolean> {
  let retries = 3;
  while (retries > 0) {
    if (IS_LINUX ? checkLinuxWpsRunning() : await checkService()) {
      return true;
    }
    await startService();
    retries--;
  }
  return false;
}

export { checkService };
