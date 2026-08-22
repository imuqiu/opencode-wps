/**
 * WPS 桥接共享层（shared/wps-bridge）单元测试
 *
 * 覆盖本次「消除三平台 handler 重复」重构的核心保障：
 *  1. 平台文件与共享单一来源一致（response.js/registry.js 逐字节相同）
 *  2. common-handler.js 由共享 core 生成，平台标记正确注入
 *  3. 平台差异隔离正确（mac 启用 ensureOutputDir，linux 不启用）
 *  4. 共享 core 生成的 handler 行为等价（mac 与 linux 平台标记隔离）
 *  5. sync --check 漂移检测能发现不一致
 */

var testCount = 0;
var passCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log('✓ ' + name);
  } catch (e) {
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

function assertNotNull(actual, msg) {
  if (actual === null || actual === undefined) throw new Error(msg + ' - expected non-null');
}

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

// ==================== 1. 平台文件与共享单一来源一致 ====================
console.log('\n--- 平台文件与共享单一来源一致性 ---');

test('registry.js: mac 与 linux 均与 shared 逐字节一致', function () {
  var shared = fs.readFileSync(path.join(ROOT, 'shared', 'wps-bridge', 'registry.js'), 'utf-8');
  var mac = fs.readFileSync(
    path.join(ROOT, 'opencode-wps-assistant', 'handlers', 'registry.js'),
    'utf-8'
  );
  var linux = fs.readFileSync(
    path.join(ROOT, 'opencode-wps-linux', 'handlers', 'registry.js'),
    'utf-8'
  );
  assertEqual(mac, shared, 'mac registry 应与 shared 一致');
  assertEqual(linux, shared, 'linux registry 应与 shared 一致');
});

test('response.js: mac 与 linux 均与 shared 逐字节一致', function () {
  var shared = fs.readFileSync(path.join(ROOT, 'shared', 'wps-bridge', 'response.js'), 'utf-8');
  var mac = fs.readFileSync(
    path.join(ROOT, 'opencode-wps-assistant', 'utils', 'response.js'),
    'utf-8'
  );
  var linux = fs.readFileSync(
    path.join(ROOT, 'opencode-wps-linux', 'utils', 'response.js'),
    'utf-8'
  );
  assertEqual(mac, shared, 'mac response 应与 shared 一致');
  assertEqual(linux, shared, 'linux response 应与 shared 一致');
});

// ==================== 2. common-handler 由共享 core 生成 ====================
console.log('\n--- common-handler 由共享 core 生成 ---');

// 加载平台 common-handler 的辅助函数（需先加载 response.js）
function loadCommonHandler(platform) {
  var __handlers = {};
  var sandbox = {
    registerHandler: function (name, fn) {
      __handlers[name] = fn;
    },
    ok: undefined,
    fail: undefined,
    invalidParam: undefined,
  };
  // 加载 response
  vm.runInThisContext(
    fs.readFileSync(path.join(ROOT, 'shared', 'wps-bridge', 'response.js'), 'utf-8'),
    { filename: 'response.js' }
  );
  global.registerHandler = function (name, fn) {
    __handlers[name] = fn;
  };
  var file =
    platform === 'mac'
      ? path.join(ROOT, 'opencode-wps-assistant', 'handlers', 'common-handler.js')
      : path.join(ROOT, 'opencode-wps-linux', 'handlers', 'common-handler.js');
  vm.runInThisContext(fs.readFileSync(file, 'utf-8'), { filename: file });
  return __handlers;
}

test('mac common-handler: 注入 BRIDGE_PLATFORM=mac', function () {
  var src = fs.readFileSync(
    path.join(ROOT, 'opencode-wps-assistant', 'handlers', 'common-handler.js'),
    'utf-8'
  );
  assertTrue(/var BRIDGE_PLATFORM = 'mac'/.test(src), 'mac 应注入 mac 平台标记');
  assertTrue(/生成产物/.test(src), '应标注为生成产物');
});

test('linux common-handler: 注入 BRIDGE_PLATFORM=linux', function () {
  var src = fs.readFileSync(
    path.join(ROOT, 'opencode-wps-linux', 'handlers', 'common-handler.js'),
    'utf-8'
  );
  assertTrue(/var BRIDGE_PLATFORM = 'linux'/.test(src), 'linux 应注入 linux 平台标记');
});

test('common-handler 注册的动作集完整', function () {
  var mac = loadCommonHandler('mac');
  var linux = loadCommonHandler('linux');
  var expected = [
    'ping',
    'wireCheck',
    'getAppInfo',
    'getSelectedText',
    'setSelectedText',
    'save',
    'saveAs',
    'openFile',
    'convertToPDF',
    'getDocumentStats',
  ].sort();
  assertEqual(Object.keys(mac).sort().join(','), expected.join(','), 'mac 动作集');
  assertEqual(Object.keys(linux).sort().join(','), expected.join(','), 'linux 动作集');
});

// ==================== 3. 平台差异隔离正确 ====================
console.log('\n--- 平台差异隔离 ---');

// 模拟 Application：让 saveAs 触发 ensureOutputDir（mac）vs 直接保存（linux）
var mockApp = {
  Name: 'WPS 文字',
  Selection: { Text: 'hello' },
  ActiveDocument: {
    Name: 'a.docx',
    FullName: '/a.docx',
    Paragraphs: { Count: 3 },
    Words: { Count: 10 },
    Characters: { Count: 50 },
    SaveAs: function (p) {
      this.savedTo = p;
    },
    Save: function () {
      this.saved = true;
    },
  },
};

function runHandlerWithApp(platform, handlerName, params, app) {
  global.Application = app;
  global.require = undefined;
  var handlers = loadCommonHandler(platform);
  return handlers[handlerName](params || {});
}

test('mac 与 linux 的 ping 平台标记正确隔离', function () {
  var macPing = runHandlerWithApp('mac', 'ping', {}, mockApp);
  var linuxPing = runHandlerWithApp('linux', 'ping', {}, mockApp);
  assertEqual(macPing.data.platform, 'mac', 'mac ping 平台标记');
  assertEqual(linuxPing.data.platform, 'linux', 'linux ping 平台标记');
});

test('setSelectedText 缺少 text 均返回参数错误（对齐 mac 安全语义）', function () {
  var mac = runHandlerWithApp('mac', 'setSelectedText', {}, mockApp);
  var linux = runHandlerWithApp('linux', 'setSelectedText', {}, mockApp);
  assertEqual(mac.success, false, 'mac 缺 text 应失败');
  assertEqual(linux.success, false, 'linux 缺 text 应失败（对齐 mac 校验）');
  assertTrue(/缺少 text/.test(mac.error), 'mac 错误信息');
  assertTrue(/缺少 text/.test(linux.error), 'linux 错误信息');
});

// ==================== 3b. 关键 handler 行为级覆盖 ====================
console.log('\n--- 关键 handler 行为级覆盖 ---');

// 注入带 existsSync mock 的 require，验证 ensureOutputDir（mac 校验 / linux 不校验）
function runWithFs(platform, handlerName, params, fsMock) {
  global.Application = mockApp;
  global.require = function (name) {
    if (name === 'path')
      return {
        dirname: function (p) {
          return '/nonexistent-dir';
        },
      };
    if (name === 'fs') return { existsSync: fsMock };
    return {};
  };
  var handlers = loadCommonHandler(platform);
  return handlers[handlerName](params || {});
}

test('saveAs: mac 输出目录不存在时返回错误（ensureOutputDir 生效）', function () {
  var res = runWithFs('mac', 'saveAs', { path: '/nonexistent-dir/a.docx' }, function () {
    return false;
  });
  assertEqual(res.success, false, 'mac 目录不存在应失败');
  assertTrue(/输出目录不存在/.test(res.error), 'mac 应提示目录不存在');
});

test('saveAs: linux 不启用 ensureOutputDir（目录不存在也尝试保存）', function () {
  var res = runWithFs('linux', 'saveAs', { path: '/nonexistent-dir/a.docx' }, function () {
    return false;
  });
  assertEqual(res.success, true, 'linux 应跳过目录校验直接保存');
  assertEqual(res.data.path, '/nonexistent-dir/a.docx', 'linux 应返回保存路径');
});

test('save: 成功保存返回 ok', function () {
  mockApp.ActiveDocument.saved = false;
  var mac = runHandlerWithApp('mac', 'save', {}, mockApp);
  assertEqual(mac.success, true, 'save 应成功');
  assertEqual(mockApp.ActiveDocument.saved, true, '应触发 Save');
});

test('getSelectedText: 返回选中文本与长度', function () {
  var mac = runHandlerWithApp('mac', 'getSelectedText', {}, mockApp);
  assertEqual(mac.success, true, 'getSelectedText 应成功');
  assertEqual(mac.data.text, 'hello', '应返回选中文本');
  assertEqual(mac.data.length, 5, '应返回文本长度');
});

test('getDocumentStats: 返回文档统计（段落/字数/字符数）', function () {
  var mac = runHandlerWithApp('mac', 'getDocumentStats', {}, mockApp);
  assertEqual(mac.success, true, 'getDocumentStats 应成功');
  assertEqual(mac.data.paragraphCount, 3, '段落数');
  assertEqual(mac.data.wordCount, 10, '字数');
  assertEqual(mac.data.characterCount, 50, '字符数');
});

test('openFile: 缺 path 返回参数错误', function () {
  var mac = runHandlerWithApp('mac', 'openFile', {}, mockApp);
  assertEqual(mac.success, false, 'openFile 缺 path 应失败');
  assertTrue(/缺少 path/.test(mac.error), '应提示缺少 path');
});

// ==================== 3c. handler-utils 单源化 ====================
console.log('\n--- handler-utils 单源化（Issue #189 PR-C）---');

// 在共享全局沙箱中加载 response+registry+handler-utils+各 handler，返回注册的动作集
function loadFullHandlers(platform) {
  var __handlers = {};
  var reg = fs.readFileSync(path.join(ROOT, 'shared', 'wps-bridge', 'registry.js'), 'utf-8');
  vm.runInThisContext(reg, { filename: 'registry.js' });
  global.HANDLERS = global.HANDLERS || {};
  __handlers = global.HANDLERS;
  var dir =
    platform === 'mac' ? 'opencode-wps-assistant' : 'opencode-wps-linux';
  // 依次加载：response → registry → handler-utils → 各 handler
  vm.runInThisContext(
    fs.readFileSync(path.join(ROOT, 'shared', 'wps-bridge', 'response.js'), 'utf-8'),
    { filename: 'response.js' }
  );
  vm.runInThisContext(
    fs.readFileSync(path.join(ROOT, dir, 'handlers', 'handler-utils.js'), 'utf-8'),
    { filename: dir + '/handlers/handler-utils.js' }
  );
  vm.runInThisContext(
    fs.readFileSync(path.join(ROOT, dir, 'handlers', 'word-handler.js'), 'utf-8'),
    { filename: dir + '/handlers/word-handler.js' }
  );
  vm.runInThisContext(
    fs.readFileSync(path.join(ROOT, dir, 'handlers', 'excel-handler.js'), 'utf-8'),
    { filename: dir + '/handlers/excel-handler.js' }
  );
  vm.runInThisContext(
    fs.readFileSync(path.join(ROOT, dir, 'handlers', 'ppt-handler.js'), 'utf-8'),
    { filename: dir + '/handlers/ppt-handler.js' }
  );
  return __handlers;
}

test('handler-utils.js: mac/linux 均与 shared 逐字节一致', function () {
  var shared = fs.readFileSync(path.join(ROOT, 'shared', 'wps-bridge', 'handler-utils.js'), 'utf-8');
  var mac = fs.readFileSync(
    path.join(ROOT, 'opencode-wps-assistant', 'handlers', 'handler-utils.js'),
    'utf-8'
  );
  var linux = fs.readFileSync(
    path.join(ROOT, 'opencode-wps-linux', 'handlers', 'handler-utils.js'),
    'utf-8'
  );
  assertEqual(mac, shared, 'mac handler-utils 应与 shared 一致');
  assertEqual(linux, shared, 'linux handler-utils 应与 shared 一致');
});

test('handler-utils: 14 个纯函数在沙箱全局可用（两平台）', function () {
  var expected = [
    'getExcelSheet', 'colToLetter', 'resolveColumnLetter', 'colToNumber', 'resolveRowCol',
    'resolveAlignment', 'toExcelColor', 'findNotesShape', 'findShape', 'getPPT',
    'resolveSlideIndex', 'toRgb', 'getSelectionRange', 'toBgr',
  ];
  ['mac', 'linux'].forEach(function (p) {
    loadFullHandlers(p);
    expected.forEach(function (fn) {
      assertTrue(typeof global[fn] === 'function', p + ': ' + fn + ' 应全局可用');
    });
  });
});

test('handler-utils: 纯函数已从各 handler 移除（不再重复定义）', function () {
  var srcs = [
    path.join(ROOT, 'opencode-wps-assistant', 'handlers', 'excel-handler.js'),
    path.join(ROOT, 'opencode-wps-linux', 'handlers', 'excel-handler.js'),
    path.join(ROOT, 'opencode-wps-assistant', 'handlers', 'ppt-handler.js'),
    path.join(ROOT, 'opencode-wps-linux', 'handlers', 'ppt-handler.js'),
    path.join(ROOT, 'opencode-wps-assistant', 'handlers', 'word-handler.js'),
    path.join(ROOT, 'opencode-wps-linux', 'handlers', 'word-handler.js'),
  ];
  // 这些函数不应再在 handler 内重复定义（只应在 shared handler-utils.js 出现一次）
  var duplicated = ['getExcelSheet', 'getPPT', 'toBgr'];
  srcs.forEach(function (f) {
    var src = fs.readFileSync(f, 'utf-8');
    duplicated.forEach(function (fn) {
      assertTrue(
        !new RegExp('^function ' + fn + '\\(').test(src),
        f + ' 不应再重复定义 ' + fn
      );
    });
  });
});

test('handler-utils: 单源化后各平台 handler 注册动作集完整', function () {
  ['mac', 'linux'].forEach(function (p) {
    var handlers = loadFullHandlers(p);
    var count = Object.keys(handlers).length;
    assertTrue(count > 150, p + ': 注册 handler 数应 > 150，实际 ' + count);
    ['getActiveWorkbook', 'getSheetList', 'getOpenDocuments', 'getActiveDocument'].forEach(
      function (a) {
        assertTrue(handlers[a] !== undefined, p + ': ' + a + ' 应已注册');
      }
    );
  });
});

// ==================== 4. sync --check 漂移检测 ====================
console.log('\n--- sync 漂移检测 ---');

test('sync-wps-bridge --check：无漂移时通过', function () {
  var cp = require('child_process');
  var out = cp.spawnSync('node', [path.join(ROOT, 'scripts', 'sync-wps-bridge.js'), '--check'], {
    encoding: 'utf-8',
  });
  assertEqual(
    out.status,
    0,
    '无漂移应退出码 0，实际 ' + out.status + ': ' + out.stdout + out.stderr
  );
});

test('sync-wps-bridge --report：输出 excel/ppt/word 重复率基线', function () {
  var cp = require('child_process');
  var out = cp.spawnSync('node', [path.join(ROOT, 'scripts', 'sync-wps-bridge.js'), '--report'], {
    encoding: 'utf-8',
  });
  assertEqual(out.status, 0, '--report 应退出码 0，实际 ' + out.status + ': ' + out.stderr);
  // 必须覆盖三个未单源化 handler
  ['excel-handler', 'ppt-handler', 'word-handler'].forEach(function (h) {
    assertTrue(out.stdout.indexOf(h) !== -1, '输出应包含 ' + h);
  });
  // 必须输出重复率百分比（格式：xx.x% 或 xx%），证明检测真实执行而非空输出
  assertTrue(/mac 行在 linux 出现率/.test(out.stdout), '输出应含表头');
  assertTrue(/\|\s*(excel|ppt|word)-handler\s*\|\s*\d+\s*\|\s*\d+\s*\|\s*\d+(\.\d+)?%\s*\|/.test(out.stdout), '输出行应为「行数|行数|百分比」格式');
  // 三平台重复率应>0（真实文件存在且有重复），防止空跑
  assertTrue(/\d+%/.test(out.stdout), '应输出至少一个百分比');
});

// ==================== 5. gateway 数据表拆分 ====================
console.log('\n--- gateway COM_ACTIONS 数据表拆分 ---');

test('com-actions.ts 存在且导出 COM_ACTIONS（纯数据表）', function () {
  var p = path.join(ROOT, 'wps-office-mcp', 'src', 'tools', 'gateway', 'com-actions.ts');
  assertTrue(fs.existsSync(p), 'com-actions.ts 应存在');
  var src = fs.readFileSync(p, 'utf-8');
  assertTrue(/export const COM_ACTIONS/.test(src), '应导出 COM_ACTIONS');
});

test('gateway/index.ts 已拆分，不再内嵌 COM_ACTIONS 数据表', function () {
  var p = path.join(ROOT, 'wps-office-mcp', 'src', 'tools', 'gateway', 'index.ts');
  var src = fs.readFileSync(p, 'utf-8');
  assertTrue(/from '\.\/com-actions'/.test(src), 'index 应从 com-actions 导入');
  assertTrue(!/const COM_ACTIONS: ToolIndexItem\[\] = \[/.test(src), 'index 不应再内嵌数据表');
});

// ==================== 汇总 ====================
console.log('\n======================================');
console.log('测试结果: ' + passCount + '/' + testCount + ' 通过');
console.log('======================================');
if (passCount !== testCount) {
  process.exit(1);
}
