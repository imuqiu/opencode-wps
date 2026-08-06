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
const { spawnSync } = require('child_process');

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
  return runValidateCapture(rewriteFn).code;
}

// 在临时副本上改写提示词并运行校验脚本，返回 { code, output }（第 1 轮评审 C2：
// 部分用例需要断言拦截路径，区分「接力校验错误」与「双源一致性错误」假阳性）
function runValidateCapture(rewriteFn) {
  const { content, prompt } = readPrompt();
  const rewritten = content.replace(prompt, rewriteFn(prompt));
  // 备份并写入临时改写
  const tmp = FILE + '.tmp';
  const backup = FILE + '.bak';
  fs.writeFileSync(tmp, rewritten);
  fs.renameSync(FILE, backup);
  fs.renameSync(tmp, FILE);
  let code;
  let output = '';
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    code = r.status;
    output = (r.stdout || '') + (r.stderr || '');
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
  return { code, output };
}

// ---- 第 3 轮评审新增：全文改写辅助函数（文档级校验用例用）----
// 与 runValidateCapture 的区别：改写整个 content（含提示词代码块外的文档结构：
// 工作流程、门禁表、暂停确认表等），并同步 skill 双源（防双源不一致干扰断言）。
function runValidateCaptureFull(rewriteFn) {
  const { content } = readPrompt();
  const rewritten = rewriteFn(content);
  const tmp = FILE + '.tmp';
  const backup = FILE + '.bak';
  const tmpS = SKILL_FILE + '.tmp';
  const bakS = SKILL_FILE + '.bak';
  // CR 第 20 轮修复（追加 12 轮循环 R1）：先备份原始 SKILL.md 内容——
  // sync-npc-team-skill.js 是直接 writeFileSync 写入（不产生 .tmp 文件），
  // 旧还原条件 fs.existsSync(SKILL_FILE + '.tmp') 永远不成立，导致变异提示词
  // 永久污染 SKILL.md（实测 diff 45 字符）。改为 finally 无条件按原内容写回。
  const origSkill = fs.readFileSync(SKILL_FILE, 'utf8');
  fs.writeFileSync(tmp, rewritten);
  fs.renameSync(FILE, backup);
  fs.renameSync(tmp, FILE);
  // 同步 skill：运行 sync 脚本使双源一致（文档级改动会同时影响正文）
  let syncOut = '';
  try {
    const { spawnSync } = require('child_process');
    const s = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'sync-npc-team-skill.js')], {
      encoding: 'utf8',
    });
    syncOut = (s.stdout || '') + (s.stderr || '');
  } catch (_) {}
  let code;
  let output = '';
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    code = r.status;
    output = (r.stdout || '') + (r.stderr || '');
  } finally {
    fs.renameSync(FILE, tmp);
    fs.renameSync(backup, FILE);
    // 还原 skill：无条件按备份原内容写回（sync 直接 writeFileSync，无 .tmp 可探测）
    fs.writeFileSync(SKILL_FILE, origSkill);
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
    try {
      fs.unlinkSync(backup);
    } catch (_) {}
  }
  return { code, output, syncOut };
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

test('负向：删铁律 8「禁止以简单为由缩减轮数」句（CR 第 28 轮回归）', function () {
  const code = runValidate(p =>
    p.replace('**评审轮数不得以简单为由缩减**，不得以简单可缩为名跳轮偷懒。', '**评审轮数不得以简单为由缩减**。')
  );
  assertEqual(code, 1, '删禁止简单可缩句应拦截（exit 1）');
});

test('负向：删铁律 7 反幻觉细节（第 6 轮逃生口回归）', function () {
  const code = runValidate(p =>
    p.replace(
      '；**禁止假装执行**（禁止只输出一句"已完成"却没有可核实的痕迹，禁止用不存在的模拟器/测试谎报结果，禁止未真实合并却宣称已合并、未真实发布却宣称已发布）',
      '；**禁止假装执行**'
    )
  );
  assertEqual(code, 1, '删可核实/谎报应拦截（exit 1）');
});

test('负向：铁律 8 插入干扰句打乱顺序（第 6 轮顺序校验回归）', function () {
  const code = runValidate(p =>
    p.replace(
      '**至少进行 10 轮彻底的 PR review 与修复循环**',
      '**评审轮数不得以简单为由缩减**，**至少进行 10 轮彻底的 PR review 与修复循环**'
    )
  );
  assertEqual(code, 1, '打乱顺序应拦截（exit 1）');
});

test('负向：删铁律 7「留下可见回复/记录」句（第 7 轮 9.1 跨行贪婪回归）', function () {
  const code = runValidate(p =>
    p.replace(
      '并在对应 Issue 或 PR 上留下**可见回复/记录**（评论、评审、提交、CI 记录、合并记录、Release 等）；',
      '；'
    )
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
  // 第 1 轮评审 C2 修复：原用例用 String.replace 只替换第一个匹配，实际删的是【接力卡】段句子，
  // 评审/修复接力卡段仍含相同句式 → 接力校验未真正失效，exit=1 靠「双源一致性」假阳性拦截。
  // 现改用全量替换（split/join 删除所有出现处），并断言拦截路径为接力校验错误。
  const { code, output } = runValidateCapture(p =>
    p.split('- 下一步召唤话术（用户原样复制即可）：').join('- 下一步：')
  );
  assertEqual(code, 1, '删下一步召唤话术应拦截（exit 1）');
  assertTrue(
    /接力卡缺少「下一步召唤话术」/.test(output),
    '应命中接力校验错误（而非双源一致性假阳性），实际输出：' + output
  );
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
    p.replace('【任务书（接力模式第一棒 0/12 创建，随接力卡逐棒传递）】\n', '')
  );
  assertEqual(code, 1, '删任务书段应拦截（exit 1）');
});

test('负向：删接力卡召唤话术示例「@CodeBuddy 接力 NPC_TEAM skill」应拦截（exit 1）', function () {
  // 第 1 轮评审 C2 修复：原用例只替换第一个匹配（删的是【接力卡】段），评审/修复接力卡段仍含
  // 相同句式 → 接力校验未真正失效，exit=1 靠「双源一致性」假阳性拦截。
  // 现改为：仅删除【接力卡】段内的召唤话术示例（定位到该段再替换），并断言命中接力校验错误。
  const { code, output } = runValidateCapture(p => {
    const sectionStart = p.indexOf('【接力卡（接力模式每步结束时必须输出）】');
    const sectionEnd = p.indexOf('【评审接力卡（5/12 评审每轮评审结束时输出）】');
    const head = p.slice(0, sectionStart);
    const section = p
      .slice(sectionStart, sectionEnd)
      .replace(
        '@CodeBuddy 接力 NPC_TEAM skill，执行下一步 N+1/12 <阶段名>：',
        '@CodeBuddy 执行下一步：'
      );
    const tail = p.slice(sectionEnd);
    return head + section + tail;
  });
  assertEqual(code, 1, '删接力召唤话术示例应拦截（exit 1）');
  assertTrue(
    /接力卡缺少「下一步召唤话术」/.test(output),
    '应命中接力校验错误（而非双源一致性假阳性），实际输出：' + output
  );
});

// ---- Issue #76：评审-修复循环接力（PR review 与修复循环也使用接力模式）回归用例 ----
// 背景：用户要求"其中的 PR review 与 修复循环也建议使用接力模式"。
// 因此 5/10 评审-修复循环在接力模式下逐轮接力：每轮评审与每次修复各是独立一次 @CodeBuddy 召唤，
// 评审棒输出【评审接力卡】、修复棒输出【修复接力卡】，禁止在一次召唤内连跑多轮评审-修复。
// 若评审-修复接力核心要素被删（回退为一次召唤内连跑多轮），CI 必须拦截。

test('正向：评审-修复接力要素完整（exit 0）', function () {
  const code = runValidate(p => p);
  assertEqual(code, 0, '评审-修复接力要素完整应 exit 0');
});

test('负向：删铁律 8「接力模式」声明应拦截（exit 1）', function () {
  const code = runValidate(p =>
    p.replace(
      '8. 评审-修复循环（10 轮彻底循环，接力模式）：',
      '8. 评审-修复循环（10 轮彻底循环）：'
    )
  );
  assertEqual(code, 1, '删评审-修复接力声明应拦截（exit 1）');
});

test('负向：删「评审-修复循环同样逐轮接力」应拦截（exit 1）', function () {
  // 第 12 轮评审 W2：该句仅铁律 8 内出现 1 次，改为段内定位铁律 8 再删 + 断言拦截路径，与其他用例风格统一。
  const { code, output } = runValidateCapture(p => {
    const start = p.indexOf('8. 评审-修复循环（10 轮彻底循环，接力模式）');
    const end = p.indexOf('9. 测试失败跳转');
    const head = p.slice(0, start);
    const rule8 = p.slice(start, end).replace('**接力模式下评审-修复循环同样逐轮接力**：', '');
    const tail = p.slice(end);
    return head + rule8 + tail;
  });
  assertEqual(code, 1, '删逐轮接力声明应拦截（exit 1）');
  assertTrue(
    /评审-修复接力缺少完整句式「评审-修复循环同样逐轮接力」/.test(output),
    '应命中铁律 8 段内校验，实际输出：' + output
  );
});

