// ========================================
// WPS 加载项 - OpenCode 集成
// ========================================

var OPENCODE_PORT = 14096;
var OPENCODE_HOST = '127.0.0.1';
var OPENCODE_API_BASE = 'http://' + OPENCODE_HOST + ':' + OPENCODE_PORT;
var LAUNCHER_API = 'http://' + OPENCODE_HOST + ':14097';

var OPENCODE_STATE = 'stopped';
var OPENCODE_ERROR = '';
var isProcessingCommand = false;

var WPS_Enum = {
  msoCTPDockPositionLeft: 0,
  msoCTPDockPositionRight: 2,
  msoFileDialogFolderPicker: 4,
  msoFileDialogOpen: 1,
};

// 任务窗格停靠位置（右侧，避免遮挡 WPS 顶部标签页：开始/插入等）
// 说明：停靠方向值直接取 WPS_Enum.msoCTPDockPositionRight（=2），
// 不新增 Top/Bottom 枚举 —— 其值（1/3）会与已有 msoFileDialogOpen(1) 冲突埋雷
var TASKPANE_DOCK_POSITION = WPS_Enum.msoCTPDockPositionRight;

// 首次打开宿主重排校正的延迟（ms）：等 WebView 初始布局稳定后再触发宿主重排。
// 依据：首次创建后宿主按错误几何布局必现，需在 WebView 已加载完成后（此时
// createTaskPane 的 Visible=true 已生效）再调度宿主重排；1000ms 为经验值，
// 兼顾「布局稳定」与「用户无感」，实机验证时若过早/过晚可在此统一调整。
var FIRST_OPEN_RELAYOUT_DELAY_MS = 1000;

// 首次打开宿主重排校正的降级开关（R6 评审 P1-1）：
// 本校正依赖「Visible=false→true 等效切标签宿主重排」这一【待实机验证】的假设。
// 实机验证发现假设不成立时，将本常量改为 false 即可一键禁用校正（避免每次首开都闪屏），
// 无需改动代码逻辑；验证通过后再改回 true。默认开启以便实机验证。
// N7-2 生命周期指引：实机验证通过后【保留本常量并保持 true】——作为未来 WPS 升级或其他
// 场景下遮挡问题复发的逃生舱（一键禁用即可定位是否本校正导致）；验证失败时改 false 并在
// 注释中标注「已验证无效，见 Issue #XXX」，便于后续维护者知悉。
var WPS_LAYOUT_CORRECTION_ENABLED = true;

// 内存 ID 兜底：PluginStorage.setItem 持久化失败（如插件初始化未完成）时，
// 本次会话内仍能避免再次点击重复 CreateTaskPane 造成多窗格叠加；
// WPS 重启后随插件内存清空，由 PluginStorage 持久化值接管（见文档注意事项第 10 条）
var taskpaneIdCache = '';

/**
 * 统一提取异常信息：e 可能是 Error 对象（取 .message），也可能是字符串等任意值
 * @param {*} e - try/catch 捕获的异常
 * @returns {*} 可读的错误描述（Error 取 .message，非 Error 值原样返回）
 */
function errMsg(e) {
  return e && e.message ? e.message : e;
}

/**
 * 校正任务窗格停靠位置（右侧），避免遮挡 WPS 顶部标签页（开始/插入等）
 * CreateTaskPane 仅传 url 单参数（官方签名稳妥用法），创建后通过
 * DockPosition 属性显式校正；每次打开/切换时也重新校正，防止位置漂移。
 * @param {object} tskpane - 任务窗格对象
 * @returns {boolean} true=设置成功；false=设置失败（已 console.error 留痕）
 */
function setTaskPaneDockPosition(tskpane) {
  if (!tskpane) {
    console.error('[WPS] setTaskPaneDockPosition: 无效的任务窗格对象');
    return false;
  }
  try {
    tskpane.DockPosition = TASKPANE_DOCK_POSITION;
    return true;
  } catch (e) {
    console.error('[WPS] 设置任务窗格停靠位置失败: ' + errMsg(e));
    return false;
  }
}

