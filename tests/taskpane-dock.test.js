/**
 * 任务窗格停靠位置测试套件（PR #79 评审整改 ③：零测试防线 → 补真实单测）
 *
 * 通过 vm 加载生产源码 opencode-wps/main.js（与 CI 中 node --check 同源），
 * mock window.Application（CreateTaskPane / GetTaskPane / PluginStorage），
 * 共 19 个用例，覆盖：
 *  1. CreateTaskPane 仅传 url 单参数（评审 ②：API 签名稳妥用法）
 *  2. 首次创建后 DockPosition 被校正为 msoCTPDockPositionRight（=2）
 *  3. 再次打开（已存在 taskpane_id）时重新校正 DockPosition
 *  4. DockPosition 设置失败时 console.error 留痕（评审 ③：不再空 catch）
 *  5. WPS_Enum 无枚举值冲突：Top/Bottom 未引入（评审 ①）
 *  6. GetTaskPane 返回 null（残留旧 id）回退重建窗格
 *  7. GetTaskPane 抛异常回退重建窗格并留痕
 *  8. DockPosition 设置失败时窗格仍正常打开（不阻断）
 *  9. createTaskPane 辅助函数统一完成创建/存 ID/校正停靠/置可见（评审 ⑤ 去重）
 * 10. setTaskPaneDockPosition 无效对象返回 false
 * 11. PluginStorage.getItem 抛异常：留痕并回退重建（评审 ⑥ 防御一致）
 * 12. CreateTaskPane 抛异常：失败留痕并返回 null，不中断（评审 ⑥ 统一兜底）
 * 13. PluginStorage.setItem 抛异常：留痕后继续校正停靠并置可见（评审 ⑦ 统一兜底）
 * 14. 切换可见性失败（tp.Visible 只读）：留痕不中断按钮回调（评审 ⑧）
 * 15. createTaskPane 内 Visible 置位失败：留痕后仍返回窗格对象（评审 ⑨ 自愈兜底）
 * 16. setItem 持久化失败：内存 ID 兜底防多窗格叠加（评审 ⑩）
 * 17. CreateTaskPane 返回的窗格 ID 为空：留痕、不覆盖既有内存缓存、且跳过 setItem 持久化写入（评审 ⑫ 空值防御）
 *     + errMsg 公共函数行为校验（评审 ⑪，含在上述用例中）
 *     + ID 为空时 setItem 不应被调用（避免持久化 undefined 覆盖既有有效 ID）
 * 18. CreateTaskPane 返回 null（而非抛异常）：立即判空 + 明确留痕 + 返回 null（评审 ⑬ 防御补充）
 * 19. 停靠校正失败但窗格可用：留痕说明窗格仍可用，仍返回窗格对象（评审 ⑬ 防御补充）
 * 20. GetTaskPane 找回路径停靠校正失败：补充「窗格仍可用」留痕，不中断可见性切换（评审 ⑭ 行为一致性）
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var MAIN_JS = path.join(__dirname, '..', 'opencode-wps', 'main.js');

var testResults = [];
var testCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    testResults.push({ name: name, status: 'PASS' });
    console.log('  ✓ ' + name);
  } catch (e) {
    testResults.push({ name: name, status: 'FAIL', error: e.message });
    console.log('  ✗ ' + name + ' → ' + e.message);
  }
}

function assertTrue(actual, msg) {
  if (!actual) throw new Error(msg || 'expected true, got ' + actual);
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'assertEqual') + ': expected ' + expected + ', got ' + actual);
  }
}

/**
 * 加载生产 main.js 到 vm 沙箱，返回 sandbox
 * @param {object} appMock - window.Application mock
 */
function loadMainJs(appMock) {
  var src = fs.readFileSync(MAIN_JS, 'utf-8');
  var errorLogs = [];
  // 记录 setTimeout 回调：生产代码用 setTimeout 做异步两步（隐藏→显示），
  // 测试环境不自动执行（避免时序依赖），由用例手动 flush（__flushTimeouts）
  var timeoutQueue = [];
  var sandbox = {
    window: {
      Application: appMock,
      // OnAddinLoad 会给 Application.Enum 赋值；mock 上允许动态加属性即可
    },
    console: {
      log: function () {},
      warn: function () {},
      error: function (msg) { errorLogs.push(String(msg)); }
    },
    alert: function () {},
    setInterval: function () { return 0; },
    clearInterval: function () {},
    setTimeout: function (cb) { timeoutQueue.push(cb); return timeoutQueue.length; },
    XMLHttpRequest: function () {
      this.open = function () {};
      this.send = function () {};
      this.setRequestHeader = function () {};
    },
    __errorLogs: errorLogs,
    // 手动执行已排队的 setTimeout 回调（按 FIFO），返回执行次数
    __flushTimeouts: function () {
      var n = 0;
      while (timeoutQueue.length) {
        var cb = timeoutQueue.shift();
        cb();
        n++;
      }
      return n;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: MAIN_JS });
  return sandbox;
}

// ==================== 测试用例 ====================

test('WPS_Enum 无枚举值冲突：无 Top/Bottom，Right=2 且唯一', function () {
  var sandbox = loadMainJs({});
  var WPS_Enum = sandbox.WPS_Enum;
  assertTrue(WPS_Enum, 'WPS_Enum 未定义');
  // 评审 ①：Top/Bottom 未引入（其值 1/3 与 msoFileDialogOpen=1 冲突）
  assertTrue(typeof WPS_Enum.msoCTPDockPositionTop === 'undefined', 'msoCTPDockPositionTop 不应存在');
  assertTrue(typeof WPS_Enum.msoCTPDockPositionBottom === 'undefined', 'msoCTPDockPositionBottom 不应存在');
  assertEqual(WPS_Enum.msoCTPDockPositionRight, 2, 'msoCTPDockPositionRight 应为 2');
  // 所有枚举值唯一
  var values = Object.keys(WPS_Enum).map(function (k) { return WPS_Enum[k]; });
  var unique = values.filter(function (v, i) { return values.indexOf(v) === i; });
  assertEqual(unique.length, values.length, '枚举值存在冲突（重复数值）');
});