test('负向：删铁律 8「评审棒输出【评审接力卡】」句应拦截（exit 1）', function () {
  // 第 12 轮评审 W1：铁律 8 段内 6 句负向覆盖补全——评审棒输出句此前无专门删除用例。
  const { code, output } = runValidateCapture(p => {
    const start = p.indexOf('8. 评审-修复循环（10 轮彻底循环，接力模式）');
    const end = p.indexOf('9. 测试失败跳转');
    const head = p.slice(0, start);
    const rule8 = p.slice(start, end).replace('评审棒输出【评审接力卡】、', '');
    const tail = p.slice(end);
    return head + rule8 + tail;
  });
  assertEqual(code, 1, '删评审棒输出句应拦截（exit 1）');
  assertTrue(
    /评审-修复接力缺少完整句式「评审棒输出【评审接力卡】」/.test(output),
    '应命中铁律 8 段内校验，实际输出：' + output
  );
});

test('负向：删铁律 8「修复棒输出【修复接力卡】」句应拦截（exit 1）', function () {
  // 第 12 轮评审 W1：铁律 8 段内 6 句负向覆盖补全——修复棒输出句此前无专门删除用例。
  const { code, output } = runValidateCapture(p => {
    const start = p.indexOf('8. 评审-修复循环（10 轮彻底循环，接力模式）');
    const end = p.indexOf('9. 测试失败跳转');
    const head = p.slice(0, start);
    const rule8 = p.slice(start, end).replace('修复棒输出【修复接力卡】，', '');
    const tail = p.slice(end);
    return head + rule8 + tail;
  });
  assertEqual(code, 1, '删修复棒输出句应拦截（exit 1）');
  assertTrue(
    /评审-修复接力缺少完整句式「修复棒输出【修复接力卡】」/.test(output),
    '应命中铁律 8 段内校验，实际输出：' + output
  );
});

test('负向：删「每轮评审与每次修复各是独立一次 @CodeBuddy 召唤」应拦截（exit 1）', function () {
  // 第 9 轮评审 W2：该句在铁律 8 与 CR 卡片段各 1 次，原用例用 replace 只替换第一个匹配（删铁律 8 的），
  // 但未断言拦截路径。改为段内定位铁律 8 再删 + 断言命中「评审-修复接力缺少完整句式」错误。
  const { code, output } = runValidateCapture(p => {
    const start = p.indexOf('8. 评审-修复循环（10 轮彻底循环，接力模式）');
    const end = p.indexOf('9. 测试失败跳转');
    const head = p.slice(0, start);
    const rule8 = p
      .slice(start, end)
      .replace('每轮评审与每次修复各是独立一次 @CodeBuddy 召唤，', '');
    const tail = p.slice(end);
    return head + rule8 + tail;
  });
  assertEqual(code, 1, '删独立召唤声明应拦截（exit 1）');
  assertTrue(
    /评审-修复接力缺少完整句式「每轮评审与每次修复各是独立一次 @CodeBuddy 召唤」/.test(output),
    '应命中铁律 8 段内校验（而非 CR 卡片段假阳性），实际输出：' + output
  );
});

test('负向：删【评审接力卡】段应拦截（exit 1）', function () {
  const code = runValidate(p => p.replace('【评审接力卡（5/12 评审每轮评审结束时输出）】\n', ''));
  assertEqual(code, 1, '删评审接力卡段应拦截（exit 1）');
});

test('负向：删【修复接力卡】段应拦截（exit 1）', function () {
  const code = runValidate(p => p.replace('【修复接力卡（5/12 评审每轮修复结束时输出）】\n', ''));
  assertEqual(code, 1, '删修复接力卡段应拦截（exit 1）');
});

test('负向：删评审接力卡召唤话术示例应拦截（exit 1）', function () {
  // 第 6 轮评审 W2：原用例用 replace 只替换第一个匹配，实际命中【接力卡】段内相同句式，
  // 拦截靠接力校验（假阳性）而非目标段校验；改为段内定位替换 + 断言拦截路径。
  const { code, output } = runValidateCapture(p => {
    const sectionStart = p.indexOf('【评审接力卡（5/12 评审每轮评审结束时输出）】');
    const sectionEnd = p.indexOf('【修复接力卡（5/12 评审每轮修复结束时输出）】');
    const head = p.slice(0, sectionStart);
    const section = p
      .slice(sectionStart, sectionEnd)
      .replace(
        '@CodeBuddy 接力 NPC_TEAM skill，执行第 R 轮评审修复（修复本轮评审问题）：',
        '@CodeBuddy 执行修复：'
      );
    const tail = p.slice(sectionEnd);
    return head + section + tail;
  });
  assertEqual(code, 1, '删评审接力卡召唤话术应拦截（exit 1）');
  assertTrue(
    /评审接力卡缺少「下一步召唤话术」/.test(output),
    '应命中评审接力卡段化校验（而非跨段假阳性），实际输出：' + output
  );
});

test('负向：删修复接力卡召唤话术示例应拦截（exit 1）', function () {
  // 第 6 轮评审 W2：同评审卡用例，改为段内定位替换 + 断言拦截路径。
  const { code, output } = runValidateCapture(p => {
    const sectionStart = p.indexOf('【修复接力卡（5/12 评审每轮修复结束时输出）】');
    const sectionEnd = p.indexOf('【复评接力卡（5/12 评审每轮复评结束时输出）】');
    const head = p.slice(0, sectionStart);
    const section = p
      .slice(sectionStart, sectionEnd)
      .replace(
        '@CodeBuddy 接力 NPC_TEAM skill，执行第 R 轮复评（评审上轮修复）：',
        '@CodeBuddy 执行复评：'
      );
    const tail = p.slice(sectionEnd);
    return head + section + tail;
  });
  assertEqual(code, 1, '删修复接力卡召唤话术应拦截（exit 1）');
  assertTrue(
    /修复接力卡缺少「下一步召唤话术」/.test(output),
    '应命中修复接力卡段化校验（而非跨段假阳性），实际输出：' + output
  );
});

test('负向：删复评接力卡召唤话术标签应拦截（exit 1）', function () {
  // 第 6 轮评审 W1/W2 新增：此前复评卡话术无段化校验，删标签行（保留【接力卡】段同句式）仍 exit 0。
  const { code, output } = runValidateCapture(p => {
    const sectionStart = p.indexOf('【复评接力卡（5/12 评审每轮复评结束时输出）】');
    const sectionEnd = p.indexOf('【暂停确认】');
    const head = p.slice(0, sectionStart);
    const section = p
      .slice(sectionStart, sectionEnd)
      .replace('- 下一步召唤话术（用户原样复制即可）：', '- 下一步：');
    const tail = p.slice(sectionEnd);
    return head + section + tail;
  });
  assertEqual(code, 1, '删复评接力卡话术标签应拦截（exit 1）');
  assertTrue(
    /复评接力卡缺少「下一步召唤话术」/.test(output),
    '应命中复评接力卡段化校验（而非跨段假阳性），实际输出：' + output
  );
});

test('负向：删复评卡「未清零」示例句应拦截（exit 1）', function () {
  // 第 6 轮评审 W1 新增：复评卡未清零示例句此前无独立校验，删除后须段内拦截。
  const { code, output } = runValidateCapture(p => {
    const sectionStart = p.indexOf('【复评接力卡（5/12 评审每轮复评结束时输出）】');
    const sectionEnd = p.indexOf('【暂停确认】');
    const head = p.slice(0, sectionStart);
    const section = p
      .slice(sectionStart, sectionEnd)
      .replace(
        '@CodeBuddy 接力 NPC_TEAM skill，执行第 R+1 轮评审（复评仍有问题，继续 review-修复循环）：',
        '@CodeBuddy 执行后续评审：'
      );
    const tail = p.slice(sectionEnd);
    return head + section + tail;
  });
  assertEqual(code, 1, '删复评未清零示例句应拦截（exit 1）');
  assertTrue(
    /复评接力卡缺少「下一步召唤话术」/.test(output),
    '应命中复评接力卡段化校验（而非跨段假阳性），实际输出：' + output
  );
});

test('负向：删复评卡「已清零」示例句应拦截（exit 1）', function () {
  // 第 6 轮评审 W1 新增：复评卡已清零示例句（转 6/10 测试）此前无独立校验，删除后须段内拦截。
  const { code, output } = runValidateCapture(p => {
    const sectionStart = p.indexOf('【复评接力卡（5/12 评审每轮复评结束时输出）】');
    const sectionEnd = p.indexOf('【暂停确认】');
    const head = p.slice(0, sectionStart);
    const section = p
      .slice(sectionStart, sectionEnd)
      .replace(
        '@CodeBuddy 接力 NPC_TEAM skill，执行 6/12 测试（评审问题已清零，进入测试阶段）：',
        '@CodeBuddy 执行测试：'
      );
    const tail = p.slice(sectionEnd);
    return head + section + tail;
  });
  assertEqual(code, 1, '删复评已清零示例句应拦截（exit 1）');
  assertTrue(
    /复评接力卡缺少「下一步召唤话术」/.test(output),
    '应命中复评接力卡段化校验（而非跨段假阳性），实际输出：' + output
  );
});

test('负向：删【暂停确认】锚点应报「段化校验区间不可达」（exit 1）', function () {
  // 第 7 轮评审 W1 新增：sliceSection 区间不可达（锚点被删）时须显式报错，而非静默跳过段化校验。
  const { code, output } = runValidateCapture(p =>
    p.replace(
      '【暂停确认】到 ⏸CP1/⏸CP2 时输出暂停卡并停下',
      '【暂停点】到 ⏸CP1/⏸CP2 时输出暂停卡并停下'
    )
  );
  assertEqual(code, 1, '删暂停确认锚点应拦截（exit 1）');
  assertTrue(
    /段化校验区间不可达：.*【暂停确认】/.test(output),
    '应命中段化校验区间不可达错误，实际输出：' + output
  );
});

