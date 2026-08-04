#!/usr/bin/env node
/**
 * launcher-linux.js - OpenCode 进程管理服务 (Linux)
 *
 * 基于 launcher-mac.js 适配 Linux：
 * - /proc 扫描 + ps / kill 定位 opencode 进程（Linux 最小化安装默认无 lsof，故不依赖）
 * - xdg-open 替代 open 打开浏览器
 * - PATH 探测增加 Linux 常见路径（/usr/local/bin, /usr/bin, ~/.local/bin, ~/.opencode/bin）
 * - 孤儿 MCP 进程清理使用 Linux 兼容的 ps 语法
 */

var http = require('http');
var { spawn, exec } = require('child_process');
var path = require('path');
var fs = require('fs');
var os = require('os');

var PORT = 14097;
var opencodeProcess = null;
var opencodeCwd = '';

// ===== 启动时清理孤儿 MCP 进程（仅清理本 launcher 派生的孤儿，避免误杀用户手动启动的正常实例）=====
function cleanupOrphanedMcp() {
    try {
        var execSync = require('child_process').execSync;
        // 只清理命令行含 opencode-wps 仓库路径的 MCP 进程，且其父进程已不存在（孤儿）
        // 用 ps -eo pid,ppid,args 精确匹配，避免误杀外部已运行实例
        var out = execSync(
            "ps -eo pid,ppid,args | grep 'wps-office-mcp/dist/index.js' | grep -v grep | awk '{print \$1, \$2}'",
            { encoding: 'utf8', timeout: 5000 }
        );
        var lines = out.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var parts = lines[i].trim().split(/\s+/);
            if (parts.length < 2) continue;
            var pid = parseInt(parts[0], 10);
            var ppid = parseInt(parts[1], 10);
            if (!pid || isNaN(pid)) continue;
            // 父进程为 1（init/systemd）表示是孤儿；父进程存活说明有宿主在管理，不杀
            if (ppid === 1) {
                try { execSync('kill ' + pid, { timeout: 3000 }); } catch(e) {}
            }
        }
    } catch(e) {}
}
cleanupOrphanedMcp();

function parseBody(req, callback) {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
        try { callback(JSON.parse(body)); }
        catch(e) {
            console.log('[launcher] Parse error: ' + e.message);
            callback({});
        }
    });
}

function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

function findOpenCodeBin() {
    var configPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
    if (fs.existsSync(configPath)) {
        try {
            var config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.opencodePath && fs.existsSync(config.opencodePath)) {
                console.log('[launcher] Using config path: ' + config.opencodePath);
                return config.opencodePath;
            }
        } catch(e) {}
    }

    var commonPaths = [
        path.join(os.homedir(), '.opencode', 'bin', 'opencode'),
        path.join(os.homedir(), '.local', 'bin', 'opencode'),
        '/usr/local/bin/opencode',
        '/usr/bin/opencode',
        '/opt/opencode/bin/opencode'
    ].filter(Boolean);
    for (var i = 0; i < commonPaths.length; i++) {
        if (fs.existsSync(commonPaths[i])) {
            console.log('[launcher] Found: ' + commonPaths[i]);
            return commonPaths[i];
        }
    }

    try {
        var whichOut = require('child_process').execSync('which opencode 2>/dev/null || echo ""', { encoding: 'utf8', timeout: 3000 });
        var whichPath = whichOut.trim();
        if (whichPath) {
            console.log('[launcher] Found via PATH: ' + whichPath);
            return whichPath;
        }
    } catch(e) {}

    console.log('[launcher] opencode not found, falling back to PATH');
    return 'opencode';
}

