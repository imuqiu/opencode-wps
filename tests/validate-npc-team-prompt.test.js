/**
 * NPC Team 提示词校验脚本回归测试（PR #88 第 7 轮评审整改）
 *
 * 背景：scripts/validate-npc-team-prompt.js 是"防假装进行/防编造全绿"的最后防线，
 * 但此前无自动化测试，第 4/5/6/7 轮评审发现的"删约束仍通过"类逃生口
 * 全部依赖评审轮次的手工负向验证才能暴露。本文件将各轮实跑的负向攻击
 * 固化为回归用例，守护校验防线本身不被未来修改静默破坏。
 *
 * 运行：node tests/validate-npc-team-prompt.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'docs', 'NPC_TEAM.md');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'validate-npc-team-prompt.js');
const SKILL_FILE = path.join(__dirname, '..', '.codebuddy', 'skills', 'npc-team', 'SKILL.md');

// ---- 自建 mini 测试框架（与 tests/ 其他套件一致，无第三方依赖）----
let testCount = 0;
let passCount = 0;
const failures = [];

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failures.push({ name, err: e });
    console.log('  ✗ ' + name + ' → ' + e.message);
  }
}

function assertTrue(actual, msg) {
  if (!actual) throw new Error(msg || 'expected true');
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected)
    throw new Error((msg || 'not equal') + ': got ' + actual + ', want ' + expected);
}

// ---- 提取提示词代码块（与校验脚本同一锚点逻辑）----
function readPrompt() {
  const content = fs.readFileSync(FILE, 'utf8');
  const m = content.match(/```text\n# NPC_TEAM_PROMPT_START[^\n]*\n([\s\S]*?)\n```/);
  if (!m) throw new Error('未找到提示词代码块锚点');
  return { content, prompt: m[1] };
}

// ---- 在临时副本上改写提示词并运行校验脚本，返回退出码 ----
function runValidate(rewriteFn) {
  const { content, prompt } = readPrompt();
  const rewritten = content.replace(prompt, rewriteFn(prompt));
  // 备份并写入临时改写
  const tmp = FILE + '.tmp';
  const backup = FILE + '.bak';
  fs.writeFileSync(tmp, rewritten);
  fs.renameSync(FILE, backup);
  fs.renameSync(tmp, FILE);
  let code;
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    code = r.status;
  } finally {
    // 无论成功失败都还原，并清理临时文件（第 8 轮评审：防工作区残留 .tmp/.bak）
    fs.renameSync(FILE, tmp);
    fs.renameSync(backup, FILE);
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* 已不存在则忽略 */
    }
    try {
      fs.unlinkSync(backup);
    } catch (_) {
      /* 已不存在则忽略 */
    }
  }
  return code;
}

// ---- 用例 ----

test('正向：现有提示词通过校验（exit 0）', function () {
  const code = runValidate(p => p);
  assertEqual(code, 0, '正向应 exit 0');
});

test('负向：删铁律 8「至少进行 10 轮彻底循环」（第 4 轮逃生口回归）', function () {
  const code = runValidate(p =>
    p.replace('**至少进行 10 轮彻底的 PR review 与修复循环**', '**至少进行 PR review 与修复循环**')
  );
  assertEqual(code, 1, '删 10 轮要求应拦截（exit 1）');
});

test('负向：删铁律 8「每轮 review 必须在 PR 中回复」（第 4 轮逃生口回归）', function () {
  const code = runValidate(p => p.replace('每轮 review 必须在 PR 中回复（真实评审记录），', ''));
  assertEqual(code, 1, '删每轮 review 回复应拦截（exit 1）');
});

test('负向：删铁律 8「循环执行直至问题清零」（第 5 轮逃生口回归）', function () {
  const code = runValidate(p =>
    p.replace('修复后复评，**循环执行直至问题清零**；', '修复后复评；')
  );
  assertEqual(code, 1, '删循环清零应拦截（exit 1）');
});

test('负向：删铁律 8「防钻空子」句（第 5 轮逃生口回归）', function () {
  const code = runValidate(p =>
    p.replace(
      '简单改动走最小路径时，review 轮数可相应缩减，但**每轮留痕规则不变**（不得因裁剪而跳轮假装）。',
      '简单改动走最小路径时，review 轮数可相应缩减。'
    )
  );
  assertEqual(code, 1, '删防钻空子句应拦截（exit 1）');
});

test('负向：删铁律 7 反幻觉细节（第 6 轮逃生口回归）', function () {
  const code = runValidate(p =>
    p.replace(
      '；**禁止假装执行**（禁止只输出一句"已完成"却没有可核实的痕迹，禁止用不存在的模拟器/测试谎报结果）',
      '；**禁止假装执行**'
    )
  );
  assertEqual(code, 1, '删可核实/谎报应拦截（exit 1）');
});