/**
 * 创建任务窗格并统一初始化：CreateTaskPane（单参数）→ 存 taskpane_id →
 * 校正停靠位置（右侧）→ 置可见。首次创建与 GetTaskPane 判空回退重建共用。
 * @returns {object} 创建并初始化好的任务窗格对象
 */
function createTaskPane() {
  try {
    var tskpane = window.Application.CreateTaskPane(GetUrlPath() + '/taskpane.html');
    // CreateTaskPane 个别版本可能返回 null（而非抛异常）：立即判空并给出明确留痕，
    // 避免后续 tskpane.ID 抛误导性的 TypeError（外层 catch 虽能兜住，但
    // 「初始化任务窗格失败」文案会把排查方向带偏到创建/存 ID/校正/置位全流程）
    if (!tskpane) {
      console.error('[WPS] 创建任务窗格失败: CreateTaskPane 返回空对象');
      return null;
    }
    // 内存 ID 兜底：无论 setItem 成败，先记录本次会话内有效 ID，
    // 避免持久化失败后再次点击重复 CreateTaskPane 造成多窗格叠加；
    // ID 为空（个别版本未回填）时留痕但不覆盖既有缓存，避免内存兜底失效
    if (tskpane.ID) {
      taskpaneIdCache = tskpane.ID;
      // setItem 与 getItem 同源同概率抛异常（如插件初始化未完成），单独 try/catch 留痕后继续：
      // 避免中断导致下方 DockPosition 校正与 Visible 置位被跳过（窗格创建了却永远不显示）；
      // 仅 ID 有效时才持久化——ID 为空时跳过写入，避免 setItem 持久化 undefined 覆盖既有有效 ID
      try {
        window.Application.PluginStorage.setItem('taskpane_id', tskpane.ID);
      } catch (e) {
        console.error('[WPS] 保存 taskpane_id 失败: ' + errMsg(e));
      }
    } else {
      console.error('[WPS] 任务窗格 ID 为空，内存兜底可能失效');
    }
    // 停靠校正失败（setTaskPaneDockPosition 内部已留痕）但窗格仍可用：
    // 不中断、继续置可见并返回窗格对象——下次点击经 GetTaskPane 找回后重新校正，
    // 有自愈机会；此处补充「窗格可用」留痕，使调用方可感知该状态（评审 ②）
    if (!setTaskPaneDockPosition(tskpane)) {
      console.error('[WPS] 任务窗格停靠校正失败（窗格仍可用，下次点击将重新校正）');
    }
    // Visible 置位单独 try/catch：窗格已创建、ID 已兜底，失败时留痕后仍返回窗格对象，
    // 保留下次点击自愈机会（GetTaskPane 能找回 → 重新校正 + 切换可见性）；
    // 若在此处 return null 会触发调用处误判「创建失败」，且无自愈路径
    try {
      tskpane.Visible = true;
    } catch (e) {
      console.error('[WPS] 置任务窗格可见失败: ' + errMsg(e));
    }
    return tskpane;
  } catch (e) {
    // 该 try 块涵盖 CreateTaskPane / 存 ID / DockPosition 校正 / Visible 置位全流程，
    // 任一步失败都会走到这里，文案用「初始化」更准确（避免误以为只是创建步骤失败）。
    // 注意：Visible 置位已内层 try/catch 兜底不会走到这里，此处实际仅兜 CreateTaskPane 本身失败
    console.error('[WPS] 初始化任务窗格失败: ' + errMsg(e));
    return null;
  }
}

// 首次打开宿主重排校正的 setTimeout 句柄
var firstOpenRelayoutTimer = null;
// 首次打开宿主重排校正是否已排程（R6 评审 P3-1）：仅首次创建路径调度一次，
// 防止非首次路径误调用导致重复隐藏→显示（可能闪屏）
var firstOpenLayoutCorrectionScheduled = false;

/**
 * 取消已排程的首次打开宿主重排校正。
 * 当前仅在 scheduleFirstOpenLayoutCorrection 内部用于取消旧排程（避免多次调用叠加）。
 * 主回调通过 try/catch 捕获 COM 异常已覆盖任务窗格销毁场景，此函数暂不集成到
 * 文档关闭等事件处理器中；若后续需要精确取消，可在相应事件处理函数中调用。
 */