test('CreateTaskPane 仅传 url 单参数（评审 ② API 签名稳妥用法）', function () {
  var createCalls = [];
  var appMock = {
    CreateTaskPane: function (url) {
      createCalls.push({ url: url, argsCount: arguments.length });
      return { ID: 'tp-1', DockPosition: undefined, Visible: false };
    },
    GetTaskPane: function () { return { DockPosition: undefined, Visible: false }; },
    PluginStorage: {
      getItem: function () { return ''; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  // 触发按钮动作
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createCalls.length, 1, 'CreateTaskPane 应被调用 1 次');
  assertEqual(createCalls[0].argsCount, 1, 'CreateTaskPane 第二参数不应传入（官方签名稳妥用法）');
});

test('首次创建：CreateTaskPane 后 DockPosition 校正为 Right(2)', function () {
  var createdPane = { ID: 'tp-1', DockPosition: undefined, Visible: false };
  var appMock = {
    CreateTaskPane: function () { return createdPane; },
    GetTaskPane: function () { return { DockPosition: undefined, Visible: false }; },
    PluginStorage: {
      getItem: function () { return ''; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createdPane.DockPosition, 2, '首次创建后 DockPosition 应为 2 (Right)');
  assertEqual(createdPane.Visible, true, '创建后应可见');
});

test('再次打开：已存在 taskpane_id 时重新校正 DockPosition', function () {
  var existingPane = { DockPosition: 0, Visible: false };
  var appMock = {
    CreateTaskPane: function () { throw new Error('不应调用 CreateTaskPane'); },
    GetTaskPane: function () { return existingPane; },
    PluginStorage: {
      getItem: function () { return 'tp-existing'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(existingPane.DockPosition, 2, '再次打开时 DockPosition 应重新校正为 2');
  assertEqual(existingPane.Visible, true, '切换后应可见');
});

test('GetTaskPane 返回 null（残留旧 taskpane_id）：回退重建窗格', function () {
  var recreatedPane = { ID: 'tp-new', DockPosition: undefined, Visible: false };
  var setItemCalls = [];
  var appMock = {
    CreateTaskPane: function () { return recreatedPane; },
    GetTaskPane: function () { return null; },
    PluginStorage: {
      getItem: function () { return 'tp-stale'; },
      setItem: function (k, v) { setItemCalls.push([k, v]); }
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(recreatedPane.DockPosition, 2, '回退重建后 DockPosition 应校正为 2');
  assertEqual(recreatedPane.Visible, true, '回退重建后应可见');
  var hasTaskPaneId = setItemCalls.some(function (c) { return c[0] === 'taskpane_id' && c[1] === 'tp-new'; });
  assertTrue(hasTaskPaneId, '应更新 PluginStorage 中的 taskpane_id 为新窗格 ID');
});

test('GetTaskPane 抛异常（个别版本对无效 id 抛错）：回退重建窗格并留痕', function () {
  var recreatedPane = { ID: 'tp-new2', DockPosition: undefined, Visible: false };
  var setItemCalls = [];
  var appMock = {
    CreateTaskPane: function () { return recreatedPane; },
    GetTaskPane: function () { throw new Error('invalid taskpane id'); },
    PluginStorage: {
      getItem: function () { return 'tp-stale'; },
      setItem: function (k, v) { setItemCalls.push([k, v]); }
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(recreatedPane.DockPosition, 2, '回退重建后 DockPosition 应校正为 2');
  assertEqual(recreatedPane.Visible, true, '回退重建后应可见');
  var hasTaskPaneId = setItemCalls.some(function (c) { return c[0] === 'taskpane_id' && c[1] === 'tp-new2'; });
  assertTrue(hasTaskPaneId, '应更新 PluginStorage 中的 taskpane_id 为新窗格 ID');
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('GetTaskPane 获取任务窗格失败') >= 0; });
  assertTrue(hasError, '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
});

test('DockPosition 设置失败：console.error 留痕（评审 ③ 不空吞异常）', function () {
  var pane = {
    ID: 'tp-fail',
    set DockPosition(v) { throw new Error('DockPosition 只读'); },
    Visible: false
  };
  var appMock = {
    CreateTaskPane: function () { return pane; },
    GetTaskPane: function () { return pane; },
    PluginStorage: {
      getItem: function () { return ''; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('设置任务窗格停靠位置失败') >= 0; });
  assertTrue(hasError, '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
  assertEqual(pane.Visible, true, '即使停靠设置失败，窗格仍应正常打开');
});

test('createTaskPane 辅助函数：统一完成创建/存 ID/校正停靠/置可见（评审 ⑤ 去重）', function () {
  var createdPane = { ID: 'tp-c', DockPosition: undefined, Visible: false };
  var setItemCalls = [];
  var createCalls = [];
  var appMock = {
    CreateTaskPane: function (url) {
      createCalls.push({ url: url, argsCount: arguments.length });
      return createdPane;
    },
    GetTaskPane: function () { throw new Error('不应调用 GetTaskPane'); },
    PluginStorage: {
      getItem: function () { return ''; },
      setItem: function (k, v) { setItemCalls.push([k, v]); }
    }
  };
  var sandbox = loadMainJs(appMock);
  var ret = sandbox.createTaskPane();
  assertEqual(ret, createdPane, '应返回创建的任务窗格对象');
  assertEqual(createCalls.length, 1, 'CreateTaskPane 应被调用 1 次');
  assertEqual(createCalls[0].argsCount, 1, 'CreateTaskPane 第二参数不应传入');
  var hasTaskPaneId = setItemCalls.some(function (c) { return c[0] === 'taskpane_id' && c[1] === 'tp-c'; });
  assertTrue(hasTaskPaneId, '应存储 taskpane_id 为新窗格 ID');
  assertEqual(createdPane.DockPosition, 2, 'DockPosition 应校正为 2 (Right)');
  assertEqual(createdPane.Visible, true, '创建后应可见');
});

test('setTaskPaneDockPosition 直接调用：无效对象返回 false', function () {
  var sandbox = loadMainJs({});
  assertEqual(sandbox.setTaskPaneDockPosition(null), false, 'null 应返回 false');
  assertEqual(sandbox.setTaskPaneDockPosition(undefined), false, 'undefined 应返回 false');
});

test('PluginStorage.getItem 抛异常（插件初始化未完成）：留痕并回退重建（评审 ⑥ 防御一致）', function () {
  var recreatedPane = { ID: 'tp-init-fail', DockPosition: undefined, Visible: false };
  var appMock = {
    CreateTaskPane: function () { return recreatedPane; },
    GetTaskPane: function () { throw new Error('不应调用 GetTaskPane'); },
    PluginStorage: {
      getItem: function () { throw new Error('PluginStorage 未就绪'); },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(recreatedPane.DockPosition, 2, 'getItem 异常后回退重建，DockPosition 应校正为 2');
  assertEqual(recreatedPane.Visible, true, '回退重建后应可见');
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('读取 taskpane_id 失败') >= 0; });
  assertTrue(hasError, '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
});

test('CreateTaskPane 抛异常（路径无效等）：失败留痕并返回 null，不中断（评审 ⑥ 统一兜底）', function () {
  var appMock = {
    CreateTaskPane: function () { throw new Error('taskpane.html 路径无效'); },
    GetTaskPane: function () { throw new Error('不应调用 GetTaskPane'); },
    PluginStorage: {
      getItem: function () { return ''; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' }); // 不应抛异常
  assertEqual(sandbox.createTaskPane(), null, 'createTaskPane 失败应返回 null');
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('初始化任务窗格失败') >= 0; });
  assertTrue(hasError, '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
});

test('PluginStorage.setItem 抛异常（初始化未完成）：留痕后继续校正停靠并置可见（评审 ⑦ 统一兜底）', function () {
  var createdPane = { ID: 'tp-setitem-fail', DockPosition: undefined, Visible: false };
  var appMock = {
    CreateTaskPane: function () { return createdPane; },
    GetTaskPane: function () { throw new Error('不应调用 GetTaskPane'); },
    PluginStorage: {
      getItem: function () { return ''; },
      setItem: function () { throw new Error('PluginStorage 未就绪'); }
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' }); // 不应抛异常
  // setItem 失败不应中断后续初始化：DockPosition 校正 + Visible 置位照常执行
  assertEqual(createdPane.DockPosition, 2, 'setItem 失败后 DockPosition 仍应校正为 2');
  assertEqual(createdPane.Visible, true, 'setItem 失败后窗格仍应可见');
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('保存 taskpane_id 失败') >= 0; });
  assertTrue(hasError, '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
});

test('切换可见性失败（tp.Visible 只读）：留痕不中断按钮回调（评审 ⑧ 统一兜底）', function () {
  var existingPane = { DockPosition: 0 };
  Object.defineProperty(existingPane, 'Visible', {
    get: function () { return false; },
    set: function () { throw new Error('Visible 只读'); }
  });
  var appMock = {
    CreateTaskPane: function () { throw new Error('不应调用 CreateTaskPane'); },
    GetTaskPane: function () { return existingPane; },
    PluginStorage: {
      getItem: function () { return 'tp-existing'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' }); // 不应抛异常
  assertEqual(existingPane.DockPosition, 2, '切换前仍应完成 DockPosition 校正');
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('切换任务窗格可见性失败') >= 0; });
  assertTrue(hasError, '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
});

test('GetTaskPane 找回路径停靠校正失败：补充「窗格仍可用」留痕，不中断可见性切换（评审 ⑭ 行为一致性）', function () {
  // 已存在任务窗格（GetTaskPane 找回路径）：DockPosition 只读抛异常（停靠校正失败）
  var existingPane = { ID: 'tp-existing-dockfail', Visible: false };
  Object.defineProperty(existingPane, 'DockPosition', {
    get: function () { return undefined; },
    set: function () { throw new Error('DockPosition 只读'); }
  });
  var appMock = {
    CreateTaskPane: function () { throw new Error('不应调用 CreateTaskPane'); },
    GetTaskPane: function () { return existingPane; },
    PluginStorage: {
      getItem: function () { return 'tp-existing-dockfail'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' }); // 不应抛异常
  // 停靠校正失败不阻断：可见性切换照常执行（false → true）
  assertEqual(existingPane.Visible, true, '停靠校正失败后可见性切换仍应执行');
  // 双层留痕：内部「设置任务窗格停靠位置失败」+ 增强「窗格仍可用」
  var hasDockError = sandbox.__errorLogs.some(function (l) { return l.indexOf('设置任务窗格停靠位置失败') >= 0; });
  assertTrue(hasDockError, '应输出停靠设置失败留痕（setTaskPaneDockPosition 内部），实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
  var hasUsable = sandbox.__errorLogs.some(function (l) { return l.indexOf('任务窗格停靠校正失败（窗格仍可用') >= 0; });
  assertTrue(hasUsable, '应输出「窗格仍可用」增强留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
});

test('createTaskPane 内 Visible 置位失败：留痕后仍返回窗格对象（评审 ⑨ 自愈兜底）', function () {
  var createdPane = { ID: 'tp-visible-fail', DockPosition: undefined };
  Object.defineProperty(createdPane, 'Visible', {
    get: function () { return false; },
    set: function () { throw new Error('Visible 只读'); }
  });
  var appMock = {
    CreateTaskPane: function () { return createdPane; },
    GetTaskPane: function () { throw new Error('不应调用 GetTaskPane'); },
    PluginStorage: {
      getItem: function () { return ''; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  var ret = sandbox.createTaskPane();
  // 关键：不再返回 null，而是返回窗格对象——保留下次点击自愈机会（GetTaskPane 找回 → 重新校正 + 切换可见性）
  assertEqual(ret, createdPane, 'Visible 置位失败仍应返回窗格对象');
  assertEqual(createdPane.DockPosition, 2, 'DockPosition 仍应校正为 2');
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('置任务窗格可见失败') >= 0; });
  assertTrue(hasError, '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
});

test('setItem 持久化失败：内存 ID 兜底，再次点击不重复创建（评审 ⑩ 多窗格防叠加）', function () {
  var createdPane = { ID: 'tp-cache', DockPosition: undefined, Visible: false };
  var createCalls = 0;
  var appMock = {
    CreateTaskPane: function () { createCalls++; return createdPane; },
    GetTaskPane: function () { return createdPane; }, // 内存 ID 能找回窗格
    PluginStorage: {
      getItem: function () { throw new Error('PluginStorage 未就绪'); }, // 持久化读取也失败
      setItem: function () { throw new Error('PluginStorage 未就绪'); }  // 持久化写入失败
    }
  };
  var sandbox = loadMainJs(appMock);
  // 第一次点击：创建 + setItem 失败（留痕），内存 ID 已记录
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createCalls, 1, '第一次点击应创建 1 次');
  assertEqual(createdPane.Visible, true, '第一次创建后应可见');
  // 第二次点击：应通过内存 ID 找回窗格，不再重复创建，而是切换可见性
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createCalls, 1, '第二次点击应复用内存 ID，不重复创建');
  assertEqual(createdPane.Visible, false, '第二次点击后应切换为隐藏');
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('保存 taskpane_id 失败') >= 0; });
  assertTrue(hasError, '应输出 setItem 失败留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
});

test('CreateTaskPane 返回的窗格 ID 为空：留痕但不覆盖既有内存缓存（评审 ⑫ 空值防御）', function () {
  var createdPane = { ID: undefined, DockPosition: undefined, Visible: false };
  var setItemCalls = [];
  var appMock = {
    CreateTaskPane: function () { return createdPane; },
    GetTaskPane: function () { throw new Error('不应调用 GetTaskPane'); },
    PluginStorage: {
      getItem: function () { return ''; },
      setItem: function (k, v) { setItemCalls.push([k, v]); }
    }
  };
  var sandbox = loadMainJs(appMock);
  // 先造一个既有缓存，验证 ID 为空时不覆盖
  sandbox.taskpaneIdCache = 'tp-existing-cache';
  var ret = sandbox.createTaskPane();
  assertEqual(ret, createdPane, 'ID 为空仍应返回窗格对象（初始化流程不中断）');
  assertEqual(createdPane.DockPosition, 2, 'DockPosition 仍应校正为 2');
  assertEqual(createdPane.Visible, true, '窗格仍应置可见');
  assertEqual(sandbox.taskpaneIdCache, 'tp-existing-cache', 'ID 为空时不应覆盖既有内存缓存');
  assertEqual(setItemCalls.length, 0, 'ID 为空时应跳过 setItem 持久化写入，避免覆盖既有有效 ID');
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('任务窗格 ID 为空') >= 0; });
  assertTrue(hasError, '应输出 ID 为空留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
});

test('errMsg 公共函数：Error 取 message，非 Error 值原样返回（评审 ⑪ 去重）', function () {
  var sandbox = loadMainJs({});
  assertEqual(sandbox.errMsg(new Error('boom')), 'boom', 'Error 对象应取 message');
  assertEqual(sandbox.errMsg('直接字符串'), '直接字符串', '字符串应原样返回');
  assertEqual(sandbox.errMsg(42), 42, '数字应原样返回');
  assertEqual(sandbox.errMsg(null), null, 'null 应原样返回');
  assertEqual(sandbox.errMsg(undefined), undefined, 'undefined 应原样返回');
});

test('CreateTaskPane 返回 null（而非抛异常）：立即判空 + 明确留痕 + 返回 null（评审 ⑬）', function () {
  var appMock = {
    CreateTaskPane: function () { return null; },
    GetTaskPane: function () { throw new Error('不应调用 GetTaskPane'); },
    PluginStorage: {
      getItem: function () { return ''; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  var ret = sandbox.createTaskPane();
  assertEqual(ret, null, 'CreateTaskPane 返回 null 时 createTaskPane 应返回 null');
  // 留痕文案应明确指向「返回空对象」，而非误导性的「初始化任务窗格失败」
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('CreateTaskPane 返回空对象') >= 0; });
  assertTrue(hasError, '应输出明确留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
  var hasMisleading = sandbox.__errorLogs.some(function (l) { return l.indexOf('初始化任务窗格失败') >= 0; });
  assertTrue(!hasMisleading, '不应走到误导性的外层 catch 文案，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
});

test('停靠校正失败但窗格可用：留痕说明窗格仍可用，仍返回窗格对象（评审 ⑬）', function () {
  var createdPane = { ID: 'tp-dock-fail', Visible: false };
  Object.defineProperty(createdPane, 'DockPosition', {
    get: function () { return undefined; },
    set: function () { throw new Error('DockPosition 只读'); }
  });
  var appMock = {
    CreateTaskPane: function () { return createdPane; },
    GetTaskPane: function () { throw new Error('不应调用 GetTaskPane'); },
    PluginStorage: {
      getItem: function () { return ''; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  var ret = sandbox.createTaskPane();
  // 停靠校正失败不阻断：仍置可见并返回窗格对象（下次点击经 GetTaskPane 找回重新校正，有自愈机会）
  assertEqual(ret, createdPane, '停靠校正失败仍应返回窗格对象');
  assertEqual(createdPane.Visible, true, '停靠校正失败后仍应置可见');
  var hasDockError = sandbox.__errorLogs.some(function (l) { return l.indexOf('设置任务窗格停靠位置失败') >= 0; });
  assertTrue(hasDockError, '应输出停靠设置失败留痕（setTaskPaneDockPosition 内部），实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
  var hasUsable = sandbox.__errorLogs.some(function (l) { return l.indexOf('任务窗格停靠校正失败（窗格仍可用') >= 0; });
  assertTrue(hasUsable, '应输出「窗格仍可用」增强留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
});

// ==================== 打开面板主动调度宿主重绘（Issue #78 三诊）====================
// 用户实测：合并 PR #83 后首次打开面板头部仍被遮挡，切标签后才恢复。
// 根因：PR #83 的宿主重绘只挂在 WindowActivate 事件上，首次打开面板（btnShowTaskPane）
// 不经过该事件 → 重绘永不触发。修复：btnShowTaskPane 创建/置可见后主动调度
// forceTaskPaneRedraw(true)（延迟 TASKPANE_OPEN_REDRAW_DELAY=400ms），与切标签同源。

function makeOpenPaneApp(pane, opts) {
  opts = opts || {};
  var getCalls = 0;
  return {
    CreateTaskPane: function () { return pane; },
    GetTaskPane: function () {
      getCalls++;
      // 默认始终返回 pane；opts.getPaneAfter 可注入指定次数后的返回值
      if (opts.getPaneAfter && getCalls > opts.getPaneAfter.calls) return opts.getPaneAfter.value;
      return pane;
    },
    PluginStorage: {
      getItem: function () { return opts.storedId || ''; },
      setItem: function () {}
    }
  };
}

test('btnShowTaskPane 首次创建：延迟 400ms 后主动调度宿主重绘（Issue #78 三诊）', function () {
  var pane = { ID: 'tp-open1', DockPosition: undefined, _visible: false };
  var visibleLog = [];
  Object.defineProperty(pane, 'Visible', {
    get: function () { return pane._visible; },
    set: function (v) { pane._visible = v; visibleLog.push(v); }
  });
  var sandbox = loadMainJs(makeOpenPaneApp(pane));
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  // 首次创建：createTaskPane 内置可见 → pane._visible = true（visibleLog[0]）
  assertEqual(pane._visible, true, '首次创建后窗格应可见');
  assertEqual(visibleLog.length, 1, '创建路径应置可见一次');
  // flush 全部定时器：调度宿主重绘（隐藏 visibleLog[1] → 恢复 visibleLog[2]）
  sandbox.__flushTimeouts();
  assertEqual(pane._visible, true, '宿主重绘完成后应恢复可见');
  assertEqual(visibleLog.length, 3, '应有 创建置可见+重绘隐藏+重绘恢复 共 3 次置位，实际: ' + JSON.stringify(visibleLog));
  assertEqual(pane.DockPosition, 2, '重绘时应校正停靠为 Right(2)');
});

test('btnShowTaskPane 首次创建：窗格不可见时不误调度重绘（可见置位失败）', function () {
  var pane = { ID: 'tp-open2', DockPosition: undefined, _visible: false };
  var visibleSetCount = 0;
  Object.defineProperty(pane, 'Visible', {
    get: function () { return pane._visible; },
    set: function (v) { visibleSetCount++; throw new Error('Visible 只读'); } // createTaskPane 内置可见失败
  });
  var sandbox = loadMainJs(makeOpenPaneApp(pane));
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  // createTaskPane 内置可见失败 → 留痕 + 仍返回窗格对象
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('置任务窗格可见失败') >= 0; });
  assertTrue(hasError, '应输出可见置位失败留痕，实际: ' + JSON.stringify(sandbox.__errorLogs));
  assertEqual(visibleSetCount, 1, 'createTaskPane 应尝试置可见 1 次');
  // flush 全部定时器：首次创建路径调度的宿主重绘执行时，forceTaskPaneRedraw
  // 因窗格不可见（!tp.Visible）直接返回，不应再次触发 Visible 置位尝试
  sandbox.__flushTimeouts();
  sandbox.__flushTimeouts();
  assertEqual(visibleSetCount, 1, '窗格不可见时调度的重绘不应再次尝试置位，实际尝试 ' + visibleSetCount + ' 次');
  assertEqual(pane._visible, false, '窗格不可见时不应被误置可见');
});

test('btnShowTaskPane 切换打开（已存在窗格）：延迟 400ms 后主动调度宿主重绘', function () {
  var pane = { ID: 'tp-open3', DockPosition: 0, _visible: false };
  var visibleLog = [];
  Object.defineProperty(pane, 'Visible', {
    get: function () { return pane._visible; },
    set: function (v) { pane._visible = v; visibleLog.push(v); }
  });
  var sandbox = loadMainJs(makeOpenPaneApp(pane, { storedId: 'tp-open3' }));
  // 第一次点击：从隐藏 → 打开，应调度宿主重绘
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(pane._visible, true, '切换后窗格应可见');
  assertEqual(pane.DockPosition, 2, '切换时应重新校正停靠为 Right(2)');
  assertEqual(visibleLog.length, 1, '切换打开应置可见一次');
  // flush：执行调度定时器（隐藏）与恢复定时器（显示）
  sandbox.__flushTimeouts();
  assertEqual(pane._visible, true, '宿主重绘完成后应恢复可见');
  assertEqual(visibleLog.length, 3, '应有 切换置可见+重绘隐藏+重绘恢复 共 3 次置位，实际: ' + JSON.stringify(visibleLog));
});

test('btnShowTaskPane 切换关闭（窗格变隐藏）：不调度宿主重绘', function () {
  var pane = { ID: 'tp-open4', DockPosition: 0, _visible: true };
  Object.defineProperty(pane, 'Visible', {
    get: function () { return pane._visible; },
    set: function (v) { pane._visible = v; }
  });
  var sandbox = loadMainJs(makeOpenPaneApp(pane, { storedId: 'tp-open4' }));
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(pane._visible, false, '切换后窗格应隐藏');
  // 关闭路径不应调度宿主重绘：flush 全部定时器后窗格保持隐藏
  sandbox.__flushTimeouts();
  assertEqual(pane._visible, false, '关闭路径不应触发任何重绘置位');
});

test('btnShowTaskPane 切换打开：读取 Visible 抛异常时保守不调度重绘', function () {
  var pane = { ID: 'tp-open5', DockPosition: 0 };
  var visibleSetCount = 0;
  Object.defineProperty(pane, 'Visible', {
    get: function () { throw new Error('Visible 读取失败'); },
    set: function (v) { visibleSetCount++; }
  });
  var sandbox = loadMainJs(makeOpenPaneApp(pane, { storedId: 'tp-open5' }));
  sandbox.OnAction({ Id: 'btnShowTaskPane' }); // 不应抛异常
  // tp.Visible = !tp.Visible 在求值阶段读取 Visible 即抛异常 → 切换失败留痕，不调度重绘
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('切换任务窗格可见性失败') >= 0; });
  assertTrue(hasError, 'Visible 读取抛异常应走切换失败留痕，实际: ' + JSON.stringify(sandbox.__errorLogs));
  assertEqual(visibleSetCount, 0, '读取失败时不应有置位发生');
  // flush 定时器：不应有任何重绘置位（调度分支因读取失败未执行）
  sandbox.__flushTimeouts();
  assertEqual(visibleSetCount, 0, 'Visible 读取失败不应触发任何额外置位');
});

test('forceTaskPaneRedraw(force=true)：不受 taskPaneRedrawPending 首次防抖影响前重绘可执行', function () {
  var pane = { ID: 'tp-open6', DockPosition: 0, _visible: true };
  var visibleLog = [];
  Object.defineProperty(pane, 'Visible', {
    get: function () { return pane._visible; },
    set: function (v) { pane._visible = v; visibleLog.push(v); }
  });
  var appMock = {
    GetTaskPane: function () { return pane; },
    PluginStorage: {
      getItem: function () { return 'tp-open6'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  // force=true（用户主动打开面板后调度）：应正常执行隐藏→显示
  sandbox.forceTaskPaneRedraw(true);
  assertEqual(visibleLog.length, 1, 'force=true 应先隐藏一次');
  sandbox.__flushTimeouts();
  assertEqual(visibleLog.length, 2, 'flush 后应恢复显示');
});

test('forceTaskPaneRedraw(true) 与 WindowActivate 触发共享防抖：pending 期间跳过', function () {
  var pane = { ID: 'tp-open7', DockPosition: 0, _visible: true };
  var visibleLog = [];
  Object.defineProperty(pane, 'Visible', {
    get: function () { return pane._visible; },
    set: function (v) { pane._visible = v; visibleLog.push(v); }
  });
  var appMock = {
    GetTaskPane: function () { return pane; },
    PluginStorage: {
      getItem: function () { return 'tp-open7'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  // 第一次 force=true：进入 pending
  sandbox.forceTaskPaneRedraw(true);
  assertEqual(visibleLog.length, 1, '第一次隐藏一次');
  // pending 期间 force=false（WindowActivate 触发）应被防抖跳过
  sandbox.forceTaskPaneRedraw(false);
  assertEqual(visibleLog.length, 1, 'pending 期间 WindowActivate 触发应跳过');
  // flush 完成第一次重绘
  sandbox.__flushTimeouts();
  assertEqual(visibleLog.length, 2, 'flush 后恢复显示');
  // pending 清除后 force=true 可再次执行
  sandbox.forceTaskPaneRedraw(true);
  assertEqual(visibleLog.length, 3, 'pending 清除后应允许再次隐藏');
});

// 用户实测：PR #79 的 DockPosition 修复后头部仍被遮挡；新建 WPS 标签页再切回即恢复。
// 像素分析结论：任务窗格 WebView 首次渲染时 topbar/session-header 区域为空白（flex 布局
// 因视口高度计算错误把头部挤出可视区），切换窗口触发宿主重绘后才恢复。
// 修复：宿主侧注册 WindowActivate 事件，切回时强制任务窗格 false→true 重绘；
// 仅当窗格原本可见时执行，避免把用户关闭的窗格重新弹出来。

test('OnAddinLoad 注册 WindowActivate 重绘监听（Issue #78 复诊加固）', function () {
  var events = {};
  var appMock = {
    AddApiEventListener: function (name, cb) { events[name] = cb; },
    PluginStorage: { getItem: function () { return ''; }, setItem: function () {} }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAddinLoad({});
  assertTrue(typeof events.WindowActivate === 'function', '应注册 WindowActivate 监听，实际: ' + JSON.stringify(Object.keys(events)));
});

test('OnAddinLoad 重复调用不应重复注册 WindowActivate 监听（防叠加）', function () {
  var regCount = 0;
  var appMock = {
    AddApiEventListener: function (name, cb) { regCount++; },
    PluginStorage: { getItem: function () { return ''; }, setItem: function () {} }
  };
  var sandbox = loadMainJs(appMock);
  // OnAddinLoad 被多次调用（插件重载/异常恢复场景）
  sandbox.OnAddinLoad({});
  sandbox.OnAddinLoad({});
  sandbox.OnAddinLoad({});
  assertEqual(regCount, 1, 'WindowActivate 监听应只注册 1 次，实际注册 ' + regCount + ' 次');
});

test('OnAddinLoad 注册 WindowActivate 时旧版本无 AddApiEventListener 应静默降级', function () {
  var appMock = {
    PluginStorage: { getItem: function () { return ''; }, setItem: function () {} }
  };
  var sandbox = loadMainJs(appMock);
  // 不应抛异常
  sandbox.OnAddinLoad({});
  var hasWarn = sandbox.__errorLogs.some(function (l) { return l.indexOf('注册 WindowActivate 监听失败') >= 0; });
  // 无 AddApiEventListener 时不走 catch，也不应有失败留痕（静默降级）
  assertTrue(!hasWarn, '无 AddApiEventListener 时不应报注册失败，实际: ' + JSON.stringify(sandbox.__errorLogs));
});

test('forceTaskPaneRedraw：窗格可见时异步两步 false→true 重绘并重新校正停靠', function () {
  var pane = { ID: 'tp-redraw', DockPosition: 0, _visible: true };
  var visibleLog = [];
  Object.defineProperty(pane, 'Visible', {
    get: function () { return pane._visible; },
    set: function (v) { pane._visible = v; visibleLog.push(v); }
  });
  var appMock = {
    CreateTaskPane: function () { throw new Error('不应调用 CreateTaskPane'); },
    GetTaskPane: function () { return pane; },
    PluginStorage: {
      getItem: function () { return 'tp-redraw'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.forceTaskPaneRedraw();
  // 第一步同步：先隐藏（false 置位立即生效）
  assertEqual(visibleLog.length, 1, '同步阶段应先隐藏一次，实际: ' + JSON.stringify(visibleLog));
  assertEqual(visibleLog[0], false, '第一次应先隐藏');
  assertEqual(pane.DockPosition, 2, '重绘时应重新校正 DockPosition 为 Right(2)');
  // 第二步异步（setTimeout 80ms）：恢复可见，隐藏→显示间让出宿主事件循环
  var flushed = sandbox.__flushTimeouts();
  assertTrue(flushed >= 1, '应存在待执行的 setTimeout 回调，实际 flush ' + flushed + ' 个');
  assertEqual(visibleLog.length, 2, 'flush 后应恢复显示，实际: ' + JSON.stringify(visibleLog));
  assertEqual(visibleLog[1], true, '第二次再显示');
});

test('forceTaskPaneRedraw：重绘进行中时 WindowActivate 连续触发应跳过（防抖）', function () {
  var pane = { ID: 'tp-redraw', DockPosition: 0, _visible: true };
  var visibleLog = [];
  Object.defineProperty(pane, 'Visible', {
    get: function () { return pane._visible; },
    set: function (v) { pane._visible = v; visibleLog.push(v); }
  });
  var appMock = {
    GetTaskPane: function () { return pane; },
    PluginStorage: {
      getItem: function () { return 'tp-redraw'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  // 第一次触发：同步隐藏，进入 pending 状态
  sandbox.forceTaskPaneRedraw();
  assertEqual(visibleLog.length, 1, '第一次应隐藏一次');
  // 第二次触发（pending 未完成）：应直接跳过，不重复隐藏
  sandbox.forceTaskPaneRedraw();
  assertEqual(visibleLog.length, 1, 'pending 期间重复触发应被跳过，实际: ' + JSON.stringify(visibleLog));
  // flush 后完成第一次重绘，恢复可见
  sandbox.__flushTimeouts();
  assertEqual(visibleLog.length, 2, 'flush 后应恢复显示，实际: ' + JSON.stringify(visibleLog));
  assertEqual(visibleLog[1], true, '恢复为可见');
  // 第三次触发（pending 已清除）：允许再次重绘
  sandbox.forceTaskPaneRedraw();
  assertEqual(visibleLog.length, 3, 'pending 清除后应允许再次隐藏');
});

test('forceTaskPaneRedraw：异步恢复前用户已重新打开/恢复可见时不应重复置位（不误弹）', function () {
  var pane = { ID: 'tp-redraw', DockPosition: 0, _visible: true };
  var visibleLog = [];
  Object.defineProperty(pane, 'Visible', {
    get: function () { return pane._visible; },
    set: function (v) { pane._visible = v; visibleLog.push(v); }
  });
  var appMock = {
    GetTaskPane: function () { return pane; },
    PluginStorage: {
      getItem: function () { return 'tp-redraw'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.forceTaskPaneRedraw();
  assertEqual(visibleLog.length, 1, '同步隐藏一次');
  // 模拟用户/其他逻辑在重绘窗口内把窗格恢复为可见（如用户点击按钮重新打开）
  pane._visible = true;
  sandbox.__flushTimeouts();
  // 异步回调检测 cur.Visible 已为 true → 跳过恢复置位，不重复写
  assertEqual(visibleLog.length, 1, '外部已恢复可见时不应重复置位，实际: ' + JSON.stringify(visibleLog));
});

test('forceTaskPaneRedraw：重绘期间用户手动操作过窗格（OnAction toggle）则放弃恢复（尊重用户意图）', function () {
  var pane = { ID: 'tp-redraw', DockPosition: 0, _visible: true };
  var visibleLog = [];
  Object.defineProperty(pane, 'Visible', {
    get: function () { return pane._visible; },
    set: function (v) { pane._visible = v; visibleLog.push(v); }
  });
  var appMock = {
    GetTaskPane: function () { return pane; },
    PluginStorage: {
      getItem: function () { return 'tp-redraw'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.forceTaskPaneRedraw();
  assertEqual(visibleLog.length, 1, '同步隐藏一次');
  // 模拟用户在 150ms 重绘窗口内通过 OnAction 点击按钮操作窗格（toggle 切换可见性）
  // 注意：此时窗格已被重绘隐藏（_visible=false），用户点击 toggle 会重新打开（true）——
  // 关键点不在于 toggle 方向，而在于「用户操作过」应阻止异步恢复再次置位
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(visibleLog.length, 2, '用户点击后应再次切换可见性');
  sandbox.__flushTimeouts();
  // 异步回调检测 lastUserTaskPaneAction > redrawStartTime → 放弃恢复
  // 恢复置位不应发生：visibleLog 保持 2 次置位（重绘隐藏 + 用户操作）
  assertEqual(visibleLog.length, 2, '重绘期间用户操作后不应恢复显示，实际: ' + JSON.stringify(visibleLog));
});

test('forceTaskPaneRedraw：异步恢复前窗格已销毁时应放弃恢复（不误弹）', function () {
  var pane = { ID: 'tp-redraw', DockPosition: 0, _visible: true };
  var visibleLog = [];
  Object.defineProperty(pane, 'Visible', {
    get: function () { return pane._visible; },
    set: function (v) { pane._visible = v; visibleLog.push(v); }
  });
  var getCalls = 0;
  var appMock = {
    GetTaskPane: function () {
      getCalls++;
      // 第一次同步调用返回窗格；异步恢复前模拟窗格已销毁（返回 null）
      return getCalls <= 1 ? pane : null;
    },
    PluginStorage: {
      getItem: function () { return 'tp-redraw'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  sandbox.forceTaskPaneRedraw();
  assertEqual(visibleLog.length, 1, '同步隐藏一次');
  sandbox.__flushTimeouts();
  // 异步回调 GetTaskPane 返回 null → 放弃恢复
  assertEqual(visibleLog.length, 1, '窗格已销毁时不应恢复显示，实际: ' + JSON.stringify(visibleLog));
});

test('forceTaskPaneRedraw：窗格不存在/不可见时不误显示（不把用户关闭的窗格弹出）', function () {
  var appMock = {
    GetTaskPane: function () { return null; },
    PluginStorage: {
      getItem: function () { return 'tp-gone'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  // GetTaskPane 返回 null → 直接返回，不抛异常
  sandbox.forceTaskPaneRedraw();
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('强制重绘任务窗格失败') >= 0; });
  assertTrue(!hasError, '窗格不存在时应静默返回，实际: ' + JSON.stringify(sandbox.__errorLogs));
});

test('forceTaskPaneRedraw：GetTaskPane 抛异常时静默降级（不误弹窗、不中断）', function () {
  var appMock = {
    GetTaskPane: function () { throw new Error('无效 id'); },
    PluginStorage: {
      getItem: function () { return 'tp-bad'; },
      setItem: function () {}
    }
  };
  var sandbox = loadMainJs(appMock);
  // forceTaskPaneRedraw 内部 try/catch 捕获异常并留痕，不中断
  sandbox.forceTaskPaneRedraw();
  var hasError = sandbox.__errorLogs.some(function (l) { return l.indexOf('强制重绘任务窗格失败') >= 0; });
  assertTrue(hasError, 'GetTaskPane 抛异常应留痕，实际: ' + JSON.stringify(sandbox.__errorLogs));
});

test('taskpane.html 自愈骨架：position:fixed 锚定 + forceReflowFix 关键结构存在（Issue #78 复诊）', function () {
  var html = fs.readFileSync(path.join(__dirname, '..', 'opencode-wps', 'taskpane.html'), 'utf-8');
  // ① 布局锚定：html,body 必须 position:fixed + inset 四边
  assertTrue(/html,body\s*\{[^}]*position\s*:\s*fixed[^}]*\}/.test(html), 'html,body 应使用 position:fixed 锚定视口');
  assertTrue(/html,body\s*\{[^}]*top\s*:\s*0[^}]*left\s*:\s*0[^}]*right\s*:\s*0[^}]*bottom\s*:\s*0[^}]*\}/.test(html), 'html,body 应显式声明 top/left/right/bottom:0（兼容旧内核，不依赖 inset 简写）');
  // ② 页面自愈：forceReflowFix 必须存在且含强制 reflow（offsetHeight）
  assertTrue(/function\s+forceReflowFix\s*\(/.test(html), '应存在 forceReflowFix 函数');
  assertTrue(/offsetHeight/.test(html), 'forceReflowFix 应读取 offsetHeight 强制同步 reflow');
  // ③ 兼容降级：requestAnimationFrame 缺失时 setTimeout 兜底
  assertTrue(/typeof\s+requestAnimationFrame\s*===\s*'function'/.test(html), '应检测 requestAnimationFrame 可用性');
  // ④ 监听 resize / visibilitychange
  assertTrue(/addEventListener\('resize'/.test(html), '应监听 resize 事件');
  assertTrue(/addEventListener\('visibilitychange'/.test(html), '应监听 visibilitychange 事件');
  // ⑤ 首次渲染多时机兜底（rAF + load + 定时器）
  assertTrue(/rafOnce\s*\(\s*forceReflowFix\s*\)/.test(html), '应通过 rafOnce 在首帧前重排');
  assertTrue(/addEventListener\('load'/.test(html), '应监听 load 事件兜底重排');
  // 定时器兜底改走 scheduleReflowFix（内部含 300ms 最小间隔检查 + 状态位重置）
  assertTrue(/setTimeout\s*\(\s*function\s*\(\s*\)\s*\{\s*scheduleReflowFix\s*\(\s*\)\s*;?\s*\}\s*,\s*300\s*\)/.test(html), '应保留 300ms 定时器兜底（走 scheduleReflowFix）');
  assertTrue(/setTimeout\s*\(\s*function\s*\(\s*\)\s*\{\s*scheduleReflowFix\s*\(\s*\)\s*;?\s*\}\s*,\s*1000\s*\)/.test(html), '应保留 1000ms 定时器兜底（走 scheduleReflowFix）');
  // ⑥ chat 视图隐藏时跳过无效重排（避免在 display:none 父级上重排）
  assertTrue(/view-chat/.test(html) && /classList\.contains\('hidden'\)/.test(html), 'chat 视图隐藏时 forceReflowFix 应跳过');
  // ⑦ 双头部检查（topbar + session-header）
  assertTrue(/\.topbar,\s*\.session-header/.test(html), '预检应同时检查 topbar 与 session-header');
  // ⑧ showChat 主动调度自愈（window.__scheduleReflowFix）
  assertTrue(/window\.__scheduleReflowFix/.test(html), '应暴露 __scheduleReflowFix 供 showChat 调用');
  assertTrue(/__scheduleReflowFix\(\)/.test(html), 'showChat 应主动调度自愈');
  // ⑨ 用户在输入时跳过强制重排（避免 display:none 导致输入框失焦丢光标）
  assertTrue(/activeElement\s*===\s*inputBox/.test(html), '输入框聚焦时 forceReflowFix 应跳过');
  // ⑩ 滚动位置尊重：重排后恢复用户滚动位置（wasNearBottom 判断）
  assertTrue(/wasNearBottom/.test(html), '应根据用户是否在消息列表底部决定滚动策略');
  // ⑪ 自愈注册晚于视图切换的时序倒挂补触发（chat 已先行显示时补调度）
  assertTrue(/if\s*\(vc\s*&&\s*!vc\.classList\.contains\('hidden'\)\)\s*scheduleReflowFix\(\)/.test(html), 'chat 已先行显示时应补触发自愈');
  // ⑫ 强制重排最小间隔 300ms（提前到所有 DOM 访问之前，拦截时零 DOM 触碰）
  assertTrue(/lastForceReflowAt/.test(html), '应有强制重排最小间隔状态');
  assertTrue(/if\s*\(now\s*-\s*lastForceReflowAt\s*<\s*300\)\s*return/.test(html), '最小间隔检查应提前到 DOM 访问之前');
  // ⑬ scrollToBottom 内部判空
  assertTrue(/if\s*\(\$messages\)\s*\$messages\.scrollTop/.test(html), 'scrollToBottom 应判空防 TypeError');
  // ⑭ .app 成功找到后重置连续失败计数
  assertTrue(/reflowRetryCount\s*=\s*0/.test(html), '.app 找到后应重置重试计数');
  // ⑮ heads 为空时复查视为未修复（持续可重试）
  assertTrue(/reflowOk\s*=\s*heads\.length\s*>\s*0/.test(html), 'heads 为空时复查应视为未修复');
  // ⑯ 重排前保存滚动位置、重排后恢复（防 display:none 重置 scrollTop 丢位置）
  assertTrue(/savedScrollTop/.test(html), '应保存重排前滚动位置');
  assertTrue(/messagesEl\.scrollTop\s*=\s*savedScrollTop/.test(html), '重排后应恢复用户滚动位置');
  // ⑰ 定时器兜底走 scheduleReflowFix（300ms 最小间隔 + 状态位一致）
  assertTrue(/Date\.now\(\)\s*-\s*lastForceReflowAt\s*<\s*300/.test(html), 'scheduleReflowFix 应含最小间隔检查');
  // ⑱ visibilitychange 隐藏时复位 reflowFixed（切走标签 WebView 重建后必须重新检查）
  assertTrue(/document\.hidden\s*\)\s*\{\s*reflowFixed\s*=\s*false/.test(html), 'visibilitychange 隐藏时应复位已修复状态');
  // ⑲ showChat 无条件调用（typeof 检查移除，由 IIFE 补触发兜底时序倒挂）
  assertTrue(/if\s*\(window\.__scheduleReflowFix\)\s*window\.__scheduleReflowFix\(\)/.test(html), 'showChat 应直接调用（IIFE 补触发兜底）');
});

// ==================== 测试结果汇总 ====================

console.log('\n========== 测试结果 ==========');
console.log('总计: ' + testCount + ' 个测试');
console.log('通过: ' + testResults.filter(function (r) { return r.status === 'PASS'; }).length + ' 个');
var failed = testResults.filter(function (r) { return r.status === 'FAIL'; });
console.log('失败: ' + failed.length + ' 个');

if (failed.length === 0) {
  console.log('\n✓ 所有任务窗格停靠测试通过!\n');
  process.exit(0);
} else {
  console.log('\n✗ 部分测试失败!');
  failed.forEach(function (r) {
    console.log('  - ' + r.name + ': ' + r.error);
  });
  process.exit(1);
}