test('负向：双源同步删三段接力卡话术标签应拦截（exit 1）', function () {
  // 第 6 轮评审 W1 新增：模拟用户改 docs 提示词（删三段卡标签行）未同步 skill，
  // 段化校验应拦截（此前全局 indexOf 校验漏检 exit 0）。
  const code = withSkillFile(fs.readFileSync(SKILL_FILE, 'utf8'), () => {
    const { content, prompt } = readPrompt();
    const stripThree = p => {
      const lines = p.split('\n');
      const titles = [
        '【评审接力卡（5/12 评审每轮评审结束时输出）】',
        '【修复接力卡（5/12 评审每轮修复结束时输出）】',
        '【复评接力卡（5/12 评审每轮复评结束时输出）】',
      ];
      let inSection = false;
      const out = [];
      for (const line of lines) {
        if (titles.some(t => line.includes(t))) inSection = true;
        if (inSection && line.trim() === '- 下一步召唤话术（用户原样复制即可）：') continue;
        out.push(line);
      }
      return out.join('\n');
    };
    const rewritten = content.replace(prompt, stripThree(prompt));
    // 与 runValidateCapture 相同的临时副本机制
    const tmp = FILE + '.tmp';
    const backup = FILE + '.bak';
    fs.writeFileSync(tmp, rewritten);
    fs.renameSync(FILE, backup);
    fs.renameSync(tmp, FILE);
    try {
      const { spawnSync } = require('child_process');
      const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
      return { code: r.status, output: (r.stdout || '') + (r.stderr || '') };
    } finally {
      fs.renameSync(FILE, tmp);
      fs.renameSync(backup, FILE);
      try {
        fs.unlinkSync(tmp);
        fs.unlinkSync(backup);
      } catch (_) {}
    }
  });
  assertEqual(code.code, 1, '双源删三段卡话术标签应拦截（exit 1）');
  assertTrue(
    /评审接力卡缺少「下一步召唤话术」|修复接力卡缺少「下一步召唤话术」|复评接力卡缺少「下一步召唤话术」/.test(
      code.output
    ),
    '应命中三段卡段化校验，实际输出：' + code.output
  );
});

test('负向：删「禁止在一次召唤内偷偷连跑多轮评审-修复」应拦截（exit 1）', function () {
  const code = runValidate(p => p.replace('，禁止在一次召唤内偷偷连跑多轮评审-修复。', '。'));
  assertEqual(code, 1, '删防连跑声明应拦截（exit 1）');
});

// ---- Issue #76 第 2 轮评审 C1/C2：复评环节闭环（复评接力卡 + 复评衔接强校验）----
// 背景：接力-修复循环声明「评审棒→修复棒→复评棒…」，但仅有评审/修复两张接力卡，复评棒行为未定义；
// 且校验脚本对复评仅有两处宽松正则，删复评衔接句可放行。本次新增【复评接力卡】模板 + 强校验。

test('正向：复评接力卡要素完整（exit 0）', function () {
  const code = runValidate(p => p);
  assertEqual(code, 0, '复评接力卡要素完整应 exit 0');
});

test('负向：删【复评接力卡】段应拦截（exit 1）', function () {
  const code = runValidate(p => p.replace('【复评接力卡（5/12 评审每轮复评结束时输出）】\n', ''));
  assertEqual(code, 1, '删复评接力卡段应拦截（exit 1）');
});

test('负向：删复评结论双分支应拦截（exit 1）', function () {
  const code = runValidate(p =>
    p.replace(
      '- 复评结论：🔴仍需修复（问题未清零，转下轮评审） / 🟢通过（问题清零，转 6/12 测试）',
      '- 复评结论：🟢通过'
    )
  );
  assertEqual(code, 1, '删复评结论双分支应拦截（exit 1）');
});

test('负向：删复评未清零续下轮评审话术应拦截（exit 1）', function () {
  const code = runValidate(p =>
    p.replace(
      '@CodeBuddy 接力 NPC_TEAM skill，执行第 R+1 轮评审（复评仍有问题，继续 review-修复循环）：',
      '@CodeBuddy 执行后续评审：'
    )
  );
  assertEqual(code, 1, '删复评未清零续轮话术应拦截（exit 1）');
});

test('负向：删复评清零转 6/12 测试话术应拦截（exit 1）', function () {
  const code = runValidate(p =>
    p.replace(
      '@CodeBuddy 接力 NPC_TEAM skill，执行 6/12 测试（评审问题已清零，进入测试阶段）：',
      '@CodeBuddy 执行测试：'
    )
  );
  assertEqual(code, 1, '删复评清零转测试话术应拦截（exit 1）');
});

test('负向：复评句式插入干扰句打乱顺序应拦截（exit 1）', function () {
  // 第 3 轮评审 W3：RELAY_REVIEW_CORE 顺序校验缺复评句式的回归用例。
  // 在【复评接力卡】段声明前插入「执行 6/10 测试」句，打乱 12 句式声明顺序 → 应报顺序错乱。
  const code = runValidate(p =>
    p.replace(
      '【复评接力卡（5/12 评审每轮复评结束时输出）】',
      '执行 6/12 测试（评审问题已清零，进入测试阶段），【复评接力卡（5/12 评审每轮复评结束时输出）】'
    )
  );
  assertEqual(code, 1, '复评句式打乱顺序应拦截（exit 1）');
});

test('负向：删复评卡「已累计轮次」句应拦截（exit 1）', function () {
  // 第 4 轮评审 W2：复评卡「已累计轮次」句是「至少 10 轮」门禁在复评环节的落点，须纳入强校验。
  // CR 第 22 轮修复（追加 12 轮循环 R3）：原用例用 replace 只替换第一个匹配，
  // 而「已累计轮次」现在在评审/修复/复评三张卡各出现一次（第 22 轮同步），
  // 原替换命中评审卡（位置靠前），拦截靠双源一致性假阳性而非复评卡段内校验；
  // 改为段内定位【复评接力卡】段再删，并断言命中复评卡段内校验错误。
  const { code, output } = runValidateCapture(p => {
    const sectionStart = p.indexOf('【复评接力卡（5/12 评审每轮复评结束时输出）】');
    const sectionEnd = p.indexOf('【暂停确认】');
    const head = p.slice(0, sectionStart);
    const section = p
      .slice(sectionStart, sectionEnd)
      .replace(
        '- 已累计轮次：第 R 轮（未清零则继续；清零且已达至少 10 轮则进下一阶段）',
        '- 已累计轮次：第 R 轮'
      );
    const tail = p.slice(sectionEnd);
    return head + section + tail;
  });
  assertEqual(code, 1, '删复评卡已累计轮次句应拦截（exit 1）');
  assertTrue(
    /复评接力卡缺少完整句式「已累计轮次/.test(output),
    '应命中复评卡段内句式校验（而非双源一致性假阳性），实际输出：' + output
  );
});

// ---- Issue #76：PR 合并（合并前暂停待用户确认）与发布（四要素）回归用例 ----
// 背景：用户最新要求"再加上PR合并（在合并前需暂停待用户确认）、发布（更新版本号、发布形成changelog、发布产物）"
// + "补充：发布（补充形成Release Notes）"。因此 8/12 PR 合并前必须停到 ⏸CP3（输出【合并确认卡】，
// 只有用户本人回复「确认合并/继续」才放行合并，禁止未确认就合并/假装已合并）；
// 9/12 发布必须真实执行四要素（① 更新版本号 ② 形成 CHANGELOG ③ 发布产物 ④ 形成 Release Notes）并留痕。

// 段内定位【合并确认卡】段并改写的辅助函数
function replaceInMergeCard(p, fn) {
  const sectionStart = p.indexOf(
    '【合并确认卡（⏸CP3：7/12 文档完成后、8/12 PR 合并前暂停，待用户确认合并）】'
  );
  const sectionEnd = p.indexOf('【角色切换】');
  const head = p.slice(0, sectionStart);
  const section = fn(p.slice(sectionStart, sectionEnd));
  const tail = p.slice(sectionEnd);
  return head + section + tail;
}

test('正向：合并确认（⏸CP3）要素完整（exit 0）', function () {
  const code = runValidate(p => p);
  assertEqual(code, 0, '合并确认要素完整应 exit 0');
});

test('负向：删铁律 13「合并前暂停确认」应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace('13. 合并前暂停确认：流水线到 ⏸CP3', '13. 合并前自动执行：流水线到 ⏸CP3')
  );
  assertEqual(code, 1, '删合并前暂停声明应拦截（exit 1）');
  assertTrue(
    /合并确认缺少完整句式「13\. 合并前暂停确认」/.test(output),
    '应命中合并确认强校验，实际输出：' + output
  );
});

test('负向：删【合并确认卡】段应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace('【合并确认卡（⏸CP3：7/12 文档完成后、8/12 PR 合并前暂停，待用户确认合并）】\n', '')
  );
  assertEqual(code, 1, '删合并确认卡段应拦截（exit 1）');
  assertTrue(
    /合并确认缺少完整句式「【合并确认卡/.test(output),
    '应命中合并确认卡段缺失校验，实际输出：' + output
  );
});