test('负向：铁律 8 插入干扰句打乱顺序（第 6 轮顺序校验回归）', function () {
  const code = runValidate(p =>
    p.replace(
      '**至少进行 10 轮彻底的 PR review 与修复循环**',
      '**每轮留痕规则不变**，**至少进行 10 轮彻底的 PR review 与修复循环**'
    )
  );
  assertEqual(code, 1, '打乱顺序应拦截（exit 1）');
});

test('负向：删铁律 7「留下可见回复/记录」句（第 7 轮 9.1 跨行贪婪回归）', function () {
  const code = runValidate(p =>
    p.replace('并在对应 Issue 或 PR 上留下**可见回复/记录**（评论、评审、提交、CI 记录等）；', '；')
  );
  assertEqual(code, 1, '删铁律 7 留痕句应拦截（exit 1）');
});

// ---- Issue #76：接力模式（每步独立调用 @CodeBuddy）回归用例 ----
// 背景：用户最新要求"每一步都独立调一次 @CodeBuddy NPC，而不是调一次 @CodeBuddy 跑完全部步骤"。
// 提示词默认改为「接力模式」：每次召唤只执行一步并输出【接力卡】，逐步接力跑完全流程。
// 若接力核心要素被删（回退为"一次跑完"旧行为），CI 必须拦截。

test('正向：接力模式要素完整（exit 0）', function () {
  const code = runValidate(p => p);
  assertEqual(code, 0, '接力模式要素完整应 exit 0');
});

test('负向：删「接力模式（默认、推荐）」应拦截（exit 1）', function () {
  const code = runValidate(p =>
    p.replace('- 接力模式（默认、推荐）：用户每次召唤你，', '- 全程模式：用户每次召唤你，')
  );
  assertEqual(code, 1, '删接力默认声明应拦截（exit 1）');
});

test('负向：删「只执行流水线中的一个步骤」应拦截（exit 1）', function () {
  const code = runValidate(p =>
    p.replace(
      '你**只执行流水线中的一个步骤**，执行完输出【接力卡】并立即停下',
      '你**一次跑完全部步骤**，'
    )
  );
  assertEqual(code, 1, '删只执行一步应拦截（exit 1）');
});

test('负向：删铁律 11「接力只执行一步」应拦截（exit 1）', function () {
  const code = runValidate(p =>
    p.replace(
      '11. 接力只执行一步（接力模式铁律）：每次被召唤**只执行流水线中的一个步骤**，',
      '11. '
    )
  );
  assertEqual(code, 1, '删铁律 11 应拦截（exit 1）');
});

test('负向：删【接力卡】段应拦截（exit 1）', function () {
  const code = runValidate(p => p.replace('【接力卡（接力模式每步结束时必须输出）】\n', ''));
  assertEqual(code, 1, '删接力卡段应拦截（exit 1）');
});

test('负向：删「下一步召唤话术」应拦截（exit 1）', function () {
  const code = runValidate(p => p.replace('- 下一步召唤话术（用户原样复制即可）：', '- 下一步：'));
  assertEqual(code, 1, '删下一步召唤话术应拦截（exit 1）');
});

test('负向：删「绝不自行继续后续步骤」应拦截（exit 1）', function () {
  const code = runValidate(p =>
    p.replace(
      '执行完必须输出【接力卡】并立即停下；**绝不自行继续后续步骤、绝不代替用户召唤下一棒**；',
      '执行完必须输出【接力卡】并立即停下；'
    )
  );
  assertEqual(code, 1, '删绝不自行继续应拦截（exit 1）');
});

test('负向：删【任务书】段应拦截（exit 1）', function () {
  const code = runValidate(p =>
    p.replace('【任务书（接力模式第一棒 0/10 创建，随接力卡逐棒传递）】\n', '')
  );
  assertEqual(code, 1, '删任务书段应拦截（exit 1）');
});

test('负向：删接力卡召唤话术示例「@CodeBuddy 接力 NPC_TEAM skill」应拦截（exit 1）', function () {
  const code = runValidate(p =>
    p.replace(
      '@CodeBuddy 接力 NPC_TEAM skill，执行下一步 N+1/10 <阶段名>：',
      '@CodeBuddy 执行下一步：'
    )
  );
  assertEqual(code, 1, '删接力召唤话术示例应拦截（exit 1）');
});

// ---- Issue #76：NPC_TEAM Skill 一键调用方案回归用例 ----

// 统一「临时改坏 SKILL.md → 运行 → finally 还原」的健壮模式（防中途异常污染工作区）
function withSkillFile(content, fn) {
  const original = fs.readFileSync(SKILL_FILE, 'utf8');
  fs.writeFileSync(SKILL_FILE, content);
  let ret;
  try {
    ret = fn();
  } finally {
    fs.writeFileSync(SKILL_FILE, original);
  }
  return ret;
}

test('正向：Skill 与 docs 提示词双源一致（exit 0）', function () {
  const code = runValidate(p => p);
  assertEqual(code, 0, '双源一致应 exit 0');
});