// 扫描 /proc/*/cmdline，精确定位 opencode serve --port <targetPort> 进程
// 不依赖 lsof（Linux 最小化安装/容器默认无 lsof），避免 execSync 抛异常导致 stop/重启失效
function findOpenCodePidsByPort(targetPort) {
    var procs = [];
    try { procs = fs.readdirSync('/proc'); } catch(e) { return []; }

    var pids = [];
    var portStr = String(targetPort);
    for (var i = 0; i < procs.length; i++) {
        var pid = parseInt(procs[i], 10);
        if (!pid || isNaN(pid)) continue;
        try {
            var cmdline = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').replace(/\0/g, ' ');
            // 同时匹配 opencode 与 --port <targetPort>，避免误杀其它进程
            if (cmdline.indexOf('opencode') !== -1 &&
                cmdline.indexOf('serve') !== -1 &&
                cmdline.indexOf('--port') !== -1 &&
                cmdline.indexOf(portStr) !== -1) {
                pids.push(pid);
            }
        } catch(e) {}
    }
    return pids;
}

function stopOpenCodeByPort(targetPort) {
    targetPort = targetPort || 14096;
    console.log('[launcher] stopOpenCodeByPort: ' + targetPort);

    try {
        var execSync = require('child_process').execSync;
        var pids = findOpenCodePidsByPort(targetPort);
        if (pids.length === 0) {
            console.log('[launcher] 端口 ' + targetPort + ' 无 OpenCode 进程');
        }
        for (var i = 0; i < pids.length; i++) {
            var pid = pids[i];
            try {
                var nameOut = execSync("ps -p " + pid + " -o comm= 2>/dev/null", { encoding: 'utf8', timeout: 3000 });
                var procName = (nameOut || '').trim().toLowerCase();
                if (procName.indexOf('node') === -1 && procName.indexOf('opencode') === -1 && procName !== '') {
                    console.log('[launcher] 跳过非 OpenCode 进程: ' + procName);
                    continue;
                }
            } catch(e) {}
            try {
                execSync('kill ' + pid, { timeout: 3000 });
                console.log('[launcher] 已终止 PID: ' + pid);
            } catch(e) {
                console.log('[launcher] 终止 PID ' + pid + ' 失败: ' + e.message);
            }
        }
    } catch(e) {
        console.log('[launcher] 端口 ' + targetPort + ' 处理失败: ' + e.message);
    }

    return { success: true };
}

function stopOpenCode() {
    console.log('[launcher] stopOpenCode');
    if (opencodeProcess) {
        try { opencodeProcess.kill('SIGTERM'); } catch(e) {
            console.error('[launcher] 终止子进程失败: ' + e.message);
        }
        opencodeProcess = null;
    }
    stopOpenCodeByPort(14096);
    return { success: true };
}

function startOpenCode(cwd, port) {
    console.log('[launcher] startOpenCode cwd=' + cwd + ' port=' + port);
    if (opencodeProcess) {
        return { success: false, error: 'already running' };
    }
    // cwd 为空时使用用户主目录（自愈/默认启动场景），避免空 cwd 导致启动失败
    if (!cwd) {
        cwd = os.homedir();
        console.log('[launcher] cwd 为空，使用用户主目录: ' + cwd);
    }
    if (!fs.existsSync(cwd)) {
        try { fs.mkdirSync(cwd, { recursive: true }); } catch(e) {}
    }
    opencodeCwd = cwd;
    var opencodeBin = findOpenCodeBin();
    console.log('[launcher] Starting: ' + opencodeBin);

    try {
        opencodeProcess = spawn(opencodeBin, [
            'serve', '--port', String(port || 14096),
            '--hostname', '127.0.0.1', '--cors', 'file://'
        ], {
            cwd: cwd,
            stdio: 'ignore',
            detached: false
        });

        opencodeProcess.on('error', function(err) {
            console.log('[launcher] Error: ' + err.message);
            opencodeProcess = null;
        });

        opencodeProcess.on('exit', function(code) {
            console.log('[launcher] Exited: ' + code);
            opencodeProcess = null;
        });

        console.log('[launcher] Started PID: ' + opencodeProcess.pid);

        var pidFile = path.join(__dirname, 'opencode.pid');
        try { fs.writeFileSync(pidFile, String(opencodeProcess.pid)); } catch(e) {}

        return { success: true, pid: opencodeProcess.pid };
    } catch(e) {
        return { success: false, error: e.message };
    }
}