test('负向：删合并确认卡「合并前置状态」应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    replaceInMergeCard(p, s =>
      s.replace(
        '- 合并前置状态：评审 ✔ 问题清零（位置）/ 测试 ✔ 通过（位置）/ CI ✔ success（位置）',
        '- 前置状态：已就绪'
      )
    )
  );
  assertEqual(code, 1, '删合并前置状态应拦截（exit 1）');
  assertTrue(
    /合并确认卡缺少必要要素/.test(output),
    '应命中合并确认卡段化校验，实际输出：' + output
  );
});

test('负向：删合并确认卡「只有用户确认才放行」应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    replaceInMergeCard(p, s =>
      s.replace('只有用户本人回复「确认合并/继续」才放行执行 8/12 PR 合并', '确认后自动合并')
    )
  );
  assertEqual(code, 1, '删用户确认才放行应拦截（exit 1）');
  assertTrue(
    /合并确认卡缺少必要要素/.test(output),
    '应命中合并确认卡段化校验，实际输出：' + output
  );
});

test('负向：删合并确认卡「禁止未确认就合并/假装已合并」应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    replaceInMergeCard(p, s =>
      s.replace('禁止代替用户确认、禁止未获确认就合并、禁止假装已合并', '禁止跳过流程')
    )
  );
  assertEqual(code, 1, '删禁止未确认就合并应拦截（exit 1）');
  assertTrue(
    /合并确认卡缺少必要要素/.test(output),
    '应命中合并确认卡段化校验，实际输出：' + output
  );
});

test('负向：删合并确认卡 8/12 合并召唤话术示例应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    replaceInMergeCard(p, s =>
      s.replace('@CodeBuddy 接力 NPC_TEAM skill，执行 8/12 PR 合并：', '@CodeBuddy 执行合并：')
    )
  );
  assertEqual(code, 1, '删合并召唤话术应拦截（exit 1）');
  assertTrue(
    /合并确认卡缺少必要要素/.test(output),
    '应命中合并确认卡段化校验，实际输出：' + output
  );
});

// ---- Issue #76 第 2 轮评审：合并门禁（9.5）段内校验盲区回归用例 ----
// 背景：实测删除「收到确认前不得执行合并」/「确认合并/继续→放行」映射 / 用户命令三选一（补充/停止）/ 铁律 13 禁止细节
// 后 validate 均 exit 0 未拦截（校验盲区）。本次补齐段内强校验并新增 5 个负向用例。

test('负向：删合并确认卡「收到确认前不得执行合并」应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    replaceInMergeCard(p, s => s.replace('- 收到确认前不得执行合并，不得输出 8/12 内容\n', ''))
  );
  assertEqual(code, 1, '删收到确认前不得执行合并应拦截（exit 1）');
  assertTrue(
    /合并确认卡缺少必要要素/.test(output),
    '应命中合并确认卡段化校验，实际输出：' + output
  );
});

test('负向：删合并确认卡「待合并 PR」字段应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    replaceInMergeCard(p, s => s.replace('- 待合并 PR：#<编号>（commit <sha>）\n', ''))
  );
  assertEqual(code, 1, '删待合并 PR 字段应拦截（exit 1）');
  assertTrue(
    /合并确认卡缺少必要要素/.test(output),
    '应命中合并确认卡段化校验，实际输出：' + output
  );
});

test('负向：删合并确认卡「用户已确认合并」留痕位置应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    replaceInMergeCard(p, s => s.replace('用户已确认合并，见：<位置>\n', ''))
  );
  assertEqual(code, 1, '删用户已确认合并留痕位置应拦截（exit 1）');
  assertTrue(
    /合并确认卡缺少必要要素/.test(output),
    '应命中合并确认卡段化校验，实际输出：' + output
  );
});

test('负向：删合并确认卡「确认合并/继续→放行」映射应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    replaceInMergeCard(p, s => s.replace('- 「确认合并/继续」→ 放行 8/12 PR 合并\n', ''))
  );
  assertEqual(code, 1, '删确认合并放行映射应拦截（exit 1）');
  assertTrue(
    /合并确认卡缺少必要要素/.test(output),
    '应命中合并确认卡段化校验，实际输出：' + output
  );
});

test('负向：删合并确认卡「补充：<意见>」命令应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    replaceInMergeCard(p, s => s.replace('- 「补充：<意见>」→ 结合意见修正 PR 后重新确认\n', ''))
  );
  assertEqual(code, 1, '删合并卡补充命令应拦截（exit 1）');
  assertTrue(
    /合并确认卡缺少必要要素/.test(output),
    '应命中合并确认卡段化校验，实际输出：' + output
  );
});

test('负向：删合并确认卡「停止」命令应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    replaceInMergeCard(p, s => s.replace('- 「停止」→ 终止后续阶段，按用户意见处理\n', ''))
  );
  assertEqual(code, 1, '删合并卡停止命令应拦截（exit 1）');
  assertTrue(
    /合并确认卡缺少必要要素/.test(output),
    '应命中合并确认卡段化校验，实际输出：' + output
  );
});

test('负向：删铁律 13「禁止未获确认就合并/假装已合并」细节应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace(
      '**只有用户本人回复「确认合并/继续」才放行执行 8/12 合并**；禁止代替用户确认、禁止未获确认就合并、禁止假装已合并（未真实 merge-pull 不得宣称已合并）。',
      '**只有用户本人回复「确认合并/继续」才放行执行 8/12 合并**。'
    )
  );
  assertEqual(code, 1, '删铁律 13 禁止细节应拦截（exit 1）');
  assertTrue(
    /铁律 13 缺少禁止细节/.test(output),
    '应命中铁律 13 强校验，实际输出：' + output
  );
});

test('正向：发布四要素要素完整（exit 0）', function () {
  const code = runValidate(p => p);
  assertEqual(code, 0, '发布四要素完整应 exit 0');
});

// ---- Issue #76 第 3 轮评审：文档级合并/发布覆盖回归用例（9.7 新增）----
// 背景：实测删提示词【流水线】主链合并/发布节点、工作流程三行、门禁表两行、暂停确认表 CP3 行、
// 角色卡片 PM/DEV 职责后 validate 均 exit 0 漏检（9.5/9.6 只覆盖铁律与模板卡段）。
// 本次新增 9.7 文档级覆盖校验 + 5 个负向用例。

test('负向：删提示词流水线 ⏸CP3 合并确认节点应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace(' → ⏸CP3 合并确认(PM 主持，等用户确认后才合并) → 8/12 PR 合并(PM，merge-pull 留痕) → 9/12 发布(DEV，版本号/CHANGELOG/发布产物/Release Notes) → 10/12 汇报(PM)', ' → 10/12 汇报(PM)')
  );
  assertEqual(code, 1, '删流水线合并/发布节点应拦截（exit 1）');
  assertTrue(
    /提示词【流水线】段缺少合并\/发布节点/.test(output),
    '应命中流水线主链校验，实际输出：' + output
  );
});

test('负向：删工作流程阶段 9/12 发布行应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('阶段 9/12 发布（DEV）→ **四要素**：① 更新版本号（package.json 等）② 形成 CHANGELOG ③ 发布产物（构建/制品/标签）④ 形成 Release Notes（发布说明，发布到 Release/对应页面）\n', '')
  );
  assertEqual(code, 1, '删工作流程发布行应拦截（exit 1）');
  assertTrue(
    /工作流程缺少合并\/发布阶段行/.test(output),
    '应命中工作流程校验，实际输出：' + output
  );
});

test('负向：删门禁表「合并前暂停确认（⏸CP3）」行应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('| **合并前暂停确认（⏸CP3）**               | 8/12 PR 合并前必须停到 ⏸CP3，输出【合并确认卡】（待合并 PR + 评审清零/测试通过/CI success 记录位置），**只有用户本人回复「确认合并/继续」才放行合并**；禁止代替确认、禁止未获确认就合并、禁止假装已合并（未真实 merge-pull 不得宣称已合并）                                                                                                                                               | 合并失控/假装合并    |\n', '')
  );
  assertEqual(code, 1, '删门禁表合并行应拦截（exit 1）');
  assertTrue(
    /门禁表缺少合并\/发布门禁行/.test(output),
    '应命中门禁表校验，实际输出：' + output
  );
});

test('负向：删暂停确认表 ⏸ CP3 合并确认行应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('| **⏸ CP3 合并确认** | 7/12 文档完成后、8/12 合并前 | 待合并 PR 的前置状态是否齐备（评审清零/测试通过/CI success），是否确认合并 |\n', '')
  );
  assertEqual(code, 1, '删暂停确认表 CP3 行应拦截（exit 1）');
  assertTrue(
    /暂停确认表缺少「⏸ CP3 合并确认」行/.test(output),
    '应命中暂停确认表校验，实际输出：' + output
  );
});

test('负向：删角色卡片 PM 合并职责应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace('主持 ⏸CP3 合并确认、执行 8/12 PR 合并（merge-pull，留痕合并结果）。', '')
  );
  assertEqual(code, 1, '删 PM 合并职责应拦截（exit 1）');
  assertTrue(
    /角色卡片 PM 缺少合并职责/.test(output),
    '应命中角色卡片校验，实际输出：' + output
  );
});

// ---- Issue #76 第 9 轮评审：留痕纪律多处覆盖盲区回归用例 ----
// 背景：实测删 CR 角色卡片「每轮 review 与每次修复均须在 PR 中分别回复留痕」或工作流程评审行同句式
// 后 validate 均 exit 0 漏检（铁律 8 留痕纪律在多处声明的落点未全部纳入强校验）。
// 本次修复：角色卡片 CR 卡 + 工作流程评审行补强校验，新增 2 个负向用例。

