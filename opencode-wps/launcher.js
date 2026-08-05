// launcher.js - OpenCode 进程管理服务
const http = require('http');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 14097;
let opencodeProcess = null;
let opencodeCwd = '';
let dockedPid = 0;
let stateLock = false;

// ===== 启动时清理孤儿 MCP 进程 =====
function cleanupOrphanedMcp() {
    try {
        var execSync = require('child_process').execSync;
        // 用 PowerShell Get-Process 按命令行路径查找，无 % 转义问题
        var psCmd = "Get-Process -Name node | Where-Object { $_.CommandLine -match 'wps-office-mcp\\\\dist\\\\index\\.js' } | ForEach-Object { $_.Id }";
        var out = execSync('powershell -NoProfile -Command "' + psCmd + '"', {
            encoding: 'utf8',
            timeout: 5000
        });
        var lines = out.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var pid = parseInt(lines[i].trim(), 10);
            if (pid > 0 && !isNaN(pid)) {
                try { execSync('taskkill /F /PID ' + pid + ' 2>nul', { shell: 'cmd.exe', stdio: 'ignore', timeout: 3000 }); } catch(e) {}
            }
        }
    } catch(e) { /* no orphaned processes */ }
}
cleanupOrphanedMcp();

/**
 * 解析 HTTP 请求体为 JSON
 * @param {object} req - HTTP Request 对象
 * @param {function} callback - 回调函数，接收解析后的对象
 */
// 模块级 Symbol 标记：外部 JSON 无法伪造（普通 JSON 字符串键无法匹配 Symbol）
var BODY_TOO_LARGE = Symbol('bodyTooLarge');
function parseBody(req, callback) {
    var body = '';
    var MAX_BODY = 1024 * 1024; // 1MB
    var tooLarge = false;
    req.on('data', function(chunk) {
        if (body.length + chunk.length > MAX_BODY) { tooLarge = true; return; }
        body += chunk;
    });
    req.on('end', function() {
        if (tooLarge) {
            console.log('[launcher] Body too large ( > 1MB), rejected');
            callback(BODY_TOO_LARGE);
            return;
        }
        try { callback(JSON.parse(body)); }
        catch(e) { 
            console.log('[launcher] Parse error: ' + e.message);
            callback({}); 
        }
    });
}

/**
 * 发送 JSON 格式的 HTTP 响应
 * @param {object} res - HTTP Response 对象
 * @param {number} statusCode - HTTP 状态码
 * @param {object} data - 响应数据
 */
// launcher 仅绑定 127.0.0.1，CORS 收敛为白名单（与 opencode-proxy.js 一致）：
//  - OpenCode serve 来源（http://127.0.0.1:14096）
//  - WPS 插件面板：本地 file:// 或 WPS 内部扩展（无 Origin / null / file://）
//  - 其余任意 http(s) Origin 一律拒绝，防本地恶意网页跨站读取
var CORS_ORIGINS = [
    'http://127.0.0.1:14096',
    'http://localhost:14096'
];

function getAllowedOrigin(req) {
    var origin = req.headers.origin;
    if (!origin || origin === 'null' || origin.indexOf('file://') === 0) {
        // 无 Origin 头：同源请求 / curl 等；null / file://：WPS 插件面板等本地受限上下文
        return '*';
    }
    if (CORS_ORIGINS.indexOf(origin) !== -1) {
        return origin;
    }
    return null; // 白名单外的 Origin 一律拒绝
}

function sendJSON(req, res, statusCode, data) {
    var allowOrigin = getAllowedOrigin(req);
    var headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (allowOrigin) {
        headers['Access-Control-Allow-Origin'] = allowOrigin;
    }
    res.writeHead(statusCode, headers);
    res.end(JSON.stringify(data));
}

