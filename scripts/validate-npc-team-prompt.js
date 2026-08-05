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

  // 提示词代码块应包含暂停确认段（【暂停确认】）
  if (!/【暂停确认】/.test(prompt))
    errors.push('提示词缺少「【暂停确认】」段（暂停卡格式说明缺失）');

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

  // ---- 8. 暂停确认机制（Issue #76 补充：人工确认防跑偏）----
  // 两个暂停点必须以完整定义存在：⏸CP1 计划确认 / ⏸CP2 开发确认
  // （用完整词而非子串，避免「到 ⏸CP1/⏸CP2 时输出暂停卡」这类引用句被误算为暂停点声明）
  if (!prompt.includes('⏸CP1 计划确认'))
    errors.push('缺少暂停点「⏸CP1 计划确认」（人工确认防跑偏机制缺失）');
  if (!prompt.includes('⏸CP2 开发确认'))
    errors.push('缺少暂停点「⏸CP2 开发确认」（人工确认防跑偏机制缺失）');
  // 三个命令词必须以完整形式存在（「继续」「补充：<意见>」「停止」），防止子串误放行
  const cmds = [
    { name: '「继续」', re: /「继续」/ },
    { name: '「补充：<意见>」', re: /「补充：<意见>」|「补充：/ },
    { name: '「停止」', re: /「停止」/ },
  ];
  for (const c of cmds) {
    if (!c.re.test(prompt)) errors.push(`缺少用户命令词 ${c.name}（暂停确认三命令不完整）`);
  }
  // 铁律：禁止代替用户确认（反幻觉红线），要求完整句式
  if (!/禁止代替用户确认、禁止假装已确认/.test(prompt))
    errors.push('缺少暂停确认铁律（禁止代替用户确认、禁止假装已确认）');
  if (!/收到命令前不得输出下一阶段内容/.test(prompt))
    errors.push('缺少暂停确认铁律（未获命令不放行，收到命令前不得输出下一阶段内容）');

  // ---- 9. 真实执行与循环门禁（Issue #76 补充：防假装执行/防流于形式）----
  // 9.1 每步真实执行 + 留痕（禁止假装执行、禁止无痕迹宣称完成）
  // 强校验：锁定铁律 7 的反幻觉细节（可核实痕迹 + 不存在的模拟器/测试谎报）+ 特有表述「可见回复/记录」，
  // 防"编造全绿"红线被删只留"禁止假装执行"空壳。注：文档工作流程/门禁表另有"留下可核实痕迹"等价表述，
  // 故此处强校验铁律 7 特有的「可见回复/记录」句式，确保铁律 7 自身受控。
  const RULE7_ANTI_HALLUCINATION = ['可核实', '谎报', '可见回复/记录'];
  if (!/禁止假装执行/.test(prompt))
    errors.push('缺少「禁止假装执行」铁律（每步必须单独真实执行并留痕）');
  if (!/留下.{0,60}痕迹|可核实.{0,60}痕迹|可被第三方核实/.test(prompt))
    errors.push('缺少「留痕检查」要求（每阶段须在 Issue/PR 留下可核实痕迹）');
  for (const frag of RULE7_ANTI_HALLUCINATION) {
    if (!prompt.includes(frag))
      errors.push(
        `铁律 7 缺少反幻觉细节「${frag}」（防"编造测试全绿"：不得无痕迹宣称完成/不得用不存在的模拟器谎报结果）`
      );
  }
  // 9.2 评审-修复循环至问题清零（要求"循环"与"清零"同时出现，避免被"全部修复"单点绕过）
  if (!/循环.{0,40}清零|清零.{0,40}循环/.test(prompt))
    errors.push('缺少「评审-修复循环直至问题清零」门禁（须同时含"循环"与"清零"语义）');
  if (!/复评|修复后.*复评/.test(prompt))
    errors.push('缺少「修复后复评」要求（评审发现问题须修复后复评）');
  // 9.2.1 10 轮彻底 review-修复循环（Issue #76 补充：每轮 review 与每次修复均须在 PR 分别回复留痕，禁止跳过轮次假装进行）
  // 强校验：锁定铁律 8 完整句式（防 OR 正则逃生口——铁律 8 核心约束被删光、仅靠 CR 卡片等残留"分别回复"字样仍放行）
  // 已知局限（第 6 轮评审记录）：includes 子串校验防"删约束"，但防不了"保留字面量改写语义"（插入干扰文本拆解语义）。
  // 因此叠加**顺序校验**：要求 7 个子串在提示词中按声明顺序递增出现，拦截"打乱顺序/插入拆解"类改写。
  const RULE8_CORE = [
    '循环执行直至问题清零',
    '至少进行 10 轮彻底的 PR review 与修复循环',
    '每轮 review 必须在 PR 中回复',
    '每次修复也必须在 PR 中回复',
    '绝不允许跳过轮次假装进行',
    '每轮留痕规则不变',
    '不得因裁剪而跳轮假装',
  ];
  let lastIdx = -1;
  for (const frag of RULE8_CORE) {
    const idx = prompt.indexOf(frag);
    if (idx === -1)
      errors.push(`铁律 8 缺少完整句式「${frag}」（10 轮循环必须真实逐轮执行，防 OR 正则逃生口）`);
    else if (idx < lastIdx)
      errors.push(
        `铁律 8 句式顺序错乱：「${frag}」出现在其声明顺序之前（疑似插入干扰文本拆解语义）`
      );
    else lastIdx = idx;
  }
  // 9.3 测试失败跳转重跑（三段式强校验：失败 + 跳回 + 重新执行，避免单宽松正则误放行）
  if (!/不通过|失败/.test(prompt))
    errors.push('缺少「测试失败跳转重跑」门禁（缺少"验收不通过/失败"语义）');
  if (!/跳回|回退|回.*重新执行|跳转到之前|跳到之前/.test(prompt))
    errors.push('缺少「测试失败跳转重跑」门禁（缺少"跳回/回退"语义）');
  if (!/重新执行|重新跑|重跑/.test(prompt))
    errors.push('缺少「测试失败跳转重跑」门禁（缺少"重新执行/重跑"语义）');
  // 9.4 充分复盘四要素
  if (!/根因|怎么造成|原因/.test(prompt)) errors.push('缺少复盘要素①「问题是怎么造成的（根因）」');
  if (!/教训/.test(prompt)) errors.push('缺少复盘要素②「应吸取什么教训」');
  if (!/避免.*再发生|避免类似问题|预防/.test(prompt))
    errors.push('缺少复盘要素③「后续如何避免类似问题（预防机制）」');
  if (!/措施|加固/.test(prompt)) errors.push('缺少复盘要素④「采取什么措施（加固动作）」');
}

// ---- 10. 文档级边界声明 ----
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