test('负向：删角色卡片 CR 留痕纪律应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace('，每轮 review 与每次修复均须在 PR 中分别回复留痕。', '。')
  );
  assertEqual(code, 1, '删 CR 卡留痕纪律应拦截（exit 1）');
  assertTrue(
    /角色卡片 CR 缺少留痕纪律/.test(output),
    '应命中角色卡片 CR 校验，实际输出：' + output
  );
});

test('负向：删工作流程评审行留痕纪律应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('（每轮 review 与每次修复均须在 PR 中分别回复留痕；', '（')
  );
  assertEqual(code, 1, '删工作流程评审行留痕纪律应拦截（exit 1）');
  assertTrue(
    /工作流程合并\/发布\/评审行语义不完整/.test(output),
    '应命中工作流程内容校验，实际输出：' + output
  );
});

// ---- Issue #76 第 4 轮评审：文档级校验锚点缺失回归用例（9.7 sliceContentSection）----
// 背景：实测删/改工作流程、门禁表、暂停确认表的章节标题后，9.7 区间定位静默跳过（exit 0 漏检）。
// 本次修复：新增 sliceContentSection（锚点缺失/区间不可达显式报错），新增 3 个负向用例。

test('负向：改工作流程标题锚点应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('## 工作流程（12 阶段流水线）', '## 工作流程')
  );
  assertEqual(code, 1, '改工作流程标题应拦截（exit 1）');
  assertTrue(
    /文档级校验锚点缺失：「## 工作流程/.test(output),
    '应命中工作流程锚点校验，实际输出：' + output
  );
});

test('负向：改门禁表标题锚点应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('### 真实执行与循环门禁（防幻觉，2026-08 补充）', '### 真实执行门禁（防幻觉）')
  );
  assertEqual(code, 1, '改门禁表标题应拦截（exit 1）');
  assertTrue(
    /文档级校验锚点缺失：「### 真实执行与循环门禁」/.test(output),
    '应命中门禁表锚点校验，实际输出：' + output
  );
});

test('负向：改暂停确认表标题锚点应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('### 暂停确认机制（防跑偏，2026-08 新增）', '### 暂停确认（防跑偏）')
  );
  assertEqual(code, 1, '改暂停确认表标题应拦截（exit 1）');
  assertTrue(
    /文档级校验锚点缺失：「### 暂停确认机制」/.test(output),
    '应命中暂停确认表锚点校验，实际输出：' + output
  );
});

// ---- Issue #76 第 6 轮评审：9.7 文档级校验「内容级」盲区回归用例 ----
// 背景：实测行保留但关键语义被删/改（门禁表四要素/流水线主链顺序/暂停确认表前置状态/工作流程合并语义/门禁表禁止细节）
// 后 validate 均 exit 0 漏检（9.7 只校验存在性不校验内容）。本次修复增加内容级强校验 + 5 个负向用例。

test('负向：删门禁表发布行四要素内容应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('| **发布真实执行（四要素）**               | 9/12 发布必须真实执行并留痕：① 更新版本号（package.json 等）② 形成 CHANGELOG（含本次变更）③ 发布产物（构建/制品/标签，真实产出）④ 形成 Release Notes（发布到 Release/对应页面）；禁止只输出"已发布"却缺任一要素                                                                                                                                                                           | 发布造假/缺产物      |', '| **发布真实执行（四要素）**               | 9/12 发布必须真实执行                                                                                                                                                                      | 发布造假/缺产物      |')
  );
  assertEqual(code, 1, '删门禁表发布行四要素应拦截（exit 1）');
  assertTrue(
    /门禁表合并\/发布行语义不完整/.test(output),
    '应命中门禁表内容校验，实际输出：' + output
  );
});

test('负向：打乱流水线主链合并/发布顺序应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace(' → ⏸CP3 合并确认(PM 主持，等用户确认后才合并) → 8/12 PR 合并(PM，merge-pull 留痕) → 9/12 发布(DEV，版本号/CHANGELOG/发布产物/Release Notes) → 10/12 汇报(PM)', ' → 9/12 发布(DEV，版本号/CHANGELOG/发布产物/Release Notes) → ⏸CP3 合并确认(PM 主持，等用户确认后才合并) → 8/12 PR 合并(PM，merge-pull 留痕) → 10/12 汇报(PM)')
  );
  assertEqual(code, 1, '打乱流水线主链顺序应拦截（exit 1）');
  assertTrue(
    /提示词【流水线】段缺少合并\/发布节点或顺序错乱/.test(output),
    '应命中流水线主链顺序校验，实际输出：' + output
  );
});

test('负向：删暂停确认表 CP3 前置状态应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('| **⏸ CP3 合并确认** | 7/12 文档完成后、8/12 合并前 | 待合并 PR 的前置状态是否齐备（评审清零/测试通过/CI success），是否确认合并 |', '| **⏸ CP3 合并确认** | 7/12 文档完成后、8/12 合并前 | 是否确认合并 |')
  );
  assertEqual(code, 1, '删 CP3 前置状态应拦截（exit 1）');
  assertTrue(
    /暂停确认表 CP3 行缺少前置状态可核实性/.test(output),
    '应命中暂停确认表内容校验，实际输出：' + output
  );
});

test('负向：改工作流程 8/12 合并行为自动合并应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('阶段 8/12 PR 合并（PM）→ **真实 merge-pull**（合并前 CI 须 success）→ 在 Issue/PR 留痕合并结果', '阶段 8/12 PR 合并（PM）→ 自动合并')
  );
  assertEqual(code, 1, '改工作流程合并语义应拦截（exit 1）');
  assertTrue(
    /工作流程合并\/发布\/评审行语义不完整/.test(output),
    '应命中工作流程内容校验，实际输出：' + output
  );
});

test('负向：删门禁表合并行禁止细节应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('| **合并前暂停确认（⏸CP3）**               | 8/12 PR 合并前必须停到 ⏸CP3，输出【合并确认卡】（待合并 PR + 评审清零/测试通过/CI success 记录位置），**只有用户本人回复「确认合并/继续」才放行合并**；禁止代替确认、禁止未获确认就合并、禁止假装已合并（未真实 merge-pull 不得宣称已合并）                                                                                                                                               | 合并失控/假装合并    |', '| **合并前暂停确认（⏸CP3）**               | 8/12 合并前须确认                                                                                                                                                                            | 合并失控/假装合并    |')
  );
  assertEqual(code, 1, '删门禁表合并禁止细节应拦截（exit 1）');
  assertTrue(
    /门禁表合并\/发布行语义不完整/.test(output),
    '应命中门禁表内容校验，实际输出：' + output
  );
});

// ---- Issue #76 第 7 轮评审：9.7 内容级校验误报/漏检修正回归用例 ----
// 背景：① 正则过严（行内加空格/文本重排误拦）；② 工作流程合并行删「留痕合并结果」漏检。
// 本次修复：放宽空白分隔正则 + 补「留痕合并结果」强校验；新增 2 正向（防误报）+ 1 负向（补漏检）用例。

test('正向：门禁表合并行加空格不误拦（exit 0）', function () {
  const code = runValidateCaptureFull(p =>
    p.replace('只有用户本人回复「确认合并/继续」才放行合并', '只有 用户本人 回复「确认合并/继续」才放行合并')
  ).code;
  assertEqual(code, 0, '门禁表行内加空格不应误拦（exit 0）');
});

test('正向：暂停确认表 CP3 行文本重排不误拦（exit 0）', function () {
  const code = runValidateCaptureFull(p =>
    p.replace('待合并 PR 的前置状态是否齐备（评审清零/测试通过/CI success），是否确认合并', '待合并 PR 前置状态：评审清零 / 测试通过 / CI success；是否确认合并')
  ).code;
  assertEqual(code, 0, 'CP3 行文本重排不应误拦（exit 0）');
});

test('负向：工作流程合并行删留痕合并结果应拦截（exit 1）', function () {
  const { code, output } = runValidateCaptureFull(p =>
    p.replace('阶段 8/12 PR 合并（PM）→ **真实 merge-pull**（合并前 CI 须 success）→ 在 Issue/PR 留痕合并结果', '阶段 8/12 PR 合并（PM）→ **真实 merge-pull**（合并前 CI 须 success）')
  );
  assertEqual(code, 1, '删留痕合并结果应拦截（exit 1）');
  assertTrue(
    /工作流程合并\/发布\/评审行语义不完整/.test(output),
    '应命中工作流程内容校验，实际输出：' + output
  );
});

test('负向：删铁律 14「发布真实执行」应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace('14. 发布真实执行：9/12 发布必须', '14. 发布：9/12 发布可以')
  );
  assertEqual(code, 1, '删发布真实执行声明应拦截（exit 1）');
  assertTrue(
    /发布四要素缺少完整句式「14\. 发布真实执行」/.test(output),
    '应命中发布四要素强校验，实际输出：' + output
  );
});

test('负向：删发布要素①「更新版本号」应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace('① 更新版本号（package.json 等）', '① 更新版本')
  );
  assertEqual(code, 1, '删更新版本号要素应拦截（exit 1）');
  assertTrue(
    /发布四要素缺少完整句式「① 更新版本号（package\.json 等）」/.test(output),
    '应命中发布四要素强校验，实际输出：' + output
  );
});

