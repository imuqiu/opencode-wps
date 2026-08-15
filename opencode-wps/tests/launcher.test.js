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
test('launcher.js 源码：非 shell 模式 spawn 使用 shell:false', function() {
  var src = fs.readFileSync(LAUNCHER, 'utf-8');
  assertTrue(/shell: false/.test(src), '非 shell 分支应显式 shell:false，避免 .exe/.ps1 走 cmd');
  assertTrue(/shell: true/.test(src), 'shell 分支应显式 shell:true，保证 .cmd 可被启动');
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
