#!/usr/bin/env node
/**
 * 诊断 upload/wiki/file API 的正确请求格式。
 * 对单篇文档尝试多种格式，打印每种格式的 HTTP 状态与响应体，
 * 以确定接口期望的 body 结构（Issue #117 方案 A 实测 10401/errcode:3 定位）。
 * 仅在 tag_push 事件（有 OCI 权限的 CNB_TOKEN）下运行有意义。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const REPO_SLUG = process.env.CNB_REPO_SLUG || 'lnxsun/opencode-wps';
const CNB_TOKEN = process.env.CNB_TOKEN;
const API_BASE = process.env.CNB_API_ENDPOINT || 'https://api.cnb.cool';
const DEFAULT_BRANCH = process.env.CNB_DEFAULT_BRANCH || 'main';

const url = `${API_BASE}/${REPO_SLUG}/-/upload/wiki/file`;
const wikiPath = 'README.md';
const content = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
const contentB64 = Buffer.from(content, 'utf8').toString('base64');

async function tryRequest(label, init) {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CNB_TOKEN}`,
        ...(init.headers || {}),
      },
      ...init,
    });
    const text = await resp.text();
    console.log(`\n=== ${label} ===`);
    console.log(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  } catch (err) {
    console.log(`\n=== ${label} ===`);
    console.log(`ERROR: ${err.message}`);
  }
}

async function main() {
  console.log(`诊断 upload/wiki/file 格式，仓库=${REPO_SLUG}，路径=${wikiPath}`);
  console.log(`源文件大小: ${Buffer.byteLength(content)} bytes, base64: ${Buffer.byteLength(contentB64)} bytes`);
  if (!CNB_TOKEN) {
    console.log('未设置 CNB_TOKEN，诊断无意义');
    return;
  }

  // 1. JSON {path, content, branch}
  await tryRequest('JSON {path, content, branch}', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: wikiPath, content, branch: DEFAULT_BRANCH }),
  });

  // 2. JSON {path, content}（不带 branch）
  await tryRequest('JSON {path, content}', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: wikiPath, content }),
  });

  // 3. JSON {path, content(base64), branch}
  await tryRequest('JSON {path, content(b64), branch}', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: wikiPath, content: contentB64, branch: DEFAULT_BRANCH }),
  });

  // 4. JSON {path, content, fileName}
  await tryRequest('JSON {path, content, fileName}', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: wikiPath, content, fileName: 'README.md' }),
  });

  // 5. multipart {file(Blob), path, branch}
  {
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/markdown' }), 'README.md');
    form.append('path', wikiPath);
    form.append('branch', DEFAULT_BRANCH);
    await tryRequest('multipart {file, path, branch}', { body: form });
  }

  // 6. multipart {content, path, branch}
  {
    const form = new FormData();
    form.append('content', content);
    form.append('path', wikiPath);
    form.append('branch', DEFAULT_BRANCH);
    await tryRequest('multipart {content, path, branch}', { body: form });
  }

  // 7. raw body，path 在 query
  await tryRequest(`raw body + query path (${wikiPath})`, {
    headers: { 'Content-Type': 'text/markdown' },
    body: content,
  });
}

main();