test('负向：删发布要素②「形成 CHANGELOG」应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace('② 形成 CHANGELOG（含本次变更记录）', '② 补充变更说明')
  );
  assertEqual(code, 1, '删形成 CHANGELOG 要素应拦截（exit 1）');
  assertTrue(
    /发布四要素缺少完整句式「② 形成 CHANGELOG（含本次变更记录）」/.test(output),
    '应命中发布四要素强校验，实际输出：' + output
  );
});

test('负向：删发布要素③「发布产物」应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace('③ 发布产物（构建/制品/标签，真实产出）', '③ 产出构建物')
  );
  assertEqual(code, 1, '删发布产物要素应拦截（exit 1）');
  assertTrue(
    /发布四要素缺少完整句式「③ 发布产物（构建\/制品\/标签，真实产出）」/.test(output),
    '应命中发布四要素强校验，实际输出：' + output
  );
});

test('负向：删发布要素④「形成 Release Notes」应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace('④ 形成 Release Notes（发布说明，发布到 Release/对应页面）', '④ 写发布说明')
  );
  assertEqual(code, 1, '删形成 Release Notes 要素应拦截（exit 1）');
  assertTrue(
    /发布四要素缺少完整句式「④ 形成 Release Notes（发布说明，发布到 Release\/对应页面）」/.test(
      output
    ),
    '应命中发布四要素强校验，实际输出：' + output
  );
});

test('负向：删发布禁止缺要素句应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p.replace(
      '禁止只输出"已发布"却无版本号变更、无 CHANGELOG、无发布产物、无 Release Notes 的任何一项',
      '禁止只输出"已发布"'
    )
  );
  assertEqual(code, 1, '删发布禁止缺要素句应拦截（exit 1）');
  assertTrue(
    /发布四要素缺少完整句式「禁止只输出"已发布"却无版本号变更/.test(output),
    '应命中发布四要素强校验，实际输出：' + output
  );
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

test('负向：SKILL 缩进漂移应被 validate formatDiff 拦截（exit 1）', function () {
  // 第 10 轮评审 W2 新增：normalize 去空白比较忽略行首缩进，缩进漂移须由 formatDiff 拦截。
  const code = withSkillFile(
    fs
      .readFileSync(SKILL_FILE, 'utf8')
      .replace(
        '\n- 未清零（转第 R+1 轮评审棒）：\n@CodeBuddy 接力 NPC_TEAM skill，执行第 R+1 轮评审',
        '\n  - 未清零：\n@CodeBuddy 接力 NPC_TEAM skill，执行第 R+1 轮评审'
      ),
    () => {
      const { spawnSync } = require('child_process');
      return spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status;
    }
  );
  assertEqual(code, 1, 'SKILL 缩进漂移应拦截（exit 1）');
});

test('负向：sync --check 对 SKILL 缩进漂移应拦截（exit 1）', function () {
  // 第 10 轮评审 W2 新增：sync --check 须与 validate 口径一致，缩进漂移也拦截。
  const code = withSkillFile(
    fs
      .readFileSync(SKILL_FILE, 'utf8')
      .replace(
        '\n- 未清零（转第 R+1 轮评审棒）：\n@CodeBuddy 接力 NPC_TEAM skill，执行第 R+1 轮评审',
        '\n  - 未清零：\n@CodeBuddy 接力 NPC_TEAM skill，执行第 R+1 轮评审'
      ),
    () => {
      const { spawnSync } = require('child_process');
      return spawnSync(
        'node',
        [path.join(__dirname, '..', 'scripts', 'sync-npc-team-skill.js'), '--check'],
        {
          encoding: 'utf8',
        }
      ).status;
    }
  );
  assertEqual(code, 1, 'sync --check 缩进漂移应拦截（exit 1）');
});

test('正向：sync 非 check 模式自动修正 SKILL 缩进漂移', function () {
  // 第 10 轮评审 W2 新增：非 check 模式须感知缩进差异并重写修正（此前 normalize 假通过不重写）。
  const drifted = fs
    .readFileSync(SKILL_FILE, 'utf8')
    .replace(
      '\n- 未清零（转第 R+1 轮评审棒）：\n@CodeBuddy 接力 NPC_TEAM skill，执行第 R+1 轮评审',
      '\n  - 未清零：\n@CodeBuddy 接力 NPC_TEAM skill，执行第 R+1 轮评审'
    );
  const code = withSkillFile(drifted, () => {
    const { spawnSync } = require('child_process');
    return spawnSync('node', [path.join(__dirname, '..', 'scripts', 'sync-npc-team-skill.js')], {
      encoding: 'utf8',
    }).status;
  });
  assertEqual(code, 0, 'sync 自动修正应 exit 0');
  // 修正后 SKILL 应与 docs 无格式差异（formatDiff 通过）
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assertEqual(r.status, 0, '修正后 validate 应 exit 0');
});

test('负向：删【流水线】段 0/12 与 1/12 节点字面量应拦截（exit 1）', function () {
  // CR 第 11 轮（追加 9 轮循环 R1）新增：原 includes 子串校验命中 10/12 的 0/12、11/12 的 1/12
  // 子串，删 0/12/1/12 节点仍 exit 0；改【流水线】段内全序校验后必须拦截。
  const { code, output } = runValidateCapture(p => {
    const secStart = p.indexOf('【流水线（12 阶段 + 3 暂停点');
    const secEnd = p.indexOf('【任务书', secStart);
    const head = p.slice(0, secStart);
    const section = p
      .slice(secStart, secEnd)
      .replace('0/12 需求接收+PO澄清 → ', '')
      .replace('1/12 拆解分派(PM) → ', '');
    return head + section + p.slice(secEnd);
  });
  assertEqual(code, 1, '删 0/12、1/12 节点应拦截（exit 1）');
  assertTrue(
    /阶段编号 0\/12 缺失|阶段编号 1\/12 缺失/.test(output),
    '应命中【流水线】段阶段完整性校验，实际输出：' + output
  );
});

test('负向：改【流水线】段 5/12 字面量为 5 应拦截（exit 1）', function () {
  // CR 第 11 轮（追加 9 轮循环 R1）新增：改 5/12 → 5 字面量（保留 10/12/11/12）后仍应拦截。
  const { code, output } = runValidateCapture(p => {
    const secStart = p.indexOf('【流水线（12 阶段 + 3 暂停点');
    const secEnd = p.indexOf('【任务书', secStart);
    const head = p.slice(0, secStart);
    const section = p.slice(secStart, secEnd).replace('5/12 评审(', '5 评审(');
    return head + section + p.slice(secEnd);
  });
  assertEqual(code, 1, '改 5/12 → 5 应拦截（exit 1）');
  assertTrue(
    /阶段编号 5\/12 缺失/.test(output),
    '应命中【流水线】段阶段完整性校验，实际输出：' + output
  );
});

test('负向：复评接力卡已清零分支缺失「至少 10 轮」应拦截（exit 1）', function () {
  // CR 第 21 轮（追加 12 轮循环 R2）新增：复评卡已清零分支须重申「至少 10 轮」下限，
  // 改成「已清零（转 6/12 测试，独立召唤）」应拦截（防第 1 轮清零即放行）。
  const { code, output } = runValidateCapture(p =>
    p.replace(
      '- 已清零（**且已达至少 10 轮**，转 6/12 测试，独立召唤）：',
      '- 已清零（转 6/12 测试，独立召唤）：'
    )
  );
  assertEqual(code, 1, '复评卡已清零分支缺 10 轮下限应拦截（exit 1）');
  assertTrue(
    /复评接力卡缺少完整句式「已清零/.test(output),
    '应命中复评卡段内句式校验，实际输出：' + output
  );
});

test('负向：冒烟测试方法 C 残留旧口径 R+1/12 应拦截（exit 1）', function () {
  // CR 第 12 轮（追加 9 轮循环 R2）新增：方法 C 未同步新计轮口径（残留 R+1/12）时须由 9.7 ⑥ 拦截。
  const { code, output } = runValidateCaptureFull(p =>
    p.replace(
      '**复评结论未清零 → 转第 R+1 轮评审继续循环；已清零（且已达至少 10 轮）→ 独立召唤 6/12 测试（复评棒停下，等待用户召唤下一棒）**',
      '**复评结论未清零 → 转第 R+1/12 轮评审继续循环；已清零 → 转 6/12 测试**'
    )
  );
  assertEqual(code, 1, '方法 C 残留旧口径应拦截（exit 1）');
  assertTrue(
    /冒烟测试方法 C 未同步新计轮口径/.test(output),
    '应命中 9.7 ⑥ 冒烟测试方法 C 校验，实际输出：' + output
  );
});

test('负向：冒烟测试方法 C 已清零分支缺失「至少 10 轮」应拦截（exit 1）', function () {
  // CR 第 21 轮（追加 12 轮循环 R2）新增：方法 C 已清零分支须重申「至少 10 轮」下限，
  // 改成「已清零 → 独立召唤 6/12 测试」应拦截（防复评棒提前放行进 6/12）。
  const { code, output } = runValidateCaptureFull(p =>
    p.replace(
      '**复评结论未清零 → 转第 R+1 轮评审继续循环；已清零（且已达至少 10 轮）→ 独立召唤 6/12 测试（复评棒停下，等待用户召唤下一棒）**',
      '**复评结论未清零 → 转第 R+1 轮评审继续循环；已清零 → 独立召唤 6/12 测试（复评棒停下，等待用户召唤下一棒）**'
    )
  );
  assertEqual(code, 1, '方法 C 已清零分支缺 10 轮下限应拦截（exit 1）');
  assertTrue(
    /冒烟测试方法 C 未同步新计轮口径/.test(output),
    '应命中 9.7 ⑥ 冒烟测试方法 C 校验，实际输出：' + output
  );
});

