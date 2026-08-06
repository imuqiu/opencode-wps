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
const { normalize } = require('./lib/normalize');
const { checkDesc, checkDescAgainstDocs } = require('./lib/npc-team-triggers');

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

  // ---- 10. 接力模式（每步独立调用 @CodeBuddy，Issue #76 最新补充）----
  // 背景：用户要求"每一步都独立调一次 @CodeBuddy NPC，而不是调一次 @CodeBuddy 跑完全部步骤"。
  // 因此提示词默认改为「接力模式」：每次召唤只执行一个步骤，输出【接力卡】后停下，用户逐步召唤下一棒。
  // 全程模式（一次跑完全部步骤）仅在用户明确要求时可用。
  // 本节强校验：若「每步独立调用/接力」核心要素被删，CI 拦截（防回退为"一次跑完"旧行为）。
  const RELAY_CORE = [
    '【运行模式（每次调用必须先自检）】',
    '接力模式（默认、推荐）',
    '只执行流水线中的一个步骤',
    '绝不自行继续后续步骤',
    '11. 接力只执行一步（接力模式铁律）',
    '绝不代替用户召唤下一棒',
    '12. 接力卡必含召唤话术',
    '下一步召唤话术',
    '【任务书（接力模式第一棒 0/10 创建，随接力卡逐棒传递）】',
    '【接力卡（接力模式每步结束时必须输出）】',
    '【接力卡·N/10 阶段名】',
  ];
  let relayLastIdx = -1;
  for (const frag of RELAY_CORE) {
    const idx = prompt.indexOf(frag);
    if (idx === -1)
      errors.push(
        `接力模式缺少完整句式「${frag}」（每次召唤必须只执行一步并输出接力卡，防回退为一次跑完全部步骤）`
      );
    else if (idx < relayLastIdx)
      errors.push(
        `接力模式句式顺序错乱：「${frag}」出现在其声明顺序之前（疑似插入干扰文本拆解语义）`
      );
    else relayLastIdx = idx;
  }
  // 接力卡必含「下一步召唤话术」内容格式（用户原样复制即可触发下一棒独立执行）
  // 注意：必须限定在【接力卡】段范围内校验（截取「【接力卡（接力模式每步结束时必须输出）】」
  // 到「【评审接力卡」之间的文本），否则评审/修复接力卡段（10b）的相同句式会造成跨段假阳性——
  // 实测【接力卡】段话术示例被删（评审/修复接力卡段保留）时全局 indexOf 仍命中，校验放行（exit 0）。
  // （第 1 轮评审 C1：校验盲区）同时要求「下一步召唤话术」标签与示例句都在段内（C2：原用例删的是标签行，
  // 仅校验示例句会漏）。
  const relayCardStart = prompt.indexOf('【接力卡（接力模式每步结束时必须输出）】');
  const relayReviewStart = prompt.indexOf('【评审接力卡（5/10 评审每轮评审结束时输出）】');
  const relayCardSection =
    relayCardStart !== -1 && relayReviewStart !== -1 && relayReviewStart > relayCardStart
      ? prompt.slice(relayCardStart, relayReviewStart)
      : '';
  if (
    relayCardSection &&
    (!relayCardSection.includes('- 下一步召唤话术（用户原样复制即可）：') ||
      !/@CodeBuddy 接力 NPC_TEAM skill，执行下一步 N\+1\/10 <阶段名>：/.test(relayCardSection))
  )
    errors.push(
      '接力卡缺少「下一步召唤话术」（含标签与示例 @CodeBuddy 接力 NPC_TEAM skill，执行下一步 N+1/10 <阶段名>：）'
    );
  // 全程模式仅为可选（默认必须为接力模式）：若提示词缺失「接力模式（默认、推荐）」已在上方强校验，
  // 再校验「全程模式」声明存在（防只剩接力没有全程，或两者都丢）
  if (!/全程模式/.test(prompt))
    warnings.push('提示词未声明「全程模式」（可选：用户明确要求一次跑完时使用）');

  // ---- 10b. 评审-修复循环接力（Issue #76 最新补充：PR review 与修复循环也使用接力模式）----
  // 背景：用户要求"其中的 PR review 与 修复循环也建议使用接力模式"。
  // 因此 5/10 评审-修复循环在接力模式下逐轮接力：每轮评审与每次修复各是独立一次 @CodeBuddy 召唤，
  // 评审棒输出【评审接力卡】、修复棒输出【修复接力卡】，禁止在一次召唤内连跑多轮评审-修复。
  // 本节强校验：若「评审-修复接力」核心要素被删，CI 拦截（防评审-修复假装进行/偷偷连跑）。
  const RELAY_REVIEW_CORE = [
    '8. 评审-修复循环（10 轮彻底循环，接力模式）',
    '评审-修复循环同样逐轮接力',
    '每轮评审与每次修复各是独立一次 @CodeBuddy 召唤',
    '评审棒输出【评审接力卡】',
    '修复棒输出【修复接力卡】',
    '禁止在一次召唤内偷偷连跑多轮评审-修复',
    '【评审接力卡（5/10 评审每轮评审结束时输出）】',
    '【修复接力卡（5/10 评审每轮修复结束时输出）】',
    '【复评接力卡（5/10 评审每轮复评结束时输出）】',
    '复评结论：🔴仍需修复（问题未清零，转下轮评审） / 🟢通过（问题清零，转 6/10 测试）',
    '已累计轮次：R/10（未清零则继续；清零且已达至少 10 轮则进下一阶段）',
    '执行第 R+1/10 轮评审（复评仍有问题，继续 review-修复循环）',
    '执行 6/10 测试（评审问题已清零，进入测试阶段）',
  ];
  let relayReviewLastIdx = -1;
  for (const frag of RELAY_REVIEW_CORE) {
    const idx = prompt.indexOf(frag);
    if (idx === -1)
      errors.push(
        `评审-修复接力缺少完整句式「${frag}」（5/10 评审-修复循环须逐轮接力，每轮评审/修复各为独立召唤，防假装进行）`
      );
    else if (idx < relayReviewLastIdx)
      errors.push(
        `评审-修复接力句式顺序错乱：「${frag}」出现在其声明顺序之前（疑似插入干扰文本拆解语义）`
      );
    else relayReviewLastIdx = idx;
  }
  // 评审接力卡/修复接力卡/复评接力卡必须含「下一步召唤话术」标签与示例句（用户原样复制即可触发下一棒独立执行）
  // 第 6 轮评审 W1：仿照 10 节【接力卡】段化做法，将三段卡的标签与示例句校验限定在各自段区间内，
  // 消除跨段假阳性与漏检（此前全局 indexOf 校验，双源同步删掉三段卡标签行后校验仍 exit 0）。
  // 通用段化工具：截取 startFrag 到 endFrag（或文件尾）之间的文本；区间不成立时返回 ''（由下方判空报错）。
  const sliceSection = (startFrag, endFrag) => {
    const s = prompt.indexOf(startFrag);
    if (s === -1) return '';
    const e = endFrag ? prompt.indexOf(endFrag, s) : prompt.length;
    if (e === -1 || e <= s) return '';
    return prompt.slice(s, e);
  };
  // 【评审接力卡】段：起点到【修复接力卡】段标题
  const reviewCardSection = sliceSection(
    '【评审接力卡（5/10 评审每轮评审结束时输出）】',
    '【修复接力卡（5/10 评审每轮修复结束时输出）】'
  );
  if (
    reviewCardSection &&
    (!reviewCardSection.includes('- 下一步召唤话术（用户原样复制即可）：') ||
      !/@CodeBuddy 接力 NPC_TEAM skill，执行第 R\+1\/10 轮评审修复（修复本轮评审问题）：/.test(
        reviewCardSection
      ))
  )
    errors.push(
      '评审接力卡缺少「下一步召唤话术」（含标签与示例 @CodeBuddy 接力 NPC_TEAM skill，执行第 R+1/10 轮评审修复（修复本轮评审问题）：）'
    );
  // 【修复接力卡】段：起点到【复评接力卡】段标题
  const fixCardSection = sliceSection(
    '【修复接力卡（5/10 评审每轮修复结束时输出）】',
    '【复评接力卡（5/10 评审每轮复评结束时输出）】'
  );
  if (
    fixCardSection &&
    (!fixCardSection.includes('- 下一步召唤话术（用户原样复制即可）：') ||
      !/@CodeBuddy 接力 NPC_TEAM skill，执行第 R\+1\/10 轮复评（评审上轮修复）：/.test(
        fixCardSection
      ))
  )
    errors.push(
      '修复接力卡缺少「下一步召唤话术」（含标签与示例 @CodeBuddy 接力 NPC_TEAM skill，执行第 R+1/10 轮复评（评审上轮修复）：）'
    );
  // 【复评接力卡】段：起点到【暂停确认】段标题，须含标签 + 未清零/已清零两个示例句
  const reReviewCardSection = sliceSection(
    '【复评接力卡（5/10 评审每轮复评结束时输出）】',
    '【暂停确认】'
  );
  if (
    reReviewCardSection &&
    (!reReviewCardSection.includes('- 下一步召唤话术（用户原样复制即可）：') ||
      !/@CodeBuddy 接力 NPC_TEAM skill，执行第 R\+1\/10 轮评审（复评仍有问题，继续 review-修复循环）：/.test(
        reReviewCardSection
      ) ||
      !/@CodeBuddy 接力 NPC_TEAM skill，执行 6\/10 测试（评审问题已清零，进入测试阶段）：/.test(
        reReviewCardSection
      ))
  )
    errors.push(
      '复评接力卡缺少「下一步召唤话术」（含标签与示例：执行第 R+1/10 轮评审（复评仍有问题）/ 执行 6/10 测试（问题已清零））'
    );
}

