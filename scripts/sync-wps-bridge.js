#!/usr/bin/env node
/**
 * WPS 桥接共享层同步脚本
 *
 * 将 `shared/wps-bridge/` 下的单一来源（single source of truth）文件同步到
 * `opencode-wps-assistant/` 与 `opencode-wps-linux/` 两个平台目录。
 *
 * 设计动机：macOS 与 Linux 反向轮询桥存在大量同构 handler 代码，
 * 改 bug 需在两平台各改一遍，极易漏改。本脚本将公共逻辑收敛到
 * `shared/wps-bridge/`，平台目录文件作为「生成产物」由本脚本产出，
 * CI 用 `--check` 模式校验漂移（防止手工改动平台文件导致单源失效）。
 *
 * 同步规则：
 *  1. response.js / registry.js —— 逐字节复制（两平台原已完全相同）
 *  2. common-core.js —— 生成平台化的 common-handler.js（注入 BRIDGE_PLATFORM）
 *
 * 用法：
 *  node scripts/sync-wps-bridge.js            # 同步（写回平台目录）
 *  node scripts/sync-wps-bridge.js --check    # 只校验不写回（CI 用）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED_DIR = path.join(ROOT, 'shared', 'wps-bridge');
const PLATFORMS = [
  { dir: 'opencode-wps-assistant', name: 'mac' },
  { dir: 'opencode-wps-linux', name: 'linux' },
];

const isCheck = process.argv.includes('--check');
let driftDetected = false;

function warn(msg) {
  console.error('[sync-wps-bridge] ' + msg);
}

/**
 * 生成平台化的 common-handler.js。
 * 以 shared 的 common-core.js 为单一来源，注入平台标记头后产出
 * 平台目录自包含的 common-handler.js（适配 script-tag 沙箱加载）。
 */
function buildCommonHandler(platformName) {
  const core = fs.readFileSync(path.join(SHARED_DIR, 'common-core.js'), 'utf-8');
  const header = `/**\n * 通用操作处理器（${platformName === 'mac' ? 'macOS' : 'Linux'} 入口 · 生成产物）\n *\n * ⚠️ 本文件由 scripts/sync-wps-bridge.js 从 shared/wps-bridge/common-core.js\n * 自动生成，请勿手工编辑——改动请修改 shared/wps-bridge/common-core.js 后\n * 重新运行：node scripts/sync-wps-bridge.js\n * 平台差异仅通过下方注入的 BRIDGE_PLATFORM 标记隔离。\n */\n\nvar BRIDGE_PLATFORM = '${platformName}';\n\n`;
  return header + core;
}

/**
 * 将文件同步到平台目录；返回 true 表示发生变更（或 --check 模式下检测到漂移）。
 */
function syncFile(platformDir, sharedRelPath, platformRelPath, content) {
  const targetAbs = path.join(ROOT, platformDir, platformRelPath);
  if (content === null) {
    content = fs.readFileSync(path.join(SHARED_DIR, sharedRelPath), 'utf-8');
  }
  if (fs.existsSync(targetAbs) && fs.readFileSync(targetAbs, 'utf-8') === content) {
    return false; // 已同步
  }
  driftDetected = true;
  if (!isCheck) {
    // 确保目标父目录存在（平台目录结构缺失时避免 writeFileSync 抛 ENOENT）
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.writeFileSync(targetAbs, content);
    warn('已同步 ' + platformDir + '/' + platformRelPath);
  } else {
    warn('漂移: ' + platformDir + '/' + platformRelPath + ' 与 shared 不一致，请运行同步');
  }
  return true;
}

function main() {
  if (!fs.existsSync(SHARED_DIR)) {
    warn('共享目录不存在: ' + SHARED_DIR);
    process.exit(1);
  }

  // 1. 逐字节复制的共享文件
  const copyFiles = [
    { shared: 'response.js', platform: 'utils/response.js' },
    { shared: 'registry.js', platform: 'handlers/registry.js' },
    { shared: 'handler-utils.js', platform: 'handlers/handler-utils.js' },
  ];

  // 2. 生成的 common-handler.js（按平台注入 BRIDGE_PLATFORM）
  const generated = { platform: 'handlers/common-handler.js' };

  for (const p of PLATFORMS) {
    for (const f of copyFiles) {
      syncFile(p.dir, f.shared, f.platform, null);
    }
    const handlerContent = buildCommonHandler(p.name);
    syncFile(p.dir, 'common-core.js', generated.platform, handlerContent);
  }

  if (driftDetected) {
    if (isCheck) {
      warn('存在漂移，请先运行 node scripts/sync-wps-bridge.js');
      process.exit(1);
    }
  } else {
    console.log('[sync-wps-bridge] 全部平台文件与 shared 一致，无需变更。');
  }
}

main();