test('负向：复评卡已清零分支加回「简单可缩」后缀应拦截（CR 第 28 轮回归）', function () {
  // CR 第 28 轮（删除简单可缩）新增：复评卡已清零分支硬性要求完整句
  // 「已清零（**且已达至少 10 轮**，转 6/12 测试，独立召唤）」——加回「（简单改动可缩）」后缀
  // 违反「至少 10 轮无条件硬性下限」，RELAY_REREVIEW_CORE 完整句匹配失配 → 拦截。
  const { code, output } = runValidateCapture(p =>
    p.replace(
      '- 已清零（**且已达至少 10 轮**，转 6/12 测试，独立召唤）：',
      '- 已清零（**且已达至少 10 轮（简单改动可缩）**，转 6/12 测试，独立召唤）：'
    )
  );
  assertEqual(code, 1, '复评卡加回简单可缩后缀应拦截（exit 1）');
  assertTrue(
    /复评接力卡缺少完整句式「已清零/.test(output),
    '应命中复评卡段内句式校验，实际输出：' + output
  );
});

test('负向：评审卡已累计轮次行加回「简单可缩」后缀应拦截（CR 第 28 轮回归）', function () {
  // CR 第 28 轮（删除简单可缩）新增：三卡「已累计轮次」只允许完整句式
  // 「第 R 轮（未清零则继续；清零且已达至少 10 轮则进下一阶段）」——加回「；简单改动按铁律 8 可缩」
  // 后缀违反「至少 10 轮无条件硬性下限」，段内完整句校验失配 → 拦截。
  const { code, output } = runValidateCapture(p => {
    const sectionStart = p.indexOf('【评审接力卡（5/12 评审每轮评审结束时输出）】');
    const sectionEnd = p.indexOf('【修复接力卡（5/12 评审每轮修复结束时输出）】');
    const head = p.slice(0, sectionStart);
    const section = p
      .slice(sectionStart, sectionEnd)
      .replace(
        '- 已累计轮次：第 R 轮（未清零则继续；清零且已达至少 10 轮则进下一阶段）',
        '- 已累计轮次：第 R 轮（未清零则继续；清零且已达至少 10 轮则进下一阶段；简单改动按铁律 8 可缩）'
      );
    const tail = p.slice(sectionEnd);
    return head + section + tail;
  });
  assertEqual(code, 1, '评审卡加回简单可缩后缀应拦截（exit 1）');
  assertTrue(
    /评审接力卡缺少「已累计轮次」/.test(output),
    '应命中评审卡已累计轮次段内校验，实际输出：' + output
  );
});

test('负向：冒烟测试方法 C 已清零分支加回「简单可缩」后缀应拦截（CR 第 28 轮回归）', function () {
  // CR 第 28 轮（删除简单可缩）新增：方法 C 已清零分支硬性要求完整句
  // 「已清零（且已达至少 10 轮）→ 独立召唤 6/12 测试」——加回「（简单改动可缩）」后缀
  // 违反「至少 10 轮无条件硬性下限」，9.7 ⑥ 完整句校验失配 → 拦截。
  const { code, output } = runValidateCaptureFull(p =>
    p.replace(
      '**复评结论未清零 → 转第 R+1 轮评审继续循环；已清零（且已达至少 10 轮）→ 独立召唤 6/12 测试（复评棒停下，等待用户召唤下一棒）**',
      '**复评结论未清零 → 转第 R+1 轮评审继续循环；已清零（且已达至少 10 轮（简单改动可缩））→ 独立召唤 6/12 测试（复评棒停下，等待用户召唤下一棒）**'
    )
  );
  assertEqual(code, 1, '方法 C 加回简单可缩后缀应拦截（exit 1）');
  assertTrue(
    /冒烟测试方法 C 未同步新计轮口径/.test(output),
    '应命中 9.7 ⑥ 冒烟测试方法 C 校验，实际输出：' + output
  );
});

test('负向：删【暂停·CP2 开发确认】模板应拦截（exit 1）', function () {
  // CR 第 13 轮（追加 9 轮循环 R3）新增：全程模式第二个强制暂停点须有输出模板，删模板须拦截。
  const code = runValidate(p =>
    p.replace('【暂停·CP2 开发确认】\n已完成：0/12→4/12 开发（PR 已建）\n', '')
  );
  assertEqual(code, 1, '删 CP2 暂停模板应拦截（exit 1）');
});

test('负向：冒烟测试方法 E 删全程模式边界约束应拦截（exit 1）', function () {
  // CR 第 13 轮（追加 9 轮循环 R3）新增：方法 E 声明全程模式暂停确认仍生效，删约束须拦截。
  const { code, output } = runValidateCaptureFull(p =>
    p.replace(
      '**方法 E（全程模式回退验证）**：明确说「一次跑完全部步骤」→ 预期：单次会话跑完，但 ⏸CP1/⏸CP2/⏸CP3 暂停确认与留痕门禁仍生效。',
      '**方法 E（全程模式回退验证）**：明确说「一次跑完全部步骤」→ 预期：单次会话跑完，暂停确认失效。'
    )
  );
  assertEqual(code, 1, '方法 E 删边界约束应拦截（exit 1）');
  assertTrue(
    /冒烟测试方法 E 缺少全程模式边界约束/.test(output),
    '应命中 9.7 ⑦ 方法 E 校验，实际输出：' + output
  );
});

test('负向：冒烟测试方法 C 删独立召唤句应拦截（exit 1）', function () {
  // CR 第 25 轮（本轮 5 轮循环 R3/W1）新增：方法 C 除计轮口径外还须保留
  // 「每轮评审/修复/复评各为独立一次 @CodeBuddy 召唤，禁止一次召唤内连跑多轮」——
  // 删除/改写后此前实测 exit 0 漏检（铁律 8 与 CR 卡段同句不覆盖冒烟测试段）。
  const { code, output } = runValidateCaptureFull(p =>
    p.replace(
      '**每轮评审/修复/复评各为独立一次 @CodeBuddy 召唤，禁止一次召唤内连跑多轮**',
      '**评审-修复循环可连续执行**'
    )
  );
  assertEqual(code, 1, '方法 C 删独立召唤句应拦截（exit 1）');
  assertTrue(
    /冒烟测试方法 C 未同步新计轮口径/.test(output),
    '应命中 9.7 ⑥ 方法 C 校验，实际输出：' + output
  );
});

test('负向：冒烟测试方法 D 删「未获用户回复绝不执行 8/12 合并」应拦截（exit 1）', function () {
  // CR 第 25 轮（本轮 5 轮循环 R3/W2）新增：方法 D 是 ⏸CP3 合并确认接力验收标准，
  // 删「未获用户回复绝不执行 8/12 合并」（铁律 13 冒烟层落点）此前实测 exit 0 漏检。
  const { code, output } = runValidateCaptureFull(p =>
    p.replace(
      '**未获用户回复「确认合并/继续」绝不执行 8/12 合并**；',
      '**用户确认后可自动执行 8/12 合并**；'
    )
  );
  assertEqual(code, 1, '方法 D 删合并前确认约束应拦截（exit 1）');
  assertTrue(
    /冒烟测试方法 D 缺少合并确认接力语义/.test(output),
    '应命中 9.7 ⑧ 方法 D 校验，实际输出：' + output
  );
});

test('负向：冒烟测试方法 D 删「真实 merge-pull 并留痕」应拦截（exit 1）', function () {
  // CR 第 27 轮（本轮 5 轮循环 R4/W1）新增：方法 D 除确认前暂停外，还须含「真实 merge-pull 并留痕」——
  // 删「真实」/删「8/12 棒真实 merge-pull 并留痕合并结果」整句此前实测 exit 0 漏检（防假装合并）。
  const { code, output } = runValidateCaptureFull(p =>
    p.replace(
      '用户确认后，把合并召唤话术发给下一次召唤 → 8/12 棒真实 merge-pull 并留痕合并结果。',
      '用户确认后，把合并召唤话术发给下一次召唤。'
    )
  );
  assertEqual(code, 1, '方法 D 删真实合并留痕语义应拦截（exit 1）');
  assertTrue(
    /冒烟测试方法 D 缺少合并确认接力语义/.test(output),
    '应命中 9.7 ⑧ 方法 D 校验，实际输出：' + output
  );
});

test('负向：冒烟测试方法 C 删「复评棒停下，等待用户召唤下一棒」应拦截（exit 1）', function () {
  // CR 第 27 轮（本轮 5 轮循环 R4/W2）新增：方法 C 还须含「（复评棒停下，等待用户召唤下一棒）」——
  // 铁律 11「接力只执行一步」冒烟层落点，删后此前实测 exit 0 漏检（已清零分支缺停棒声明）。
  const { code, output } = runValidateCaptureFull(p =>
    p.replace(
      '（复评棒停下，等待用户召唤下一棒）',
      ''
    )
  );
  assertEqual(code, 1, '方法 C 删停棒声明应拦截（exit 1）');
  assertTrue(
    /冒烟测试方法 C 未同步新计轮口径/.test(output),
    '应命中 9.7 ⑥ 方法 C 校验，实际输出：' + output
  );
});

