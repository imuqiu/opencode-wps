// ========================================
// WPS 加载项 - OpenCode 集成
// ========================================

var OPENCODE_PORT = 14096
var OPENCODE_HOST = '127.0.0.1'
var OPENCODE_API_BASE = 'http://' + OPENCODE_HOST + ':' + OPENCODE_PORT
var LAUNCHER_API = 'http://' + OPENCODE_HOST + ':14097'

var OPENCODE_STATE = 'stopped'
var OPENCODE_ERROR = ''
var isProcessingCommand = false;

var WPS_Enum = {
    msoCTPDockPositionLeft: 0,
    msoCTPDockPositionRight: 2,
    msoFileDialogFolderPicker: 4,
    msoFileDialogOpen: 1
}

// 任务窗格停靠位置（右侧，避免遮挡 WPS 顶部标签页：开始/插入等）
// 说明：停靠方向值直接取 WPS_Enum.msoCTPDockPositionRight（=2），
// 不新增 Top/Bottom 枚举 —— 其值（1/3）会与已有 msoFileDialogOpen(1) 冲突埋雷
var TASKPANE_DOCK_POSITION = WPS_Enum.msoCTPDockPositionRight

// 内存 ID 兜底：PluginStorage.setItem 持久化失败（如插件初始化未完成）时，
// 本次会话内仍能避免再次点击重复 CreateTaskPane 造成多窗格叠加；
// WPS 重启后随插件内存清空，由 PluginStorage 持久化值接管（见文档注意事项第 10 条）
var taskpaneIdCache = ''

/**
 * 统一提取异常信息：e 可能是 Error 对象（取 .message），也可能是字符串等任意值
 * @param {*} e - try/catch 捕获的异常
 * @returns {*} 可读的错误描述（Error 取 .message，非 Error 值原样返回）
 */
function errMsg(e) {
    return (e && e.message ? e.message : e)
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
        console.error('[WPS] setTaskPaneDockPosition: 无效的任务窗格对象')
        return false
    }
    try {
        tskpane.DockPosition = TASKPANE_DOCK_POSITION
        return true
    } catch (e) {
        console.error('[WPS] 设置任务窗格停靠位置失败: ' + errMsg(e))
        return false
    }
}

/**
 * 创建任务窗格并统一初始化：CreateTaskPane（单参数）→ 存 taskpane_id →
 * 校正停靠位置（右侧）→ 置可见。首次创建与 GetTaskPane 判空回退重建共用。
 * @returns {object} 创建并初始化好的任务窗格对象
 */