function startOpenCode(cwd, port) {
    console.log('[launcher] startOpenCode called with cwd: ' + cwd + ' port: ' + port);
    if (opencodeProcess) {
        return { success: false, error: 'already running' };
    }
    if (!cwd) {
        return { success: false, error: 'cwd is undefined' };
    }
    // 端口校验（与 stopOpenCodeByPort 同一套规则）：body.port 可被外部控制，
    // 非法值（非数字/越界/含 shell 元字符）直接拒绝，防止污染 --port 启动参数
    var parsedPort = parseInt(port, 10);
    if (port !== undefined && port !== null && (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535)) {
        return { success: false, error: 'invalid port' };
    }
    // 验证工作目录安全性
    var validation = validateCwd(cwd);
    if (!validation.valid) {
        return { success: false, error: validation.error };
    }
    cwd = validation.resolved;
    if (!fs.existsSync(cwd)) {
        try { fs.mkdirSync(cwd, { recursive: true }); } catch(e) {}
    }
    opencodeCwd = cwd;
    var opencodeBin = findOpenCodeBin();
    console.log('[launcher] Starting with: ' + opencodeBin);

    var isPs1 = opencodeBin.endsWith('.ps1');
    var isExe = /\.exe$/i.test(opencodeBin);
    var finalPort = parsedPort || 14096;
    var opencodeArgs = ['serve', '--port', String(finalPort), '--hostname', '127.0.0.1', '--cors', 'file://'];
    // .ps1 用 powershell.exe 直接执行、.exe 直接 CreateProcess，均无需 shell；
    // 无扩展名（如 PATH 中的 'opencode'，npm 全局安装实为 .cmd 脚本）时，
    // spawn 不带 shell 无法启动 .cmd 文件，必须保留 shell。
    var needShell = !isPs1 && !isExe;
    
    try {
        opencodeProcess = spawn(
            isPs1 ? 'powershell.exe' : opencodeBin,
            isPs1 
                ? ['-ExecutionPolicy', 'Bypass', '-File', opencodeBin, ...opencodeArgs]
                : opencodeArgs,
            {
                cwd: cwd,
                stdio: 'ignore',
                detached: false,
                windowsHide: true,
                shell: needShell
            }
        );

        opencodeProcess.on('error', function(err) {
            console.log('[launcher] Error: ' + err.message);
            opencodeProcess = null;
        });

        opencodeProcess.on('exit', function(code) {
            console.log('[launcher] Exited: ' + code);
            opencodeProcess = null;
            // 清理 PID 文件
            var pidFile = path.join(__dirname, 'opencode.pid');
            try { fs.unlinkSync(pidFile); } catch (e) {}
        });

        console.log('[launcher] Started PID: ' + opencodeProcess.pid);

        // 保存 PID 到文件
        var pidFile = path.join(__dirname, 'opencode.pid');
        try {
            fs.writeFileSync(pidFile, String(opencodeProcess.pid));
        } catch (e) {
            console.log('[launcher] Failed to write PID file: ' + e.message);
        }

        return { success: true, pid: opencodeProcess.pid };
    } catch(e) {
        return { success: false, error: e.message };
    }
}

