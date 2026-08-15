// launcher.js - OpenCode 进程管理服务
const http = require('http');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 14097;
const OPENCODE_PORT = 14096;
let opencodeProcess = null;
let opencodeCwd = '';
let dockedPid = 0;
let stateLock = false;
// opencode serve 服务端日志写流（模块级持有，便于 stop/exit 时统一关闭，避免资源泄漏）
let opencodeLogStream = null;

// 关闭并释放 opencode serve 日志写流（幂等，可安全重复调用）
// 注意：用 end() 会先 flush 缓冲区再关闭 fd，避免 destroy() 丢弃未落盘数据；
// 由于写流只被子进程 stdout/stderr 使用，子进程退出后这里即可安全关闭。
function closeOpenCodeLogStream() {
    if (opencodeLogStream) {
        try {
            opencodeLogStream.end();
        } catch (e) { /* 忽略关闭过程中的错误 */ }
        opencodeLogStream = null;
    }
}

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

    // 服务端日志落盘：stdio 由 'ignore' 改为管道，stdout/stderr 写入日志文件。
    // 之前 'ignore' 直接丢弃 opencode serve 的全部日志，导致用户无法查看
    // 服务端日志来定位 UnknownError（如 err_edae3507）等运行期错误。
    // 先关闭上一次遗留的日志写流（防止重复启动时产生孤儿流，符合重入安全）
    closeOpenCodeLogStream();
    var logFile = null;
    try {
        var logDir = path.join(os.homedir(), '.opencode', 'logs');
        if (!fs.existsSync(logDir)) { fs.mkdirSync(logDir, { recursive: true }); }
        logFile = path.join(logDir, 'opencode-serve.log');
        // 简单大小轮转：超过阈值（如 5MB）时把旧日志重命名，避免无限增长占满磁盘。
        // Windows 上 rename 目标已存在会抛错，故先删除上次的 .old（忽略其不存在）。
        try {
            var MAX_LOG_BYTES = 5 * 1024 * 1024;
            if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
                try { if (fs.existsSync(logFile + '.old')) { fs.unlinkSync(logFile + '.old'); } } catch (e) {}
                fs.renameSync(logFile, logFile + '.old');
            }
        } catch (e) { /* 轮转失败不影响日志落盘 */ }
        // 'a' 追加模式：保留历史日志，便于对比多次运行
        opencodeLogStream = fs.createWriteStream(logFile, { flags: 'a' });
    } catch (e) {
        console.log('[launcher] Failed to init opencode log file: ' + e.message);
    }

    try {
        // stdio 处理与 shell 模式解耦：shell 模式（如 npm 全局安装的 opencode.cmd，
        // needShell=true）下 Node 不允许向 stdio 传流对象（WriteStream），否则抛
        // "The argument 'stdio' is invalid. Received WriteStream {fd:null,...}" 导致
        // spawn 前直接 throw（Issue #134 回归，用户 .cmd 场景启动必失败）。
        // 因此 shell 模式改用 ['ignore','pipe','pipe'] + 手动 pipe 到日志写流；
        // 非 shell 模式（.exe/.ps1 直接 CreateProcess）才可把日志写流直接作为 stdio。
        if (needShell) {
            opencodeProcess = spawn(
                opencodeBin,
                opencodeArgs,
                {
                    cwd: cwd,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    detached: false,
                    windowsHide: true,
                    shell: true
                }
            );
            // 手动把子进程 stdout/stderr pipe 进日志写流（shell 模式无法直接作为 stdio）。
            // 失败不阻断：即便日志流异常，opencode serve 仍能正常启动并运行。
            if (opencodeLogStream) {
                if (opencodeProcess.stdout) {
                    opencodeProcess.stdout.on('data', function(d) { try { opencodeLogStream.write(d); } catch (e) {} });
                }
                if (opencodeProcess.stderr) {
                    opencodeProcess.stderr.on('data', function(d) { try { opencodeLogStream.write(d); } catch (e) {} });
                }
            }
        } else {
            var stdioArr = opencodeLogStream ? ['ignore', opencodeLogStream, opencodeLogStream] : ['ignore', 'ignore', 'ignore'];
            opencodeProcess = spawn(
                opencodeBin,
                opencodeArgs,
                {
                    cwd: cwd,
                    stdio: stdioArr,
                    detached: false,
                    windowsHide: true,
                    shell: false
                }
            );
        }

        if (logFile) {
            console.log('[launcher] opencode serve logs → ' + logFile);
        }

        opencodeProcess.on('error', function(err) {
            console.log('[launcher] Error: ' + err.message);
            // 把启动失败原因写进 opencode-serve.log：计划任务/VBS 启动的 launcher 控制台不可见，
            // 若不落盘则失败原因完全丢失（Issue #134 的 opencode-serve.log 曾为空）。
            // 常见 ENOENT = 找不到 opencode 二进制；EACCES = 权限不足。
            // 直接复用闭包中已算好的 opencodeBin，避免在此失败关键路径上再次触发
            // findOpenCodeBin() 里同步阻塞的 execSync('where opencode', {timeout:5000})。
            var errMsg = '[launcher] spawn error: ' + err.message +
                ' (opencodeBin=' + (opencodeBin || '<empty>') + ')';
            try {
                if (opencodeLogStream && opencodeLogStream.writable) {
                    // 用 end(errMsg) 而非 write()+closeOpenCodeLogStream()：end 会在 flush
                    // 缓冲区后关闭 fd，避免依赖隐式 flush 行为导致失败原因丢日志。
                    opencodeLogStream.end(errMsg + '\n');
                }
            } catch (e) { /* 日志写入失败不阻断 */ }
            console.log(errMsg);
            opencodeProcess = null;
            // 子进程启动失败，释放日志写流（end 已触发，closeOpenCodeLogStream 幂等置空）
            closeOpenCodeLogStream();
        });

        opencodeProcess.on('exit', function(code) {
            console.log('[launcher] Exited: ' + code);
            opencodeProcess = null;
            // 子进程退出后释放日志写流，确保末尾日志落盘
            closeOpenCodeLogStream();
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
    // 关闭 opencode serve 日志写流，确保末尾日志落盘
    closeOpenCodeLogStream();

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

/**
 * 探测指定端口当前是否被监听（同步）。
 * 用于 /status 在 opencodeProcess 引用丢失（如 launcher 重启）时回退判断服务是否仍在运行。
 * 基于 netstat -ano 匹配本地监听地址，与 stopOpenCodeByPort 同一套匹配规则。
 * @param {number} port - 目标端口（1-65535）
 * @returns {boolean} 端口是否被 LISTENING
 */
function isPortListening(port) {
    port = parseInt(port, 10);
    if (isNaN(port) || port < 1 || port > 65535) return false;
    try {
        var execSync = require('child_process').execSync;
        // findstr 匹配 ":port "（带尾空格）减少 :140960/:114096 等子串误匹配
        var output = execSync('netstat -ano | findstr ":' + port + ' "', {
            shell: 'cmd.exe',
            encoding: 'utf8',
            timeout: 5000
        });
        var lines = output.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('LISTENING') > 0) {
                var parts = line.split(/\s+/);
                var localAddr = parts[1] || '';
                // IPv6 地址 [::1]:14096 含多个冒号，用 lastIndexOf 取端口
                var listenPort = parseInt(localAddr.substring(localAddr.lastIndexOf(':') + 1), 10);
                if (listenPort === port) {
                    return true;
                }
            }
        }
    } catch (e) {
        // netstat 失败（极少数环境）不阻断，视为端口未监听
    }
    return false;
}

function loadOpenCodeConfig() {
    // 优先读取 opencode 的真实全局配置位置（与 install-addons.js 写入一致）：
    //   Windows: %USERPROFILE%\.config\opencode\opencode.json
    //   POSIX:   ~/.config/opencode/opencode.json
    // 兼容旧路径 %APPDATA%\opencode\config.json（历史遗留），两者都读不到再走 PATH 探测。
    var candidates = [
        path.join(process.env.USERPROFILE || os.homedir(), '.config', 'opencode', 'opencode.json'),
        // 旧路径兜底：APPDATA/USERPROFILE 均未定义（如裸 Linux 环境）时退回 os.homedir()，避免 path.join(undefined) 抛错
        path.join(process.env.APPDATA || process.env.USERPROFILE || os.homedir(), 'opencode', 'config.json')
    ];
    var defaultConfig = { opencodePath: 'opencode' };

    var configPath = null;
    for (var ci = 0; ci < candidates.length; ci++) {
        if (fs.existsSync(candidates[ci])) { configPath = candidates[ci]; break; }
    }

    if (!configPath) {
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
 * 在指定目录里探测 opencode 可执行文件（兼容 .exe/.cmd/.ps1 三种形态）。
 * npm 全局安装会同时生成 opencode、opencode.cmd、opencode.ps1 三个 shim，
 * 交互 PowerShell 的 Get-Command 优先解析 .ps1，而 cmd.exe 只会解析 .exe/.cmd/.bat。
 * 统一在此按扩展名探测，避免依赖 launcher 运行期（计划任务/VBS）的 PATH。
 * @param {string} dir - 待探测目录
 * @returns {string|null} 命中返回绝对路径，未命中返回 null
 */
function findOpenCodeInDir(dir) {
    if (!dir || typeof dir !== 'string') return null;
    // 优先 .exe，其次 .cmd（cmd 可直接执行），最后 .ps1（走 powershell -File）
    var exts = ['.exe', '.cmd', '.ps1'];
    for (var ei = 0; ei < exts.length; ei++) {
        var candidate = path.join(dir, 'opencode' + exts[ei]);
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return candidate;
            }
        } catch (e) { /* 单个候选探测失败不阻断 */ }
    }
    return null;
}

/**
 * 收集 opencode 可能所在的 bin 目录（Windows）。
 * 覆盖 npm 全局安装、Trae 自带 node、以及 Program Files 等常见位置，
 * 供 findOpenCodeBin 按扩展名逐一探测。
 * @returns {string[]} 候选目录列表（去重、按优先级排序）
 */
function getOpenCodeBinDirs() {
    var user = process.env.USERPROFILE || os.homedir() || '';
    var appdata = process.env.APPDATA || path.join(user, 'AppData', 'Roaming');
    var localAppData = process.env.LOCALAPPDATA || path.join(user, 'AppData', 'Local');
    var dirs = [
        // Trae 自带 node 的全局 bin（用户机器实测：opencode.ps1 位于此）
        path.join(user, '.trae-cn', 'sdks', 'versions', 'node', 'current'),
        path.join(user, '.trae-cn', 'bin'),
        // npm 全局 bin
        path.join(appdata, 'npm'),
        path.join(localAppData, 'npm'),
        // opencode 官方安装器
        path.join(localAppData, 'Programs', 'opencode'),
        'C:\\Program Files\\opencode',
        'C:\\Program Files (x86)\\opencode'
    ];
    var seen = {};
    var out = [];
    for (var i = 0; i < dirs.length; i++) {
        if (!dirs[i]) continue;
        var key = dirs[i].toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        out.push(dirs[i]);
    }
    return out;
}

/**
 * 解析 `where opencode` 命令输出，返回第一个命中的 opencode 可执行文件绝对路径。
 * 逐行过滤：文件名含 opencode 且以 .exe/.cmd/.ps1 结尾（Windows 扩展名判定）。
 * @param {string} output - `where opencode` 的原始输出（可含 \r\n 换行）
 * @returns {string|null} 命中返回绝对路径；未命中返回 null
 */
function parseWhereOutput(output) {
    if (typeof output !== 'string' || !output) return null;
    var lines = output.split(/\r?\n/);
    for (var li = 0; li < lines.length; li++) {
        var line = (lines[li] || '').trim();
        if (!line) continue;
        // 提取文件名：兼容 / 与 \ 分隔符（path.basename 在非 Windows 上不识别
        // 反斜杠路径，故手动取最后一个分隔符后的片段，保证单测跨平台可跑）。
        var base = line.split(/[\/\\]/).pop();
        // 取第一个命中的 opencode（.exe/.cmd/.ps1 均可）。
        // 用 ^opencode\.(...)$ 精确匹配文件名，避免误命中相邻文件（如
        // opencodehelper.exe / opencode-tool.cmd / my-opencode.bin）。`where opencode`
        // 虽只返回精确同名项，收紧后更稳，且不受基线路径影响。
        if (/^opencode\.(exe|cmd|ps1)$/i.test(base)) {
            return line;
        }
    }
    return null;
}

/**
 * 查找可用的 opencode CLI 可执行文件（绝对路径）。
 * 优先级：显式配置 > 常见 bin 目录探测（.exe/.cmd/.ps1）> PATH 解析 > 裸 'opencode'。
 * @returns {string} 找到的 opencode 可执行路径；未找到时返回裸 'opencode'（依赖运行期 PATH）
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

    // 2. 在常见 bin 目录按扩展名探测（.exe/.cmd/.ps1）
    var dirs = getOpenCodeBinDirs();
    for (var di = 0; di < dirs.length; di++) {
        var found = findOpenCodeInDir(dirs[di]);
        if (found) {
            console.log('[launcher] Found: ' + found);
            return found;
        }
    }

    // 3. 用 `where opencode` 从 PATH 解析真实路径（where 依赖本进程运行期 PATH，
    //    计划任务/VBS 拉起的 launcher 不含 .trae-cn；真正覆盖 #134 的是第 2 步目录探测）
    try {
        var execSync = require('child_process').execSync;
        var out = execSync('where opencode', { shell: 'cmd.exe', encoding: 'utf8', timeout: 5000 });
        var viaWhere = parseWhereOutput(out);
        if (viaWhere) {
            console.log('[launcher] Found via PATH: ' + viaWhere);
            return viaWhere;
        }
    } catch (e) { /* where 未命中或命令失败，继续回退 */ }

    // 4. 回退到裸 'opencode'（依赖运行期 PATH，最后手段）
    console.log('[launcher] ⚠️ OpenCode not found in known paths/PATH');
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
        // 状态判定：opencodeProcess 引用存在即 running；
        // 但 launcher 重启后（opencodeProcess 复位为 null）而 14096 端口仍被占用时，
        // 进程其实仍在运行 —— 需回退探测端口，避免 UI 误显 stopped（Issue #114 回归）。
        var running = opencodeProcess !== null;
        // 端口监听探测：仅 running=false 时才需实际 netstat；running=true 时端口必然占用，
        // portOpen 恒 true（避免多余 netstat）。前端可用 running || portOpen 交叉判断。
        var portOpen = running ? true : isPortListening(OPENCODE_PORT);
        if (!running) {
            running = portOpen;
        }
        sendJSON(req, res, 200, {
            running: running,
            cwd: opencodeCwd,
            pid: opencodeProcess ? opencodeProcess.pid : null,
            // 额外暴露端口探测结果，便于前端多源交叉验证（与 running 同源复用，避免重复 netstat）
            portOpen: portOpen
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

// 仅在作为主模块运行时才启动 HTTP 服务（require 用于单测时跳过监听）
if (require.main === module) {
    server.listen(PORT, '127.0.0.1', function() {
        console.log('[launcher] Running on http://127.0.0.1:' + PORT);
    });
}

// 导出纯函数供单测 require 真实实现（避免测试文件里维护一份与交付代码脱节的副本）。
// 被 require 时跳过上面 server.listen，仅暴露函数。
module.exports = {
    parseWhereOutput: parseWhereOutput,
    findOpenCodeBin: findOpenCodeBin,
    findOpenCodeInDir: findOpenCodeInDir,
    getOpenCodeBinDirs: getOpenCodeBinDirs,
    loadOpenCodeConfig: loadOpenCodeConfig,
    validateCwd: validateCwd,
    isPortListening: isPortListening
};