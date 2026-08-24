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
 * ⚠️ 实测结论（Issue #117 2026-08-23 已验证）：
 *   本脚本在 tag_push（CI）环境下**无法通过 upload/wiki/file API 上传 Wiki**：
 *   - JSON body（{path,content,branch}）→ 401 errcode:16「user is not logged in」
 *   - multipart（file/content + path + branch）→ 400 errcode:3「Invalid argument」
 *   即流水线临时令牌 CNB_TOKEN 对该内部 API 无认证/授权权限（docker login 有效但
 *   HTTP 上传接口不可用）。上传修正后的 docs/ 至 Wiki 需用户本人（OAuth 权限）
 *   通过网页手动上传，或等待平台修复 codewiki 插件 LLM 缺陷后自动生成。
 *   本脚本保留作平台能力恢复后的自动尝试。
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

// 一级目录落地页（Issue #210）：Wiki 导航会把每个一级目录渲染成一个“与一级目录同名”的
// 首个子节点（指向裸目录路径，如 /-/wiki/使用指南）。此前只上传了 `使用指南/USAGE.md` 这类
// 带子路径的页面，裸目录路径上没有页面，导致点击同名节点 → 404。
//
// 修复：为每个一级目录额外上传一页“裸路径落地页”（路径 = 目录名本身），使点击同名节点可落到
// 真实内容而非 404。落地内容规则：
//   - 存在“同名文档”（标题与一级目录完全一致）的目录 → 复用该文档内容（使用指南→USAGE.md，
//     开发指南→DEVELOPMENT_GUIDE.md）；
//   - 无同名文档的目录（平台专题/内部参考）→ 生成一篇“分类索引页”，列出本目录全部文档链接。
// 每项：{ dir: 一级目录名, indexSourceFile?: 复用的同名文档路径 }
const CATEGORY_INDEX = [
  { dir: '使用指南', indexSourceFile: 'USAGE.md' },
  { dir: '开发指南', indexSourceFile: 'DEVELOPMENT_GUIDE.md' },
  { dir: '平台专题' },
  { dir: '内部参考' },
];

/** 生成“分类索引页”内容（用于无同名文档的一级目录落地页） */
function buildCategoryIndex(dir) {
  const cat = WIKI_MENU.find(c => c.dir === dir);
  if (!cat) {
    throw new Error(`未知 Wiki 分类: ${dir}`);
  }
  // 索引页链接指向 Wiki 内页面（/-/wiki/<dir>/<file>），让用户停留在 Wiki 内浏览
  const wikiBase = `https://cnb.cool/${REPO_SLUG}/-/wiki/${encodeURIComponent(dir)}`;
  const lines = [`# ${dir}`, ''];
  lines.push(`> 本文档是「${dir}」分类的索引页，汇总该分类下的全部 Wiki 文档。`, '');
  lines.push('| 文档 | 说明 |', '|------|------|');
  for (const file of cat.files) {
    lines.push(
      `| [${file}](${wikiBase}/${encodeURIComponent(file)}) | ${file.replace(/\.md$/, '')} |`
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * 一级目录 → 落地页配置 的 Map 缓存（避免逐 cat 线性查找 CATEGORY_INDEX）。
 * @type {Map<string, {dir: string, indexSourceFile?: string}>}
 */
const CATEGORY_INDEX_MAP = new Map(CATEGORY_INDEX.map(c => [c.dir, c]));

/**
 * 汇总待上传的文档条目：{ wikiPath, sourceFile, content? }（content 优先于 sourceFile）。
 * @param {string} [docsDir] 可选：docs 目录绝对路径，默认 path.join(rootDir, 'docs')；
 *   供测试注入隔离目录使用，避免读写真实工作区文件。
 */
function collectEntries(docsDir = path.join(rootDir, 'docs')) {
  const entries = [];
  for (const cat of WIKI_MENU) {
    for (const file of cat.files) {
      // README.md 在仓库根，其余在 docs/ 下
      const sourceFile =
        file === 'README.md' ? path.join(rootDir, 'README.md') : path.join(docsDir, file);
      const wikiPath = cat.dir ? `${cat.dir}/${file}` : file;
      entries.push({ wikiPath, sourceFile });
    }
    // 一级目录“同名”落地页（Issue #210）：让裸目录路径（/-/wiki/<dir>）可访问
    const landing = CATEGORY_INDEX_MAP.get(cat.dir);
    if (cat.dir && !landing) {
      // 一级目录未配置落地页：提示维护者，避免同名节点 404 复发且不可察觉（P13）
      console.warn(`  ⚠ 分类「${cat.dir}」未配置落地页，一级目录同名节点可能 404`);
    }
    if (landing && cat.dir) {
      let content;
      if (landing.indexSourceFile) {
        // 复用同名文档作为落地页，顶部加一行入口说明以区分文档页与入口页
        const srcPath = path.join(docsDir, landing.indexSourceFile);
        if (fs.existsSync(srcPath)) {
          const src = fs.readFileSync(srcPath, 'utf8');
          content = `> 本页为「${cat.dir}」分类入口页，完整文档见左侧导航或下方链接。\n\n${src}`;
        } else {
          // 同名文档缺失时回退为索引页，避免抛 ENOENT 终止整个上传流程
          console.warn(`  ⚠ ${cat.dir}：同名文档 ${landing.indexSourceFile} 缺失，回退为索引页`);
          content = buildCategoryIndex(cat.dir);
        }
      } else {
        content = buildCategoryIndex(cat.dir);
      }
      entries.push({ wikiPath: cat.dir, content });
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
    // 一级目录索引页走内置生成的 content；普通文档页读 sourceFile
    let content;
    if (e.content !== undefined) {
      content = e.content;
    } else {
      if (!fs.existsSync(e.sourceFile)) {
        console.log(`  ✗ ${e.wikiPath}：源文件不存在 ${e.sourceFile}`);
        failed++;
        failures.push(`${e.wikiPath}（源文件缺失）`);
        continue;
      }
      content = fs.readFileSync(e.sourceFile, 'utf8');
    }
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

module.exports = { collectEntries, uploadFile, buildCategoryIndex, CATEGORY_INDEX, WIKI_MENU };