function stopOpenCodeByPort(port) {
    // 端口必须是 1-65535 的整数：body.port 可被外部控制，
    // 未校验会拼进 netstat/findstr 命令造成命令注入（如 port="14096 & calc"）
    port = parseInt(port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
        console.log('[launcher] Invalid port rejected: ' + port);
        return { success: false, error: 'invalid port' };
    }
    console.log('[launcher] stopOpenCodeByPort called for port: ' + port);
    
    try {
        var execSync = require('child_process').execSync;
        
        // 查找占用指定端口的进程 PID
        // findstr 匹配 ":port "（带尾空格）减少 :140960/:114096 等子串误匹配
        var output = execSync('netstat -ano | findstr ":' + port + ' "', { 
            shell: 'cmd.exe',
            encoding: 'utf8',
            timeout: 5000
        });
        
        var lines = output.split('\n');
        var killed = false;
        
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('LISTENING') > 0 || line.indexOf('ESTABLISHED') > 0) {
                var parts = line.split(/\s+/);
                var localAddr = parts[1] || '';
                // 检查是否为指定端口：IPv6 地址 [::1]:14096 含多个冒号，用 lastIndexOf 取端口
                var listenPort = parseInt(localAddr.substring(localAddr.lastIndexOf(':') + 1), 10);
                
                if (listenPort === port) {
                    var pid = parseInt(parts[parts.length - 1], 10);
                    if (pid > 0) {
                        console.log('[launcher] Found process on port ' + port + ', PID: ' + pid);
                        // 验证进程名，避免误杀。优先用 PowerShell Get-CimInstance（Win11 兼容，
                        // wmic 已在 Win11 移除）；查询失败再保守跳过，避免误杀非 OpenCode 进程。
                        // 注意：不能无条件 continue——否则 Win11 上永远杀不掉合法进程。
                        var isOpenCode = false;
                        try {
                            var psNameCmd = "powershell -NoProfile -Command \"(Get-CimInstance Win32_Process -Filter 'ProcessId=" + pid + "').Name\"";
                            var nameOut = execSync(psNameCmd, { encoding: 'utf8', timeout: 3000 });
                            var procName = (nameOut.split('\n')[0] || '').trim().toLowerCase();
                            isOpenCode = (procName === 'node.exe' || procName === 'opencode.exe' || procName === '');
                            if (!isOpenCode) {
                                console.log('[launcher] Skipping non-OpenCode process: ' + procName);
                                continue;
                            }
                        } catch(e) {
                            // PowerShell 也失败（极少数环境）：回退尝试 wmic（老系统），再失败则保守跳过
                            try {
                                var wmicOut = execSync('wmic process where ProcessId=' + pid + ' get Name /format:csv', { encoding: 'utf8', timeout: 3000, shell: 'cmd.exe' });
                                var wmicName = (wmicOut.split('\n')[1] || '').trim().toLowerCase();
                                isOpenCode = (wmicName === 'node.exe' || wmicName === 'opencode.exe' || wmicName === '');
                                if (!isOpenCode) {
                                    console.log('[launcher] Skipping non-OpenCode process: ' + wmicName);
                                    continue;
                                }
                            } catch(e2) {
                                // 两种方式都失败：无法确认进程身份，保守跳过
                                console.log('[launcher] Cannot verify process name for PID ' + pid + ', skipping');
                                continue;
                            }
                        }
                        try {
                            execSync('taskkill /F /PID ' + pid + ' 2>nul', { 
                                shell: 'cmd.exe',
                                stdio: 'ignore',
                                timeout: 5000
                            });
                            console.log('[launcher] Terminated PID: ' + pid);
                            killed = true;
                        } catch(e) {
                            console.log('[launcher] Failed to terminate PID ' + pid + ': ' + e.message);
                        }
                    }
                }
            }
        }
        
        if (!killed) {
            console.log('[launcher] No process found on port ' + port);
        }
        
    } catch(e) {
        console.log('[launcher] Port-based shutdown failed: ' + e.message);
    }
    
    return { success: true };
}

function stopOpenCode() {
    console.log('[launcher] stopOpenCode called');
    
    // 先尝试结束 node 跟踪的子进程
    if (opencodeProcess) {
        try {
            opencodeProcess.kill();
        } catch(e) {
            console.error('[launcher] Failed to kill child process: ' + e.message);
        }
        opencodeProcess = null;
    }

    // 按端口关闭（14096 和 14097）- 精确杀，不全杀
    try {
        stopOpenCodeByPort(14096);
    } catch(e) {
        console.log('[launcher] Port-based shutdown failed: ' + e.message);
    }
    
    // 清理 PID 文件
    var pidFile = path.join(__dirname, 'opencode.pid');
    try {
        if (fs.existsSync(pidFile)) {
            fs.unlinkSync(pidFile);
        }
    } catch(e) {}

    return { success: true };
}

function loadOpenCodeConfig() {
    var configPath = path.join(process.env.APPDATA || process.env.USERPROFILE, 'opencode', 'config.json');
    var defaultConfig = { opencodePath: 'opencode' };

    if (!fs.existsSync(configPath)) {
        console.log('[launcher] Config file not found, using defaults (run install-addons.js)');
        return defaultConfig;
    }

    try {
        var config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config && typeof config === 'object') {
            return config;
        }
    } catch (e) {
        console.error('[launcher] Config file parse failed, using defaults: ' + e.message);
    }

    return defaultConfig;
}

