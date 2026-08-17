/**
 * Launcher 测试套件
 * 测试 Launcher 的路径查找、进程管理等功能
 * 直接 require ../opencode-wps/launcher.js 的真实实现（评审建议 #2：避免本地副本与交付代码脱节）。
 */

var path = require('path');
var fs = require('fs');

// ==================== 加载真实 Launcher 实现 ====================
// launcher.js 通过 require.main === module 保护，被 require 时不会启动 HTTP 服务，
// 仅暴露纯函数（findOpenCodeBin/findOpenCodeInDir/getOpenCodeBinDirs/loadOpenCodeConfig/validateCwd/isPortListening）。
var launcher = require(path.join(__dirname, '..', 'opencode-wps', 'launcher.js'));

var findOpenCodeInDir = launcher.findOpenCodeInDir;
var getOpenCodeBinDirs = launcher.getOpenCodeBinDirs;
var findOpenCodeBin = launcher.findOpenCodeBin;
var parseWhereOutput = launcher.parseWhereOutput;
var buildSpawnCommand = launcher.buildSpawnCommand;
var getDiagInfo = launcher.getDiagInfo;
var configPathUsed = launcher.configPathUsed;
var validateCwd = launcher.validateCwd;

// 进程管理（模拟）
var mockChildProcess = null;
var mockPidFile = path.join(__dirname, 'test.pid');

function startOpenCodeMock(cwd) {
  // 模拟启动，返回 PID
  var mockPid = Math.floor(Math.random() * 10000) + 1000;
  fs.writeFileSync(mockPidFile, mockPid.toString());
  return { pid: mockPid, cwd: cwd };
}

function stopOpenCodeMock() {
  if (fs.existsSync(mockPidFile)) {
    var pid = parseInt(fs.readFileSync(mockPidFile, 'utf-8'));
    fs.unlinkSync(mockPidFile);
    return { killed: true, pid: pid };
  }
  return { killed: false };
}

function getOpenCodePid() {
  if (fs.existsSync(mockPidFile)) {
    return parseInt(fs.readFileSync(mockPidFile, 'utf-8'));
  }
  return null;
}

// ==================== 测试用例 ====================

var testResults = [];
var testCount = 0;
var passCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    testResults.push({ name: name, status: 'PASS' });
    console.log('✓ ' + name);
  } catch (e) {
    testResults.push({ name: name, status: 'FAIL', error: e.message });
    console.log('✗ ' + name + ': ' + e.message);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg + ' - expected: ' + expected + ', actual: ' + actual);
  }
}

function assertTrue(actual, msg) {
  if (!actual) throw new Error(msg + ' - expected true');
}

function assertFalse(actual, msg) {
  if (actual) throw new Error(msg + ' - expected false');
}

function assertNotNull(actual, msg) {
  if (actual === null || actual === undefined) {
    throw new Error(msg + ' - expected not null');
  }
}

console.log('\n========== Launcher 测试套件（真实实现） ==========\n');

// --- 1. 路径查找测试（真实 findOpenCodeInDir / getOpenCodeBinDirs / findOpenCodeBin）---
console.log('--- 路径查找测试 ---');

test('findOpenCodeInDir: 识别 .trae-cn 下的 opencode.ps1（Issue #134 实测形态）', function () {
  var binDir = path.join(__dirname, 'fakehome');
  fs.mkdirSync(binDir, { recursive: true });
  var ps1 = path.join(binDir, 'opencode.ps1');
  fs.writeFileSync(ps1, '# fake ps1\n');
  try {
    var result = findOpenCodeInDir(binDir);
    assertEqual(path.basename(result), 'opencode.ps1', '应命中 .ps1');
    assertEqual(path.dirname(result), binDir, '应返回所在目录');
  } finally {
    fs.unlinkSync(ps1);
    try {
      fs.rmdirSync(binDir, { recursive: true });
    } catch (e) {}
  }
});