test('负向：Skill 文件缺失应拦截（exit 1）', function () {
  const backup = SKILL_FILE + '.bak';
  const original = fs.readFileSync(SKILL_FILE, 'utf8');
  fs.renameSync(SKILL_FILE, backup);
  let code;
  try {
    const { spawnSync } = require('child_process');
    code = spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status;
  } finally {
    fs.renameSync(backup, SKILL_FILE);
  }
  assertEqual(code, 1, '删 Skill 文件应拦截（exit 1）');
});

test('负向：Skill 正文与 docs 提示词漂移应拦截（exit 1）', function () {
  const code = withSkillFile(
    fs
      .readFileSync(SKILL_FILE, 'utf8')
      .replace('你是「NPC Team 总指挥」', '你是「NPC Team 总指挥官」'),
    () => {
      const { spawnSync } = require('child_process');
      return spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status;
    }
  );
  assertEqual(code, 1, 'Skill 正文漂移应拦截（exit 1）');
});

test('负向：Skill frontmatter name 非 npc-team 应拦截（exit 1）', function () {
  const code = withSkillFile(
    fs.readFileSync(SKILL_FILE, 'utf8').replace('name: npc-team', 'name: npc-teamx'),
    () => {
      const { spawnSync } = require('child_process');
      return spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status;
    }
  );
  assertEqual(code, 1, 'frontmatter name 错误应拦截（exit 1）');
});

test('负向：Skill frontmatter description 缺触发词应拦截（exit 1）', function () {
  const code = withSkillFile(
    fs
      .readFileSync(SKILL_FILE, 'utf8')
      .replace('当用户说"调用 NPC_TEAM skill"、"npc-team"、"NPC Team"', '当用户提到 NPC Team 时'),
    () => {
      const { spawnSync } = require('child_process');
      return spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status;
    }
  );
  assertEqual(code, 1, 'description 缺触发词应拦截（exit 1）');
});

test('负向：Skill description 缺调用短语「调用 NPC_TEAM skill」应拦截（exit 1）', function () {
  const code = withSkillFile(
    fs.readFileSync(SKILL_FILE, 'utf8').replace('当用户说"调用 NPC_TEAM skill"、', '当用户说、'),
    () => {
      const { spawnSync } = require('child_process');
      return spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status;
    }
  );
  assertEqual(code, 1, 'description 缺调用短语应拦截（exit 1）');
});

test('负向：同步脚本 --check 对正文漂移应拦截（exit 1）', function () {
  // 先制造正文漂移：直接改 SKILL 正文身份声明句（不经过 sync），再跑 --check
  const code = withSkillFile(
    fs
      .readFileSync(SKILL_FILE, 'utf8')
      .replace(
        '你是「NPC Team 总指挥」，由官方免费',
        '你是「NPC Team 总指挥」，由官方免费（测试漂移）'
      ),
    () => {
      const { spawnSync } = require('child_process');
      const r = spawnSync(
        'node',
        [path.join(__dirname, '..', 'scripts', 'sync-npc-team-skill.js'), '--check'],
        { encoding: 'utf8' }
      );
      return r.status;
    }
  );
  assertEqual(code, 1, '正文漂移时 --check 应 exit 1');
});

test('负向：同步脚本 --check 对 description 缺触发词应拦截（exit 1）', function () {
  const code = withSkillFile(
    fs
      .readFileSync(SKILL_FILE, 'utf8')
      .replace('当用户说"调用 NPC_TEAM skill"、"npc-team"、"NPC Team"', '当用户提到 NPC Team 时'),
    () => {
      const { spawnSync } = require('child_process');
      const r = spawnSync(
        'node',
        [path.join(__dirname, '..', 'scripts', 'sync-npc-team-skill.js'), '--check'],
        { encoding: 'utf8' }
      );
      return r.status;
    }
  );
  assertEqual(code, 1, 'description 缺触发词时 --check 应 exit 1');
});

test('正向：同步脚本 --check 对一致的双源返回 0', function () {
  const { spawnSync } = require('child_process');
  const r = spawnSync(
    'node',
    [path.join(__dirname, '..', 'scripts', 'sync-npc-team-skill.js'), '--check'],
    {
      encoding: 'utf8',
    }
  );
  assertEqual(r.status, 0, '--check 一致应 exit 0');
});

// ---- 汇总 ----
console.log('\n========== 测试结果 ==========');
console.log('总计: ' + testCount + ' 个测试');
console.log('通过: ' + passCount + ' 个');
console.log('失败: ' + (testCount - passCount) + ' 个');

if (passCount === testCount) {
  console.log('\n✓ NPC Team 提示词校验脚本回归测试全部通过!\n');
  process.exit(0);
} else {
  console.log('\n✗ 部分测试失败!\n');
  process.exit(1);
}
