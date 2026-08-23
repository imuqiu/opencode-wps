#!/usr/bin/env node
/**
 * 将仓库 docs/ 文档上传到 CNB Code Wiki（绕过 codewiki 插件 LLM 生成缺陷）。
 *
 * 背景（Issue #117/#204）：
 *   仓库已通过 codewiki 插件尝试自动生成 Wiki，但平台侧 codewiki 插件调用 LLM
 *   持续返回空响应（"LLM响应中未找到有效的Action标签"），导致 Wiki 从未自动生成。
 *   此前已通过 `upload/wiki/file` API 手动上传 22 篇文档成功，仓库因此出现 Wiki
 *   导航入口（flags 含 Wiki）。但手动上传的是 v1.9.3 时代使用**相对链接**的旧版文档，
 *   点击 Wiki 内链接会 404。
 *
 *   方案 A：在 `.cnb.yml` 的 `tag_push` 中新增一个 stage，构建容器内用脚本把
 *   docs/（已由 scripts/rewrite-wiki-links.js 改写为 CNB blob 绝对链接）重新上传为
 *   Wiki 页面，从而修复 Wiki 内链接 404。
 *
 * 用法（CI，tag_push 事件）：
 *   node scripts/upload-wiki.js
 *
 * 依赖环境变量（CNB 构建容器自动注入）：
 *   CNB_REPO_SLUG       仓库路径，如 lnxsun/opencode-wps
 *   CNB_TOKEN           流水线运行期临时令牌（OCI 凭证，可调用 wiki 上传 API）
 *   CNB_API_ENDPOINT    CNB API 地址，默认 https://api.cnb.cool
 *   CNB_DEFAULT_BRANCH  默认分支（可选，默认 main）
 *
 * 本脚本在构建容器内运行，仅依赖内置 Node.js，无第三方依赖。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

// 环境变量（CNB 构建容器自动注入）
const REPO_SLUG = process.env.CNB_REPO_SLUG || 'lnxsun/opencode-wps';
const CNB_TOKEN = process.env.CNB_TOKEN;
const API_BASE = process.env.CNB_API_ENDPOINT || 'https://api.cnb.cool';
const DEFAULT_BRANCH = process.env.CNB_DEFAULT_BRANCH || 'main';

// 当前 Wiki 菜单结构（与仓库首页 wiki 菜单保持一致，含 4 大分类）
// 每项：{ dir: 上传到 Wiki 的路径前缀, files: [docs/ 下文件名] }
const WIKI_MENU = [
  { dir: '', files: ['README.md'] },
  { dir: '使用指南', files: ['USAGE.md', 'INSTALLATION.md', 'TROUBLESHOOTING.md', 'FEATURES.md'] },
  {
    dir: '开发指南',
    files: [
      'DEVELOPMENT_GUIDE.md',
      'SKILLS.md',
      'ARCHITECTURE.md',
      'CODE_REVIEW_GUIDE.md',
      'WPSJS_DEVELOPMENT.md',
      'INSTALL_SCRIPT.md',
    ],
  },
  { dir: '平台专题', files: ['WINDOWS.md', 'MAC.md', 'LINUX.md'] },
  {
    dir: '内部参考',
    files: [
      'MCP.md',
      'OPENCODE_API.md',
      'WPS_COM_API.md',
      'WPS_COM_PS1.md',
      'POWERSHELL_COM.md',
      'SECURITY.md',
      'NPC_TEAM.md',
      'HISTORY.md',
    ],
  },
];

/** 汇总待上传的文档条目：{ wikiPath, sourceFile } */
function collectEntries() {
  const entries = [];
  for (const cat of WIKI_MENU) {
    for (const file of cat.files) {
      // README.md 在仓库根，其余在 docs/ 下
      const sourceFile =
        file === 'README.md' ? path.join(rootDir, 'README.md') : path.join(rootDir, 'docs', file);
      const wikiPath = cat.dir ? `${cat.dir}/${file}` : file;
      entries.push({ wikiPath, sourceFile });
    }
  }
  return entries;
}

/**
 * 上传单篇文档到 Wiki。
 * 调用 `POST /{repo}/-/upload/wiki/file`，Bearer CNB_TOKEN 认证。
 * 请求体为 multipart/form-data：file 字段携带文件内容（Blob），path 字段携带 Wiki 路径，
 * branch 字段携带目标分支。
 * @returns {Promise<{ok: boolean, status?: number, body?: string}>}
 */
async function uploadFile(wikiPath, content) {
  if (!CNB_TOKEN) {
    throw new Error('环境变量 CNB_TOKEN 未设置，无法调用 wiki 上传 API');
  }
  const url = `${API_BASE}/${REPO_SLUG}/-/upload/wiki/file`;
  const form = new FormData();
  // file 字段携带文件内容（Blob），path 字段携带 Wiki 路径，branch 携带目标分支
  form.append('file', new Blob([content], { type: 'text/markdown' }), path.basename(wikiPath));
  form.append('path', wikiPath);
  form.append('branch', DEFAULT_BRANCH);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CNB_TOKEN}`,
      // 不手动设置 Content-Type，让 fetch 自动生成 multipart boundary
    },
    body: form,
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, body: text };
}

async function main() {
  console.log(`[upload-wiki] 仓库: ${REPO_SLUG}, 分支: ${DEFAULT_BRANCH}`);
  const entries = collectEntries();
  console.log(`[upload-wiki] 共 ${entries.length} 篇文档待上传：`);
  for (const e of entries) {
    console.log(`  - ${e.wikiPath}`);
  }

  let success = 0;
  let failed = 0;
  const failures = [];

  for (const e of entries) {
    if (!fs.existsSync(e.sourceFile)) {
      console.log(`  ✗ ${e.wikiPath}：源文件不存在 ${e.sourceFile}`);
      failed++;
      failures.push(`${e.wikiPath}（源文件缺失）`);
      continue;
    }
    const content = fs.readFileSync(e.sourceFile, 'utf8');
    try {
      const result = await uploadFile(e.wikiPath, content);
      if (result.ok) {
        console.log(`  ✓ ${e.wikiPath}（HTTP ${result.status}）`);
        success++;
      } else if (result.status === 403 && /oci token/i.test(result.body)) {
        // 认证失败：当前 token 无 OCI 权限（需在 push/tag_push 类事件中运行）
        console.error(
          `✗ 认证失败：CNB_TOKEN 无 OCI 权限（HTTP 403）` +
            `。请确认本脚本在 push/tag_push 类事件中运行（该事件下 CNB_TOKEN 具有制品库/OCI 权限）。`
        );
        console.error(`  响应：${result.body.slice(0, 200)}`);
        process.exit(2);
      } else {
        console.log(`  ✗ ${e.wikiPath}（HTTP ${result.status}）：${result.body.slice(0, 200)}`);
        failed++;
        failures.push(`${e.wikiPath}（HTTP ${result.status} ${result.body.slice(0, 80)}）`);
      }
    } catch (err) {
      console.log(`  ✗ ${e.wikiPath}：${err.message}`);
      failed++;
      failures.push(`${e.wikiPath}（${err.message}）`);
    }
  }

  console.log(`\n[upload-wiki] 完成：成功 ${success} / ${failed} 失败`);
  if (failures.length) {
    console.log('[upload-wiki] 失败明细：');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { collectEntries, uploadFile };