function createTaskPane() {
    try {
        var tskpane = window.Application.CreateTaskPane(GetUrlPath() + '/taskpane.html')
        // CreateTaskPane 个别版本可能返回 null（而非抛异常）：立即判空并给出明确留痕，
        // 避免后续 tskpane.ID 抛误导性的 TypeError（外层 catch 虽能兜住，但
        // 「初始化任务窗格失败」文案会把排查方向带偏到创建/存 ID/校正/置位全流程）
        if (!tskpane) {
            console.error('[WPS] 创建任务窗格失败: CreateTaskPane 返回空对象')
            return null
        }
        // 内存 ID 兜底：无论 setItem 成败，先记录本次会话内有效 ID，
        // 避免持久化失败后再次点击重复 CreateTaskPane 造成多窗格叠加；
        // ID 为空（个别版本未回填）时留痕但不覆盖既有缓存，避免内存兜底失效
        if (tskpane.ID) {
            taskpaneIdCache = tskpane.ID
            // setItem 与 getItem 同源同概率抛异常（如插件初始化未完成），单独 try/catch 留痕后继续：
            // 避免中断导致下方 DockPosition 校正与 Visible 置位被跳过（窗格创建了却永远不显示）；
            // 仅 ID 有效时才持久化——ID 为空时跳过写入，避免 setItem 持久化 undefined 覆盖既有有效 ID
            try {
                window.Application.PluginStorage.setItem('taskpane_id', tskpane.ID)
            } catch (e) {
                console.error('[WPS] 保存 taskpane_id 失败: ' + errMsg(e))
            }
        } else {
            console.error('[WPS] 任务窗格 ID 为空，内存兜底可能失效')
        }
        // 停靠校正失败（setTaskPaneDockPosition 内部已留痕）但窗格仍可用：
        // 不中断、继续置可见并返回窗格对象——下次点击经 GetTaskPane 找回后重新校正，
        // 有自愈机会；此处补充「窗格可用」留痕，使调用方可感知该状态（评审 ②）
        if (!setTaskPaneDockPosition(tskpane)) {
            console.error('[WPS] 任务窗格停靠校正失败（窗格仍可用，下次点击将重新校正）')
        }
        // Visible 置位单独 try/catch：窗格已创建、ID 已兜底，失败时留痕后仍返回窗格对象，
        // 保留下次点击自愈机会（GetTaskPane 能找回 → 重新校正 + 切换可见性）；
        // 若在此处 return null 会触发调用处误判「创建失败」，且无自愈路径
        try {
            tskpane.Visible = true
        } catch (e) {
            console.error('[WPS] 置任务窗格可见失败: ' + errMsg(e))
        }
        return tskpane
    } catch (e) {
        // 该 try 块涵盖 CreateTaskPane / 存 ID / DockPosition 校正 / Visible 置位全流程，
        // 任一步失败都会走到这里，文案用「初始化」更准确（避免误以为只是创建步骤失败）。
        // 注意：Visible 置位已内层 try/catch 兜底不会走到这里，此处实际仅兜 CreateTaskPane 本身失败
        console.error('[WPS] 初始化任务窗格失败: ' + errMsg(e))
        return null
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
            type: app.ActiveDocument ? 'word' : app.ActiveWorkbook ? 'excel' : 'ppt'
        };
        if (app.ActiveDocument) {
            try { info.paragraphCount = doc.Paragraphs.Count; } catch(e) {}
            try { info.wordCount = doc.Words.Count; } catch(e) {}
        }
        var key = JSON.stringify(info);
        if (key === lastDocInfo) return;
        lastDocInfo = key;
        var xhr = new XMLHttpRequest();
        xhr.timeout = 3000;
        xhr.open('POST', LAUNCHER_API + '/docinfo', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(key);
    } catch(e) {
        console.warn('[OpenCode] sendDocInfo failed: ' + errMsg(e));
    }
}

/**
 * 设置 OpenCode 运行状态
 * @param {string} state - 状态值：stopped / running / error
 * @param {string} [error] - 错误描述
 */
function setOpenCodeState(state, error) {
    OPENCODE_STATE = state
    OPENCODE_ERROR = error || ''
    try {
        window.Application.PluginStorage.setItem('opencode_state', state)
        window.Application.PluginStorage.setItem('opencode_error', error || '')
        window.Application.PluginStorage.setItem('opencode_api_base', OPENCODE_API_BASE)
    } catch (e) {}
    console.log('[OpenCode] State: ' + state + (error ? ' Error: ' + error : ''))
}

/**
 * 启动 OpenCode 服务进程
 * @param {string} cwd - 工作目录
 */
function startOpenCodeServer(cwd) {
    if (!cwd) { isProcessingCommand = false; return; }
    try { window.Application.PluginStorage.setItem('opencode_cwd', cwd) } catch (e) {}
    var data = JSON.stringify({ cwd: cwd })
    console.log('[OpenCode] Sending: ' + data)
    var xhr = new XMLHttpRequest()
    xhr.timeout = 10000
    xhr.open('POST', LAUNCHER_API + '/start', true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            console.log('[OpenCode] Launcher response: ' + xhr.status + ' ' + xhr.responseText)
            isProcessingCommand = false;
        }
    }
    xhr.onerror = function() { console.log('[OpenCode] Cannot reach launcher'); isProcessingCommand = false; }
    xhr.ontimeout = function() { console.log('[OpenCode] Launcher timeout'); isProcessingCommand = false; }
    try { xhr.send(data) } catch (e) { console.log('[OpenCode] Send error: ' + errMsg(e)); isProcessingCommand = false; }
}

/**
 * 停止 OpenCode 服务进程
 */
function stopOpenCodeServer() {
    var xhr = new XMLHttpRequest()
    xhr.timeout = 5000
    xhr.open('POST', LAUNCHER_API + '/stop', true)
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) { console.log('[OpenCode] Stop: ' + xhr.status); isProcessingCommand = false; }
    }
    xhr.onerror = function() { isProcessingCommand = false; }
    xhr.ontimeout = function() { isProcessingCommand = false; }
    try { xhr.send() } catch (e) { isProcessingCommand = false; }
    setOpenCodeState('stopped')
}

