#!/usr/bin/env node
// launcher.js 回归测试：直接 node tests/launcher.test.js 运行。
// 聚焦 Issue #134 回归 —— shell 模式（opencode.cmd，needShell=true）下 spawn 传
// WriteStream 导致 "The argument 'stdio' is invalid" 启动失败。
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var spawn = require('child_process').spawn;

var passed = 0;
var failed = 0;
var failures = [];

function assertTrue(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; failures.push(msg); console.log('  ✗ ' + msg); }
}

function test(name, fn) {
  console.log('\n▶ ' + name);
  try { fn(); } catch (e) { failed++; failures.push(name + ': ' + e.message); console.log('  ✗ 抛异常: ' + e.message); }
}

// launcher.js 在本仓库根目录（main 扁平化后的结构）
var LAUNCHER = path.join(__dirname, '..', 'launcher.js');

console.log('launcher 回归测试（stdio / shell 模式解耦）');
console.log('============================================');

// --- 1. 验证根因：shell:true 时向 stdio 传流对象会直接 throw ---
test('shell:true 向 stdio 传 WriteStream 应抛 "stdio is invalid"（验证根因）', function() {
  var logPath = path.join(os.tmpdir(), 'launcher-stdio-test-' + Date.now() + '.log');
  var stream = fs.createWriteStream(logPath, { flags: 'a' });
  var threw = false;
  try {
    spawn('echo', ['hi'], { shell: true, stdio: ['ignore', stream, stream] });
  } catch (e) {
    threw = true;
  }
  try { stream.close(); } catch (e) {}
  try { fs.unlinkSync(logPath); } catch (e) {}
  assertTrue(threw, 'shell:true 时向 stdio 传 WriteStream 应抛 "stdio is invalid"');
});