function cancelFirstOpenLayoutCorrection() {
  if (firstOpenRelayoutTimer) {
    clearTimeout(firstOpenRelayoutTimer);
    firstOpenRelayoutTimer = null;
  }
  // N7-1 修复：取消后重置排程标记，使取消后若再次进入首次创建路径可重新调度。
  // 注意：scheduleFirstOpenLayoutCorrection 内部调用本函数后，会重新设置
  // firstOpenLayoutCorrectionScheduled=true（见其内部顺序），因此不会破坏防重复语义。
  firstOpenLayoutCorrectionScheduled = false;
}

/**
 * 首次打开后的宿主重排校正（Issue #164）
 *
 * 背景：在最大化窗口下首次创建任务窗格时，WPS 宿主（12.1.0.28022）会把任务窗格
 * WebView 的可见区域定位到文档窗口的错误顶边 Y（约偏移一个功能区高度），导致
 * ChatUI 顶部（topbar + session-header）被挤出可视区、被「开始/插入」功能区盖住。
 * 页面内部（getBoundingClientRect / window.innerHeight）只能看到 WebView 内部视口，
 * 测不到宿主把整个可见窗口上移了多少，所以任何「页面内检测 + 强制 reflow」都无效
 * （#78 六轮实机验证已证明）。用户实测「新建 WPS 标签窗口再切回」能恢复，说明宿主
 * 在窗口/标签切换时会重算任务窗格的窗口矩形（含顶边 Y）——这是唯一可靠的恢复路径。
 *
 * 本函数在【首次创建】路径调度一次与「切换标签」同源的宿主重排：短暂隐藏再显示
 * 任务窗格（并重新断言停靠位置），让宿主按正确的停靠几何重建可见窗口。
 *
 * 为什么只做首次、只做一次：
 *  - 首次创建时宿主按错误几何布局是必现的（#164 用户确认「必现」）；
 *  - 之后窗格已被宿主正确重排（用户切过标签或本校正生效过），再切可见性反而
 *    可能引起闪烁，因此不重复调度；
 *  - 该校正发生在 WebView 已加载完成之后（延迟执行），确保宿主重排作用于最终布局。
 *  - N9-1：校正执行后即使未生效（宿主未真正重排）也【不自动重试】——避免反复闪烁。
 *    如需重试，可经 OnAction 的 GetTaskPane else 分支（cancel 重置标记后重新进入
 *    首次创建路径，或手动再次调度）实现，但需评估闪烁成本。
 *
 * @param {object} tskpane - 待校正的任务窗格对象
 */
