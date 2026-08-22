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
 *  node scripts/sync-wps-bridge.js --report   # 只输出三平台 handler 归一化重复率基线（不写回）
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

// --report 模式下纳入重复率检测的 handler（尚未单源化的三平台大文件）
const REPORT_HANDLERS = ['excel-handler', 'ppt-handler', 'word-handler'];

const isCheck = process.argv.includes('--check');
const isReport = process.argv.includes('--report');
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

/**
 * 归一化一行代码：去除首尾空白、空行、纯注释/空块行，并剥离平台注入标记
 * （BRIDGE_PLATFORM 声明、生成产物头部注释等），用于跨平台重复率对比。
 */
function normalizeLine(line) {
  const t = line.trim();
  if (!t) return null; // 空行
  if (/^\/\//.test(t) || /^\/\*/.test(t) || /^\*/.test(t) || /^\*\/$/.test(t)) return null; // 注释行
  if (t === '{' || t === '}' || t === ';') return null; // 空块/分号
  return t
    .replace(/var BRIDGE_PLATFORM = '[a-z]+';/, "var BRIDGE_PLATFORM = '<p>';") // 平台注入标记
    .replace(/BRIDGE_PLATFORM\.([A-Z_]+)/g, 'BRIDGE_PLATFORM.<p>'); // 平台差异引用
}

/**
 * 计算单文件的行指纹集合（去重后的非空归一化行）。
 * @returns {Set<string>}
 */
function lineFingerprintSet(fileAbs) {
  const src = fs.readFileSync(fileAbs, 'utf-8');
  const set = new Set();
  for (const raw of src.split(/\r?\n/)) {
    const n = normalizeLine(raw);
    if (n !== null) set.add(n);
  }
  return set;
}

/**
 * --report 模式：输出三个未单源化 handler 在 mac/linux 之间的归一化重复率基线。
 * 重复率 = 本平台行指纹中同时出现在另一平台的比例，反映"改 1 个 bug 需同步几处"。
 */
function runReport() {
  console.log('\n=== WPS bridge handler 归一化重复率基线（Issue #189 屎山清理）===');
  console.log('说明：剔除空行/注释/平台注入标记后，按行指纹统计两平台行级重叠。\n');

  const macDir = PLATFORMS.find(p => p.name === 'mac').dir;
  const linuxDir = PLATFORMS.find(p => p.name === 'linux').dir;

  const rows = [];
  let totalMac = 0;
  let totalLinux = 0;
  for (const handler of REPORT_HANDLERS) {
    const macAbs = path.join(ROOT, macDir, 'handlers', handler + '.js');
    const linuxAbs = path.join(ROOT, linuxDir, 'handlers', handler + '.js');
    if (!fs.existsSync(macAbs) || !fs.existsSync(linuxAbs)) {
      warn('跳过（文件缺失）: ' + handler);
      continue;
    }
    const macSet = lineFingerprintSet(macAbs);
    const linuxSet = lineFingerprintSet(linuxAbs);
    const macInLinux = [...macSet].filter(l => linuxSet.has(l)).length;
    const linuxInMac = [...linuxSet].filter(l => macSet.has(l)).length;
    const macPct = macSet.size ? Math.round((macInLinux / macSet.size) * 1000) / 10 : 0;
    const linuxPct = linuxSet.size ? Math.round((linuxInMac / linuxSet.size) * 1000) / 10 : 0;
    rows.push({ handler, mac: macSet.size, linux: linuxSet.size, macPct, linuxPct });
    totalMac += macSet.size;
    totalLinux += linuxSet.size;
  }

  console.log(
    '| handler | mac 实质行 | linux 实质行 | mac 行在 linux 出现率 | linux 行在 mac 出现率 |'
  );
  console.log('|---------|-----------|-------------|---------------------|---------------------|');
  for (const r of rows) {
    console.log(`| ${r.handler} | ${r.mac} | ${r.linux} | ${r.macPct}% | ${r.linuxPct}% |`);
  }
  console.log(`\n合计实质行：mac ${totalMac} / linux ${totalLinux}`);
  console.log('说明：比例越接近 100% 说明两平台重复越严重，单源化收益越大。\n');
}

function main() {
  if (isReport && isCheck) {
    warn(
      '--report 与 --check 同时指定，优先执行 --report（本次不进行漂移校验）；如要校验请仅用 --check'
    );
  }
  if (isReport) {
    runReport();
    return;
  }
  if (!fs.existsSync(SHARED_DIR)) {
    warn('共享目录不存在: ' + SHARED_DIR);
    process.exit(1);
  }

  // 1. 逐字节复制的共享文件
  const copyFiles = [
    { shared: 'response.js', platform: 'utils/response.js' },
    { shared: 'registry.js', platform: 'handlers/registry.js' },
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