/**
 * 检查 OpenCode 服务健康状况
 */
function checkServerHealth(callback) {
    var xhr = new XMLHttpRequest()
    xhr.timeout = 3000
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) callback(xhr.status === 200)
    }
    xhr.onerror = function() { callback(false) }
    xhr.ontimeout = function() { callback(false) }
    try { xhr.open('GET', OPENCODE_API_BASE + '/global/health', true); xhr.send() } catch (e) { callback(false) }
}

/**
 * 连接 OpenCode Chat API
 * @param {string} cwd - 工作目录
 * @param {string} sessionId - 会话标识
 */
function connectOpenCode() {
    if (OPENCODE_STATE === 'running') { isProcessingCommand = false; return; }
    setOpenCodeState('connecting')
    checkServerHealth(function(isRunning) {
        setOpenCodeState(isRunning ? 'running' : 'stopped')
        isProcessingCommand = false;
    })
}

function OnAddinLoad(ribbonUI) {
    if (typeof window.Application.ribbonUI !== "object") window.Application.ribbonUI = ribbonUI
    if (typeof window.Application.Enum !== "object") window.Application.Enum = WPS_Enum
    // 注册 WPS 窗口激活事件：新建/切换标签页后强制重绘任务窗格，
    // 修复 TaskPane WebView 首次渲染布局 bug（头部被遮挡/空白）——
    // 用户实测「新建标签页后再切回原标签头部即恢复」，说明切换窗口会触发重绘，
    // 这里在宿主侧主动复现该行为，无需用户手动操作。
    registerWindowActivateReflow()
    connectOpenCode()
    return true
}