function scheduleFirstOpenLayoutCorrection(tskpane) {
  if (!tskpane) return;
  // 降级开关（R6 评审 P1-1）：实机验证假设不成立时禁用校正，避免无意义闪屏
  if (!WPS_LAYOUT_CORRECTION_ENABLED) {
    console.log('[WPS] 首次打开宿主重排校正已禁用（WPS_LAYOUT_CORRECTION_ENABLED=false）');
    return;
  }
  // 内部标记防重复调度（R6 评审 P3-1）：仅首次创建路径调度一次，避免维护者在非首次
  // 路径误调用导致重复隐藏→显示。用单独标记记录，不依赖调用方自觉。
  // 顺序说明（N7-1 修复）：先 cancel（内部会重置标记为 false），再设置标记 true，
  // 保证：① cancel 不破坏防重复语义（内部 cancel 后马上重新置 true）；
  // ② OnAction else 分支 cancel 时，标记被重置，后续重入首次创建路径可重新调度。
  if (firstOpenLayoutCorrectionScheduled) return;
  // 先取消可能存在的旧排程（评审 info 4：避免多次调用叠加多个 setTimeout）
  try {
    cancelFirstOpenLayoutCorrection();
  } catch (e) {
    // R6 评审 P2-1：clearTimeout 在 COM 环境异常时，单独留痕后继续创建 timer（
    // 取消失败不阻断校正调度本身；若取消失败导致旧 timer 残留，由 firstOpenLayoutCorrectionScheduled
    // 标记兜底——同一会话仅调度一次，不会叠加）
    console.error('[WPS] 取消旧排程失败: ' + errMsg(e));
  }
  // 设置排程标记（在 cancel 之后设置，确保 cancel 内部重置为 false 后重新生效）
  firstOpenLayoutCorrectionScheduled = true;
  // 评审 warning 2：setTimeout 可能在 WPS COM 环境中抛异常，包 try/catch 留痕后优雅返回。
  // 延迟到 WebView 初始布局稳定后再触发宿主重排，等效「新建标签再切回」的宿主重算时机
  var currentTimerId;
  try {
    currentTimerId = setTimeout(function () {
      try {
        // ⚠️ 待实机验证的核心假设：本函数假设「Visible=false→true」能触发与『新建标签
        // 再切回』相同的宿主重排（重算任务窗格窗口矩形、含顶边 Y）。该假设此前无实机证据，
        // 若实机验证发现无效，本校正退化为无意义的开关闪烁，届时应弃用本函数而非继续堆补丁。
        //
        // 竞态防护（评审 warning）：首次创建后 1000ms 内用户可能已再次点击把面板手动隐藏
        // （OnAction 的 else 分支会执行 tp.Visible=!tp.Visible）。若此时仍强制执行
        // 隐藏→显示，会把用户刚隐藏的面板强拉回来。因此先读取当前可见性：仅当面板仍为
        // 可见时才做重排校正；用户已手动隐藏则直接跳过（尊重用户操作，不强行重排）。
        //
        // 评审 warning 2：Visible 读取可能抛 COM 异常（区别于「重排校正失败」）。
        // 在延迟窗口内任务窗格可能已被销毁（关闭文档/退出 WPS），此时读取 Visible 会抛
        // COM 异常，由外层 catch 捕获后统一记录为「宿主重排校正失败」，诊断信息准确。
        var currentVisible = tskpane.Visible;
        if (!currentVisible) {
          console.log('[WPS] 首次打开宿主重排校正跳过：用户已手动隐藏面板');
          return;
        }
        // 重新断言停靠位置（右侧），确保宿主按右侧停靠几何重建窗口；
        // 校验返回值（评审 warning）：停靠校正失败时不再继续隐藏→显示（此时即使触发
        // 宿主重排，几何也可能仍不正确），跳过并留痕，避免做无意义/可能闪烁的重排。
        if (!setTaskPaneDockPosition(tskpane)) {
          console.error('[WPS] 首次打开宿主重排校正跳过：停靠位置校正失败');
          return;
        }
        // 短暂隐藏再显示：强制宿主按正确几何重建任务窗格可见窗口，等效标签切换的宿主重排
        tskpane.Visible = false;
        tskpane.Visible = true;
        console.log('[WPS] 首次打开宿主重排校正已执行（等效新建标签再切回）');
      } catch (e) {
        // 校正失败不致命：下次打开（GetTaskPane 路径）仍有重新校正机会，只留痕不中断。
        // R6 评审 P1-2：若「隐藏→显示」在显示一步抛异常（隐藏已生效但显示失败），面板会
        // 停留在隐藏状态且用户不可见。尝试恢复 Visible=true 兜底，避免面板意外消失。
        console.error('[WPS] 首次打开宿主重排校正失败: ' + errMsg(e));
        try {
          tskpane.Visible = true;
        } catch (e2) {
          // 恢复显示也失败（如对象已销毁）：仅留痕，不做更多处理，下次点击自愈
          console.error('[WPS] 校正失败后恢复面板可见失败: ' + errMsg(e2));
        }
      } finally {
        // 评审 warning 1：仅当 firstOpenRelayoutTimer 仍指向当前 timer 时才清空，
        // 避免误清空回调执行期间新调度的 timer 句柄。
        if (firstOpenRelayoutTimer === currentTimerId) {
          firstOpenRelayoutTimer = null;
        }
      }
    }, FIRST_OPEN_RELAYOUT_DELAY_MS);
    // 将当前 timer 句柄存入全局变量（评审 warning 1：finally 中通过 === 比较避免误清空新调度）
    firstOpenRelayoutTimer = currentTimerId;
  } catch (e) {
    // setTimeout 异常：留痕后优雅返回，不阻断 OnAction 主流程。
    // N8-1 修复：调度失败应视为「未排程」，重置标记使后续可重试校正，
    // 避免异常后校正机会永久丢失。
    console.error('[WPS] 调度首次打开宿主重排校正失败: ' + errMsg(e));
    firstOpenLayoutCorrectionScheduled = false;
  }
}

