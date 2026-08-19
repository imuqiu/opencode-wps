/**
 * 任务窗格停靠位置测试套件（PR #79 评审整改 ③：零测试防线 → 补真实单测）
 *
 * 通过 vm 加载生产源码 opencode-wps/main.js（与 CI 中 node --check 同源），
 * mock window.Application（CreateTaskPane / GetTaskPane / PluginStorage），
 * 共 20 个用例，覆盖：
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
 *
 * 清理说明（Issue #78）：此前为修复「头部被遮挡」问题新增的宿主重绘（forceTaskPaneRedraw /
 * scheduleTaskPaneOpenRedraw / registerWindowActivateReflow）与页面自愈（taskpane.html reflow）
 * 相关用例已随无效修复代码一并删除——经 6 轮实机验证确认该问题为 WPS 宿主 bug，修复无效。
 * 本文件仅保留任务窗格创建/切换的通用健壮性用例（与 WPS bug 无关）。
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
  var timeoutMap = {}; // id → 回调映射，clearTimeout 按 id 标记取消
  var timeoutIdCounter = 0;
  var sandbox = {
    window: {
      Application: appMock,
      // OnAddinLoad 会给 Application.Enum 赋值；mock 上允许动态加属性即可
    },
    console: {
      log: function () {},
      warn: function () {},
      error: function (msg) {
        errorLogs.push(String(msg));
      },
    },
    alert: function () {},
    setInterval: function () {
      return 0;
    },
    clearInterval: function () {},
    // 用自增 id 跟踪 setTimeout 回调，clearTimeout 按 id 标记取消（评审 info 4：
    // 比「id = 数组索引」更健壮，多次调用也不依赖队列中回调的当前位置）
    setTimeout: function (cb) {
      var id = ++timeoutIdCounter;
      timeoutMap[id] = cb;
      timeoutQueue.push(id);
      return id;
    },
    clearTimeout: function (id) {
      // 支持 cancelFirstOpenLayoutCorrection 的 clearTimeout 调用
      if (typeof id === 'number' && timeoutMap[id]) {
        delete timeoutMap[id]; // 从 map 中移除，__flushTimeouts 跳过
      }
    },
    XMLHttpRequest: function () {
      this.open = function () {};
      this.send = function () {};
      this.setRequestHeader = function () {};
    },
    __errorLogs: errorLogs,
    // 手动执行已排队的 setTimeout 回调（按 FIFO），返回执行次数
    // 已通过 clearTimeout 取消的回调（从 timeoutMap 中删除）会被跳过
    __flushTimeouts: function () {
      var n = 0;
      while (timeoutQueue.length) {
        var id = timeoutQueue.shift();
        var cb = timeoutMap[id];
        if (cb) {
          cb();
          n++;
        }
        delete timeoutMap[id];
      }
      return n;
    },
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
  assertTrue(
    typeof WPS_Enum.msoCTPDockPositionTop === 'undefined',
    'msoCTPDockPositionTop 不应存在'
  );
  assertTrue(
    typeof WPS_Enum.msoCTPDockPositionBottom === 'undefined',
    'msoCTPDockPositionBottom 不应存在'
  );
  assertEqual(WPS_Enum.msoCTPDockPositionRight, 2, 'msoCTPDockPositionRight 应为 2');
  // 所有枚举值唯一
  var values = Object.keys(WPS_Enum).map(function (k) {
    return WPS_Enum[k];
  });
  var unique = values.filter(function (v, i) {
    return values.indexOf(v) === i;
  });
  assertEqual(unique.length, values.length, '枚举值存在冲突（重复数值）');
});

test('CreateTaskPane 仅传 url 单参数（评审 ② API 签名稳妥用法）', function () {
  var createCalls = [];
  var appMock = {
    CreateTaskPane: function (url) {
      createCalls.push({ url: url, argsCount: arguments.length });
      return { ID: 'tp-1', DockPosition: undefined, Visible: false };
    },
    GetTaskPane: function () {
      return { DockPosition: undefined, Visible: false };
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
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
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      return { DockPosition: undefined, Visible: false };
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createdPane.DockPosition, 2, '首次创建后 DockPosition 应为 2 (Right)');
  assertEqual(createdPane.Visible, true, '创建后应可见');
});

test('再次打开：已存在 taskpane_id 时重新校正 DockPosition', function () {
  var existingPane = { DockPosition: 0, Visible: false };
  var appMock = {
    CreateTaskPane: function () {
      throw new Error('不应调用 CreateTaskPane');
    },
    GetTaskPane: function () {
      return existingPane;
    },
    PluginStorage: {
      getItem: function () {
        return 'tp-existing';
      },
      setItem: function () {},
    },
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
    CreateTaskPane: function () {
      return recreatedPane;
    },
    GetTaskPane: function () {
      return null;
    },
    PluginStorage: {
      getItem: function () {
        return 'tp-stale';
      },
      setItem: function (k, v) {
        setItemCalls.push([k, v]);
      },
    },
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(recreatedPane.DockPosition, 2, '回退重建后 DockPosition 应校正为 2');
  assertEqual(recreatedPane.Visible, true, '回退重建后应可见');
  var hasTaskPaneId = setItemCalls.some(function (c) {
    return c[0] === 'taskpane_id' && c[1] === 'tp-new';
  });
  assertTrue(hasTaskPaneId, '应更新 PluginStorage 中的 taskpane_id 为新窗格 ID');
});

test('GetTaskPane 抛异常（个别版本对无效 id 抛错）：回退重建窗格并留痕', function () {
  var recreatedPane = { ID: 'tp-new2', DockPosition: undefined, Visible: false };
  var setItemCalls = [];
  var appMock = {
    CreateTaskPane: function () {
      return recreatedPane;
    },
    GetTaskPane: function () {
      throw new Error('invalid taskpane id');
    },
    PluginStorage: {
      getItem: function () {
        return 'tp-stale';
      },
      setItem: function (k, v) {
        setItemCalls.push([k, v]);
      },
    },
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(recreatedPane.DockPosition, 2, '回退重建后 DockPosition 应校正为 2');
  assertEqual(recreatedPane.Visible, true, '回退重建后应可见');
  var hasTaskPaneId = setItemCalls.some(function (c) {
    return c[0] === 'taskpane_id' && c[1] === 'tp-new2';
  });
  assertTrue(hasTaskPaneId, '应更新 PluginStorage 中的 taskpane_id 为新窗格 ID');
  var hasError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('GetTaskPane 获取任务窗格失败') >= 0;
  });
  assertTrue(
    hasError,
    '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs)
  );
});

test('DockPosition 设置失败：console.error 留痕（评审 ③ 不空吞异常）', function () {
  var pane = {
    ID: 'tp-fail',
    set DockPosition(v) {
      throw new Error('DockPosition 只读');
    },
    Visible: false,
  };
  var appMock = {
    CreateTaskPane: function () {
      return pane;
    },
    GetTaskPane: function () {
      return pane;
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  var hasError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('设置任务窗格停靠位置失败') >= 0;
  });
  assertTrue(
    hasError,
    '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs)
  );
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
    GetTaskPane: function () {
      throw new Error('不应调用 GetTaskPane');
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function (k, v) {
        setItemCalls.push([k, v]);
      },
    },
  };
  var sandbox = loadMainJs(appMock);
  var ret = sandbox.createTaskPane();
  assertEqual(ret, createdPane, '应返回创建的任务窗格对象');
  assertEqual(createCalls.length, 1, 'CreateTaskPane 应被调用 1 次');
  assertEqual(createCalls[0].argsCount, 1, 'CreateTaskPane 第二参数不应传入');
  var hasTaskPaneId = setItemCalls.some(function (c) {
    return c[0] === 'taskpane_id' && c[1] === 'tp-c';
  });
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
    CreateTaskPane: function () {
      return recreatedPane;
    },
    GetTaskPane: function () {
      throw new Error('不应调用 GetTaskPane');
    },
    PluginStorage: {
      getItem: function () {
        throw new Error('PluginStorage 未就绪');
      },
      setItem: function () {},
    },
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(recreatedPane.DockPosition, 2, 'getItem 异常后回退重建，DockPosition 应校正为 2');
  assertEqual(recreatedPane.Visible, true, '回退重建后应可见');
  var hasError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('读取 taskpane_id 失败') >= 0;
  });
  assertTrue(
    hasError,
    '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs)
  );
});

test('CreateTaskPane 抛异常（路径无效等）：失败留痕并返回 null，不中断（评审 ⑥ 统一兜底）', function () {
  var appMock = {
    CreateTaskPane: function () {
      throw new Error('taskpane.html 路径无效');
    },
    GetTaskPane: function () {
      throw new Error('不应调用 GetTaskPane');
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' }); // 不应抛异常
  assertEqual(sandbox.createTaskPane(), null, 'createTaskPane 失败应返回 null');
  var hasError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('初始化任务窗格失败') >= 0;
  });
  assertTrue(
    hasError,
    '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs)
  );
});

test('PluginStorage.setItem 抛异常（初始化未完成）：留痕后继续校正停靠并置可见（评审 ⑦ 统一兜底）', function () {
  var createdPane = { ID: 'tp-setitem-fail', DockPosition: undefined, Visible: false };
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      throw new Error('不应调用 GetTaskPane');
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {
        throw new Error('PluginStorage 未就绪');
      },
    },
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' }); // 不应抛异常
  // setItem 失败不应中断后续初始化：DockPosition 校正 + Visible 置位照常执行
  assertEqual(createdPane.DockPosition, 2, 'setItem 失败后 DockPosition 仍应校正为 2');
  assertEqual(createdPane.Visible, true, 'setItem 失败后窗格仍应可见');
  var hasError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('保存 taskpane_id 失败') >= 0;
  });
  assertTrue(
    hasError,
    '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs)
  );
});

test('切换可见性失败（tp.Visible 只读）：留痕不中断按钮回调（评审 ⑧ 统一兜底）', function () {
  var existingPane = { DockPosition: 0 };
  Object.defineProperty(existingPane, 'Visible', {
    get: function () {
      return false;
    },
    set: function () {
      throw new Error('Visible 只读');
    },
  });
  var appMock = {
    CreateTaskPane: function () {
      throw new Error('不应调用 CreateTaskPane');
    },
    GetTaskPane: function () {
      return existingPane;
    },
    PluginStorage: {
      getItem: function () {
        return 'tp-existing';
      },
      setItem: function () {},
    },
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' }); // 不应抛异常
  assertEqual(existingPane.DockPosition, 2, '切换前仍应完成 DockPosition 校正');
  var hasError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('切换任务窗格可见性失败') >= 0;
  });
  assertTrue(
    hasError,
    '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs)
  );
});

test('GetTaskPane 找回路径停靠校正失败：补充「窗格仍可用」留痕，不中断可见性切换（评审 ⑭ 行为一致性）', function () {
  // 已存在任务窗格（GetTaskPane 找回路径）：DockPosition 只读抛异常（停靠校正失败）
  var existingPane = { ID: 'tp-existing-dockfail', Visible: false };
  Object.defineProperty(existingPane, 'DockPosition', {
    get: function () {
      return undefined;
    },
    set: function () {
      throw new Error('DockPosition 只读');
    },
  });
  var appMock = {
    CreateTaskPane: function () {
      throw new Error('不应调用 CreateTaskPane');
    },
    GetTaskPane: function () {
      return existingPane;
    },
    PluginStorage: {
      getItem: function () {
        return 'tp-existing-dockfail';
      },
      setItem: function () {},
    },
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' }); // 不应抛异常
  // 停靠校正失败不阻断：可见性切换照常执行（false → true）
  assertEqual(existingPane.Visible, true, '停靠校正失败后可见性切换仍应执行');
  // 双层留痕：内部「设置任务窗格停靠位置失败」+ 增强「窗格仍可用」
  var hasDockError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('设置任务窗格停靠位置失败') >= 0;
  });
  assertTrue(
    hasDockError,
    '应输出停靠设置失败留痕（setTaskPaneDockPosition 内部），实际错误日志: ' +
      JSON.stringify(sandbox.__errorLogs)
  );
  var hasUsable = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('任务窗格停靠校正失败（窗格仍可用') >= 0;
  });
  assertTrue(
    hasUsable,
    '应输出「窗格仍可用」增强留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs)
  );
});

test('createTaskPane 内 Visible 置位失败：留痕后仍返回窗格对象（评审 ⑨ 自愈兜底）', function () {
  var createdPane = { ID: 'tp-visible-fail', DockPosition: undefined };
  Object.defineProperty(createdPane, 'Visible', {
    get: function () {
      return false;
    },
    set: function () {
      throw new Error('Visible 只读');
    },
  });
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      throw new Error('不应调用 GetTaskPane');
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  var sandbox = loadMainJs(appMock);
  var ret = sandbox.createTaskPane();
  // 关键：不再返回 null，而是返回窗格对象——保留下次点击自愈机会（GetTaskPane 找回 → 重新校正 + 切换可见性）
  assertEqual(ret, createdPane, 'Visible 置位失败仍应返回窗格对象');
  assertEqual(createdPane.DockPosition, 2, 'DockPosition 仍应校正为 2');
  var hasError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('置任务窗格可见失败') >= 0;
  });
  assertTrue(
    hasError,
    '应输出 console.error 留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs)
  );
});

test('setItem 持久化失败：内存 ID 兜底，再次点击不重复创建（评审 ⑩ 多窗格防叠加）', function () {
  var createdPane = { ID: 'tp-cache', DockPosition: undefined, Visible: false };
  var createCalls = 0;
  var appMock = {
    CreateTaskPane: function () {
      createCalls++;
      return createdPane;
    },
    GetTaskPane: function () {
      return createdPane;
    }, // 内存 ID 能找回窗格
    PluginStorage: {
      getItem: function () {
        throw new Error('PluginStorage 未就绪');
      }, // 持久化读取也失败
      setItem: function () {
        throw new Error('PluginStorage 未就绪');
      }, // 持久化写入失败
    },
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
  var hasError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('保存 taskpane_id 失败') >= 0;
  });
  assertTrue(
    hasError,
    '应输出 setItem 失败留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs)
  );
});

test('CreateTaskPane 返回的窗格 ID 为空：留痕但不覆盖既有内存缓存（评审 ⑫ 空值防御）', function () {
  var createdPane = { ID: undefined, DockPosition: undefined, Visible: false };
  var setItemCalls = [];
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      throw new Error('不应调用 GetTaskPane');
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function (k, v) {
        setItemCalls.push([k, v]);
      },
    },
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
  var hasError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('任务窗格 ID 为空') >= 0;
  });
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
    CreateTaskPane: function () {
      return null;
    },
    GetTaskPane: function () {
      throw new Error('不应调用 GetTaskPane');
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  var sandbox = loadMainJs(appMock);
  var ret = sandbox.createTaskPane();
  assertEqual(ret, null, 'CreateTaskPane 返回 null 时 createTaskPane 应返回 null');
  // 留痕文案应明确指向「返回空对象」，而非误导性的「初始化任务窗格失败」
  var hasError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('CreateTaskPane 返回空对象') >= 0;
  });
  assertTrue(hasError, '应输出明确留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs));
  var hasMisleading = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('初始化任务窗格失败') >= 0;
  });
  assertTrue(
    !hasMisleading,
    '不应走到误导性的外层 catch 文案，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs)
  );
});

test('停靠校正失败但窗格可用：留痕说明窗格仍可用，仍返回窗格对象（评审 ⑬）', function () {
  var createdPane = { ID: 'tp-dock-fail', Visible: false };
  Object.defineProperty(createdPane, 'DockPosition', {
    get: function () {
      return undefined;
    },
    set: function () {
      throw new Error('DockPosition 只读');
    },
  });
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      throw new Error('不应调用 GetTaskPane');
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  var sandbox = loadMainJs(appMock);
  var ret = sandbox.createTaskPane();
  // 停靠校正失败不阻断：仍置可见并返回窗格对象（下次点击经 GetTaskPane 找回重新校正，有自愈机会）
  assertEqual(ret, createdPane, '停靠校正失败仍应返回窗格对象');
  assertEqual(createdPane.Visible, true, '停靠校正失败后仍应置可见');
  var hasDockError = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('设置任务窗格停靠位置失败') >= 0;
  });
  assertTrue(
    hasDockError,
    '应输出停靠设置失败留痕（setTaskPaneDockPosition 内部），实际错误日志: ' +
      JSON.stringify(sandbox.__errorLogs)
  );
  var hasUsable = sandbox.__errorLogs.some(function (l) {
    return l.indexOf('任务窗格停靠校正失败（窗格仍可用') >= 0;
  });
  assertTrue(
    hasUsable,
    '应输出「窗格仍可用」增强留痕，实际错误日志: ' + JSON.stringify(sandbox.__errorLogs)
  );
});

// ==================== 测试结果汇总 ====================

test('首次创建路径调度宿主重排校正（等效新建标签切回，Issue #164）', function () {
  var createdPane = { ID: 'tp-first', DockPosition: undefined, Visible: false };
  var visibleOps = [];
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      return { DockPosition: undefined, Visible: false };
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  // 记录 DockPosition / Visible 写入序列，验证宿主重排校正触发了「隐藏→显示」
  Object.defineProperty(createdPane, 'DockPosition', {
    set: function (v) {
      this._dp = v;
    },
    get: function () {
      return this._dp;
    },
  });
  Object.defineProperty(createdPane, 'Visible', {
    set: function (v) {
      visibleOps.push(v);
      this._vis = v;
    },
    get: function () {
      return this._vis;
    },
  });

  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createdPane.DockPosition, 2, '首次创建后 DockPosition 应为 Right(2)');

  // 手动执行排队的 setTimeout 回调（等效延迟 FIRST_OPEN_RELAYOUT_DELAY_MS 后触发宿主重排校正）
  var n = sandbox.__flushTimeouts();
  assertTrue(n >= 1, '首次创建后应排程宿主重排校正回调，实际执行 ' + n + ' 个');

  // 校正逻辑：重新断言 DockPosition，并执行「隐藏→显示」宿主重排
  assertEqual(createdPane.DockPosition, 2, '宿主重排校正应重新断言 DockPosition 为 Right(2)');
  assertEqual(
    visibleOps[visibleOps.length - 1],
    true,
    '宿主重排校正应以「显示」收尾（隐藏→显示后最终可见）'
  );
  var hasHide = visibleOps.some(function (v) {
    return v === false;
  });
  assertTrue(hasHide, '宿主重排校正应包含一次「隐藏」以强制宿主重建窗口');
});

test('非首次创建（GetTaskPane 找回）路径不调度宿主重排校正', function () {
  var existingPane = { DockPosition: 0, Visible: false };
  var appMock = {
    CreateTaskPane: function () {
      throw new Error('不应调用 CreateTaskPane');
    },
    GetTaskPane: function () {
      return existingPane;
    },
    PluginStorage: {
      getItem: function () {
        return 'tp-existing';
      },
      setItem: function () {},
    },
  };
  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  // 非首次打开不排程首次校正
  var n = sandbox.__flushTimeouts();
  assertEqual(n, 0, '非首次创建路径不应调度首次宿主重排校正，实际执行 ' + n + ' 个');
  assertEqual(existingPane.DockPosition, 2, '再次打开仍应重新校正 DockPosition 为 Right(2)');
});

test('竞态防护：首次创建后用户已手动隐藏面板，宿主重排校正跳过（评审 warning 修复）', function () {
  var createdPane = { ID: 'tp-race', DockPosition: undefined, Visible: false };
  var visibleOps = [];
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      return { DockPosition: undefined, Visible: false };
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  Object.defineProperty(createdPane, 'DockPosition', {
    set: function (v) {
      this._dp = v;
    },
    get: function () {
      return this._dp;
    },
  });
  Object.defineProperty(createdPane, 'Visible', {
    set: function (v) {
      visibleOps.push(v);
      this._vis = v;
    },
    get: function () {
      return this._vis;
    },
  });

  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  // createTaskPane 置 Visible=true，随后模拟用户通过【非 OnAction 路径】把面板隐藏
  // （R6 评审 P2-3：真实用户走 OnAction else 分支会先 cancel timer；此处模拟的是用户
  //  通过 WPS 原生关闭按钮等非插件路径隐藏面板——此时 timer 未被取消，回调仍会触发）
  assertEqual(createdPane.Visible, true, '首次创建后应可见');
  createdPane.Visible = false; // 模拟非 OnAction 路径隐藏面板（等效延迟窗口内被隐藏）
  var opsBeforeFlush = visibleOps.length;

  // 触发延迟回调
  var n = sandbox.__flushTimeouts();
  assertTrue(n >= 1, '首次创建后应排程宿主重排校正回调，实际执行 ' + n + ' 个');

  // 竞态防护生效：用户已隐藏时不执行隐藏→显示，面板保持隐藏，也不被强拉回显示
  assertEqual(createdPane.Visible, false, '用户已隐藏面板时，校正应跳过且不把面板强拉回来');
  // 回调内不应产生新的隐藏→显示写入（仅可能有的是一开始 createTaskPane 的可见性写入）
  assertEqual(
    visibleOps.length,
    opsBeforeFlush,
    '竞态防护：用户已隐藏时不应追加隐藏→显示可见性写入'
  );
});

test('停靠校正失败跳过重排：setTaskPaneDockPosition 返回 false 时不再隐藏→显示（评审 warning 修复）', function () {
  var createdPane = { ID: 'tp-dockfail', DockPosition: undefined, Visible: false };
  var visibleOps = [];
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      return { DockPosition: undefined, Visible: false };
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  // DockPosition setter 抛异常 → setTaskPaneDockPosition 返回 false
  Object.defineProperty(createdPane, 'DockPosition', {
    set: function () {
      throw new Error('dock set failed');
    },
    get: function () {
      return undefined;
    },
  });
  Object.defineProperty(createdPane, 'Visible', {
    set: function (v) {
      visibleOps.push(v);
      this._vis = v;
    },
    get: function () {
      return this._vis;
    },
  });

  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  // createTaskPane 内第一次 DockPosition 校正就失败，但窗格仍置可见并返回；
  // 首次创建路径仍会排程校正回调
  assertEqual(createdPane.Visible, true, 'createTaskPane 停靠失败但仍应置可见');
  var opsBeforeFlush = visibleOps.length;

  var n = sandbox.__flushTimeouts();
  assertTrue(n >= 1, '首次创建后应排程宿主重排校正回调，实际执行 ' + n + ' 个');

  // 停靠校正失败时跳过隐藏→显示，不追加可见性写入
  assertEqual(visibleOps.length, opsBeforeFlush, '停靠校正失败时应跳过隐藏→显示，不追加可见性写入');
  assertEqual(createdPane.Visible, true, '停靠校正失败时面板可见性保持不变');
  assertTrue(
    sandbox.__errorLogs.some(function (m) {
      return String(m).indexOf('停靠位置校正失败') >= 0;
    }),
    '停靠校正失败跳过时应留痕'
  );
});

test('竞态防护：通过第二次 OnAction 点击隐藏面板后，校正取消（评审 info 4 + info 5）', function () {
  var createdPane = { ID: 'tp-race2', DockPosition: undefined, Visible: false };
  var visibleOps = [];
  var callCount = 0; // 跟踪 OnAction 调用次数
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      return createdPane;
    },
    PluginStorage: {
      getItem: function () {
        // 第一次调用返回空（走 createTaskPane 路径），之后返回已持久化 ID
        callCount++;
        return callCount === 1 ? '' : 'tp-race2';
      },
      setItem: function () {},
    },
  };
  Object.defineProperty(createdPane, 'DockPosition', {
    set: function (v) {
      this._dp = v;
    },
    get: function () {
      return this._dp;
    },
  });
  Object.defineProperty(createdPane, 'Visible', {
    set: function (v) {
      visibleOps.push(v);
      this._vis = v;
    },
    get: function () {
      return this._vis;
    },
  });

  var sandbox = loadMainJs(appMock);
  // 第一次点击：创建任务窗格并调度校正
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createdPane.Visible, true, '首次创建后应可见');
  // 第二次点击：走 GetTaskPane 分支，切换 Visible 为 false（用户隐藏面板）
  // 评审 info 4：隐藏面板时应同时取消排队中的校正 timer
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createdPane.Visible, false, '第二次点击应切换为隐藏');
  var opsBeforeFlush = visibleOps.length;

  // 触发延迟回调（已取消，不应执行任何回调）
  var n = sandbox.__flushTimeouts();
  assertEqual(n, 0, '用户隐藏面板后校正 timer 已被取消，实际执行 ' + n + ' 个');

  // 用户隐藏面板后校正被取消，不把面板强拉回来
  assertEqual(createdPane.Visible, false, '用户通过第二次点击隐藏面板后，校正应取消');
  assertEqual(visibleOps.length, opsBeforeFlush, '隐藏面板后校正取消，不应追加任何可见性写入');
});

test('任务窗格销毁时 Visible 读取抛 COM 异常：宿主重排校正失败留痕且不崩溃（评审 warning 1）', function () {
  var deadPane = { ID: 'tp-dead', DockPosition: undefined, Visible: false };
  var getCount = 0;
  // Visible getter：第一次正常（assert 验证），第二次抛 COM 异常（模拟对象在延迟窗口内被销毁）
  Object.defineProperty(deadPane, 'Visible', {
    set: function (v) {
      this._vis = v;
    },
    get: function () {
      getCount++;
      if (getCount >= 2) {
        throw new Error('COM object destroyed');
      }
      return this._vis;
    },
  });
  Object.defineProperty(deadPane, 'DockPosition', {
    set: function (v) {
      this._dp = v;
    },
    get: function () {
      return this._dp;
    },
  });
  var appMock = {
    CreateTaskPane: function () {
      return deadPane;
    },
    GetTaskPane: function () {
      return deadPane;
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };

  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  // createTaskPane 置可见：第1次读（检查有效）、第2次读（可见性）
  assertEqual(deadPane.Visible, true, '首次创建后应可见');

  // 触发延迟回调：第3次读取 Visible 时抛 COM 异常
  var n = sandbox.__flushTimeouts();
  assertTrue(n >= 1, '首次创建后应排程宿主重排校正回调，实际执行 ' + n + ' 个');
  // 异常被捕获，面板保持可见，不崩溃
  assertTrue(
    sandbox.__errorLogs.some(function (m) {
      return String(m).indexOf('宿主重排校正失败') >= 0;
    }),
    '任务窗格销毁时应留痕为宿主重排校正失败'
  );
});

// 注（评审 info 5）：cancelFirstOpenLayoutCorrection 目前仅在内部调度和此测试中使用，
// 主回调通过 try/catch 已覆盖对象销毁场景。后续若需要在文档关闭等真实事件中精确取消，
// 可在相应事件处理函数中调用该函数。
test('取消排程：cancelFirstOpenLayoutCorrection 后回调不再执行（评审 info 4）', function () {
  var createdPane = { ID: 'tp-cancel', DockPosition: undefined, Visible: false };
  var visibleOps = [];
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      return createdPane;
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  Object.defineProperty(createdPane, 'DockPosition', {
    set: function (v) {
      this._dp = v;
    },
    get: function () {
      return this._dp;
    },
  });
  Object.defineProperty(createdPane, 'Visible', {
    set: function (v) {
      visibleOps.push(v);
      this._vis = v;
    },
    get: function () {
      return this._vis;
    },
  });

  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createdPane.Visible, true, '首次创建后应可见');

  // 取消已排程的校正
  sandbox.cancelFirstOpenLayoutCorrection();
  var opsBeforeFlush = visibleOps.length;

  // 触发延迟回调（已被取消，不会执行）
  var n = sandbox.__flushTimeouts();
  assertEqual(n, 0, '取消后不应执行任何校正回调，实际执行 ' + n + ' 个');
  assertEqual(createdPane.Visible, true, '取消后面板可见性不变');
  assertEqual(visibleOps.length, opsBeforeFlush, '取消后不应追加任何可见性写入');
});

test('降级开关禁用时不调度宿主重排校正（R6 评审 P1-1）', function () {
  var createdPane = { ID: 'tp-disabled', DockPosition: undefined, Visible: false };
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      return { DockPosition: undefined, Visible: false };
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  Object.defineProperty(createdPane, 'DockPosition', {
    set: function (v) {
      this._dp = v;
    },
    get: function () {
      return this._dp;
    },
  });
  Object.defineProperty(createdPane, 'Visible', {
    set: function (v) {
      this._vis = v;
    },
    get: function () {
      return this._vis;
    },
  });

  var sandbox = loadMainJs(appMock);
  // 关闭降级开关：实机验证假设不成立时一键禁用
  sandbox.WPS_LAYOUT_CORRECTION_ENABLED = false;
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createdPane.DockPosition, 2, '降级开关禁用时仍应正常创建窗格并校正停靠');
  assertEqual(createdPane.Visible, true, '降级开关禁用时窗格仍应可见');
  // 不排程校正回调
  var n = sandbox.__flushTimeouts();
  assertEqual(n, 0, '降级开关禁用时不应排程宿主重排校正，实际执行 ' + n + ' 个');
});

test('内部标记防重复调度：首次排程后再调用 scheduleFirstOpenLayoutCorrection 不重复（R6 评审 P3-1）', function () {
  var createdPane = { ID: 'tp-once', DockPosition: undefined, Visible: false };
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      return createdPane;
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  Object.defineProperty(createdPane, 'DockPosition', {
    set: function (v) {
      this._dp = v;
    },
    get: function () {
      return this._dp;
    },
  });
  Object.defineProperty(createdPane, 'Visible', {
    set: function (v) {
      this._vis = v;
    },
    get: function () {
      return this._vis;
    },
  });

  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createdPane.Visible, true, '首次创建后应可见');

  // 首次调度：已排程校正回调
  var n1 = sandbox.__flushTimeouts();
  assertTrue(n1 >= 1, '首次创建后应排程宿主重排校正，实际执行 ' + n1 + ' 个');

  // 再次显式调用 scheduleFirstOpenLayoutCorrection（模拟维护者误在非首次路径调用）：
  // 内部标记 firstOpenLayoutCorrectionScheduled 应为 true，直接跳过不重复调度
  sandbox.scheduleFirstOpenLayoutCorrection(createdPane);
  var n2 = sandbox.__flushTimeouts();
  assertEqual(n2, 0, '内部标记生效后不应重复调度校正回调，实际执行 ' + n2 + ' 个');
});

test('cancel 后重置排程标记：可重新调度（R7 评审 N7-1）', function () {
  var createdPane = { ID: 'tp-resched', DockPosition: undefined, Visible: false };
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      return createdPane;
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  Object.defineProperty(createdPane, 'DockPosition', {
    set: function (v) {
      this._dp = v;
    },
    get: function () {
      return this._dp;
    },
  });
  Object.defineProperty(createdPane, 'Visible', {
    set: function (v) {
      this._vis = v;
    },
    get: function () {
      return this._vis;
    },
  });

  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createdPane.Visible, true, '首次创建后应可见');

  // 首次调度：已排程校正回调
  var n1 = sandbox.__flushTimeouts();
  assertTrue(n1 >= 1, '首次创建后应排程宿主重排校正，实际执行 ' + n1 + ' 个');

  // 取消排程（模拟 OnAction else 分支用户隐藏面板）：标记应重置
  sandbox.cancelFirstOpenLayoutCorrection();
  assertEqual(
    sandbox.firstOpenLayoutCorrectionScheduled,
    false,
    'cancel 后 firstOpenLayoutCorrectionScheduled 应重置为 false'
  );

  // 取消后可重新调度（模拟再次进入首次创建路径，如同会话内 createTaskPane 重试）
  sandbox.scheduleFirstOpenLayoutCorrection(createdPane);
  var n2 = sandbox.__flushTimeouts();
  assertTrue(n2 >= 1, 'cancel 重置后应可重新调度校正回调，实际执行 ' + n2 + ' 个');
});

test('setTimeout 异常后重置排程标记：可重试（R8 评审 N8-1）', function () {
  var createdPane = { ID: 'tp-timeouterr', DockPosition: undefined, Visible: false };
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      return createdPane;
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  Object.defineProperty(createdPane, 'DockPosition', {
    set: function (v) {
      this._dp = v;
    },
    get: function () {
      return this._dp;
    },
  });
  Object.defineProperty(createdPane, 'Visible', {
    set: function (v) {
      this._vis = v;
    },
    get: function () {
      return this._vis;
    },
  });

  var sandbox = loadMainJs(appMock);

  // 模拟 setTimeout 抛异常（COM 环境异常）：替换 sandbox.setTimeout
  var origSetTimeout = sandbox.setTimeout;
  var failCount = 1; // 仅第一次调度抛异常
  sandbox.setTimeout = function () {
    if (failCount-- > 0) {
      throw new Error('setTimeout COM error');
    }
    return origSetTimeout.apply(null, arguments);
  };

  // 首次 OnAction：setTimeout 异常，标记应重置（不抛到 OnAction 外层，被内部 catch 捕获）
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createdPane.Visible, true, 'setTimeout 异常时窗格仍应可见（不阻断主流程）');
  assertEqual(
    sandbox.firstOpenLayoutCorrectionScheduled,
    false,
    'setTimeout 异常后 firstOpenLayoutCorrectionScheduled 应重置为 false'
  );
  assertTrue(
    sandbox.__errorLogs.some(function (m) {
      return String(m).indexOf('调度首次打开宿主重排校正失败') >= 0;
    }),
    'setTimeout 异常应留痕'
  );

  // 恢复 sandbox.setTimeout（failCount 已为 0，后续调用走正常路径）
  sandbox.setTimeout = origSetTimeout;

  // 再次调度（模拟重试）：标记已重置，应可重新排程校正
  sandbox.scheduleFirstOpenLayoutCorrection(createdPane);
  var n = sandbox.__flushTimeouts();
  assertTrue(n >= 1, 'setTimeout 异常后重置标记，应可重新调度校正回调，实际执行 ' + n + ' 个');
});

test('隐藏成功但显示失败：恢复 Visible=true 避免面板消失（R6 评审 P1-2）', function () {
  var createdPane = { ID: 'tp-restore', DockPosition: undefined, Visible: false };
  var setCount = 0;
  var visibleOps = [];
  var appMock = {
    CreateTaskPane: function () {
      return createdPane;
    },
    GetTaskPane: function () {
      return { DockPosition: undefined, Visible: false };
    },
    PluginStorage: {
      getItem: function () {
        return '';
      },
      setItem: function () {},
    },
  };
  Object.defineProperty(createdPane, 'DockPosition', {
    set: function (v) {
      this._dp = v;
    },
    get: function () {
      return this._dp;
    },
  });
  // Visible setter：第 1 次设 true（createTaskPane）、第 2 次设 false（隐藏）、
  // 第 3 次设 true（显示，此步抛 COM 异常模拟显示失败）、
  // 第 4 次设 true（catch 中恢复 Visible=true）
  Object.defineProperty(createdPane, 'Visible', {
    set: function (v) {
      visibleOps.push(v);
      setCount++;
      // 第 3 次设 true（隐藏后显示）时抛异常：模拟显示失败
      if (setCount === 3 && v === true) {
        throw new Error('COM set Visible=true failed');
      }
      this._vis = v;
    },
    get: function () {
      return this._vis;
    },
  });

  var sandbox = loadMainJs(appMock);
  sandbox.OnAction({ Id: 'btnShowTaskPane' });
  assertEqual(createdPane.Visible, true, 'createTaskPane 应置可见');

  // 触发延迟回调：隐藏（setCount=2）→ 显示失败（setCount=3 抛异常）→ catch 中恢复
  var n = sandbox.__flushTimeouts();
  assertTrue(n >= 1, '首次创建后应排程宿主重排校正回调，实际执行 ' + n + ' 个');
  // catch 中尝试恢复 Visible=true：最终应保持可见
  assertEqual(createdPane.Visible, true, '显示失败后 catch 应恢复 Visible=true 避免面板消失');
  assertTrue(
    sandbox.__errorLogs.some(function (m) {
      return String(m).indexOf('宿主重排校正失败') >= 0;
    }),
    '显示失败应留痕为宿主重排校正失败'
  );
});

console.log('\n========== 测试结果 ==========');
console.log('总计: ' + testCount + ' 个测试');
console.log(
  '通过: ' +
    testResults.filter(function (r) {
      return r.status === 'PASS';
    }).length +
    ' 个'
);
var failed = testResults.filter(function (r) {
  return r.status === 'FAIL';
});
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