test('findOpenCodeInDir: 目录下同时有 .exe 时优先 .exe（其次 .cmd/.ps1）', function () {
  var binDir = path.join(__dirname, 'fakehome2');
  fs.mkdirSync(binDir, { recursive: true });
  var exe = path.join(binDir, 'opencode.exe');
  var cmd = path.join(binDir, 'opencode.cmd');
  var ps1 = path.join(binDir, 'opencode.ps1');
  fs.writeFileSync(exe, '\x00');
  fs.writeFileSync(cmd, '@echo off');
  fs.writeFileSync(ps1, 'x');
  try {
    assertEqual(path.basename(findOpenCodeInDir(binDir)), 'opencode.exe', '应优先 .exe');
    fs.unlinkSync(exe);
    assertEqual(
      path.basename(findOpenCodeInDir(binDir)),
      'opencode.cmd',
      '无 .exe 时应退而取 .cmd'
    );
    fs.unlinkSync(cmd);
    assertEqual(
      path.basename(findOpenCodeInDir(binDir)),
      'opencode.ps1',
      '仅剩 .ps1 时应命中 .ps1'
    );
  } finally {
    try {
      fs.unlinkSync(exe);
    } catch (e) {}
    try {
      fs.unlinkSync(cmd);
    } catch (e) {}
    try {
      fs.unlinkSync(ps1);
    } catch (e) {}
    try {
      fs.rmdirSync(binDir, { recursive: true });
    } catch (e) {}
  }
});

test('findOpenCodeInDir: 目录为空或不存在时返回 null', function () {
  assertEqual(findOpenCodeInDir(null), null, 'null 目录应返回 null');
  assertEqual(findOpenCodeInDir(''), null, '空目录应返回 null');
  assertEqual(findOpenCodeInDir(123), null, '非字符串应返回 null');
  var missing = path.join(__dirname, 'no_such_dir_xyz');
  assertEqual(findOpenCodeInDir(missing), null, '不存在的目录应返回 null');
});

test('getOpenCodeBinDirs: 覆盖 .trae-cn/npm/Program Files 常见目录且去重', function () {
  var dirs = getOpenCodeBinDirs();
  assertTrue(Array.isArray(dirs), '应返回数组');
  assertTrue(dirs.length >= 7, '至少包含 7 个候选目录');
  // 关键目录必须覆盖
  var joined = dirs.join('\n');
  assertTrue(
    /\.trae-cn[\\/]sdks[\\/]versions[\\/]node[\\/]current/.test(joined),
    '应包含 Trae node 的 current bin 目录'
  );
  assertTrue(/\.trae-cn[\\/]bin/.test(joined), '应包含 .trae-cn/bin');
  assertTrue(/npm/.test(joined), '应包含 npm 全局 bin');
  assertTrue(/Programs[\\/]opencode/.test(joined), '应包含 opencode 官方安装目录');
  // 去重校验
  var lower = dirs.map(function (d) {
    return d.toLowerCase();
  });
  assertEqual(new Set(lower).size, dirs.length, '候选目录不应有重复');
});

test('findOpenCodeBin: 返回有效路径字符串（冒烟）', function () {
  var result = findOpenCodeBin();
  assertNotNull(result, '应返回路径');
  assertTrue(typeof result === 'string' && result.length > 0, '应返回非空字符串');
});

// --- step 3 `where opencode` 输出解析（评审建议：补单测拦截 .cmd 正则 bug）---
console.log('\n--- where 输出解析（parseWhereOutput）---');

test('parseWhereOutput: 命中 .cmd 路径（回归 Issue #134 / 评审 bug）', function () {
  var out = 'C:\\Users\\Administrator\\.trae-cn\\sdks\\versions\\node\\current\\opencode.cmd';
  assertEqual(parseWhereOutput(out), out, '应识别 .cmd 绝对路径（\\.cmd 正则不再误配）');
});

test('parseWhereOutput: 命中 .ps1 / .exe 路径', function () {
  assertEqual(
    parseWhereOutput('D:\\tools\\opencode.ps1'),
    'D:\\tools\\opencode.ps1',
    '应识别 .ps1'
  );
  assertEqual(parseWhereOutput('C:\\npm\\opencode.exe'), 'C:\\npm\\opencode.exe', '应识别 .exe');
});

test('parseWhereOutput: 多行输出取第一个命中的 opencode', function () {
  var out = 'C:\\a\\some_other.exe\r\nC:\\b\\opencode.cmd\r\nC:\\c\\opencode.ps1';
  assertEqual(
    parseWhereOutput(out),
    'C:\\b\\opencode.cmd',
    '应跳过无关行、取第一个命中的 opencode'
  );
});

test('parseWhereOutput: 未命中/空输入返回 null', function () {
  assertEqual(parseWhereOutput(null), null, 'null 应返回 null');
  assertEqual(parseWhereOutput(''), null, '空串应返回 null');
  assertEqual(parseWhereOutput('C:\\a\\other.exe'), null, '不含 opencode 的路径应返回 null');
  assertEqual(parseWhereOutput('C:\\a\\opencode.txt'), null, '非 .exe/.cmd/.ps1 扩展名应返回 null');
});