// --- WPS 就绪检查 ---
/**
 * 检查 WPS Application 是否就绪
 * @returns {boolean} true 表示 WPS 可用
 */
function checkWpsReady() {
  try {
    if (!window.WPS || !window.WPS.Application) {
      console.error('[WPS] WPS 未就绪');
      return false;
    }
    return true;
  } catch (e) {
    console.error('[WPS] 检查失败: ' + errMsg(e));
    return false;
  }
}

/**
 * 获取当前活动文档（支持文字/表格/演示）
 * @returns {object|null} 活动文档对象，无文档时返回 null
 */
function checkDocument() {
  try {
    var app = window.WPS && window.WPS.Application;
    if (!app) {
      // 某些 WPS 版本中窗口回调只能通过 window.Application 访问
      app = window.Application;
      if (!app) return null;
    }
    // WPS 文字 / 表格 / 演示使用不同的 Active 属性
    var doc = app.ActiveDocument || app.ActiveWorkbook || app.ActivePresentation;
    if (!doc) {
      console.warn('[WPS] 请先打开文档');
      return null;
    }
    return doc;
  } catch (e) {
    console.error('[WPS] 文档检查失败: ' + errMsg(e));
    return null;
  }
}

/**
 * 获取插件安装路径
 * @returns {string} 归一化的路径（正斜杠）
 */
function GetUrlPath() {
  var pluginPath = '___WPS_ADDON_PATH___';
  return pluginPath.replace(/\\/g, '/');
}

var lastDocInfo = '';

/**
 * 将当前文档信息推送到 launcher 缓存
 * 每 500ms 轮询调用，文档未变化时自动跳过
 */
function sendDocInfo() {
  try {
    var app = window.WPS && window.WPS.Application;
    if (!app) app = window.Application;
    if (!app) return;
    var doc = app.ActiveDocument || app.ActiveWorkbook || app.ActivePresentation;
    if (!doc) {
      // 无文档打开时清除缓存，避免 MCP fallback 返回过期数据
      if (lastDocInfo !== '') {
        lastDocInfo = '';
        var clearXhr = new XMLHttpRequest();
        clearXhr.open('POST', LAUNCHER_API + '/docinfo', true);
        clearXhr.setRequestHeader('Content-Type', 'application/json');
        clearXhr.send(JSON.stringify({ closed: true }));
      }
      return;
    }
    var info = {
      name: doc.Name,
      path: doc.FullName,
      type: app.ActiveDocument ? 'word' : app.ActiveWorkbook ? 'excel' : 'ppt',
    };
    if (app.ActiveDocument) {
      try {
        info.paragraphCount = doc.Paragraphs.Count;
      } catch (e) {}
      try {
        info.wordCount = doc.Words.Count;
      } catch (e) {}
    }
    var key = JSON.stringify(info);
    if (key === lastDocInfo) return;
    lastDocInfo = key;
    var xhr = new XMLHttpRequest();
    xhr.timeout = 3000;
    xhr.open('POST', LAUNCHER_API + '/docinfo', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(key);
  } catch (e) {
    console.warn('[OpenCode] sendDocInfo failed: ' + errMsg(e));
  }
}

/**
 * 设置 OpenCode 运行状态
 * @param {string} state - 状态值：stopped / running / error
 * @param {string} [error] - 错误描述
 */
function setOpenCodeState(state, error) {
  OPENCODE_STATE = state;
  OPENCODE_ERROR = error || '';
  try {
    window.Application.PluginStorage.setItem('opencode_state', state);
    window.Application.PluginStorage.setItem('opencode_error', error || '');
    window.Application.PluginStorage.setItem('opencode_api_base', OPENCODE_API_BASE);
  } catch (e) {}
  console.log('[OpenCode] State: ' + state + (error ? ' Error: ' + error : ''));
}

/**
 * 启动 OpenCode 服务进程
 * @param {string} cwd - 工作目录
 */
function startOpenCodeServer(cwd) {
  if (!cwd) {
    isProcessingCommand = false;
    return;
  }
  try {
    window.Application.PluginStorage.setItem('opencode_cwd', cwd);
  } catch (e) {}
  var data = JSON.stringify({ cwd: cwd });
  console.log('[OpenCode] Sending: ' + data);
  var xhr = new XMLHttpRequest();
  xhr.timeout = 10000;
  xhr.open('POST', LAUNCHER_API + '/start', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      console.log('[OpenCode] Launcher response: ' + xhr.status + ' ' + xhr.responseText);
      isProcessingCommand = false;
    }
  };
  xhr.onerror = function () {
    console.log('[OpenCode] Cannot reach launcher');
    isProcessingCommand = false;
  };
  xhr.ontimeout = function () {
    console.log('[OpenCode] Launcher timeout');
    isProcessingCommand = false;
  };
  try {
    xhr.send(data);
  } catch (e) {
    console.log('[OpenCode] Send error: ' + errMsg(e));
    isProcessingCommand = false;
  }
}