/**
 * 查找可用的 opencode CLI 可执行文件
 * @returns {string|null} 找到的路径，未找到返回 null
 */
function findOpenCodeBin() {
    // 1. 从配置读取（有防御性检查）
    var config = loadOpenCodeConfig();
    if (config.opencodePath) {
        if (config.opencodePath === 'opencode' || fs.existsSync(config.opencodePath)) {
            // 校验路径是可执行文件且文件名合理（防 config.json 被篡改指向任意 exe）
            var p = config.opencodePath;
            var isFile = p !== 'opencode' ? fs.statSync(p).isFile() : true;
            var nameOk = /opencode/i.test(path.basename(p)) || p === 'opencode' || /\.(exe|cmd|ps1)$/i.test(p);
            if (isFile && nameOk) {
                console.log('[launcher] Using config path: ' + config.opencodePath);
                return config.opencodePath;
            }
            console.log('[launcher] Config opencodePath invalid (not opencode-like file), falling through');
        }
    }

    // 2. 尝试常见安装路径
    var commonPaths = [
        path.join(process.env.USERPROFILE || os.homedir(), '.trae-cn', 'bin', 'opencode.exe'),
        path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'opencode', 'opencode.exe'),
        'C:\\Program Files\\opencode\\opencode.exe',
        'C:\\Program Files (x86)\\opencode\\opencode.exe'
    ];
    for (var i = 0; i < commonPaths.length; i++) {
        if (fs.existsSync(commonPaths[i])) {
            console.log('[launcher] Found: ' + commonPaths[i]);
            return commonPaths[i];
        }
    }

    // 3. 回退到 PATH 中的 opencode
    console.log('[launcher] ⚠️ OpenCode not found, searching PATH');
    console.log('[launcher] Tip: ensure opencode is installed or run install-addons.js');
    return 'opencode';
}

/**
 * 校验工作目录路径合法性
 * 拒绝 UNC 路径、DOS 设备路径、路径穿越。
 * 统一返回 { valid, resolved/error } 对象，绝不 throw——
 * 调用方（startOpenCode / dockWindow）都没有 try/catch 包裹，
 * 一旦 throw 会进入 uncaughtException 导致 launcher 进程退出。
 * @param {string} cwd - 待校验的目录路径
 * @returns {{valid: boolean, resolved?: string, error?: string}} 校验结果
 */
