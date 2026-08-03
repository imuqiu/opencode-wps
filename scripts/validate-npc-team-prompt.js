#!/usr/bin/env node
/**
 * 校验 docs/NPC_TEAM.md 提示词的结构完整性、逻辑一致性与零积分原则
 *
 * 背景：NPC Team 提示词是 Issue #76 的核心交付物（零积分方案）。
 * 一旦角色卡片缺失、阶段编号错乱、或「零积分/不召唤自建 NPC」红线被误删，
 * 用户粘贴后 CodeBuddy 可能行为失控（如真的去召唤自建 NPC → 消耗积分）。
 * 本脚本在 CI 中执行，作为提示词质量的回归防线。
 *
 * 用法：node scripts/validate-npc-team-prompt.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '../docs/NPC_TEAM.md');
const errors = [];
const warnings = [];

const content = fs.readFileSync(FILE, 'utf8');

// ---- 1. 提取提示词代码块（```text ... ```，带锚点标记，避免捕获到错误代码块）----
const m = content.match(/```text\n# NPC_TEAM_PROMPT_START[^\n]*\n(?<prompt>[\s\S]*?)\n```/);
if (!m) {
  errors.push('未找到带锚点 # NPC_TEAM_PROMPT_START 的提示词代码块（核心交付物缺失或锚点被删）');
} else {
  const prompt = m.groups.prompt;
  if (prompt.length < 500)
    errors.push('提示词过短（不足 500 字符），疑似捕获到错误代码块，请检查锚点位置');

  // ---- 2. 身份声明 ----
  if (!/NPC Team 总指挥/.test(prompt)) warnings.push('提示词缺少「NPC Team 总指挥」身份声明');
  if (!/官方 CodeBuddy|CodeBuddy 化身/.test(prompt))
    errors.push('提示词缺少「由官方 CodeBuddy 化身」声明');

  // ---- 3. 6 位专家角色卡片（强校验：必须在【角色卡片】段内逐行匹配到每张卡片行）----
  // 避免「开发/评审/测试」等词在流水线正文高频出现导致的弱校验误放行：
  // 要求卡片行格式「emoji 缩写：」或「全称：」，且必须位于【角色卡片】段内。
  const cardSection = prompt.match(/【角色卡片】\n([\s\S]*?)(?=\n【流水线|\n【角色切换|$)/);
  if (!cardSection) {
    errors.push('提示词缺少「【角色卡片】」段');
  } else {
    const cards = cardSection[1];
    const requiredCards = [
      { key: '项目经理 PM', re: /🎯\s*PM\s*[：:]|项目经理\s*[：:]/ },
      { key: '产品经理 PO', re: /📋\s*PO\s*[：:]|产品经理\s*[：:]/ },
      { key: '架构师 ARCH', re: /🏗️?\s*ARCH\s*[：:]|架构师\s*[：:]/ },
      { key: '全栈开发 DEV', re: /💻\s*DEV\s*[：:]|全栈开发\s*[：:]/ },
      { key: '代码评审员 CR', re: /🔍\s*CR\s*[：:]|代码评审员\s*[：:]/ },
      { key: '测试工程师 QA', re: /🧪\s*QA\s*[：:]|测试工程师\s*[：:]/ },
    ];
    for (const c of requiredCards) {
      if (!c.re.test(cards))
        errors.push(`角色卡片缺失：${c.key}（需在【角色卡片】段内存在对应卡片行）`);
    }
  }

  // ---- 4. 零积分红线 ----
  if (!/零积分|不召唤任何自建 NPC|不消耗积分/.test(prompt)) {
    errors.push('缺少零积分红线声明（全程不召唤自建 NPC）');
  }

  // ---- 5. 阶段流水线一致性（10 阶段，0/10 ~ 9/10）----
  if (prompt.includes('0/10') || prompt.includes('9/10')) {
    // 若使用 0/10 编号，则必须 0..9 全部出现
    for (let i = 0; i <= 9; i++) {
      if (!prompt.includes(`${i}/10`)) errors.push(`阶段编号 ${i}/10 缺失（10 阶段流水线不完整）`);
    }
  } else if (prompt.includes('阶段 1/') || prompt.includes('阶段 0/')) {
    errors.push('阶段编号分母不是 10（历史 bug：9 阶段/0/9 分母错误）');
  } else {
    warnings.push('未检测到 0/10~9/10 阶段编号（若已改为其他计数方式请确认一致性）');
  }

  // 流水线关键阶段覆盖
  const stages = ['需求', '拆解', '分析', '设计', '开发', '评审', '测试', '文档', '汇报', '复盘'];
  for (const s of stages) {
    if (!prompt.includes(s)) warnings.push(`流水线可能缺少「${s}」阶段`);
  }

  // ---- 6. 角色切换卡 ----
  if (!/角色切换/.test(prompt)) warnings.push('缺少「角色切换卡」格式说明');

  // ---- 7. 硬性规则 ----
  if (!/安全红线|敏感信息|凭据/.test(prompt))
    errors.push('缺少安全红线（禁输出 Token/密码/密钥、禁硬编码凭据）');
  if (!/诚实|不编造|如实/.test(prompt)) warnings.push('缺少诚实汇报规则（不编造测试结果）');
  if (!/省 Token|不重复/.test(prompt)) warnings.push('缺少省 Token/增量输出规则');
  if (!/语言/.test(prompt)) warnings.push('缺少语言匹配规则');
}

// ---- 8. 文档级边界声明 ----
const docSections = ['关键边界', '本地', '平台'];
for (const s of docSections) {
  if (!content.includes(s)) warnings.push(`文档缺少「${s}」相关边界说明`);
}

// ---- 输出 ----
let failed = false;
for (const e of errors) {
  failed = true;
  console.error(`❌ ${e}`);
}
for (const w of warnings) console.warn(`⚠️  ${w}`);

if (failed) {
  console.error(`\n✖ NPC Team 提示词校验失败：${errors.length} 个错误`);
  process.exit(1);
}
if (errors.length === 0 && warnings.length === 0) {
  console.log('✅ NPC Team 提示词校验通过（无错误、无警告）');
} else {
  console.log(
    `\n✅ NPC Team 提示词校验通过（${errors.length} 错误 / ${warnings.length} 警告，警告不阻塞）`
  );
}