// 强制重绘任务窗格：Visible false→true（仅当当前可见时），
// 触发 WPS 宿主对 WebView 的重新布局/重绘，修复头部被挤出可视区的首次渲染 bug。
// 窗格不存在或不可见时不执行——避免把用户主动关闭的窗格重新弹出来。
// 隐藏→显示拆成两步（中间 setTimeout 让出宿主事件循环）：
// 同一同步代码块内连续置位可能被 WPS 宿主合并处理，重绘实际不生效。
// 重绘进行中标志：WindowActivate 可能连续触发，一次重绘未完成时跳过后续触发（防抖）
var taskPaneRedrawPending = false
// 用户最近一次主动操作任务窗格的时间戳（OnAction toggle 分支记录）：
// forceTaskPaneRedraw 异步恢复前比对，若重绘期间用户手动关闭过窗格则放弃恢复，
// 避免把用户刚关闭的窗格重新弹出来（尊重用户意图）
var lastUserTaskPaneAction = 0
// 用户主动打开面板后调度宿主重绘的延迟：等 WPS 宿主完成新窗格首次布局后再重绘，
// 避免重绘过早（宿主尚未完成初始布局）导致无效。
// 该值远大于 forceTaskPaneRedraw 内部的 150ms 恢复窗口：
// 用户主动打开（tp.Visible=true）→ 等 400ms 宿主完成首次布局 → 再走 150ms
// 隐藏→显示重绘，全程约 550ms 完成自愈。
var TASKPANE_OPEN_REDRAW_DELAY = 400
// WindowActivate 触发后的重绘延迟：等 WPS 完成窗口切换布局后再重绘（PR #83）
// 与 TASKPANE_OPEN_REDRAW_DELAY 语义不同、不可混用：
// - 400ms：等「新窗格首次布局」完成（打开面板路径，首次打开必触发）；
// - 200ms：等「窗口切换布局」完成（切标签路径，宿主已完成布局、仅需重绘）。
var WINDOW_ACTIVATE_REDRAW_DELAY = 200
// 打开面板后主动调度一次宿主重绘（Issue #78 三诊）——首次创建与切换显示两路共用：
// 等宿主完成首次布局后，重置用户操作时间戳并触发 forceTaskPaneRedraw(true)。
// 注意：真实保护链是 forceTaskPaneRedraw 内的可见性检查（!tp.Visible return 不误弹），
// 时间戳清零仅用于清理调度等待期（400ms 内）残留的旧操作时间戳，避免语义混乱——
// 后续 150ms 重绘窗口内的新用户操作仍会重新设置时间戳而被尊重。
// 依赖关系：若未来移除可见性检查，本清零将失效，必须同步保留可见性防线。
// 调度起点恒 ≥ toggle 时间戳（OnAction 先置时间戳再调用本函数，同毫秒相等或晚 1ms），
// 守卫用严格大于可正确区分「调度自身刚记录的时间戳」与「等待期内用户的新操作」。
function scheduleTaskPaneOpenRedraw() {
    var scheduleAt = Date.now()
    setTimeout(function() {
        // 等待期内用户主动操作过窗格（时间戳晚于调度起点，如 400ms 内又点了一次开关）：
        // 尊重用户意图，放弃本次自愈调度（窗格状态已由用户最新操作决定，重绘意义不大）；
        // 同时避免清零覆盖用户操作时间戳——否则若恰有进行中的重绘，其恢复回调的
        // lastUserTaskPaneAction 比对会失效，行为退化为仅靠可见性检查兜底（见上方依赖注释）。
        // 留痕：实机排查「打开面板仍遮挡」时可区分「守卫放弃」与「重绘执行但宿主未生效」。
        if (lastUserTaskPaneAction > scheduleAt) {
            console.log('[WPS] 打开面板自愈重绘已放弃（等待期内用户操作过窗格）')
            return
        }
        lastUserTaskPaneAction = 0
        forceTaskPaneRedraw(true)
    }, TASKPANE_OPEN_REDRAW_DELAY)
}
function forceTaskPaneRedraw(force) {
    // 用户主动打开面板路径（btnShowTaskPane 创建/置可见后）主动调度重绘：
    // WPS TaskPane WebView 首次渲染视口高度计算错误（宿主 bug），只有宿主重新布局
    // （隐藏→显示任务窗格）才能让 WebView 拿到正确视口；而 PR #83 的宿主重绘
    // 只挂在 WindowActivate 事件上，首次打开面板不经过该事件 → 重绘永不触发，
    // 与用户实测「合并 #83 后首次打开仍遮挡、切标签后恢复」完全吻合（Issue #78）。
    // force=true：用户主动打开面板后调度（首次创建/切换显示）；
    // force=false：WindowActivate 被动触发。两者均受下方 taskPaneRedrawPending
    // 防抖保护——若恰有重绘在进行中（如用户刚切标签）则跳过本次，避免两次重绘交错
    // 导致 Visible 状态错乱；force 仅用于日志区分触发源，不改变防抖语义。
    var redrawSource = force ? '用户主动打开面板' : 'WindowActivate 切换窗口'
    var tsId = ""
    // 重绘开始时间戳提前到函数开头：确保读取窗格期间及之后任何用户操作都被捕获
    var redrawStartTime = Date.now()
    try {
        // getItem 与 OnAction 路径同源同概率抛异常（插件初始化未完成）：
        // 单独 try/catch 留痕后继续用内存兜底，避免整个函数被拖入失败分支
        tsId = window.Application.PluginStorage.getItem("taskpane_id") || taskpaneIdCache || ""
    } catch (e) {
        console.error('[WPS] 读取 taskpane_id 失败: ' + errMsg(e))
        tsId = taskpaneIdCache || ""
    }
    if (!tsId) return
    // 上一次重绘的 setTimeout 未完成时跳过（WindowActivate 连续触发防抖）
    if (taskPaneRedrawPending) return
    try {
        var tp = window.Application.GetTaskPane(tsId)
        if (!tp) {
            console.log('[WPS] 强制重绘跳过：任务窗格不存在（已销毁）')
            return
        }
        if (!tp.Visible) {
            console.log('[WPS] 强制重绘跳过：任务窗格当前不可见（不误弹，等待用户主动打开）')
            return
        }
        // 停靠位置重新校正（防漂移）
        setTaskPaneDockPosition(tp)
        // 先隐藏再显示，强制 WebView 重新布局；两步间让出宿主事件循环，
        // 确保 WPS 宿主真的执行隐藏→重排→显示流程（而非合并两次属性写入）。
        // 恢复延迟 150ms：慢速环境宿主完成隐藏→重排耗时不定，80ms 可能过早
        // 导致重绘不完整；页面侧 visibilitychange/resize 自愈会兜底最终布局
        taskPaneRedrawPending = true
        tp.Visible = false
        setTimeout(function() {
            taskPaneRedrawPending = false
            try {
                // 重绘期间用户手动操作过窗格（如点按钮关闭）→ 尊重用户意图，放弃恢复；
                // 用 >= 覆盖同毫秒边界（用户操作与重绘开始同毫秒时也不能误恢复）。
                // 已知限制：WPS TaskPane 原生右上角 X 关闭不经过 OnAction，lastUserTaskPaneAction
                // 不会更新——若原生关闭为「销毁」语义（GetTaskPane 返回 null）则下方 !cur 已覆盖；
                // 若个别版本为「隐藏」语义（Visible=false 保留对象）则可能被本恢复误弹，见文档注意事项 16
                if (lastUserTaskPaneAction >= redrawStartTime) return
                var cur = window.Application.GetTaskPane(tsId)
                if (!cur) return          // 窗格已销毁：放弃恢复
                if (cur.Visible) return   // 已被外部恢复（用户重新打开等）：不重复置位
                cur.Visible = true
                console.log('[WPS] 任务窗格已强制重绘（' + redrawSource + '触发布局修复）')
            } catch (e) {
                console.error('[WPS] 恢复任务窗格可见失败: ' + errMsg(e))
            }
        }, 150)
    } catch (e) {
        taskPaneRedrawPending = false
        console.error('[WPS] 强制重绘任务窗格失败: ' + errMsg(e))
    }
}