/**
 * 停止 OpenCode 服务进程
 */
function stopOpenCodeServer() {
  var xhr = new XMLHttpRequest();
  xhr.timeout = 5000;
  xhr.open('POST', LAUNCHER_API + '/stop', true);
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      console.log('[OpenCode] Stop: ' + xhr.status);
      isProcessingCommand = false;
    }
  };
  xhr.onerror = function () {
    isProcessingCommand = false;
  };
  xhr.ontimeout = function () {
    isProcessingCommand = false;
  };
  try {
    xhr.send();
  } catch (e) {
    isProcessingCommand = false;
  }
  setOpenCodeState('stopped');
}

/**
 * 检查 OpenCode 服务健康状况
 */
function checkServerHealth(callback) {
  var xhr = new XMLHttpRequest();
  xhr.timeout = 3000;
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) callback(xhr.status === 200);
  };
  xhr.onerror = function () {
    callback(false);
  };
  xhr.ontimeout = function () {
    callback(false);
  };
  try {
    xhr.open('GET', OPENCODE_API_BASE + '/global/health', true);
    xhr.send();
  } catch (e) {
    callback(false);
  }
}

/**
 * 连接 OpenCode Chat API
 * @param {string} cwd - 工作目录
 * @param {string} sessionId - 会话标识
 */
function connectOpenCode() {
  if (OPENCODE_STATE === 'running') {
    isProcessingCommand = false;
    return;
  }
  setOpenCodeState('connecting');
  checkServerHealth(function (isRunning) {
    setOpenCodeState(isRunning ? 'running' : 'stopped');
    isProcessingCommand = false;
  });
}

function OnAddinLoad(ribbonUI) {
  if (typeof window.Application.ribbonUI !== 'object') window.Application.ribbonUI = ribbonUI;
  if (typeof window.Application.Enum !== 'object') window.Application.Enum = WPS_Enum;
  connectOpenCode();
  return true;
}

function getControlId(control) {
  // WPS 不同版本/回调中 Id 属性大小写不一致（control.Id vs control.id）
  return control.Id || control.id;
}

