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
const { formatDiff } = require('./lib/format-compare');
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

  // ---- 3. 7 位专家角色卡片（强校验：必须在【角色卡片】段内逐行匹配到每张卡片行）----
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
      { key: '研究员 RES', re: /🔬\s*(?:研究员\s*)?RES\s*[：:]|研究员\s*RES\s*[：:]/ },
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

  // ---- 5. 阶段流水线一致性（12 阶段，0/12 ~ 11/12）----
  // CR 第 11 轮修复（追加 9 轮循环 R1）：原 includes 子串校验存在双重逃生口——
  // ① includes('0/12') 命中 10/12、includes('1/12') 命中 11/12 的子串；
  // ② 即便改词边界正则，删除【流水线】段节点后仍会被暂停确认卡等其它段的引用字面量（已完成：0/12 需求接收 → 1/12 拆解分派）掩盖。
  // 因此改为：限定在【流水线】段内做 0..11 **全序出现**校验（词边界正则 + indexOf 递增），
  // 只有流水线主链完整且有序才通过，跨段引用不参与阶段完整性判定。
  const stageIdRe = i => new RegExp(`(?:^|[^0-9/])${i}\\/12(?:[^0-9]|$)`);
  // 提取【流水线】段（sliceSection 定义为 const 在后不提升，此处内联定位）
  const pipelineSectionStart = prompt.indexOf('【流水线（12 阶段 + 4 暂停点');
  if (pipelineSectionStart === -1) {
    errors.push('提示词缺少「【流水线】段」（12 阶段流水线定义缺失）');
  } else {
    const pipelineSectionEnd = prompt.indexOf('【任务书', pipelineSectionStart);
    if (pipelineSectionEnd === -1 || pipelineSectionEnd <= pipelineSectionStart) {
      errors.push('提示词【流水线】段区间不可达（【任务书】未出现在其后，疑似段落顺序错乱）');
    } else {
      const pipelineSection = prompt.slice(pipelineSectionStart, pipelineSectionEnd);
      // 若使用 0/12 编号，则必须在流水线段内 0..11 全部出现且按序递增
      // CR 第 20 轮修复（追加 12 轮循环 R1）：去掉「边界标记进入条件」逃生口——
      // 原 if (stageIdRe(0) || stageIdRe(11)) 在 0/12 与 11/12 同时被删时条件不成立，
      // 走 else 只发 warning，12 阶段流水线删掉首尾两阶段仍放行（实测 exit 0）。
      // 改为无条件执行 0..11 全序校验：缺失任何阶段（含首尾）都报 error。
      {
        let lastIdx = -1;
        for (let i = 0; i <= 11; i++) {
          const mm = stageIdRe(i).exec(pipelineSection);
          if (!mm) {
            errors.push(`阶段编号 ${i}/12 缺失（12 阶段流水线不完整，【流水线】段未包含该节点）`);
            break;
          }
          if (mm.index < lastIdx) {
            errors.push(`阶段编号 ${i}/12 顺序错乱（【流水线】段节点未按 0/12→11/12 递增排列）`);
            break;
          }
          lastIdx = mm.index;
        }
      }
    }
  }
  // 历史 10 阶段编号（0/10~9/10）不应残留（先剔除评审轮次计轮 R/10、R+1/10 的合法用法，再检查）
  const withoutReviewRounds = prompt.replace(/R\+1\/10/g, '').replace(/R\/10/g, '');
  for (let i = 0; i <= 9; i++) {
    if (new RegExp(`(?:^|[^0-9/])${i}\\/10(?:[^0-9]|$)`).test(withoutReviewRounds))
      errors.push(`阶段编号 ${i}/10 残留（已迁移为 ${i}/12 或 ${i + 2}/12，历史编号未清理）`);
  }

  // 流水线关键阶段覆盖
  const stages = [
    '需求',
    '拆解',
    '分析',
    '设计',
    '开发',
    '评审',
    '测试',
    '文档',
    '合并',
    '发布',
    '汇报',
    '复盘',
  ];
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

  // ---- 8. 暂停确认机制（Issue #76 补充：人工确认防跑偏）+ 合并确认（⏸CP3）----
  // 两个开发暂停点必须以完整定义存在：⏸CP1 计划确认 / ⏸CP2 开发确认
  // （用完整词而非子串，避免「到 ⏸CP1/⏸CP2 时输出暂停卡」这类引用句被误算为暂停点声明）
  if (!prompt.includes('⏸CP1 计划确认'))
    errors.push('缺少暂停点「⏸CP1 计划确认」（人工确认防跑偏机制缺失）');
  if (!prompt.includes('⏸CP2 开发确认'))
    errors.push('缺少暂停点「⏸CP2 开发确认」（人工确认防跑偏机制缺失）');
  // CR 第 13 轮修复（追加 9 轮循环 R3）：仅校验「⏸CP2 开发确认」字样可被流水线段引用命中，
  // 但【暂停确认】段的【暂停·CP2 开发确认】模板被删时 CI 不拦截。故强校验模板段存在。
  if (!/【暂停·CP2 开发确认】\n已完成：0\/12→4\/12 开发（PR 已建）/.test(prompt))
    errors.push('缺少暂停卡模板「【暂停·CP2 开发确认】」（全程模式第二个强制暂停点须有输出模板）');
  // CR 第 14 轮修复（追加 9 轮循环 R4）：
  // ① 暂停确认引导语须明确 CP1/CP2 → 暂停卡、CP3 → 合并确认卡（此前「⏸CP1/⏸CP2/⏸CP3 时输出暂停卡」
  //    把 CP3 也归为暂停卡，与铁律 13/合并确认卡模板矛盾，CodeBuddy 可能输出通用暂停卡而非合并确认卡）；
  // ② CP2 模板内容强校验（命令三选一完整 + 已完成行），防模板与暂停确认表/工作流程漂移。
  if (!/到 ⏸CP1\/⏸CP2 时输出暂停卡并停下；到 ⏸CP3 时输出【合并确认卡】/.test(prompt))
    errors.push(
      '暂停确认引导语未区分 CP3 输出（须为：到 ⏸CP1/⏸CP2 时输出暂停卡；到 ⏸CP3 时输出【合并确认卡】）'
    );
  const cp2Section = prompt.match(/【暂停·CP2 开发确认】\n([\s\S]*?)(?=\n【合并确认卡|$)/);
  if (
    cp2Section !== null &&
    (!cp2Section[1].includes('「继续」→ 确认实现方向正确') ||
      !cp2Section[1].includes('「补充：<意见>」→ 结合意见修正当前产物后继续') ||
      !cp2Section[1].includes('「停止」→ 终止后续阶段'))
  )
    errors.push(
      '暂停卡模板【暂停·CP2 开发确认】命令三选一不完整（须含：继续→确认实现方向正确 / 补充：<意见>→修正后继续 / 停止→终止）'
    );
  // ⏸CP3 合并确认：合并前必须暂停待用户确认（铁律 13）
  if (!prompt.includes('⏸CP3 合并确认'))
    errors.push('缺少暂停点「⏸CP3 合并确认」（PR 合并前须暂停待用户确认，禁止未确认就合并）');
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
  // 9.2.1 10 轮彻底 review-修复循环（Issue #76 补充：每步（评审/修复/复评）均须在 PR 分别回复留痕，留痕以「每步」为粒度而非「每轮」，禁止跳过任何一步假装进行）
  // 强校验：锁定铁律 8 完整句式（防 OR 正则逃生口——铁律 8 核心约束被删光、仅靠 CR 卡片等残留"分别回复"字样仍放行）
  // 已知局限（第 6 轮评审记录）：includes 子串校验防"删约束"，但防不了"保留字面量改写语义"（插入干扰文本拆解语义）。
  // 因此叠加**顺序校验**：要求 7 个子串在提示词中按声明顺序递增出现，拦截"打乱顺序/插入拆解"类改写。
  const RULE8_CORE = [
    '循环执行直至问题清零',
    '至少进行 10 轮彻底的 PR review 与修复循环',
    '每一步（评审棒 / 修复棒 / 复评棒）都必须在 PR 中分别回复留痕',
    '留痕以「每步」为粒度而非「每轮」',
    '绝不允许跳过任何一步假装进行',
    // CR 第 28 轮修复：用户明确要求「不要简单可缩裁剪，至少 10 轮保留」，删除「简单改动可缩减」语义——
    // 评审轮数无条件硬性下限，不得以简单为由缩减（防 NPC 以简单为名偷懒跳轮）。
    '评审轮数不得以简单为由缩减',
    '不得以简单可缩为名跳轮偷懒',
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

  // ---- 9.5 6 个改造点门禁（Issue #147 补充：暂停点不静默跳过 / 自动接续 / 留痕粒度强化 / 评审范围纪律）----
  // 改造点 1：暂停点任何模式不得静默跳过
  if (!/任何模式不得静默跳过/.test(prompt))
    errors.push(
      '缺少「暂停点不得静默跳过」门禁（铁律 6：无论接力/全程/自动连续模式，到 CP1/CP2/CP3 必须停下等用户命令）'
    );
  // 改造点 2：未设暂停点自动接续
  // 铁律 11 澄清自动接续时也会出现「未设 ⏸CP 暂停点的步骤…自动触发下一步」，为避免与铁律 11
  // 澄清句形成误命中（负向回归：删除运行模式自动接续句后，仅凭铁律 11 的澄清句仍能通过门禁），
  // 将门禁锚定到运行模式独有的「无需用户逐棒手动复制召唤话术」短语，确保门禁只校验运行模式原句。
  // 注：门禁依赖该单一锚点短语，属正则门禁固有取舍；若未来该短语被改写，需同步更新本门禁正则及
  // tests 负向回归用例（见「删运行模式…应拦截」）。
  if (!/未设.{0,40}暂停点的步骤.{0,40}自动触发下一步.{0,40}无需用户逐棒手动复制/.test(prompt))
    errors.push(
      '缺少「未设暂停点自动接续」门禁（运行模式：未设 ⏸CP 的步骤由系统自动触发下一步，无需用户逐棒手动复制召唤话术；用户可在暂停点确认/纠正/停止）'
    );
  // 改造点 3：每步留痕粒度强化（评审棒/修复棒/复评棒独立留痕，缺任一步即视为假装执行）
  if (
    !/评审-修复循环中，评审棒\/修复棒\/复评棒每一步各自独立留痕，缺任一步即视为假装执行/.test(
      prompt
    )
  )
    errors.push(
      '缺少「每步留痕粒度强化」门禁（铁律 7：评审棒/修复棒/复评棒每一步各自独立留痕，缺任一步即视为假装执行）'
    );
  // 改造点 5：评审范围纪律（只评 PR diff 新增/改动行，不泛化）
  if (!/只评审 PR diff 新增.{0,20}改动行|只评 PR diff 新增.{0,20}改动行/.test(prompt))
    errors.push(
      '缺少「评审范围纪律」门禁（铁律 15/CR 卡片：只评审 PR diff 新增/改动行，不得评审历史代码/无关文件/发表与 diff 无关的泛化意见）'
    );
  // 改造点 5 联动：RES 定位问题只能针对 PR diff 范围内代码
  if (!/RES 定位问题只能针对 PR diff 范围/.test(prompt))
    errors.push(
      '缺少「RES 定位范围纪律」门禁（铁律 15：RES 定位问题只能针对 PR diff 范围内的代码，不得借调研之名泛化到无关模块）'
    );
  // 改造点 4：新增🔬研究员 RES 角色（角色卡片已 7 张强校验，此处再校验 RES 介入流水线）
  if (!/研究员 RES：需求背景调研/.test(prompt))
    errors.push(
      '缺少「研究员 RES 角色」声明（第 7 位专家：需求背景调研、问题根因定位、方案可行性研究）'
    );
  // 补充（Issue #147 用户补充）：RES 角色介入 5/12——RES 须独立执行研究员视角评审并单独留痕，缺独立留痕即视为 RES 未介入（假介入）
  if (!/RES 5\/12 介入必须独立执行研究员视角评审并单独留痕/.test(prompt))
    errors.push(
      '缺少「RES 5/12 介入独立留痕」声明（角色卡片/工作流程：RES 独立执行研究员视角评审并单独留痕，缺独立留痕即视为 RES 未介入）'
    );
  if (!/「🔬 RES 研究员评审」独立留痕于 PR/.test(prompt))
    errors.push(
      '缺少「RES 研究员评审独立留痕锚点」门禁（RES 在 5/12 的评审结论须以「🔬 RES 研究员评审」独立留痕于 PR）'
    );
  // 改造点 6：N 轮评审-修复循环验收标准（有效下限 = max(10, 用户指定 N)）
  if (!/有效下限 = max\(10, 用户指定 N\)/.test(prompt))
    errors.push(
      '缺少「N 轮评审-修复验收标准」门禁（铁律 8：有效下限 = max(10, 用户指定 N)，可核实验收）'
    );

  // ---- 9.8 十四条质量红线纪律门禁（Issue #147：防「垒屎山」铁律 16~18）----
  // 思维纪律（铁律 16）：充分分析根因 / 方案切实可行须求证 / 评审整改实事求是 / 逻辑清晰无矛盾兜底
  if (!/充分分析需求或定位问题.{0,30}真正原因/.test(prompt))
    errors.push(
      '缺少「思维纪律-充分分析」门禁（铁律 16：充分分析需求或定位问题真正原因，不能假装分析）'
    );
  if (!/方案应切实可行，不能想当然.{0,40}充分求证/.test(prompt))
    errors.push('缺少「思维纪律-方案求证」门禁（铁律 16：方案应切实可行，动手前须充分求证）');
  if (!/每一轮都要.{0,20}充分发现问题/.test(prompt))
    errors.push(
      '缺少「思维纪律-评审实事求是」门禁（铁律 16：每一轮都要充分发现问题，不能假装凑数）'
    );
  if (!/自相矛盾的兜底/.test(prompt))
    errors.push('缺少「思维纪律-逻辑清晰」门禁（铁律 16：不做自相矛盾的兜底）');
  // 改动纪律（铁律 17）：最小必要改动 / 小型原子化 PR / 无关问题单独拆 issue / 用户可见变更更新 docs
  if (!/最小必要改动.{0,20}不盲目扩大/.test(prompt))
    errors.push('缺少「改动纪律-最小必要改动」门禁（铁律 17：做最小必要改动，不盲目扩大）');
  if (!/小型的、原子化的 PR/.test(prompt))
    errors.push(
      '缺少「改动纪律-原子化 PR」门禁（铁律 17：采取小型原子化 PR，必要时一个 issue 拆为多个 PR）'
    );
  if (!/单独拆 issue 及 PR/.test(prompt))
    errors.push('缺少「改动纪律-无关问题单独拆」门禁（铁律 17：无关问题单独拆 issue 及 PR）');
  if (!/更新.{0,10}\/docs 目录中的相关文档/.test(prompt))
    errors.push('缺少「改动纪律-更新 docs」门禁（铁律 17：用户可见变更须更新 /docs 文档）');
  // 测试纪律（铁律 18）：充分测试逐条真测 / 单测+集成测试 / preflight / format / lint
  if (!/逐条.{0,10}真测/.test(prompt))
    errors.push('缺少「测试纪律-逐条真测」门禁（铁律 18：逐条真测，禁止假装测试/空断言）');
  if (!/单元测试.{0,30}集成测试/.test(prompt))
    errors.push('缺少「测试纪律-单测+集成测试」门禁（铁律 18：必须执行单元测试与集成测试）');
  if (!/npm run preflight/.test(prompt))
    errors.push('缺少「测试纪律-preflight」门禁（铁律 18：提交 PR 前必须运行 npm run preflight）');
  if (!/npm run format/.test(prompt))
    errors.push('缺少「测试纪律-format」门禁（铁律 18：用 npm run format 格式化代码）');
  if (!/npm run lint/.test(prompt))
    errors.push('缺少「测试纪律-lint」门禁（铁律 18：用 npm run lint 检查代码）');
  if (!/暂未建立的测试.{0,20}单独开 issue/.test(prompt))
    errors.push('缺少「测试纪律-补建测试」门禁（铁律 18：暂未建立的测试单独开 issue 及 PR 完善）');

  // ---- 9.9 需求覆盖度检查 + ⏸CP2.5 需求覆盖确认（Issue #147 补充：加一步检查开发及测试是否覆盖全部需求，检查完设置暂停点）----
  // 6/12 测试通过后必须做需求覆盖度检查（逐条需求 ↔ 开发落点 ↔ 测试覆盖），完成后经 ⏸CP2.5 暂停待用户确认
  if (!/需求覆盖度检查/.test(prompt))
    errors.push(
      '缺少「需求覆盖度检查」门禁（6/12 测试通过后须逐条核对开发落点/测试覆盖是否覆盖全部需求）'
    );
  if (!/逐条核对开发落点.{0,30}测试覆盖/.test(prompt))
    errors.push('缺少「需求覆盖度矩阵」门禁（须逐条核对开发落点与测试覆盖，输出覆盖度矩阵）');
  if (!/⏸CP2.5 需求覆盖确认/.test(prompt))
    errors.push('缺少暂停点「⏸CP2.5 需求覆盖确认」（需求覆盖度检查完成后须暂停待用户确认）');
  if (!/需求全覆盖|覆盖了全部需求/.test(prompt))
    errors.push('缺少「需求全覆盖确认」语义（⏸CP2.5 暂停须等用户确认需求全覆盖后才进入下一阶段）');
  if (!/【暂停·CP2.5 需求覆盖确认】/.test(prompt))
    errors.push(
      '缺少暂停卡模板「【暂停·CP2.5 需求覆盖确认】」（全程模式需求覆盖确认须有输出模板）'
    );

  // ---- 通用段化工具：截取 startFrag 到 endFrag（或文件尾）之间的文本 ----
  // 第 7 轮评审 W1：区间不可达（endFrag ≤ startFrag / 锚点缺失）时显式报错并返回 null，
  // 禁止静默返回空串跳过段化校验（防锚点被删后段化校验静默失效）。
  const sliceSection = (startFrag, endFrag) => {
    const s = prompt.indexOf(startFrag);
    if (s === -1) {
      errors.push(`段化校验锚点缺失：「${startFrag}」不存在（段化校验无法定位，疑似该段被删）`);
      return null;
    }
    const e = endFrag ? prompt.indexOf(endFrag, s) : prompt.length;
    if (e === -1 || e <= s) {
      errors.push(
        `段化校验区间不可达：「${endFrag}」未出现在「${startFrag}」之后（疑似段落顺序错乱或锚点被删）`
      );
      return null;
    }
    return prompt.slice(s, e);
  };

  // 文档级区间定位（CR 第 4 轮评审新增）：与 sliceSection 语义一致，但作用于整个文档 content
  // （提示词代码块外的文档结构：工作流程/门禁表/暂停确认表等）。锚点缺失/区间不可达时显式报错，
  // 禁止静默返回 null 跳过校验（防删章节标题绕过文档级覆盖校验）。
  const sliceContentSection = (startFrag, endFrag) => {
    const s = content.indexOf(startFrag);
    if (s === -1) {
      errors.push(
        `文档级校验锚点缺失：「${startFrag}」不存在（文档级校验无法定位，疑似该章节被删/改名）`
      );
      return null;
    }
    const e = endFrag ? content.indexOf(endFrag, s) : content.length;
    if (e === -1 || e <= s) {
      errors.push(
        `文档级校验区间不可达：「${endFrag}」未出现在「${startFrag}」之后（疑似章节顺序错乱或锚点被删）`
      );
      return null;
    }
    return content.slice(s, e);
  };

  // ---- 9.5 PR 合并门禁（Issue #76 最新补充：合并前暂停待用户确认，防未确认/假装合并）----
  // 用户要求"再加上PR合并（在合并前需暂停待用户确认）"。因此 8/12 PR 合并前必须停到 ⏸CP3：
  // 输出【合并确认卡】（待合并 PR + 前置状态记录位置），只有用户本人回复「确认合并/继续」才放行合并；
  // 禁止代替用户确认、禁止未获确认就合并、禁止假装已合并（未真实 merge-pull 不得宣称已合并）。
  // 铁律 13 声明（全局唯一）与【合并确认卡】段内要素（段内唯一，避免与铁律 13 重复句式干扰顺序校验）
  const RELAY_MERGE_CORE = [
    '13. 合并前暂停确认',
    '【合并确认卡（⏸CP3：7/12 文档完成后、8/12 PR 合并前暂停，待用户确认合并）】',
  ];
  let mergeLastIdx = -1;
  for (const frag of RELAY_MERGE_CORE) {
    const idx = prompt.indexOf(frag);
    if (idx === -1)
      errors.push(
        `合并确认缺少完整句式「${frag}」（8/12 PR 合并前必须暂停待用户确认，防未确认就合并/假装已合并）`
      );
    else if (idx < mergeLastIdx)
      errors.push(
        `合并确认句式顺序错乱：「${frag}」出现在其声明顺序之前（疑似插入干扰文本拆解语义）`
      );
    else mergeLastIdx = idx;
  }
  // 合并确认卡必须含「合并前置状态」字段（评审清零/测试通过/CI success 的可核实记录位置）
  // 以及「确认合并/继续」放行句、禁止未确认就合并/假装已合并句、8/12 合并召唤话术示例（段内强校验）
  // CR 第 2 轮修复：补齐段内要素校验盲区——「收到确认前不得执行合并」硬约束句、
  // 「确认合并/继续→放行」映射句、用户命令三选一完整性（继续/补充/停止三行齐全），
  // 并补铁律 13 段内禁止细节校验（与合并确认卡段内校验双保险）。
  const mergeCardSection = sliceSection(
    '【合并确认卡（⏸CP3：7/12 文档完成后、8/12 PR 合并前暂停，待用户确认合并）】',
    '【角色切换】'
  );
  // 铁律 13 段：从铁律 13 声明到铁律 14 声明之间
  const rule13Start = prompt.indexOf('13. 合并前暂停确认');
  const rule13End = prompt.indexOf('14. 发布真实执行');
  const rule13Section =
    rule13Start !== -1 && rule13End !== -1 && rule13End > rule13Start
      ? prompt.slice(rule13Start, rule13End)
      : null;
  if (
    mergeCardSection !== null &&
    (!mergeCardSection.includes('合并前置状态') ||
      !/评审.{0,30}清零.{0,60}测试.{0,30}通过.{0,60}CI.{0,20}success/.test(mergeCardSection) ||
      !mergeCardSection.includes('只有用户本人回复「确认合并/继续」才放行执行 8/12 PR 合并') ||
      !mergeCardSection.includes('禁止代替用户确认、禁止未获确认就合并、禁止假装已合并') ||
      !mergeCardSection.includes('收到确认前不得执行合并，不得输出 8/12 内容') ||
      !mergeCardSection.includes('「确认合并/继续」→ 放行 8/12 PR 合并') ||
      !mergeCardSection.includes('「补充：<意见>」→ 结合意见修正 PR 后重新确认') ||
      !mergeCardSection.includes('「停止」→ 终止后续阶段，按用户意见处理') ||
      !/待合并 PR：#<编号>（commit <sha>）/.test(mergeCardSection) ||
      !mergeCardSection.includes('用户已确认合并，见：<位置>') ||
      !/@CodeBuddy 接力 NPC_TEAM skill，执行 8\/12 PR 合并：/.test(mergeCardSection))
  )
    errors.push(
      '合并确认卡缺少必要要素（须含合并前置状态：评审清零/测试通过/CI success、用户确认才放行、收到确认前不得执行合并、确认合并/继续→放行映射、用户命令三选一完整（继续/补充/停止）、禁止未确认就合并/假装已合并、8/12 合并召唤话术示例）'
    );
  // CR 第 18 轮修复（追加 9 轮循环 R8）：合并确认卡段内补「8/12 → 9/12 接力衔接」强校验——
  // 此前 9.5 只校验 8/12 合并召唤话术，合并棒完成后如何进入 9/12 发布（独立发布棒召唤）无校验，
  // 若该链路描述被删/改 CI 不拦截，接力模式下合并后无法规范进入发布阶段。
  if (
    mergeCardSection !== null &&
    (!/@CodeBuddy 接力 NPC_TEAM skill，执行 9\/12 发布：/.test(mergeCardSection) ||
      !/8\/12 合并棒完成后/.test(mergeCardSection) ||
      !/9\/12 发布棒由 DEV 执行四要素/.test(mergeCardSection))
  )
    errors.push(
      '合并确认卡缺少 8/12→9/12 接力衔接（须含：8/12 合并棒完成后输出【接力卡·8/12】、9/12 发布召唤话术 @CodeBuddy 接力 NPC_TEAM skill，执行 9/12 发布：、9/12 发布棒由 DEV 执行四要素）'
    );
  // 铁律 13 禁止细节强校验（CR 第 2 轮修复：防铁律 13 被删空壳仍通过）
  if (
    rule13Section !== null &&
    (!rule13Section.includes('只有用户本人回复「确认合并/继续」才放行执行 8/12 合并') ||
      !rule13Section.includes('禁止代替用户确认、禁止未获确认就合并、禁止假装已合并') ||
      !rule13Section.includes('未真实 merge-pull 不得宣称已合并'))
  )
    errors.push(
      '铁律 13 缺少禁止细节（须含：只有用户回复「确认合并/继续」才放行 8/12 合并、禁止代替用户确认/未获确认就合并/假装已合并、未真实 merge-pull 不得宣称已合并）'
    );

  // ---- 9.6 发布真实执行（Issue #76 最新补充：发布形成四要素）----
  // 用户要求"发布（更新版本号、发布形成changelog、发布产物）" + "补充：发布（补充形成Release Notes）"。
  // 因此 9/12 发布必须真实执行四要素并留痕：① 更新版本号 ② 形成 CHANGELOG ③ 发布产物 ④ 形成 Release Notes；
  // 禁止只输出"已发布"却缺任一要素（防发布造假）。
  const RELAY_RELEASE_CORE = [
    '14. 发布真实执行',
    '① 更新版本号（package.json 等）',
    '② 形成 CHANGELOG（含本次变更记录）',
    '③ 发布产物（构建/制品/标签，真实产出）',
    '④ 形成 Release Notes（发布说明，发布到 Release/对应页面）',
    '禁止只输出"已发布"却无版本号变更、无 CHANGELOG、无发布产物、无 Release Notes 的任何一项',
  ];
  let releaseLastIdx = -1;
  for (const frag of RELAY_RELEASE_CORE) {
    const idx = prompt.indexOf(frag);
    if (idx === -1)
      errors.push(
        `发布四要素缺少完整句式「${frag}」（9/12 发布必须真实执行版本号/CHANGELOG/发布产物/Release Notes 四要素并留痕）`
      );
    else if (idx < releaseLastIdx)
      errors.push(
        `发布四要素句式顺序错乱：「${frag}」出现在其声明顺序之前（疑似插入干扰文本拆解语义）`
      );
    else releaseLastIdx = idx;
  }

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
    '【任务书（接力模式第一棒 0/12 创建，随接力卡逐棒传递）】',
    '用户命令记录（继续/补充/停止，CP3 含确认合并）',
    '【接力卡（接力模式每步结束时必须输出）】',
    '【接力卡·N/12 阶段名】',
  ];
  // CR 第 17 轮修复（追加 9 轮循环 R7）：RELAY_CORE 补充运行模式判断逻辑句式——
  // 判断逻辑是每次调用先自检的入口，此前仅校验模式声明，判断逻辑被删/改（如删全程模式触发分支、
  // 改默认模式）时 CI 不拦截，接力/全程切换契约可能被静默破坏。
  const RELAY_JUDGE_CORE = [
    '判断：① 若用户**明确要求**「一次跑完全部步骤/一次跑完」→ 全程模式（保留 ⏸CP1/⏸CP2/⏸CP2.5/⏸CP3 暂停确认）',
    '若消息带上一棒【接力卡】/任务书 → 接力模式续棒',
    '若为新需求 → 默认接力模式',
  ];
  let relayJudgeLastIdx = -1;
  for (const frag of RELAY_JUDGE_CORE) {
    const idx = prompt.indexOf(frag);
    if (idx === -1)
      errors.push(
        `运行模式判断缺少完整句式「${frag}」（每次调用须先自检：明确要求一次跑完→全程模式；带接力卡/任务书→接力续棒；新需求→默认接力）`
      );
    else if (idx < relayJudgeLastIdx)
      errors.push(
        `运行模式判断句式顺序错乱：「${frag}」出现在其声明顺序之前（疑似插入干扰文本拆解语义）`
      );
    else relayJudgeLastIdx = idx;
  }
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
  // 评审-修复循环例外（PR #123 第 2 轮评审 W3）：运行模式「接力模式」描述须同步声明评审-修复循环自动连续执行例外
  // （与铁律 8/11 一致，防运行模式硬性措辞覆盖铁律 8 的例外语义）
  const relayModeSection = sliceSection(
    '【运行模式（每次调用必须先自检）】',
    '【铁律（最高优先级）】'
  );
  if (
    relayModeSection !== null &&
    !/接力模式（默认、推荐）：用户每次召唤你，你\*\*只执行流水线中的一个步骤\*\*/.test(
      relayModeSection
    )
  )
    errors.push(
      '运行模式缺少「接力模式（默认、推荐）」声明（每次召唤须默认只执行一步并输出接力卡）'
    );
  if (relayModeSection === null)
    errors.push(
      '运行模式段落不可达：无法校验「评审-修复循环自动连续执行」例外声明（运行模式/铁律锚点缺失或顺序错乱）'
    );
  if (relayModeSection !== null && !relayModeSection.includes('评审-修复循环自动连续执行'))
    errors.push(
      '运行模式「接力模式」描述缺少评审-修复循环自动连续执行例外声明（须同步铁律 8，防运行模式覆盖铁律 8 例外语义）'
    );
  // 接力卡必含「下一步召唤话术」内容格式（用户原样复制即可触发下一棒独立执行）
  // 注意：必须限定在【接力卡】段范围内校验（截取「【接力卡（接力模式每步结束时必须输出）】」
  // 到「【评审-修复循环留痕卡】之间的文本），否则评审-修复循环留痕卡段（10b）的相同句式会造成跨段假阳性——
  // 实测【接力卡】段话术示例被删（评审-修复留痕卡段保留）时全局 indexOf 仍命中，校验放行（exit 0）。
  // （第 1 轮评审 C1：校验盲区）同时要求「下一步召唤话术」标签与示例句都在段内（C2：原用例删的是标签行，
  // 仅校验示例句会漏）。
  // 第 7 轮评审 W1/W2：统一改用 sliceSection 工具（区间不可达时显式报错，不再静默跳过），
  // 并消除【接力卡】段与 10b 段两套段截取实现重复。
  const relayCardSection = sliceSection(
    '【接力卡（接力模式每步结束时必须输出）】',
    '【评审-修复循环留痕卡（5/12 评审-修复循环自动连续执行时使用）】'
  );
  if (
    relayCardSection !== null &&
    (!relayCardSection.includes('- 下一步召唤话术（用户原样复制即可）：') ||
      !/@CodeBuddy 接力 NPC_TEAM skill，执行下一步 N\+1\/12 <阶段名>：/.test(relayCardSection))
  )
    errors.push(
      '接力卡缺少「下一步召唤话术」（含标签与示例 @CodeBuddy 接力 NPC_TEAM skill，执行下一步 N+1/12 <阶段名>：）'
    );
  // CR 第 16 轮修复（追加 9 轮循环 R6）：【接力卡】段首引导语强校验——
  // 此前仅校验召唤话术，引导语「全程模式不输出接力卡、改为 ⏸CP1/⏸CP2 暂停卡 + ⏸CP3【合并确认卡】」
  // 被删/改（如改成全程模式也输出接力卡）时 CI 不拦截，全程/接力模式输出契约可能被静默破坏；
  // 且第 4 轮修复只改了【暂停确认】段引导语，本段残留旧口径「⏸CP1/⏸CP2/⏸CP3 暂停卡」未被发现（漏网之鱼）。
  if (
    relayCardSection !== null &&
    (!relayCardSection.includes('仅接力模式需输出') ||
      !/全程模式（用户明确要求一次跑完）不输出接力卡，改为 ⏸CP1\/⏸CP2 暂停卡 \+ ⏸CP3【合并确认卡】/.test(
        relayCardSection
      ))
  )
    errors.push(
      '接力卡段首引导语不符合全程/接力输出契约（须含：仅接力模式需输出；全程模式不输出接力卡，改为 ⏸CP1/⏸CP2 暂停卡 + ⏸CP3【合并确认卡】）'
    );
  // 全程模式仅为可选（默认必须为接力模式）：若提示词缺失「接力模式（默认、推荐）」已在上方强校验，
  // 再校验「全程模式」声明存在（防只剩接力没有全程，或两者都丢）
  if (!/全程模式/.test(prompt))
    warnings.push('提示词未声明「全程模式」（可选：用户明确要求一次跑完时使用）');

  // ---- 10b. 评审-修复循环自动连续执行 + 每步留痕（Issue #76 最新补充）----
  // 背景：用户要求"5/12 评审-修复循环自动进行，不用暂停、采用接力模式（自动继续），每步独立调用 @CodeBuddy"；
  // 并澄清"是每步在 PR 留痕，而不是每轮"。
  // 因此 5/12 评审-修复循环在接力模式下**自动连续执行**：用户要求跑 N 轮时，同一次召唤内自动跑完 N 轮直至清零，
  // 中途不暂停、无需逐棒手动召唤；但**每一步（评审/修复/复评）都必须在 PR 分别回复留痕（留痕以「每步」为粒度而非「每轮」）**。
  // 本节强校验：若「每步留痕 / 自动连续执行」核心要素被删，CI 拦截（防评审-修复假装进行/漏步留痕）。
  const RELAY_REVIEW_CORE = [
    '8. 评审-修复循环（10 轮彻底循环，接力模式下自动连续执行）',
    '留痕以「每步」为粒度而非「每轮」',
    '无需逐棒手动召唤、中途不暂停',
    '同一次召唤内自动连续执行',
    '每步完成后立即在 PR 中留痕',
    '每步留痕必须真实可核实，否则视为假装执行',
    '【评审-修复循环留痕卡（5/12 评审-修复循环自动连续执行时使用）】',
    '【评审留痕·第 R 轮·评审棒】',
    '【修复留痕·第 R 轮·修复棒】',
    '【复评留痕·第 R 轮·复评棒】',
  ];
  // 自动连续执行铁律 8 段限定校验 + 全局卡标题校验：前 6 句在铁律 8 段（8. 至 9. 之间），卡标题全局唯一。
  const rule8Start = prompt.indexOf('8. 评审-修复循环（10 轮彻底循环，接力模式下自动连续执行）');
  const rule8End = prompt.indexOf('9. 测试失败跳转');
  const rule8Section =
    rule8Start !== -1 && rule8End !== -1 && rule8End > rule8Start
      ? prompt.slice(rule8Start, rule8End)
      : null;
  const coreSearchTarget = rule8Section !== null ? rule8Section : prompt;
  let relayReviewLastIdx = -1;
  const coreFrags = RELAY_REVIEW_CORE.slice(0, 6); // 铁律 8 专属
  const cardFrags = RELAY_REVIEW_CORE.slice(6); // 卡段标题（全局唯一，用 prompt）
  const searchTargets = [
    ...coreFrags.map(f => ({ f, scope: coreSearchTarget })),
    ...cardFrags.map(f => ({ f, scope: prompt })),
  ];
  for (const { f, scope } of searchTargets) {
    const idx = scope.indexOf(f);
    if (idx === -1)
      errors.push(
        `评审-修复自动连续循环缺少完整句式「${f}」（5/12 评审-修复循环须自动连续执行，且每一步（评审/修复/复评）在 PR 分别留痕，留痕以「每步」为粒度而非「每轮」，防假装进行）`
      );
    else if (idx < relayReviewLastIdx)
      errors.push(
        `评审-修复自动连续循环句式顺序错乱：「${f}」出现在其声明顺序之前（疑似插入干扰文本拆解语义）`
      );
    else relayReviewLastIdx = idx;
  }
  // 循环留痕卡段内专属字段（复评结论/已累计轮次/留痕要求）段内顺序校验
  const loopCardSection = sliceSection(
    '【评审-修复循环留痕卡（5/12 评审-修复循环自动连续执行时使用）】',
    '【暂停确认】'
  );
  const LOOP_CARD_CORE = [
    '评审结论：🔴需修复 / 🟡建议 / 🟢通过',
    '已累计轮次：第 R 轮',
    '复评结论：🔴仍需修复（未清零，自动继续第 R+1 轮评审棒） / 🟢通过（清零且已达有效下限轮次，结束循环转 6/12 测试；有效下限 = max(10, 用户要求 N)，铁律 8 下限优先）',
    '转 6/12 测试需独立召唤下一棒',
    '每步留痕必须真实可核实，缺任一步即视为假装执行',
  ];
  if (loopCardSection !== null) {
    let loopCardLastIdx = -1;
    for (const f of LOOP_CARD_CORE) {
      const idx = loopCardSection.indexOf(f);
      if (idx === -1)
        errors.push(
          `评审-修复循环留痕卡缺少完整句式「${f}」（5/12 循环内每步留痕/计轮口径/转 6/12 语义须完整，防提前放行）`
        );
      else if (idx < loopCardLastIdx)
        errors.push(
          `评审-修复循环留痕卡句式顺序错乱：「${f}」出现在其声明顺序之前（疑似插入干扰文本拆解语义）`
        );
      else loopCardLastIdx = idx;
    }
  }
  // 循环收尾必须输出【评审-修复循环汇总卡】（PR #123 第 6 轮评审 C6）：汇总 R 轮每步 PR 留痕位置，
  // 是自动连续循环审计产物。卡名自身须强校验——LOOP_CARD_CORE 的「转 6/12」「每步留痕必须真实可核实」
  // 恰巧来自汇总卡这一行，删整行会间接拦截，但改名/挪走该行则 CI 漏检，故补卡名硬校验。
  if (loopCardSection !== null && !loopCardSection.includes('【评审-修复循环汇总卡】'))
    errors.push(
      '循环收尾缺少「【评审-修复循环汇总卡】」卡名（须输出汇总卡汇总 R 轮每步 PR 留痕位置，防审计语义被削弱）'
    );
  const reviewMarkSection = sliceSection(
    '【评审留痕·第 R 轮·评审棒】',
    '【修复留痕·第 R 轮·修复棒】'
  );
  if (reviewMarkSection !== null && !/本步留痕：<评审记录在 PR 的留痕位置>/.test(reviewMarkSection))
    errors.push('评审留痕块缺少「本步留痕：<评审记录在 PR 的留痕位置>」字段（每步须在 PR 留痕）');
  const fixMarkSection = sliceSection('【修复留痕·第 R 轮·修复棒】', '【复评留痕·第 R 轮·复评棒】');
  if (fixMarkSection !== null && !/本步留痕：<修复提交在 PR 的留痕位置>/.test(fixMarkSection))
    errors.push('修复留痕块缺少「本步留痕：<修复提交在 PR 的留痕位置>」字段（每步须在 PR 留痕）');
  const reReviewMarkSection = sliceSection('【复评留痕·第 R 轮·复评棒】', '【暂停确认】');
  if (
    reReviewMarkSection !== null &&
    !/本步留痕：<复评记录在 PR 的留痕位置>/.test(reReviewMarkSection)
  )
    errors.push('复评留痕块缺少「本步留痕：<复评记录在 PR 的留痕位置>」字段（每步须在 PR 留痕）');

  // ---- 9.7 文档级合并/发布覆盖（CR 第 3 轮评审：9.5/9.6 只校验提示词铁律与模板卡段，
  // 但提示词【流水线】主链、工作流程、门禁表、暂停确认表、角色卡片中的合并/发布声明被删仍漏检）----
  // 实测盲区（双源同步后删除均 exit 0）：
  // ① 提示词【流水线】段 ⏸CP3 合并确认→8/12 PR 合并→9/12 发布 整段被删；
  // ② 工作流程 ⏸ CP3 合并确认 / 阶段 8/12 PR 合并 / 阶段 9/12 发布 三行被删；
  // ③ 门禁表 合并前暂停确认（⏸CP3）/ 发布真实执行（四要素）两行被删；
  // ④ 暂停确认表 ⏸ CP3 合并确认 行被删；⑤ 角色卡片 PM 合并职责 / DEV 发布职责被删。
  // 修复：对这些文档结构进行存在性强校验（不校验语义细节，只保证关键声明未被整删）。

  // ① 提示词【流水线】段主链（段内定位，防其他段落同词命中）
  // CR 第 6 轮修复：三节点除存在性校验外增加顺序校验（⏸CP3 合并确认 → 8/12 PR 合并 → 9/12 发布 递增 indexOf）
  const pipelineSection = sliceSection('【流水线（12 阶段 + 4 暂停点', '【任务书');
  if (pipelineSection !== null) {
    const pipelineFrags = ['⏸CP3 合并确认', '8/12 PR 合并', '9/12 发布'];
    let pipelineLastIdx = -1;
    let pipelineBroken = false;
    for (const frag of pipelineFrags) {
      const idx = pipelineSection.indexOf(frag);
      if (idx === -1) {
        pipelineBroken = true;
        break;
      }
      if (idx < pipelineLastIdx) pipelineBroken = true;
      pipelineLastIdx = idx;
    }
    if (pipelineBroken)
      errors.push(
        '提示词【流水线】段缺少合并/发布节点或顺序错乱（须含 ⏸CP3 合并确认 → 8/12 PR 合并 → 9/12 发布 完整主链，防主流程丢失合并/发布阶段）'
      );
  }

  // ② 工作流程三行（文档级）——CR 第 4 轮修复：改用 sliceContentSection 统一区间定位，
  // 锚点缺失时显式报错（此前 indexOf 失败静默返回 null，删标题即可绕过校验）
  // CR 第 6 轮修复：三行除存在性校验外增加关键语义强校验（防行保留但语义被删）
  const workflowSection = sliceContentSection('## 工作流程（12 阶段流水线）', '### 两种执行方式');
  if (
    workflowSection !== null &&
    (!workflowSection.includes('⏸ CP3 合并确认') ||
      !workflowSection.includes('阶段 8/12 PR 合并') ||
      !workflowSection.includes('阶段 9/12 发布'))
  )
    errors.push(
      '工作流程缺少合并/发布阶段行（须含 ⏸ CP3 合并确认 / 阶段 8/12 PR 合并 / 阶段 9/12 发布，防执行细化丢失合并/发布）'
    );
  // R5-1 修复：工作流程 6/12 需求覆盖度检查行（文档级）——新增需求覆盖度检查 + ⏸CP2.5 后
  // 须在工作流程段补充校验，防文档工作流程与实际流水线脱节（实测删除后 exit 0）。
  if (
    workflowSection !== null &&
    (!workflowSection.includes('需求覆盖度检查') ||
      !workflowSection.includes('⏸ CP2.5 需求覆盖确认') ||
      !workflowSection.includes('覆盖度矩阵'))
  )
    errors.push(
      '工作流程缺少需求覆盖度检查/⏸CP2.5 行（须含 需求覆盖度检查 / 覆盖度矩阵 / ⏸ CP2.5 需求覆盖确认，防执行细化丢失需求覆盖确认）'
    );
  // CR 第 6 轮修复：行内关键语义强校验（合并行须真实 merge-pull + CI success + 留痕；发布行须四要素）
  // CR 第 7 轮修复：正则放宽空白（防行内加空格/文本重排误拦），并补「留痕合并结果」语义强校验（防漏检）
  // CR 第 9 轮修复：评审行「每步分别回复留痕」句式强校验（防工作流程评审行丢留痕纪律）
  if (
    workflowSection !== null &&
    (!/阶段 8\/12 PR 合并（PM）→ \*\*真实 merge-pull\*\*/.test(workflowSection) ||
      !/合并前 CI 须 success/.test(workflowSection) ||
      !/留痕合并结果/.test(workflowSection) ||
      !/阶段 9\/12 发布（DEV）→ \*\*四要素\*\*/.test(workflowSection) ||
      !/每一步（评审\/修复\/复评）均须在 PR 中分别回复留痕，留痕以「每步」为粒度而非「每轮」/.test(
        workflowSection
      ))
  )
    errors.push(
      '工作流程合并/发布/评审行语义不完整（合并行须含：真实 merge-pull、合并前 CI 须 success、留痕合并结果；发布行须含：**四要素**；评审行须含：每一步（评审/修复/复评）均须在 PR 中分别回复留痕，留痕以「每步」为粒度而非「每轮」）'
    );

  // ③ 门禁表两行（文档级）
  const gateSection = sliceContentSection(
    '### 真实执行与循环门禁',
    '## 与"逐个召唤自建 NPC"的对比'
  );
  if (
    gateSection !== null &&
    (!gateSection.includes('合并前暂停确认（⏸CP3）') ||
      !gateSection.includes('发布真实执行（四要素）'))
  )
    errors.push(
      '门禁表缺少合并/发布门禁行（须含「合并前暂停确认（⏸CP3）」与「发布真实执行（四要素）」，防防幻觉清单缺失）'
    );
  // CR 第 6 轮修复：门禁表行内关键语义强校验（防行保留但禁止细节/四要素被删）
  // CR 第 7 轮修复：正则放宽空白分隔（防行内加空格/重排误拦）
  if (
    gateSection !== null &&
    (!/只有\s*用户\s*本人\s*回复「确认合并\/继续」\s*才\s*放行合并/.test(gateSection) ||
      !/禁止代替确认、禁止未获确认就合并、禁止假装已合并/.test(gateSection) ||
      !/① 更新版本号（package\.json 等）/.test(gateSection) ||
      !/④ 形成 Release Notes/.test(gateSection))
  )
    errors.push(
      '门禁表合并/发布行语义不完整（合并行须含：只有用户确认才放行、禁止代替确认/未获确认就合并/假装已合并；发布行须含四要素 ① 更新版本号 ② CHANGELOG ③ 发布产物 ④ Release Notes）'
    );

  // ④ 暂停确认表 CP3 行（文档级）
  const pauseSection = sliceContentSection('### 暂停确认机制', '### 真实执行与循环门禁');
  if (pauseSection !== null && !pauseSection.includes('⏸ CP3 合并确认'))
    errors.push('暂停确认表缺少「⏸ CP3 合并确认」行（4 暂停点体系不完整）');
  // R4-1 修复：暂停确认表 CP2.5 行（文档级）——新增 ⏸CP2.5 后须与 CP3 行对称校验，
  // 防文档暂停确认表被删 CP2.5 行而 CI 不拦截（实测删除后 exit 0）。
  if (pauseSection !== null && !pauseSection.includes('⏸ CP2.5 需求覆盖确认'))
    errors.push('暂停确认表缺少「⏸ CP2.5 需求覆盖确认」行（4 暂停点体系不完整）');
  // CR 第 6 轮修复：CP3 行前置状态可核实性强校验（评审清零/测试通过/CI success 关键词）
  // CR 第 7 轮修复：正则放宽空白（防文本重排误拦），改为宽松的关键词组合校验
  if (
    pauseSection !== null &&
    (!/评审\s*清零/.test(pauseSection) ||
      !/测试\s*通过/.test(pauseSection) ||
      !/CI\s*success/.test(pauseSection))
  )
    errors.push('暂停确认表 CP3 行缺少前置状态可核实性（须含：评审清零/测试通过/CI success）');

  // ⑤ 角色卡片职责（提示词内）
  const cardSection2 = prompt.match(/【角色卡片】\n([\s\S]*?)(?=\n【流水线|\n【角色切换|$)/);
  if (cardSection2) {
    const cards = cardSection2[1];
    if (!/PM.*⏸CP3 合并确认.*8\/12 PR 合并/s.test(cards))
      errors.push('角色卡片 PM 缺少合并职责（须含 主持 ⏸CP3 合并确认、执行 8/12 PR 合并）');
    if (!/DEV.*9\/12 发布执行/s.test(cards))
      errors.push('角色卡片 DEV 缺少发布职责（须含 9/12 发布执行）');
    // CR 第 9 轮修复：CR 卡「每步（评审棒/修复棒/复评棒）分别回复留痕」强校验
    // （铁律 8 留痕纪律在 CR 角色行为契约中的落点，删除后评审角色可能只循环不留痕）
    if (
      !/CR.*每一步（评审棒\/修复棒\/复评棒）均须在 PR 中分别回复留痕（留痕以「每步」为粒度而非「每轮」）/s.test(
        cards
      )
    )
      errors.push(
        '角色卡片 CR 缺少留痕纪律（须含 每一步（评审棒/修复棒/复评棒）均须在 PR 中分别回复留痕（留痕以「每步」为粒度而非「每轮」））'
      );
  }

  // ⑥ 冒烟测试方法 C 段落（文档级）——CR 第 12 轮修复（追加 9 轮循环 R2）新增：
  // 第 11 轮将 R 计轮口径统一为「三棒同轮、复评未清零转第 R+1 轮、清零独立召唤 6/12」，
  // 但方法 C 段落（评审-修复自动连续循环的端到端验收标准）若残留旧口径（R+1/12、已清零直接转），
  // 用户按文档验收会得到错误预期。该段此前不在 9.7 文档级覆盖范围，删改后 CI 不拦截。
  const smokeCSection = sliceContentSection(
    '**方法 C（评审-修复自动连续循环，仅当用户明确要求跑 N 轮时适用）**',
    '**方法 D（合并确认接力）**'
  );
  // CR 第 28 轮修复：移除简单可缩豁免后缀（用户明确要求「至少 10 轮 保留」）——
  // 已清零分支硬性要求完整句（已清零（且已达至少 10 轮）→ 独立召唤 6/12 测试）。
  // 最新修订：用户要求「每步在 PR 留痕，而不是每轮」+「评审-修复循环自动连续执行（不用暂停）」——
  // 方法 C 须验收：同一次召唤内自动连续跑完 N 轮、每步（评审/修复/复评）在 PR 分别留痕、中途不暂停。
  if (
    smokeCSection !== null &&
    (!smokeCSection.includes('同一次召唤内自动连续执行') ||
      !/每一步（评审\/修复\/复评）都必须在 PR 中分别回复留痕（留痕以「每步」为粒度而非「每轮」）/.test(
        smokeCSection
      ) ||
      !/复评结论未清零 → 自动继续下一轮评审/.test(smokeCSection) ||
      !/已清零（且已达有效下限轮次 max\(10, 用户要求 N\)）→ 独立召唤 6\/12 测试/.test(
        smokeCSection
      ) ||
      !/中途不暂停、无需逐棒手动召唤/.test(smokeCSection))
  )
    errors.push(
      '冒烟测试方法 C 未同步新语义（须含：同一次召唤内自动连续执行；每一步（评审/修复/复评）在 PR 分别回复留痕，留痕以「每步」为粒度而非「每轮」；复评未清零 → 自动继续下一轮；已清零（且已达有效下限轮次 max(10, 用户要求 N)）→ 独立召唤 6/12 测试；中途不暂停、无需逐棒手动召唤）'
    );

  // ⑦ 冒烟测试方法 E（全程模式回退验证）——CR 第 13 轮修复（追加 9 轮循环 R3）新增：
  // 方法 E 声明「一次跑完全部步骤 → 单次会话跑完，但 ⏸CP1/⏸CP2/⏸CP3 暂停确认与留痕门禁仍生效」，
  // 是全程模式与接力模式边界约束的验收标准；此前无文档级覆盖，删改后 CI 不拦截。
  const smokeESection = sliceContentSection(
    '**方法 E（全程模式回退验证）**',
    '### 2. 冒烟测试（端到端，2 分钟）'
  );
  if (
    smokeESection !== null &&
    !/⏸CP1\/⏸CP2\/⏸CP2\.5\/⏸CP3 暂停确认与留痕门禁仍生效/.test(smokeESection)
  )
    errors.push(
      '冒烟测试方法 E 缺少全程模式边界约束（须含：一次跑完全部步骤时 ⏸CP1/⏸CP2/⏸CP2.5/⏸CP3 暂停确认与留痕门禁仍生效）'
    );

  // ⑧ 冒烟测试方法 D（合并确认接力）——CR 第 25 轮修复（本轮 5 轮循环 R3/W2）新增：
  // 方法 D 是 ⏸CP3 合并确认的端到端验收标准：
  // ① 未获用户回复「确认合并/继续」绝不执行 8/12 合并（铁律 13 在冒烟测试层的落点）；
  // ② 用户确认后把合并召唤话术发给下一次召唤 → 8/12 棒真实 merge-pull 并留痕（接力模式独立召唤语义）。
  // 此前无文档级覆盖，删改后 CI 不拦截（实测删「未获用户回复绝不执行」/删「把合并召唤话术发给下一次召唤」均 exit 0）。
  const smokeDSection = sliceContentSection(
    '**方法 D（合并确认接力）**',
    '**方法 E（全程模式回退验证）**'
  );
  // CR 第 27 轮修复（本轮 5 轮循环 R4/W1）：方法 D 除确认前暂停外，还须含「真实 merge-pull 并留痕」
  // ——删「真实」/删「8/12 棒真实 merge-pull 并留痕合并结果」整句此前实测 exit 0 漏检（防假装合并）。
  if (
    smokeDSection !== null &&
    (!/未获用户回复「确认合并\/继续」绝不执行 8\/12 合并/.test(smokeDSection) ||
      !/把合并召唤话术发给下一次召唤/.test(smokeDSection) ||
      !/真实 merge-pull 并留痕/.test(smokeDSection))
  )
    errors.push(
      '冒烟测试方法 D 缺少合并确认接力语义（须含：未获用户回复「确认合并/继续」绝不执行 8/12 合并；用户确认后把合并召唤话术发给下一次召唤 → 8/12 棒真实 merge-pull 并留痕合并结果）'
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
      } else {
        // 第 10 轮评审 W2：normalize 去空白比较会忽略「行首缩进」等纯格式差异，
        // 导致第 5 轮 I1 类修复（docs 缩进统一、SKILL 未重新生成）静默失同步。
        // 增加格式级比较：按行比较「行首缩进 + 行内内容（去行尾空白）」，缩进差异直接拦截。
        const fmtDiff = formatDiff(skillPrompt, docPrompt);
        if (fmtDiff.length > 0) {
          errors.push(
            'NPC_TEAM Skill 正文与 docs/NPC_TEAM.md 提示词存在格式级差异（行首缩进不一致）：' +
              fmtDiff.slice(0, 3).join('； ') +
              '。请运行 scripts/sync-npc-team-skill.js 自动同步'
          );
        }
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