test('parseWhereOutput: 收紧正则拒绝相邻文件误命中（评审建议）', function () {
  // 仅文件名精确为 opencode.<ext> 才命中，避免误收 opencodehelper.exe / opencode-tool.cmd
  assertEqual(parseWhereOutput('C:\\bin\\opencodehelper.exe'), null, 'opencodehelper.exe 不应命中');
  assertEqual(parseWhereOutput('C:\\bin\\opencode-tool.cmd'), null, 'opencode-tool.cmd 不应命中');
  assertEqual(parseWhereOutput('C:\\bin\\my-opencode.bin'), null, 'my-opencode.bin 不应命中');
  assertEqual(
    parseWhereOutput('C:\\bin\\opencode.exe'),
    'C:\\bin\\opencode.exe',
    '精确 opencode.exe 应命中'
  );
});

// --- buildSpawnCommand：spawn 命令预览（GET /diag 自检）---
console.log('\n--- spawn 命令构造（buildSpawnCommand）---');

test('buildSpawnCommand: .ps1 → powershell.exe -File（脱离运行期 PATH，Issue #134）', function () {
  var r = buildSpawnCommand('C:\\bin\\opencode.ps1');
  assertEqual(r.command, 'powershell.exe', '.ps1 应由 powershell.exe 拉起');
  assertTrue(r.args.indexOf('-ExecutionPolicy') !== -1, '应带 -ExecutionPolicy');
  assertEqual(
    r.args[r.args.indexOf('-File') + 1],
    'C:\\bin\\opencode.ps1',
    '-File 后应为 ps1 绝对路径'
  );
  assertEqual(r.needShell, false, '.ps1 不需要 shell');
  assertTrue(r.args.indexOf('serve') !== -1, '应含 serve 子命令');
});

test('buildSpawnCommand: .exe → 直接执行，无需 shell', function () {
  var r = buildSpawnCommand('C:\\bin\\opencode.exe');
  assertEqual(r.command, 'C:\\bin\\opencode.exe', '.exe 应直接作为 command');
  assertEqual(r.needShell, false, '.exe 不需要 shell');
  assertTrue(r.args.indexOf('--port') !== -1, '应含 --port');
});

test('buildSpawnCommand: 无扩展名（PATH 裸 opencode）→ 依赖 shell 启动 .cmd shim', function () {
  var r = buildSpawnCommand('opencode');
  assertEqual(r.command, 'opencode', '裸 opencode 作为 command');
  assertEqual(r.needShell, true, '无扩展名需要 shell 启动 .cmd shim');
});

test('buildSpawnCommand: 空值默认回退裸 opencode', function () {
  var r = buildSpawnCommand(null);
  assertEqual(r.command, 'opencode', '空值应回退裸 opencode');
});

// --- getDiagInfo / configPathUsed：GET /diag 自检 ---
console.log('\n--- 诊断信息（getDiagInfo / configPathUsed）---');

test('getDiagInfo: 返回关键字段且结构稳定', function () {
  var info = getDiagInfo();
  assertNotNull(info.opencodeBin, '应包含 opencodeBin');
  assertTrue(
    typeof info.opencodeBin === 'string' && info.opencodeBin.length > 0,
    'opencodeBin 应为非空字符串'
  );
  assertTrue(typeof info.logFile === 'string' && info.logFile.length > 0, 'logFile 应为非空字符串');
  assertTrue(typeof info.logExists === 'boolean', 'logExists 应为布尔');
  assertTrue(typeof info.logSize === 'number' && info.logSize >= 0, 'logSize 应为非负数字');
  assertTrue(typeof info.homedir === 'string' && info.homedir.length > 0, 'homedir 应为非空字符串');
  assertTrue('userprofile' in info, '应包含 userprofile 字段');
  assertTrue(
    typeof info.spawnCommand === 'string' && info.spawnCommand.length > 0,
    'spawnCommand 应为非空字符串'
  );
  assertNotNull(info.config, '应包含 config 信息');
});

test('getDiagInfo: spawnCommand 与 buildSpawnCommand 一致', function () {
  var info = getDiagInfo();
  var cmd = buildSpawnCommand(info.opencodeBin);
  var expected = cmd.needShell
    ? cmd.command + ' ' + cmd.args.join(' ')
    : (cmd.command === 'powershell.exe' ? 'powershell.exe ' : '') + cmd.args.join(' ');
  assertEqual(info.spawnCommand, expected, 'spawnCommand 应与 buildSpawnCommand 输出一致');
});

test('configPathUsed: 返回字符串或 null（不抛错）', function () {
  var p = configPathUsed();
  if (p !== null) {
    assertTrue(typeof p === 'string' && p.length > 0, '应为非空字符串');
  }
});