function OnAction(control) {
  var eleId = getControlId(control);
  switch (eleId) {
    case 'btnShowTaskPane':
      var tsId = '';
      // PluginStorage 在插件初始化未完成等场景可能抛异常，与其他 getItem 调用保持 try/catch 防御一致
      try {
        tsId = window.Application.PluginStorage.getItem('taskpane_id') || '';
      } catch (e) {
        console.error('[WPS] 读取 taskpane_id 失败: ' + errMsg(e));
      }
      // 内存 ID 兜底：PluginStorage 持久化失败/读取失败时，用本次会话内存值避免重复创建多窗格
      if (!tsId) {
        tsId = taskpaneIdCache || '';
      }
      var tp = null;
      if (tsId) {
        try {
          // 个别 WPS 版本对无效/过期 id 会抛异常而非返回 null，统一 try/catch 兜底
          tp = window.Application.GetTaskPane(tsId);
        } catch (e) {
          console.error('[WPS] GetTaskPane 获取任务窗格失败: ' + errMsg(e));
          tp = null;
        }
      }
      // 首次创建，或 PluginStorage 读取失败 / GetTaskPane 返回 null/抛异常：统一回退重建（createTaskPane 内部自带 try/catch，失败返回 null）
      if (!tp) {
        tp = createTaskPane();
        if (!tp) {
          // 创建也失败（如 taskpane.html 路径无效）：已留痕，直接返回，避免后续空指针
          return;
        }
        // 首次创建路径：createTaskPane 已统一完成创建/存 ID/校正停靠/置可见
        // 首次创建后宿主按错误几何布局是必现的（#164：最大化窗口下必现，需新建标签
        // 切回才能恢复）——调度一次「等效切标签」的宿主重排，校正首次打开的头部遮挡
        // 评审 warning 1：调度失败（如 setTimeout 异常）不阻断 OnAction 主流程，留痕即可
        try {
          scheduleFirstOpenLayoutCorrection(tp);
        } catch (e) {
          console.error('[WPS] 调度首次打开宿主重排校正失败: ' + errMsg(e));
        }
      } else {
        // 评审 info 4：进入 GetTaskPane 找回路径时，用户可能在排队校正窗口内再次点击。
        // 取消可能仍排队的首次打开校正 timer（无论后续可见性切换结果如何），
        // 避免回调在用户操作后仍触发不必要的宿主重排。
        cancelFirstOpenLayoutCorrection();
        // 每次打开时重新校正停靠位置（右侧），防止位置漂移再次遮挡顶栏；
        // 与 createTaskPane 内保持一致：停靠校正失败（内部已留痕）但窗格仍可用，
        // 补充「窗格仍可用」留痕后不中断可见性切换（下次点击将重新校正，有自愈机会）
        if (!setTaskPaneDockPosition(tp)) {
          console.error('[WPS] 任务窗格停靠校正失败（窗格仍可用，下次点击将重新校正）');
        }
        // Visible 切换也包 try/catch：与 createTaskPane 内 Visible 置位保持统一兜底，
        // 避免个别 WPS 版本对该属性抛异常时直接中断按钮回调（后续 break 分支不执行）
        try {
          tp.Visible = !tp.Visible;
        } catch (e) {
          console.error('[WPS] 切换任务窗格可见性失败: ' + errMsg(e));
        }
      }
      break;
    case 'btnDockWindow':
      dockOpenCodeWindow();
      break;
    case 'btnCheckStatus':
      checkStatus();
      break;
  }
  return true;
}

function GetImage(control) {
  if (!control) return '';
  var id = getControlId(control);
  if (!id) return '';
  if (id === 'btnShowTaskPane') return 'btn-panel.png';
  if (id === 'btnDockWindow') return 'btn-dock.png';
  if (id === 'btnCheckStatus') return 'btn-status.png';
  return '';
}

function GetImageSize(control) {
  if (!control) return 16;
  var id = getControlId(control);
  if (!id) return 16;
  if (id === 'btnShowTaskPane') return 32;
  return 16;
}

function OnGetEnabled(control) {
  if (!control) return true;
  // 任务窗格和Web面板按钮始终可用；连接状态按钮需文档已打开
  var id = getControlId(control);
  if (id === 'btnShowTaskPane' || id === 'btnDockWindow') return true;
  if (id === 'btnCheckStatus') return checkDocument() !== null;
  console.warn('[WPS] Unknown ribbon button: ' + (id || '(no id)') + ', disabled by default');
  return false; // 未知按钮默认禁用（新增按钮需显式添加 case）
}

