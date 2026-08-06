'use strict';

/**
 * NPC_TEAM Skill description 触发词规则（单一规则源）。
 * validate-npc-team-prompt.js（11.1b/11.1c）与 sync-npc-team-skill.js（descOk）
 * 共同引用，避免两处硬编码触发词导致未来调整时静默失同步。
 *
 * 触发词集合与 docs/NPC_TEAM.md「使用方式一」「关键边界」中明示的调用方式保持一致：
 * - npc-team：按名加载
 * - NPC_TEAM skill / NPC Team：一句话调用
 * - 跑完整流程 / 全流程 / 拆解→分析→…→复盘：全流程语义
 * - 调用 NPC_TEAM skill：docs 示例调用短语（用户按文档说法必须能触发）
 * - 接力 / 每步独立调用：接力模式语义（每次 @CodeBuddy 调用只执行一个步骤，用户逐步召唤）
 * - 评审-修复接力：评审-修复循环同样逐轮接力（每轮评审/修复各为独立召唤）
 * - 合并确认 / 合并前暂停：PR 合并前暂停待用户确认（⏸CP3）
 * - 发布：更新版本号 + CHANGELOG + 发布产物
 */

/** description 必须包含的触发词（每项为正则，全部命中才算合法） */
const DESC_TRIGGERS = [
  { label: '「npc-team」', re: /npc-team/ },
  { label: '「NPC_TEAM skill / NPC Team」', re: /NPC_TEAM skill|NPC Team/ },
  {
    label: '「全流程触发语义」',
    re: /跑完整流程|全流程|拆解→分析→设计→开发→评审→修复→测试→文档→汇报→复盘/,
  },
  { label: '「调用短语：调用 NPC_TEAM skill」', re: /调用 NPC_TEAM skill/ },
  { label: '「接力模式：接力/每步独立执行」', re: /接力|每步|逐步/ },
  { label: '「评审-修复接力」', re: /评审-修复接力|评审接力/ },
  { label: '「合并确认/合并前暂停」', re: /合并确认|合并前暂停|合并/ },
  { label: '「发布」', re: /发布|版本号|CHANGELOG/ },
];

/**
 * docs/NPC_TEAM.md「使用方式一」明示的触发短语（11.1c 交集校验用）。
 * 与 DESC_TRIGGERS 同源维护：新增触发词须同时考虑两处（或用 includes 全匹配时保持字符串一致）。
 */
const DOC_DESC_TRIGGERS = [
  '调用 NPC_TEAM skill',
  'npc-team',
  'NPC Team',
  '跑完整流程',
  '帮我跑全流程',
  '接力',
  '每步',
  '评审-修复接力',
  '合并确认',
  '合并前暂停',
  '发布',
];

/**
 * 校验 description 是否包含全部必要触发词。
 * @param {string} desc description 行文本（含 "description: " 前缀亦可）
 * @returns {{ ok: boolean, missing: string[] }}
 */
function checkDesc(desc) {
  const missing = [];
  for (const t of DESC_TRIGGERS) {
    if (!t.re.test(desc)) missing.push(t.label);
  }
  return { ok: missing.length === 0, missing };
}

/**
 * 校验 description 是否包含 docs「使用方式一」明示的全部触发短语（11.1c 交集校验）。
 * @param {string} desc description 行文本
 * @returns {{ ok: boolean, missing: string[] }}
 */
function checkDescAgainstDocs(desc) {
  const missing = DOC_DESC_TRIGGERS.filter(t => !desc.includes(t));
  return { ok: missing.length === 0, missing };
}

module.exports = { DESC_TRIGGERS, DOC_DESC_TRIGGERS, checkDesc, checkDescAgainstDocs };
