// opencode-proxy.js
// 轻量反向代理：转发请求到 opencode 服务器，去掉 CSP 头
// WPS 内嵌浏览器对 CSP 处理过严，导致 SPA 无法正常初始化

var http = require('http')
var TARGET_HOST = '127.0.0.1'
var TARGET_PORT = 14096
var PROXY_PORT = 14098

var server = http.createServer(function (clientReq, clientRes) {
    // CORS preflight 优先处理：不触碰上游，避免 OPTIONS 白白建立连接
    if (clientReq.method === 'OPTIONS') {
        clientRes.writeHead(200, {
            'access-control-allow-origin': 'http://127.0.0.1:14096',
            'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'access-control-allow-headers': 'Content-Type, x-opencode-directory',
            'access-control-max-age': '86400'
        })
        clientRes.end()
        return
    }

    var options = {
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        path: clientReq.url,
        method: clientReq.method,
        headers: Object.assign({}, clientReq.headers, {
            host: TARGET_HOST + ':' + TARGET_PORT
        })
    }

    var proxyReq = http.request(options, function (proxyRes) {
        // 复制响应头，但去掉 CSP 与 hop-by-hop 头（connection/transfer-encoding 等
        // 应由 Node 自动管理，转发会导致分块冲突/连接悬挂）
        var HOP_BY_HOP = ['connection', 'transfer-encoding', 'keep-alive', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer']
        var headers = {}
        for (var key in proxyRes.headers) {
            var lk = key.toLowerCase()
            if (lk === 'content-security-policy' || HOP_BY_HOP.indexOf(lk) !== -1) continue
            headers[key] = proxyRes.headers[key]
        }
        // 允许所有来源的 CORS
        headers['access-control-allow-origin'] = 'http://127.0.0.1:14096'
        headers['access-control-allow-methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
        headers['access-control-allow-headers'] = 'Content-Type, x-opencode-directory'

        clientRes.writeHead(proxyRes.statusCode, headers)
        proxyRes.pipe(clientRes, { end: true })
    })

    proxyReq.on('error', function (err) {
        clientRes.writeHead(502)
        clientRes.end('Proxy error: ' + err.message)
    })

    // 客户端提前断开时销毁上游请求，防止悬挂连接（内存/句柄泄漏）
    clientReq.on('error', function () {
        proxyReq.destroy()
    })
    clientReq.on('close', function () {
        if (!clientRes.writableEnded) proxyReq.destroy()
    })

    clientReq.pipe(proxyReq, { end: true })
})

server.listen(PROXY_PORT, TARGET_HOST, function () {
    console.log('[OpenCode Proxy] Listening on http://' + TARGET_HOST + ':' + PROXY_PORT)
    console.log('[OpenCode Proxy] Forwarding to http://' + TARGET_HOST + ':' + TARGET_PORT)
    console.log('[OpenCode Proxy] CSP headers stripped')
})

server.on('error', function (err) {
    if (err.code === 'EADDRINUSE') {
        console.log('[OpenCode Proxy] Port ' + PROXY_PORT + ' already in use, proxy likely already running')
    } else {
        console.error('[OpenCode Proxy] Error:', err.message)
    }
})