test('负向：暂停确认引导语未区分 CP3 输出应拦截（exit 1）', function () {
  // CR 第 14 轮（追加 9 轮循环 R4）新增：引导语把 CP3 也归为暂停卡时须拦截（CP3 应输出合并确认卡）。
  const code = runValidate(p =>
    p.replace(
      '【暂停确认】到 ⏸CP1/⏸CP2 时输出暂停卡并停下；到 ⏸CP3 时输出【合并确认卡】（见下）并停下',
      '【暂停确认】到 ⏸CP1/⏸CP2/⏸CP3 时输出暂停卡并停下'
    )
  );
  assertEqual(code, 1, '引导语未区分 CP3 应拦截（exit 1）');
});

test('负向：删【暂停·CP2 开发确认】模板命令三选一应拦截（exit 1）', function () {
  // CR 第 14 轮（追加 9 轮循环 R4）新增：CP2 模板命令三选一不完整须拦截（防模板与暂停确认表漂移）。
  const code = runValidate(p =>
    p.replace('「继续」→ 确认实现方向正确，继续流水线', '「继续」→ 继续流水线')
  );
  assertEqual(code, 1, 'CP2 模板命令三选一不完整应拦截（exit 1）');
});

test('负向：接力卡段首引导语残留旧口径（CP3 也归暂停卡）应拦截（exit 1）', function () {
  // CR 第 16 轮（追加 9 轮循环 R6）新增：全程模式不输出接力卡、CP3 输出合并确认卡的引导语契约，
  // 残留旧口径「⏸CP1/⏸CP2/⏸CP3 暂停卡」时须拦截。
  const code = runValidate(p =>
    p.replace(
      '> 仅接力模式需输出；全程模式（用户明确要求一次跑完）不输出接力卡，改为 ⏸CP1/⏸CP2 暂停卡 + ⏸CP3【合并确认卡】。',
      '> 仅接力模式需输出；全程模式（用户明确要求一次跑完）不输出接力卡，改为 ⏸CP1/⏸CP2/⏸CP3 暂停卡。'
    )
  );
  assertEqual(code, 1, '接力卡引导语残留旧口径应拦截（exit 1）');
});

test('负向：删接力卡段首引导语应拦截（exit 1）', function () {
  // CR 第 16 轮（追加 9 轮循环 R6）新增：引导语整体删除须拦截（防全程/接力输出契约丢失）。
  const code = runValidate(p =>
    p.replace('> 仅接力模式需输出；全程模式（用户明确要求一次跑完）不输出接力卡，改为 ⏸CP1/⏸CP2 暂停卡 + ⏸CP3【合并确认卡】。\n', '')
  );
  assertEqual(code, 1, '删接力卡引导语应拦截（exit 1）');
});

test('负向：删运行模式判断全程模式分支应拦截（exit 1）', function () {
  // CR 第 17 轮（追加 9 轮循环 R7）新增：判断逻辑缺全程模式触发分支须拦截（防全程模式不可达）。
  const code = runValidate(p =>
    p.replace(
      '判断：① 若用户**明确要求**「一次跑完全部步骤/一次跑完」→ 全程模式（保留 ⏸CP1/⏸CP2/⏸CP3 暂停确认）；② 若消息带上一棒【接力卡】/任务书 → 接力模式续棒；③ 若为新需求 → 默认接力模式。',
      '判断：若消息带上一棒【接力卡】/任务书 → 接力模式续棒；若为新需求 → 默认接力模式。'
    )
  );
  assertEqual(code, 1, '删全程模式分支应拦截（exit 1）');
});

test('负向：删运行模式判断接力续棒分支应拦截（exit 1）', function () {
  // CR 第 17 轮（追加 9 轮循环 R7）新增：判断逻辑缺接力续棒分支须拦截（防接力模式续棒契约丢失）。
  const code = runValidate(p =>
    p.replace('② 若消息带上一棒【接力卡】/任务书 → 接力模式续棒；', '')
  );
  assertEqual(code, 1, '删接力续棒分支应拦截（exit 1）');
});

test('负向：删合并确认卡 8/12→9/12 接力衔接应拦截（exit 1）', function () {
  // CR 第 18 轮（追加 9 轮循环 R8）新增：合并棒完成后如何进入 9/12 发布（独立发布棒召唤）链路
  // 被删时须拦截（防接力模式下合并后无法规范进入发布阶段）。
  const code = runValidate(p =>
    p.replace(
      '> 🔗 8/12 合并棒完成后：输出【接力卡·8/12】（本步产物：合并记录位置），下一步 9/12 发布，召唤话术：\n> @CodeBuddy 接力 NPC_TEAM skill，执行 9/12 发布：\n> 任务书：<...>\n> 合并记录见：<位置>\n> （9/12 发布棒由 DEV 执行四要素：版本号/CHANGELOG/发布产物/Release Notes，铁律 14）\n',
      ''
    )
  );
  assertEqual(code, 1, '删 8/12→9/12 接力衔接应拦截（exit 1）');
});

test('负向：删 9/12 发布召唤话术应拦截（exit 1）', function () {
  // CR 第 18 轮（追加 9 轮循环 R8）新增：9/12 发布独立召唤话术被删须拦截。
  const code = runValidate(p =>
    p.replace(
      '@CodeBuddy 接力 NPC_TEAM skill，执行 9/12 发布：',
      '@CodeBuddy 继续执行发布：'
    )
  );
  assertEqual(code, 1, '删 9/12 发布召唤话术应拦截（exit 1）');
});

test('负向：删评审接力卡已累计轮次 10 轮下限句应拦截（exit 1）', function () {
  // CR 第 22 轮（追加 12 轮循环 R3）新增：三张接力卡「已累计轮次」口径一致化后，
  // 评审接力卡（第 1 棒）的「清零且已达至少 10 轮则进下一阶段」被删须拦截——
  // 前两棒缺少循环结束条件提示会让 CodeBuddy 对何时结束评审循环预期不完整。
  const { code, output } = runValidateCapture(p => {
    const sectionStart = p.indexOf('【评审接力卡（5/12 评审每轮评审结束时输出）】');
    const sectionEnd = p.indexOf('【修复接力卡（5/12 评审每轮修复结束时输出）】');
    const head = p.slice(0, sectionStart);
    const section = p
      .slice(sectionStart, sectionEnd)
      .replace(
        '- 已累计轮次：第 R 轮（未清零则继续；清零且已达至少 10 轮则进下一阶段）',
        '- 已累计轮次：第 R 轮（未清零则继续）'
      );
    const tail = p.slice(sectionEnd);
    return head + section + tail;
  });
  assertEqual(code, 1, '删评审卡已累计轮次 10 轮下限应拦截（exit 1）');
  assertTrue(
    /评审接力卡缺少「已累计轮次」10 轮下限句/.test(output),
    '应命中评审接力卡段内句式校验，实际输出：' + output
  );
});

test('负向：删任务书用户命令记录 CP3 确认合并说明应拦截（exit 1）', function () {
  // CR 第 19 轮（追加 9 轮循环 R9）新增：任务书字段遗漏 CP3 确认合并命令说明须拦截。
  const code = runValidate(p =>
    p.replace(
      '用户命令记录（继续/补充/停止，CP3 含确认合并）',
      '用户命令记录（继续/补充/停止）'
    )
  );
  assertEqual(code, 1, '删任务书 CP3 确认合并说明应拦截（exit 1）');
});

// ---- CR 第 20 轮修复（追加 12 轮循环 R1）回归用例 ----
// 背景：① runValidateCaptureFull 的 SKILL.md 还原条件 fs.existsSync(SKILL_FILE + '.tmp') 永远不成立
// （sync 脚本直接 writeFileSync，不产生 .tmp），变异提示词被永久写入 SKILL.md（实测 diff 45 字符），
// 污染工作区且会被 git 提交带上；② 阶段完整性校验的边界进入条件（stageIdRe(0)||stageIdRe(11)）在
// 0/12 与 11/12 同时被删时走 else 只发 warning，12 阶段流水线删掉首尾仍放行。

test('负向：删流水线 0/12 与 11/12 边界节点应拦截（exit 1）', function () {
  const { code, output } = runValidateCapture(p =>
    p
      .replace(
        '0/12 需求接收+PO澄清 → ',
        '需求接收+PO澄清 → '
      )
      .replace(' → 11/12 复盘(全员)', ' → 复盘(全员)')
  );
  assertEqual(code, 1, '删 0/12 与 11/12 应拦截（exit 1）');
  assertTrue(
    /阶段编号 0\/12 缺失/.test(output),
    '应命中阶段完整性校验（而非双源一致性假阳性），实际输出：' + output
  );
});

test('负向：runValidateCaptureFull 不污染 SKILL.md（工作区还原回归）', function () {
  const before = fs.readFileSync(SKILL_FILE, 'utf8');
  // 使用会触发 sync 改写提示词的 Full 变体（删 PM 卡合并职责）
  const { code } = runValidateCaptureFull(content =>
    content.replace(
      '主持 ⏸CP3 合并确认、执行 8/12 PR 合并（merge-pull，留痕合并结果）。',
      ''
    )
  );
  const after = fs.readFileSync(SKILL_FILE, 'utf8');
  assertEqual(code, 1, '删 PM 合并职责应拦截（exit 1）');
  assertEqual(after, before, '测试后 SKILL.md 必须与测试前完全一致（不得被变异提示词污染）');
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