function validateCwd(cwd) {
    if (typeof cwd !== 'string' || !cwd) {
        return { valid: false, error: 'cwd 不能为空' };
    }
    // 拒绝 UNC 路径和 DOS 设备路径
    if (/^\\\\[?.]/.test(cwd) || /^\\\\/.test(cwd)) {
        return { valid: false, error: 'UNC and DOS device paths are not allowed' };
    }
    // 防止路径遍历：只拒绝 `..` 作为完整路径段的形态（`C:\a\..\b`），
    // 允许 `C:\my..folder` 等合法目录名（旧实现 includes('..') 误拒合法路径）
    if (/(^|[\\/])\.\.($|[\\/])/.test(cwd)) {
        return { valid: false, error: '无效的工作目录：不允许路径遍历' };
    }
    // 检查非法字符
    if (/[<>"|?*]/.test(cwd)) {
        return { valid: false, error: '无效的工作目录：包含非法字符' };
    }
    // 规范化路径
    var resolved = path.resolve(cwd);
    return { valid: true, resolved: resolved };
}

/**
 * 校验 URL 合法性（仅允许 localhost HTTP/HTTPS）
 * @param {string} url - 待校验的 URL
 * @returns {boolean} URL 合法返回 true
 */
function isValidUrl(url) {
    if (typeof url !== 'string') return false;
    try {
        var parsed = new URL(url);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
               (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    } catch (e) { return false; }
}

/**
 * 打开 Edge 停靠窗口
 * @param {string} url - 停靠目标 URL
 */
function dockWindow(callback, data) {
    var cwd = data && data.cwd ? data.cwd : ''
    var sessionId = data && data.session ? data.session : ''

    // 如果没有传cwd，使用launcher中存储的cwd
    if (!cwd && opencodeCwd) {
        cwd = opencodeCwd
    }

    // 验证 cwd：与 startOpenCode 同一套规则，通过后用 resolved 规范路径拼 query
    if (cwd) {
        var validation = validateCwd(cwd);
        if (!validation.valid) {
            console.log('[launcher] Cwd validation failed: ' + validation.error);
            callback({ success: false, error: validation.error });
            return;
        }
        cwd = validation.resolved;
    }

    console.log('[launcher] dockWindow final cwd: ' + cwd + ' session: ' + sessionId)

    // 每次调用使用唯一临时脚本名，避免并发请求互相覆盖同一 dock.ps1 的竞态
    var scriptPath = path.join(__dirname, 'dock.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8) + '.ps1');
    var edgeUrl = 'http://127.0.0.1:14096'

    // 直接使用传入的 cwd，不做任何转换
    if (cwd && cwd.length > 0) {
        edgeUrl += '?cwd=' + encodeURIComponent(cwd)
    }

    if (!isValidUrl(edgeUrl)) {
        console.error('[launcher] Invalid URL rejected:', edgeUrl);
        callback({ success: false, error: 'Invalid URL' });
        return;
    }
    console.log('[launcher] Final URL: ' + edgeUrl)
    // PowerShell 单引号字符串包裹 URL + 单引号翻倍转义：
    // - 单引号内不做 $ 变量插值（防 cwd 含 $ 被 PowerShell 解析）
    // - 单引号翻倍（''）表示字面单引号（防 cwd 含 ' 破坏字符串定界）
    // encodeURIComponent 不编码 ' 与 $，必须在此层处理
    var psSafeUrl = edgeUrl.replace(/'/g, "''");
    var script = [
        '# Open OpenCode Web',
        '$edge = @(',
        '    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",',
        '    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",',
        '    (Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe" -ErrorAction SilentlyContinue)."(default)"',
        ') | Where-Object { Test-Path $_ } | Select-Object -First 1',
        'if (-not $edge) { $edge = "msedge.exe" }',
        '& "$edge" --app=' + "'" + psSafeUrl + "'"
    ].join('\n');
    fs.writeFileSync(scriptPath, script, 'utf8');
    exec('powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + scriptPath + '"', { timeout: 5000 }, function(err, stdout, stderr) {
        // 延迟删除脚本：等 PowerShell 启动完成后再删，避免进程仍在读文件时被删
        setTimeout(function() { try { fs.unlinkSync(scriptPath) } catch(e) {} }, 2000)
        if (err) {
            // exec 超时 ≠ 启动失败：Edge 冷启动可能超过 5 秒，PowerShell 可能仍在拉起窗口。
            // 探测"带 --app= 且指向 14096 的 msedge 进程"是否出现（避免误判用户已开的普通 Edge 浏览器）
            console.error('[launcher] dockWindow exec error: ' + (err.message || err));
            try {
                var execSync = require('child_process').execSync;
                var edgeCheck = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name=\'msedge.exe\'\" | Where-Object { $_.CommandLine -match \'14096\' } | Measure-Object).Count"', { encoding: 'utf8', timeout: 3000 });
                var count = parseInt(edgeCheck.trim(), 10);
                if (count > 0) {
                    console.log('[launcher] dockWindow exec timed out but Edge app process detected (' + count + '), treating as success');
                    callback({ success: true, pid: 0, timeout: true });
                    return;
                }
            } catch(e) { /* 探测失败，按失败处理 */ }
            callback({ success: false, error: 'dock exec failed: ' + (err.message || err) });
            return;
        }
        callback({ success: true, pid: 0 })
    })
}

// ===== 崩溃自动恢复 =====
process.on('uncaughtException', function(err) {
    console.error('[launcher] CRASH: ' + (err && err.message || err));
    try {
        var pidFile = path.join(__dirname, 'opencode.pid');
        try { fs.unlinkSync(pidFile); } catch(e) {}
    } catch(e) {}
    // 释放端口，让计划任务/VBS 自动重新拉起
    server.close();
    process.exit(1);
});
process.on('unhandledRejection', function(reason) {
    console.error('[launcher] Unhandled Rejection: ' + (reason && reason.message || reason));
});

var server = http.createServer(function(req, res) {
    // 来源校验统一走 getAllowedOrigin（已覆盖：无 Origin / null / file:// 放行、
    // 白名单 127.0.0.1/localhost 放行、其余拒绝）；非白名单 Origin 直接 403。
    // 不再单独做 isLocal 判断——两套逻辑并存曾导致 file:// 面板被误拦截。
    var origin = req.headers.origin;
    if (origin && getAllowedOrigin(req) === null) {
        sendJSON(req, res, 403, { error: 'Forbidden: non-local origin' });
        return;
    }

    if (req.method === 'OPTIONS') {
        sendJSON(req, res, 200, {});
        return;
    }

    var url = req.url;

    if (req.method === 'POST' && url === '/start') {
        if (stateLock) {
            sendJSON(req, res, 409, { error: 'Another start request is in progress' });
            return;
        }
        stateLock = true;
        parseBody(req, function(body) {
            if (body === BODY_TOO_LARGE) {
                stateLock = false;
                sendJSON(req, res, 413, { error: 'Request body too large' });
                return;
            }
            try {
                var result = startOpenCode(body.cwd, body.port);
                sendJSON(req, res, result.success ? 200 : 400, result);
            } catch(e) {
                console.error('[launcher] startOpenCode failed:', e);
                sendJSON(req, res, 500, { error: 'Internal error: ' + e.message });
            } finally {
                stateLock = false;
            }
        });
        return;
    }

    if (req.method === 'POST' && url === '/stop') {
        var result = stopOpenCode();
        sendJSON(req, res, 200, result);
        return;
    }

    if (req.method === 'GET' && url === '/status') {
        sendJSON(req, res, 200, {
            running: opencodeProcess !== null,
            cwd: opencodeCwd,
            pid: opencodeProcess ? opencodeProcess.pid : null
        });
        return;
    }

    if (req.method === 'GET' && url === '/health') {
        sendJSON(req, res, 200, { healthy: true, uptime: process.uptime() });
        return;
    }

    if (req.method === 'POST' && url === '/dock') {
        parseBody(req, function(body) {
            if (body === BODY_TOO_LARGE) {
                sendJSON(req, res, 413, { error: 'Request body too large' });
                return;
            }
            dockWindow(function(result) {
                sendJSON(req, res, result.success ? 200 : 400, result);
            }, body);
        });
        return;
    }

    if (req.method === 'POST' && url === '/docinfo') {
        parseBody(req, function(body) {
            if (body === BODY_TOO_LARGE) {
                sendJSON(req, res, 413, { error: 'Request body too large' });
                return;
            }
            // 校验 body 必须是普通对象（非数组/非标量），避免写入非法缓存内容
            if (!body || typeof body !== 'object' || Array.isArray(body)) {
                sendJSON(req, res, 400, { error: 'Invalid body: expected object' });
                return;
            }
            var docInfoPath = path.join(__dirname, 'docinfo.cache.json');
            if (body && body.closed === true) {
                try { fs.unlinkSync(docInfoPath); } catch(e) { /* 文件不存在也视为清除成功 */ }
                sendJSON(req, res, 200, { success: true });
                return;
            }
            try {
                fs.writeFileSync(docInfoPath, JSON.stringify(body), 'utf8');
                sendJSON(req, res, 200, { success: true });
            } catch(e) {
                console.error('[launcher] Failed to write docinfo cache: ' + e.message);
                sendJSON(req, res, 500, { success: false, error: 'Write failed: ' + e.message });
            }
        });
        return;
    }

    if (req.method === 'GET' && url === '/docinfo') {
        var docInfoPath = path.join(__dirname, 'docinfo.cache.json');
        try {
            var data = fs.readFileSync(docInfoPath, 'utf8');
            sendJSON(req, res, 200, JSON.parse(data));
        } catch(e) {
            sendJSON(req, res, 404, { error: 'No document info available' });
        }
        return;
    }

    sendJSON(req, res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', function() {
    console.log('[launcher] Running on http://127.0.0.1:' + PORT);
});