// ---- 11. 文档级边界声明 ----
const docSections = ['关键边界', '本地', '平台'];
for (const s of docSections) {
  if (!content.includes(s)) warnings.push(`文档缺少「${s}」相关边界说明`);
}

// ---- 12. NPC_TEAM Skill 双源一致性（Issue #76 新增：一键调用 skill 方案）----
// 背景：docs/NPC_TEAM.md 是提示词唯一权威源，.codebuddy/skills/npc-team/SKILL.md 是可自动加载的 skill 版。
// 若两者正文漂移（skill 改老 / 提示词改新），用户用 skill 一句话调用时行为可能与文档不一致。
// 因此 CI 强制校验：skill 存在 + frontmatter 合法 + 提示词正文与 docs 提示词完全一致（归一化空白后）。
const SKILL_FILE = path.resolve(__dirname, '../.codebuddy/skills/npc-team/SKILL.md');
if (!fs.existsSync(SKILL_FILE)) {
  errors.push(
    '缺少 NPC_TEAM Skill（.codebuddy/skills/npc-team/SKILL.md 不存在，一键调用方案不可用）'
  );
} else {
  const skillContent = fs.readFileSync(SKILL_FILE, 'utf8');

  // 11.1 frontmatter 必须合法（name/description 齐全）
  const fm = skillContent.match(/^---\r?\n(?<fm>[\s\S]*?)\r?\n---\r?\n/);
  if (!fm || !/^name:\s*.+$/m.test(fm.groups.fm) || !/^description:\s*.+$/m.test(fm.groups.fm)) {
    errors.push('NPC_TEAM Skill frontmatter 非法（需含 name 与 description 字段）');
    // frontmatter 缺失时无有效锚点，跳过 11.2 正文校验（避免报错叠加与逻辑穿透）
  } else {
    // name 应为 npc-team
    if (!/^name:\s*npc-team\s*$/m.test(fm.groups.fm))
      errors.push(
        'NPC_TEAM Skill 的 name 应为 npc-team（当前不匹配，导致无法被 @CodeBuddy 按名加载）'
      );

    // 11.1b description 触发词一致性（防静默失效：description 缺触发词 → NPC 不加载 Skill）
    // 触发词须与 docs/NPC_TEAM.md「使用方式一」保持一致；description 是 NPC 自动加载的唯一依据，
    // 若只更新正文而漏掉 description，用户仍无法用一句话触发，双源校验必须覆盖到 description。
    // 规则单一源：scripts/lib/npc-team-triggers.js（validate 与 sync 共用，防两处硬编码失同步）。
    const descLine = fm.groups.fm.match(/^description:\s*.+$/m);
    const desc = descLine ? descLine[0] : '';
    const { ok, missing } = checkDesc(desc);
    if (!ok)
      errors.push(
        'NPC_TEAM Skill description 缺少必要触发词：' +
          missing.join('、') +
          '（NPC 可能无法自动加载）'
      );

    // 11.1c docs 触发词交集校验：docs/NPC_TEAM.md「使用方式一」明示的触发短语必须全部出现在 description 中，
    // 防单边新增（docs 新加触发词但 description 未同步）导致用户按新文档说法无法触发。
    // 规则单一源：scripts/lib/npc-team-triggers.js 的 DOC_DESC_TRIGGERS。
    const { missing: missingDoc } = checkDescAgainstDocs(desc);
    if (missingDoc.length > 0)
      errors.push(
        'NPC_TEAM Skill description 与 docs 触发词交集缺失：' +
          missingDoc.join('、') +
          '（docs 使用方式一已明示，description 未同步，用户按文档说法将无法触发）'
      );

    // 11.2 提取 skill 正文（去掉 frontmatter 与开头的说明段，起点为身份声明句）
    // 仅在 frontmatter 合法时执行（fm 存在且 name/description 齐全），避免报错叠加与逻辑穿透
    const skillBody = skillContent.replace(fm[0], '');
    const bodyStart = skillBody.indexOf('你是「NPC Team 总指挥」，由官方免费');
    if (bodyStart === -1) {
      errors.push('NPC_TEAM Skill 缺少身份声明句（你是「NPC Team 总指挥」，由官方免费...）');
    } else {
      // 11.2a preamble（说明段）语义检查：说明段须明确引用 docs/NPC_TEAM.md 并声明「一致/等价」，
      // 防止说明段与实际关系脱钩（docs 提示词大改而 SKILL 说明段仍声称“完全一致”）。
      const preamble = skillBody.slice(0, bodyStart);
      if (!/docs\/NPC_TEAM\.md/.test(preamble) || !/完全一致|一致|等价/.test(preamble))
        warnings.push(
          'NPC_TEAM Skill 说明段未明确声明“与 docs/NPC_TEAM.md 一致/等价”（建议补充，防声明与实际脱钩）'
        );

      const skillPrompt = skillBody.slice(bodyStart).trim();
      const docPrompt = m ? m.groups.prompt.trim() : '';
      if (!docPrompt) {
        errors.push('无法提取 docs 提示词正文，无法进行 Skill 双源一致性校验');
      } else if (normalize(skillPrompt) !== normalize(docPrompt)) {
        errors.push(
          'NPC_TEAM Skill 正文与 docs/NPC_TEAM.md 提示词不一致（改提示词须同步改 skill，或反之）。' +
            '请运行 scripts/sync-npc-team-skill.js 自动同步，或手动保持一致'
        );
      }
    }
  }
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