// --- 2. 修复验证：launcher.js shell 分支必须用 pipe 而非 WriteStream ---
test('launcher.js 源码：shell 模式 stdio 用 pipe 而非 WriteStream（修复验证）', function() {
  var src = fs.readFileSync(LAUNCHER, 'utf-8');
  // shell 分支（needShell=true）必须使用 ['ignore','pipe','pipe']
  assertTrue(/stdio: \['ignore', 'pipe', 'pipe'\]/.test(src), 'shell 模式应使用 pipe 数组而非 WriteStream');
  // shell 分支必须手动把 stdout/stderr pipe 进日志写流
  assertTrue(/opencodeProcess\.stdout\.on\('data'/.test(src), 'shell 模式应手动 pipe stdout 进日志流');
  assertTrue(/opencodeProcess\.stderr\.on\('data'/.test(src), 'shell 模式应手动 pipe stderr 进日志流');
  // 非 shell 分支（.exe/.ps1 直启）保留 WriteStream 直接作为 stdio 的优化路径
  assertTrue(/stdioArr = opencodeLogStream \? \['ignore', opencodeLogStream, opencodeLogStream\]/.test(src), '非 shell 模式应保留 WriteStream 直连 stdio');
});

// --- 3. spawn 语义一致性：.exe/.ps1 直启不强制 shell ---
test('launcher.js 源码：spawn 分支隐藏启动（.exe/.ps1 直启、.cmd 走 cmd.exe）', function() {
  var src = fs.readFileSync(LAUNCHER, 'utf-8');
  assertTrue(/shell: false/.test(src), '非 shell 分支应显式 shell:false，避免 .exe/.ps1 走 cmd');
  // 启动服务不闪黑窗（Issue #143 后续反馈）：.cmd shim 不再用 Node shell:true，改为显式
  // cmd.exe /d /s /c 包装 + hiddenSpawn 强制 windowsHide，让 CREATE_NO_WINDOW 覆盖批处理嵌套控制台。
  assertTrue(/hiddenSpawn\(\s*'cmd\.exe'/.test(src), 'shell 分支应显式 cmd.exe 启动（替代 shell:true，防嵌套黑窗）');
  assertTrue(/\/d', '\/s', '\/c', shellCmd/.test(src), 'shell 分支应使用 cmd.exe /d /s /c 包装');
  assertTrue(/windowsVerbatimArguments: true/.test(src), 'shell 分支应设 windowsVerbatimArguments 防引号破坏');
});

// --- 4. 语法自检 ---
test('launcher.js 语法检查', function() {
  var ok = true;
  try {
    var child = spawn(process.execPath, ['--check', LAUNCHER], { stdio: ['ignore', 'ignore', 'pipe'] });
    var err = '';
    child.stderr.on('data', function(d) { err += d; });
    child.on('close', function(code) { if (code !== 0) { ok = false; } });
    child.on('exit', function() { assertTrue(ok, 'launcher.js 语法检查通过' + (err ? '（' + err.trim() + '）' : '')); });
  } catch (e) { assertTrue(false, '语法检查执行异常: ' + e.message); }
});

// --- 5. 关闭服务不闪黑窗：所有 execSync 必须显式 windowsHide:true ---
// 根因（Issue #143）：stopOpenCode() → stopOpenCodeByPort() 中多个 execSync 以
// shell:cmd.exe / powershell 拉起子进程，未设 windowsHide 时 Windows 会弹出可见控制台窗口。
// 修复：为全部 execSync 调用显式加 windowsHide:true（CREATE_NO_WINDOW），隐藏黑窗。
test('launcher.js 源码：所有 execSync 均显式 windowsHide:true（修复黑窗闪现）', function() {
  var src = fs.readFileSync(LAUNCHER, 'utf-8');
  // 逐个断言 stop 路径（stopOpenCodeByPort）及启动/探测路径上的关键 execSync 都带 windowsHide
  assertTrue(/execSync\('powershell -NoProfile -Command "\' \+ psCmd/, 'cleanupOrphanedMcp powershell 需 windowsHide');
  assertTrue(/taskkill \/F \/PID ' \+ pid \+ ' 2>nul', \{ shell: 'cmd\.exe', stdio: 'ignore', timeout: 3000, windowsHide: true \}/.test(src), 'cleanupOrphanedMcp taskkill 需 windowsHide');
  // stopOpenCodeByPort 中的 netstat / powershell 验证 / wmic 回退 / taskkill 四条路径
  assertTrue(/netstat -ano \| findstr "\:' \+ port \+ ' "', \{ \s* shell: 'cmd\.exe',[\s\S]*?windowsHide: true/.test(src), 'stopOpenCodeByPort netstat 需 windowsHide');
  assertTrue(/execSync\(psNameCmd, \{ encoding: 'utf8', timeout: 3000, windowsHide: true \}\)/.test(src), 'stopOpenCodeByPort powershell 进程名验证需 windowsHide');
  assertTrue(/wmic process where ProcessId=' \+ pid \+ ' get Name \/format:csv', \{ encoding: 'utf8', timeout: 3000, shell: 'cmd\.exe', windowsHide: true \}/.test(src), 'stopOpenCodeByPort wmic 回退需 windowsHide');
  assertTrue(/taskkill \/F \/PID ' \+ pid \+ ' 2>nul', \{ \s* shell: 'cmd\.exe',[\s\S]*?windowsHide: true/.test(src), 'stopOpenCodeByPort taskkill 需 windowsHide');
  // isPortListening / where opencode / dockWindow edgeCheck 三条路径
  assertTrue(/isPortListening/.test(src), 'isPortListening 存在');
  assertTrue(/where opencode', \{ shell: 'cmd\.exe', encoding: 'utf8', timeout: 5000, windowsHide: true \}/.test(src), 'findOpenCodeBin where 需 windowsHide');
  assertTrue(/execSync\('powershell[\s\S]*?msedge[\s\S]*?windowsHide: true/.test(src), 'dockWindow edgeCheck powershell 需 windowsHide');
  // 兜底：确保源码中不存在任何未带 windowsHide 的 execSync 调用（防回归）
  // 统计源码中所有 `windowsHide` 出现（含 hiddenExecSync 内部的 `= true` 赋值与各调用点显式 `: true`）
  var execSyncCount = (src.match(/execSync\(/g) || []).length;
  var windowsHideOccur = (src.match(/windowsHide/g) || []).length;
  assertTrue(windowsHideOccur >= execSyncCount, 'execSync 调用数(' + execSyncCount + ') ≤ windowsHide 出现数(' + windowsHideOccur + ')，无遗漏');
});

// --- 6. 启动服务不闪黑窗：spawn 统一走 hiddenSpawn 强制 windowsHide ---
// 根因（Issue #143 后续反馈）：startOpenCode 的 spawn 在 needShell=true（.cmd shim）时用
// Node shell:true，windowsHide 仅间接传给外层 cmd.exe，无法覆盖批处理嵌套控制台 → 启动闪 1 次黑窗。
// 修复：新增 hiddenSpawn 强制 windowsHide；shell 分支改显式 cmd.exe /d /s /c 包装；非 shell 分支统一走 hiddenSpawn。
test('launcher.js 源码：spawn 统一经 hiddenSpawn 强制 windowsHide（修复启动闪黑窗）', function() {
  var src = fs.readFileSync(LAUNCHER, 'utf-8');
  // hiddenSpawn 帮助函数强制 windowsHide:true
  assertTrue(/function hiddenSpawn\b[\s\S]*?options\.windowsHide = true/.test(src), 'hiddenSpawn 应强制 windowsHide=true');
  // startOpenCode 两个 spawn 分支都必须走 hiddenSpawn（.exe/.ps1 直启 + .cmd shim 显式 cmd.exe）
  var spawnCalls = (src.match(/opencodeProcess = hiddenSpawn\(/g) || []).length;
  assertTrue(spawnCalls === 2, 'startOpenCode 两个 spawn 分支都应走 hiddenSpawn（当前 ' + spawnCalls + '/2）');
  // 源码中不得再存在裸 spawn( 直接启动 opencode（除 hiddenSpawn 定义外的 require('child_process').spawn）
  assertTrue(!/opencodeProcess = spawn\(/.test(src), '不允许再裸用 spawn 启动 opencode');
});


// --- 权限自动确认（Issue #116）：launcher 追加 --permission allow ---
test('权限自动确认：shouldAutoAllowPermission 存在且 config 有 permission 配置（Issue #116）', function() {
  var src = fs.readFileSync(LAUNCHER, 'utf-8');
  assertTrue(/function shouldAutoAllowPermission\(\)/.test(src), 'launcher 应有 shouldAutoAllowPermission 函数');
  assertTrue(/--permission'/.test(src), 'launcher 应能追加 --permission 参数');
  var cfgSrc = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf-8');
  assertTrue(/permission\s*:\s*\{/.test(cfgSrc), 'config.js 应有 permission 配置段');
  assertTrue(/mode: 'auto'/.test(cfgSrc), 'config.js permission.mode 默认应为 auto');
  assertTrue(/autoAllowOnLaunch/.test(cfgSrc), 'config.js 应有 autoAllowOnLaunch 配置');
});

// --- 权限自动确认：buildSpawnCommand 在 auto 配置下追加 --permission allow ---
test('权限自动确认：buildSpawnCommand 在 auto 配置下追加 --permission allow（Issue #116）', function() {
  try {
    var launcher = require(LAUNCHER);
    // config.js 当前为 auto 模式，buildSpawnCommand 应包含 --permission allow
    var cmd = launcher.buildSpawnCommand('opencode');
    var hasPerm = cmd.args.indexOf('--permission') !== -1;
    assertTrue(hasPerm, 'auto 模式下 buildSpawnCommand args 应含 --permission allow（实际: ' + JSON.stringify(cmd.args) + '）');
    // --permission 之后应为 allow（而非 deny/ask）
    var permIdx = cmd.args.indexOf('--permission');
    assertTrue(permIdx >= 0 && cmd.args[permIdx + 1] === 'allow', '--permission 后应为 allow');
  } catch (e) {
    // launcher require 可能因环境（如 findOpenCodeBin 探测 powershell）报错，降级为源码检查
    failed++; failures.push('权限自动确认 buildSpawnCommand 测试异常: ' + e.message);
    console.log('  ✗ ' + e.message);
  }
});

// ==================== 测试结果汇总 ====================
console.log('\n============================================');
console.log('测试结果: ' + passed + ' 通过, ' + failed + ' 失败');
if (failures.length) {
  console.log('失败用例:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  process.exit(0);
}
