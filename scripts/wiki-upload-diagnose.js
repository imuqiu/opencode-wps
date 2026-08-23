#!/usr/bin/env node
/**
 * 诊断 upload/wiki/file API 的 multipart 正确参数（Issue #117 方案 A）。
 * 已确认：multipart 内容类型能到达业务逻辑（JSON 被 401 拦截），
 * 但 multipart 返回 errcode:3 Invalid argument——需定位正确字段名与 path 格式。
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
const content = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');

async function tryMultipart(label, buildForm) {
  try {
    const form = buildForm();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CNB_TOKEN}` },
      body: form,
    });
    const text = await resp.text();
    console.log(`\n=== ${label} ===`);
    console.log(`HTTP ${resp.status}: ${text.slice(0, 250)}`);
  } catch (err) {
    console.log(`\n=== ${label} ===`);
    console.log(`ERROR: ${err.message}`);
  }
}

async function main() {
  console.log(`诊断 multipart 参数，仓库=${REPO_SLUG}`);
  if (!CNB_TOKEN) {
    console.log('未设置 CNB_TOKEN');
    return;
  }

  const paths = ['README.md', '/README.md', 'docs/README.md', 'wiki/README.md'];

  // A. file 字段 + path + branch（path 四种格式）
  for (const p of paths) {
    await tryMultipart(`A file+path(${p})+branch`, () => {
      const f = new FormData();
      f.append('file', new Blob([content], { type: 'text/markdown' }), 'README.md');
      f.append('path', p);
      f.append('branch', DEFAULT_BRANCH);
      return f;
    });
  }

  // B. content 字段 + path + branch（path 两种格式）
  for (const p of ['README.md', '/README.md']) {
    await tryMultipart(`B content+path(${p})+branch`, () => {
      const f = new FormData();
      f.append('content', content);
      f.append('path', p);
      f.append('branch', DEFAULT_BRANCH);
      return f;
    });
  }

  // C. 只有 file + path（无 branch）
  await tryMultipart('C file+path(README.md) 无branch', () => {
    const f = new FormData();
    f.append('file', new Blob([content], { type: 'text/markdown' }), 'README.md');
    f.append('path', 'README.md');
    return f;
  });

  // D. file + fileName + path
  await tryMultipart('D file+fileName+path', () => {
    const f = new FormData();
    f.append('file', new Blob([content], { type: 'text/markdown' }), 'README.md');
    f.append('fileName', 'README.md');
    f.append('path', 'README.md');
    return f;
  });

  // E. 只有 file（无 path 无 branch）
  await tryMultipart('E 仅 file', () => {
    const f = new FormData();
    f.append('file', new Blob([content], { type: 'text/markdown' }), 'README.md');
    return f;
  });

  // F. wikiPath 字段
  await tryMultipart('F file+wikiPath+branch', () => {
    const f = new FormData();
    f.append('file', new Blob([content], { type: 'text/markdown' }), 'README.md');
    f.append('wikiPath', 'README.md');
    f.append('branch', DEFAULT_BRANCH);
    return f;
  });
}

main();