// 注册 WPS 窗口激活事件（官方 SDK：AddApiEventListener('WindowActivate')）；
// 个别版本不支持/抛异常时静默降级（不影响既有功能）
// 已注册标志：OnAddinLoad 可能被多次调用（插件重载/异常恢复），防重复叠加监听
var windowActivateListenerRegistered = false
function registerWindowActivateReflow() {
    try {
        if (windowActivateListenerRegistered) return
        if (typeof window.Application.AddApiEventListener === 'function') {
            window.Application.AddApiEventListener('WindowActivate', function() {
                // 延迟执行：等 WPS 完成窗口切换布局后再重绘
                setTimeout(function() { forceTaskPaneRedraw() }, WINDOW_ACTIVATE_REDRAW_DELAY)
            })
            windowActivateListenerRegistered = true
            console.log('[WPS] 已注册 WindowActivate 重绘监听')
        }
    } catch (e) {
        console.warn('[WPS] 注册 WindowActivate 监听失败（已降级，不影响使用）: ' + errMsg(e))
    }
}

function getControlId(control) {
    // WPS 不同版本/回调中 Id 属性大小写不一致（control.Id vs control.id）
    return control.Id || control.id;
}

function OnAction(control) {
    var eleId = getControlId(control)
    switch (eleId) {
        case "btnShowTaskPane":
            var tsId = ""
            // PluginStorage 在插件初始化未完成等场景可能抛异常，与其他 getItem 调用保持 try/catch 防御一致
            try { tsId = window.Application.PluginStorage.getItem("taskpane_id") || "" } catch (e) {
                console.error('[WPS] 读取 taskpane_id 失败: ' + errMsg(e))
            }
            // 内存 ID 兜底：PluginStorage 持久化失败/读取失败时，用本次会话内存值避免重复创建多窗格
            if (!tsId) { tsId = taskpaneIdCache || "" }
            var tp = null
            if (tsId) {
                try {
                    // 个别 WPS 版本对无效/过期 id 会抛异常而非返回 null，统一 try/catch 兜底
                    tp = window.Application.GetTaskPane(tsId)
                } catch (e) {
                    console.error('[WPS] GetTaskPane 获取任务窗格失败: ' + errMsg(e))
                    tp = null
                }
            }
            // 首次创建，或 PluginStorage 读取失败 / GetTaskPane 返回 null/抛异常：统一回退重建（createTaskPane 内部自带 try/catch，失败返回 null）
            if (!tp) {
                tp = createTaskPane()
                if (!tp) {
                    // 创建也失败（如 taskpane.html 路径无效）：已留痕，直接返回，避免后续空指针
                    return
                }
                // 首次创建路径：窗格已置可见。WPS TaskPane WebView 首次渲染视口高度
                // 计算错误（宿主 bug），PR #83 的宿主重绘只挂在 WindowActivate 事件上，
                // 首次打开面板不经过该事件 → 重绘永不触发，与用户实测「合并 #83 后首次
                // 打开仍遮挡、切标签后恢复」吻合。这里主动调度一次宿主重绘修复（Issue #78）。
                // createTaskPane 内 Visible 置位失败（窗格不可见）时 forceTaskPaneRedraw
                // 会因 !tp.Visible 直接返回，天然安全，不误弹。
                probeTaskPane(tp)  // 四诊探针：首次创建后采集 DockPosition/尺寸/宿主控制（Issue #78）
                scheduleTaskPaneOpenRedraw()
            } else {
                // 每次打开时重新校正停靠位置（右侧），防止位置漂移再次遮挡顶栏；
                // 与 createTaskPane 内保持一致：停靠校正失败（内部已留痕）但窗格仍可用，
                // 补充「窗格仍可用」留痕后不中断可见性切换（下次点击将重新校正，有自愈机会）
                if (!setTaskPaneDockPosition(tp)) {
                    console.error('[WPS] 任务窗格停靠校正失败（窗格仍可用，下次点击将重新校正）')
                }
                // Visible 切换也包 try/catch：与 createTaskPane 内 Visible 置位保持统一兜底，
                // 避免个别 WPS 版本对该属性抛异常时直接中断按钮回调（后续 break 分支不执行）
                try {
                    tp.Visible = !tp.Visible
                    // 记录用户主动操作时间戳：forceTaskPaneRedraw 异步恢复前比对，
                    // 重绘期间用户手动关闭过窗格则放弃恢复（不把用户刚关闭的窗格弹回来）
                    lastUserTaskPaneAction = Date.now()
                    // 切换后窗格可见（本次是打开）：主动调度宿主重绘，与首次创建路径同源——
                    // 首次打开的 WebView 渲染 bug 在切换显示时同样可能触发（宿主重新布局时机
                    // 因版本/场景而异），统一在打开后补一次宿主重绘（Issue #78）。
                    // 仅当无重绘进行中（taskPaneRedrawPending=false）时调度：
                    // 若恰在 forceTaskPaneRedraw 的隐藏→显示窗口内（如用户快速点按钮），
                    // 窗格已可见且原重绘的恢复回调会处理状态，此时再调度会造成额外闪烁；
                    // 由原重绘的 lastUserTaskPaneAction 比对统一收口（放弃恢复）。
                    // 读取 Visible 失败（COM 属性异常）时保守不调度，避免误判状态。
                    // 已知竞态：tp.Visible = !tp.Visible 与下方 nowVisible 读取为两次 COM 属性访问，
                    // 但 WPS 宿主不会在同步代码块内异步改变窗格状态，读到的即切换后的状态，
                    // 竞态窗口可接受（即使极端场景误判，最坏只是多做一次无害重绘）。
                    // 另一面取舍：读取失败（nowVisible=false）时保守不调度 → 本次打开可能不自愈
                    // （头部仍遮挡），但下次切换/WindowActivate 仍会触发重绘兜底，代价可接受。
                    var nowVisible = false
                    try { nowVisible = !!tp.Visible } catch (e) { nowVisible = false }
                    if (nowVisible) {
                        // 四诊探针：切换打开后采集（含 P4 强制复位验证宿主是否接受停靠控制）
                        probeTaskPane(tp)
                    }
                    if (nowVisible && !taskPaneRedrawPending) {
                        // 与首次创建路径同源：打开后 400ms 主动调度宿主重绘（见函数上方注释）
                        scheduleTaskPaneOpenRedraw()
                    }
                } catch (e) {
                    console.error('[WPS] 切换任务窗格可见性失败: ' + errMsg(e))
                }
            }
            break
        case "btnDockWindow":
            dockOpenCodeWindow()
            break
        case "btnCheckStatus":
            checkStatus()
            break
    }
    return true
}