function OnGetVisible(control) {
  return true;
}
function OnGetLabel(control) {
  return '';
}

function checkStatus() {
  var cwd = '';
  try {
    cwd = window.Application.PluginStorage.getItem('opencode_cwd') || '';
  } catch (e) {}
  var statusText = '=== OpenCode 状态 ===\n\n';
  statusText += '状态: ' + OPENCODE_STATE + '\n';
  statusText += '地址: ' + OPENCODE_API_BASE + '\n';
  if (cwd) statusText += '工作目录: ' + cwd + '\n';
  if (OPENCODE_ERROR) statusText += '错误: ' + OPENCODE_ERROR + '\n';
  if (OPENCODE_STATE !== 'running') statusText += '\n提示: 请在插件面板中启动 OpenCode 服务\n';

  try {
    if (typeof window.Application !== 'undefined') {
      statusText += '\n=== WPS 信息 ===\n';
      statusText += '应用: ' + (window.Application.Name || 'WPS Office') + '\n';
      if (window.Application.ActiveWorkbook)
        statusText += '文档: ' + window.Application.ActiveWorkbook.Name + ' (Excel)\n';
      else if (window.Application.ActiveDocument)
        statusText += '文档: ' + window.Application.ActiveDocument.Name + ' (Word)\n';
      else if (window.Application.ActivePresentation)
        statusText += '文档: ' + window.Application.ActivePresentation.Name + ' (PPT)\n';
    }
  } catch (e) {
    statusText += '\nWPS 信息获取失败: ' + errMsg(e);
  }
  alert(statusText);
}

/**
 * 打开/停靠任务窗格
 * @param {string} [sessionId] - 会话标识
 */
function dockOpenCodeWindow() {
  var cwd = '';
  var sessionId = '';
  try {
    cwd = window.Application.PluginStorage.getItem('opencode_cwd') || '';
  } catch (e) {}
  try {
    sessionId = window.Application.PluginStorage.getItem('opencode_session_id') || '';
  } catch (e) {}
  if (!cwd) {
    try {
      cwd = window.Application.PluginStorage.getItem('opencode_start_cwd') || '';
    } catch (e) {}
  }
  console.log('[OpenCode] dockOpenCodeWindow cwd: ' + cwd + ' session: ' + sessionId);

  var normalized = cwd.replace(/\\\\/g, '\\');
  var xhr = new XMLHttpRequest();
  xhr.open('POST', LAUNCHER_API + '/dock', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      console.log('[OpenCode] Dock response: ' + xhr.status + ' ' + xhr.responseText);
    }
  };
  xhr.onerror = function () {
    console.log('[OpenCode] Dock error');
  };
  xhr.send(JSON.stringify({ cwd: normalized, session: sessionId }));
  sendDocInfo();
}

var lastCmdTime = 0;

setInterval(function () {
  if (isProcessingCommand) return;
  sendDocInfo();
  try {
    var raw = window.Application.PluginStorage.getItem('opencode_command');
    if (raw) {
      var cmd = raw,
        ts = 0;
      // 尝试解析 JSON 格式 { cmd: string, ts: number }
      if (raw.indexOf('{') === 0) {
        try {
          var parsed = JSON.parse(raw);
          if (parsed.ts && parsed.cmd) {
            ts = parsed.ts;
            cmd = parsed.cmd;
          }
        } catch (e) {}
      }
      if (ts && ts <= lastCmdTime) {
        window.Application.PluginStorage.setItem('opencode_command', '');
        return;
      }
      if (ts) lastCmdTime = ts;
      isProcessingCommand = true;
      window.Application.PluginStorage.setItem('opencode_command', '');
      if (cmd === 'connect') {
        connectOpenCode();
      } else if (cmd.indexOf('start:') === 0) {
        startOpenCodeServer(cmd.substring(6));
      } else if (cmd === 'stop') {
        stopOpenCodeServer();
      } else {
        isProcessingCommand = false;
      }
    }
  } catch (e) {
    isProcessingCommand = false;
  }
}, 500);