// --- 2. cwd 验证测试（真实 validateCwd）---
console.log('\n--- cwd 验证测试 ---');

test('validateCwd: 合法 Windows 路径', function () {
  var result = validateCwd('D:\\project\\myapp');
  assertTrue(result.valid, '应返回有效');
  assertNotNull(result.resolved, '应返回规范化路径');
});

test('validateCwd: 合法 Unix 路径', function () {
  var result = validateCwd('/home/user/project');
  assertTrue(result.valid, '应返回有效');
});

test('validateCwd: 空值', function () {
  var result = validateCwd('');
  assertFalse(result.valid, '应返回无效');
  assertEqual(result.error, 'cwd 不能为空');
});

test('validateCwd: 路径遍历尝试', function () {
  var result = validateCwd('C:\\Users\\test\\..\\Windows');
  assertFalse(result.valid, '应返回无效');
  assertTrue(result.error.includes('路径遍历'), '应提示路径遍历');
});

test('validateCwd: 非法字符', function () {
  var result = validateCwd('C:\\test|path');
  assertFalse(result.valid, '应返回无效');
  assertTrue(result.error.includes('非法字符'), '应提示非法字符');
});

test('validateCwd: 相对路径', function () {
  var result = validateCwd('./project');
  assertTrue(result.valid, '相对路径应有效');
});

// --- 3. 进程管理测试 ---
console.log('\n--- 进程管理测试 ---');

test('startOpenCodeMock: 启动并记录 PID', function () {
  var result = startOpenCodeMock('D:\\test');
  assertNotNull(result.pid, '应返回 PID');
  assertEqual(result.cwd, 'D:\\test', '应保存 cwd');
  var savedPid = getOpenCodePid();
  assertEqual(savedPid, result.pid, 'PID 应已保存');
});

test('stopOpenCodeMock: 终止进程并清理', function () {
  startOpenCodeMock('D:\\test');
  var result = stopOpenCodeMock();
  assertTrue(result.killed, '应返回已终止');
  var savedPid = getOpenCodePid();
  assertTrue(savedPid === null, 'PID 文件应已删除');
});

test('getOpenCodePid: 无 PID 文件', function () {
  try {
    fs.unlinkSync(mockPidFile);
  } catch (e) {}
  var pid = getOpenCodePid();
  assertTrue(pid === null, '无文件时应返回 null');
});

// --- 4. 边界情况测试 ---
console.log('\n--- 边界情况测试 ---');

test('validateCwd: 特殊路径', function () {
  var result = validateCwd('C:\\');
  assertTrue(result.valid, '根目录应有效');
});

test('validateCwd: 带空格的路径', function () {
  var result = validateCwd('C:\\Program Files\\App');
  assertTrue(result.valid, '带空格的路径应有效');
});

test('validateCwd: 中文路径', function () {
  var result = validateCwd('D:\\我的文档\\项目');
  assertTrue(result.valid, '中文路径应有效');
});

// --- 4. /status 状态判定：端口回退逻辑（Issue #114 回归） ---
test('/status: 存在 isPortListening 端口回退探测（launcher 重启后仍能识别运行中的服务）', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'opencode-wps', 'launcher.js'), 'utf-8');
  // isPortListening 函数存在
  assertTrue(/function isPortListening\s*\(/.test(src), '应定义 isPortListening 函数');
  // /status 中 opencodeProcess 为 null 时回退探测端口（portOpen 源），running 复用 portOpen
  assertTrue(
    /portOpen = running \? true : isPortListening\(OPENCODE_PORT\)/.test(src),
    '/status 应通过 portOpen 回退探测端口'
  );
  assertTrue(
    /running = portOpen;/.test(src),
    '/status 中 running 应复用 portOpen（避免重复 netstat）'
  );
  // 暴露 portOpen 字段供前端多源交叉验证
  assertTrue(/portOpen: portOpen/.test(src), '/status 应暴露 portOpen 字段');
  // OPENCODE_PORT 常量已定义
  assertTrue(/const OPENCODE_PORT = 14096;/.test(src), '应定义 OPENCODE_PORT=14096 常量');
});

// ==================== 测试结果汇总 ====================

console.log('\n========== 测试结果 ==========');
console.log('总计: ' + testCount + ' 个测试');
console.log('通过: ' + passCount + ' 个');
console.log('失败: ' + (testCount - passCount) + ' 个');

if (passCount === testCount) {
  console.log('\n✓ 所有 Launcher 测试通过!\n');
  process.exit(0);
} else {
  console.log('\n✗ 部分测试失败!\n');
  process.exit(1);
}