function GetImage(control) {
    if (!control) return ''
    var id = getControlId(control);
    if (!id) return '';
    if (id === 'btnShowTaskPane') return 'btn-panel.png'
    if (id === 'btnDockWindow') return 'btn-dock.png'
    if (id === 'btnCheckStatus') return 'btn-status.png'
    return ''
}

function GetImageSize(control) {
    if (!control) return 16
    var id = getControlId(control);
    if (!id) return 16;
    if (id === 'btnShowTaskPane') return 32
    return 16
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

function OnGetVisible(control) { return true }
function OnGetLabel(control) { return "" }

// ============ 任务窗格诊断探针（Issue #78 四诊：先定位清楚再动手） ============
// 背景：前 3 轮修复（#79 DockPosition / #83 三层防御 / #90 打开面板重绘）均未解决
// 「头部被遮挡 + 顶栏标签被压扁」，用户关键线索：新建 WPS 标签后切回即恢复。
// 本轮不改修复行为，先采集可观测数据区分「插件停靠问题」与「WPS 宿主 bug」：
//   P1 DockPosition 实际值（Right=2 / Floating=4 是关键判据）
//   P2 窗格 Width/Height（尺寸异常 → 宿主布局异常）
//   P3 Window 属性（宿主窗口句柄存在性，只读）
//   P4 强制复位 Right 并读回验证（宿主是否允许程序控制停靠）
//   P5 残留 id 检测（id 有值但 GetTaskPane 找不到 → 旧实例残留，走重建路径）
// 采集点：打开面板（首次创建 / 切换打开）后自动执行，结果写入
//   PluginStorage('taskpane_probe') + 内存 lastTaskPaneProbe + console 留痕；
// 展示：点「连接状态」按钮（btnCheckStatus）弹窗末尾汇总展示，用户截图反馈即可。
var lastTaskPaneProbe = ''

function probeTaskPane(tp) {
    var lines = []
    var tsId = ''
    try { tsId = window.Application.PluginStorage.getItem('taskpane_id') || taskpaneIdCache || '' } catch (e) {}
    lines.push('[探针] taskpane_id=' + (tsId || '(空)'))
    lines.push('[探针] 内存缓存=' + (taskpaneIdCache || '(空)'))
    if (tp) {
        // P1: 停靠位置实际值（Right=2 / Floating=4 是关键判据）
        try {
            var dp = tp.DockPosition
            var dpLabel = dp === 0 ? 'Left' : dp === 1 ? 'Top' : dp === 2 ? 'Right' : dp === 3 ? 'Bottom' : dp === 4 ? 'Floating!' : '未知(' + dp + ')'
            lines.push('[P1] DockPosition=' + dp + ' (' + dpLabel + ')')
        } catch (e) { lines.push('[P1] DockPosition 读取失败: ' + errMsg(e)) }
        // P2: 窗格尺寸（异常尺寸 → 宿主布局异常）
        try { lines.push('[P2] Width=' + tp.Width + ' Height=' + tp.Height) } catch (e) { lines.push('[P2] 尺寸读取失败: ' + errMsg(e)) }
        // P3: 宿主窗口句柄（只读属性，个别版本不存在）
        try { lines.push('[P3] Window=' + (tp.Window ? String(tp.Window) : '(空/无)')) } catch (e) { lines.push('[P3] Window 读取失败: ' + errMsg(e)) }
        // P4: 强制复位 Right(=2) 并读回验证宿主是否接受程序控制（不接受 → 宿主霸占停靠状态）
        try {
            var prev = tp.DockPosition
            tp.DockPosition = 2
            var after = tp.DockPosition
            lines.push('[P4] 强制复位 Right: ' + prev + '→' + after + (after === 2 ? ' (宿主接受控制)' : ' (宿主拒绝/忽略!)'))
        } catch (e) { lines.push('[P4] 强制复位 Right 失败: ' + errMsg(e)) }
        // P4b: DockPositionRestrict 可用性（msoCTPDockPositionRestrictNoChange=1，只读不写）
        try { lines.push('[P4b] DockPositionRestrict=' + tp.DockPositionRestrict + (tp.DockPositionRestrict === 1 ? ' (已锁定停靠)' : '')) } catch (e) { lines.push('[P4b] DockPositionRestrict 不可用: ' + errMsg(e)) }
        // P5: 残留 id 检测（id 有值但 GetTaskPane 找不到 → 旧实例残留，将走重建路径）
        var exists = true
        if (tsId) {
            try { exists = !!window.Application.GetTaskPane(tsId) } catch (e) { exists = false }
        }
        lines.push('[P5] GetTaskPane 找回=' + (exists ? '正常' : '失败(残留id，将走重建)'))
    } else {
        lines.push('[P5] 窗格不存在（GetTaskPane 返回空，走重建路径）')
    }
    var result = lines.join('\n')
    lastTaskPaneProbe = result
    try { window.Application.PluginStorage.setItem('taskpane_probe', result) } catch (e) {}
    console.log('[WPS 任务窗格探针]\n' + result)
    return result
}

function checkStatus() {
    var cwd = ''
    try { cwd = window.Application.PluginStorage.getItem('opencode_cwd') || '' } catch (e) {}
    var statusText = '=== OpenCode 状态 ===\n\n'
    statusText += '状态: ' + OPENCODE_STATE + '\n'
    statusText += '地址: ' + OPENCODE_API_BASE + '\n'
    if (cwd) statusText += '工作目录: ' + cwd + '\n'
    if (OPENCODE_ERROR) statusText += '错误: ' + OPENCODE_ERROR + '\n'
    if (OPENCODE_STATE !== 'running') statusText += '\n提示: 请在插件面板中启动 OpenCode 服务\n'

    try {
        if (typeof window.Application !== 'undefined') {
            statusText += '\n=== WPS 信息 ===\n'
            statusText += '应用: ' + (window.Application.Name || 'WPS Office') + '\n'
            if (window.Application.ActiveWorkbook) statusText += '文档: ' + window.Application.ActiveWorkbook.Name + ' (Excel)\n'
            else if (window.Application.ActiveDocument) statusText += '文档: ' + window.Application.ActiveDocument.Name + ' (Word)\n'
            else if (window.Application.ActivePresentation) statusText += '文档: ' + window.Application.ActivePresentation.Name + ' (PPT)\n'
        }
    } catch (e) { statusText += '\nWPS 信息获取失败: ' + errMsg(e) }

    // 探针结果汇总（Issue #78 四诊）：有内存结果优先展示，否则读持久化值
    var probeText = lastTaskPaneProbe || ''
    if (!probeText) {
        try { probeText = window.Application.PluginStorage.getItem('taskpane_probe') || '' } catch (e) { probeText = '' }
    }
    if (probeText) statusText += '\n=== 任务窗格探针 ===\n' + probeText + '\n'
    // 页面侧视口诊断（taskpane.html 写入的 P6 数据）
    var probePageText = ''
    try { probePageText = window.Application.PluginStorage.getItem('taskpane_probe_page') || '' } catch (e) { probePageText = '' }
    if (probePageText) statusText += '\n=== 页面视口探针 ===\n' + probePageText + '\n'
    alert(statusText)
}

/**
 * 打开/停靠任务窗格
 * @param {string} [sessionId] - 会话标识
 */
function dockOpenCodeWindow() {
    var cwd = ''
    var sessionId = ''
    try { cwd = window.Application.PluginStorage.getItem('opencode_cwd') || '' } catch(e) {}
    try { sessionId = window.Application.PluginStorage.getItem('opencode_session_id') || '' } catch(e) {}
    if (!cwd) {
        try { cwd = window.Application.PluginStorage.getItem('opencode_start_cwd') || '' } catch(e) {}
    }
    console.log('[OpenCode] dockOpenCodeWindow cwd: ' + cwd + ' session: ' + sessionId)

    var normalized = cwd.replace(/\\\\/g, '\\')
    var xhr = new XMLHttpRequest()
    xhr.open('POST', LAUNCHER_API + '/dock', true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            console.log('[OpenCode] Dock response: ' + xhr.status + ' ' + xhr.responseText)
        }
    }
    xhr.onerror = function() { console.log('[OpenCode] Dock error') }
    xhr.send(JSON.stringify({ cwd: normalized, session: sessionId }))
    sendDocInfo()
}

var lastCmdTime = 0;

setInterval(function () {
    if (isProcessingCommand) return;
    sendDocInfo()
    try {
        var raw = window.Application.PluginStorage.getItem('opencode_command')
        if (raw) {
            var cmd = raw, ts = 0;
            // 尝试解析 JSON 格式 { cmd: string, ts: number }
            if (raw.indexOf('{') === 0) {
                try {
                    var parsed = JSON.parse(raw);
                    if (parsed.ts && parsed.cmd) { ts = parsed.ts; cmd = parsed.cmd; }
                } catch(e) {}
            }
            if (ts && ts <= lastCmdTime) {
                window.Application.PluginStorage.setItem('opencode_command', '')
                return;
            }
            if (ts) lastCmdTime = ts;
            isProcessingCommand = true;
            window.Application.PluginStorage.setItem('opencode_command', '')
            if (cmd === 'connect') { connectOpenCode(); }
            else if (cmd.indexOf('start:') === 0) { startOpenCodeServer(cmd.substring(6)); }
            else if (cmd === 'stop') { stopOpenCodeServer(); }
            else { isProcessingCommand = false; }
        }
    } catch (e) { isProcessingCommand = false; }
}, 500)