function dockWindow(callback, data) {
    var cwd = data && data.cwd ? data.cwd : '';
    var sessionId = data && data.session ? data.session : '';
    if (!cwd && opencodeCwd) cwd = opencodeCwd;

    console.log('[launcher] dockWindow: cwd=' + cwd + ' session=' + sessionId);
    var url = 'http://127.0.0.1:14096';
    if (cwd) url += '?cwd=' + encodeURIComponent(cwd);
    if (sessionId) url += (cwd ? '&' : '?') + 'session=' + encodeURIComponent(sessionId);

    // Linux: 使用 execFile + 参数数组打开系统默认浏览器，避免 URL 中的不可信字符（引号/分号等）被 shell 解释（命令注入）
    // 依次尝试 xdg-open / google-chrome / firefox，前一个失败则尝试下一个；全部失败必须报失败（不能让用户误以为已打开）
    function tryOpenBrowser(browsers, index) {
        if (index >= browsers.length) {
            // 所有浏览器都尝试失败：明确返回失败，避免用户无感知（第 4 轮只修了单个失败重试，这里补上全部失败语义）
            callback({ success: false, error: 'no usable browser (tried xdg-open/google-chrome/firefox)' });
            return;
        }
        var bin = browsers[index];
        var child = require('child_process').execFile(bin, [url], { timeout: 8000 }, function(err) {
            if (err) {
                // ENOENT(命令不存在) 或其它启动失败（无图形会话/无默认应用）都尝试下一个浏览器
                tryOpenBrowser(browsers, index + 1);
            } else {
                callback({ success: true, pid: 0 });
            }
        });
    }
    tryOpenBrowser(['xdg-open', 'google-chrome', 'firefox'], 0);
}

process.on('uncaughtException', function(err) {
    console.error('[launcher] CRASH: ' + (err && err.message || err));
    try {
        var pidFile = path.join(__dirname, 'opencode.pid');
        try { fs.unlinkSync(pidFile); } catch(e) {}
    } catch(e) {}
    server.close();
    process.exit(1);
});
process.on('unhandledRejection', function(reason) {
    console.error('[launcher] Unhandled Rejection: ' + (reason && reason.message || reason));
});

var server = http.createServer(function(req, res) {
    if (req.method === 'OPTIONS') {
        sendJSON(res, 200, {});
        return;
    }

    var url = req.url;

    if (req.method === 'POST' && url === '/start') {
        parseBody(req, function(body) {
            try {
                var result = startOpenCode(body.cwd, body.port);
                sendJSON(res, result.success ? 200 : 400, result);
            } catch(e) {
                console.error('[launcher] startOpenCode failed:', e);
                sendJSON(res, 500, { error: 'Internal error: ' + e.message });
            }
        });
        return;
    }

    if (req.method === 'POST' && url === '/stop') {
        sendJSON(res, 200, stopOpenCode());
        return;
    }

    if (req.method === 'GET' && url === '/status') {
        sendJSON(res, 200, {
            running: opencodeProcess !== null,
            cwd: opencodeCwd,
            pid: opencodeProcess ? opencodeProcess.pid : null
        });
        return;
    }

    if (req.method === 'GET' && url === '/health') {
        sendJSON(res, 200, { healthy: true, uptime: process.uptime() });
        return;
    }

    if (req.method === 'POST' && url === '/dock') {
        parseBody(req, function(body) {
            dockWindow(function(result) {
                sendJSON(res, result.success ? 200 : 400, result);
            }, body);
        });
        return;
    }

    sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', function() {
    console.log('[launcher] Linux Launcher running on http://127.0.0.1:' + PORT);
});
