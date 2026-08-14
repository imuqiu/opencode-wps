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
 * - 自动继续 / 自动连续执行 / 自动接力：评审-修复循环自动连续执行触发语义（同一次召唤内自动跑完 N 轮，中途不暂停）
 * - 评审-修复接力：评审-修复循环自动连续执行（同一次召唤内自动跑完 N 轮，每步评审/修复/复评在 PR 分别留痕）
 * - PR 合并 / 合并确认 / 发布 / Release Notes：合并与发布阶段语义（8/12 合并前 ⏸CP3 暂停待用户确认；
 *   9/12 发布真实执行版本号/CHANGELOG/发布产物/Release Notes 四要素并留痕）
 */

/** description 必须包含的触发词（每项为正则，全部命中才算合法） */
const DESC_TRIGGERS = [
  { label: '「npc-team」', re: /npc-team/ },
  { label: '「NPC_TEAM skill / NPC Team」', re: /NPC_TEAM skill|NPC Team/ },
  {
    label: '「全流程触发语义」',
    re: /跑完整流程|全流程|拆解→分析→设计→开发→评审→修复→测试→文档→PR合并→发布→汇报→复盘/,
  },
  { label: '「调用短语：调用 NPC_TEAM skill」', re: /调用 NPC_TEAM skill/ },
  { label: '「接力模式：接力/每步独立执行」', re: /接力|每步|逐步|自动继续|自动连续执行|自动接力/ },
  { label: '「评审-修复接力」', re: /评审-修复接力|评审接力/ },
  {
    label: '「合并/发布触发语义」',
    // 发布为高频动词（发布公告/发布评论），须与合并/发布语境组合命中才有效；
    // 单独出现「发布」不视为触发（避免 description 无关句子误触发 skill 加载）
    re: /PR 合并|合并确认|发布(?:四要素|产物|Release|版本|CHANGELOG)|Release Notes/,
  },
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
  '自动继续',
  '自动连续执行',
  'PR 合并',
  '合并确认',
  '发布',
  'Release Notes',
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
