# Skills 目录说明

## 目录结构

```
skills/           ← 源文件（此目录，被 git 跟踪）
    wps-excel/           # Excel 数据处理技能
    wps-word/            # Word 文档操作技能
    wps-ppt/             # PPT 演示文稿技能
    wps-office/          # WPS 通用技能
    wps-proofread/       # 文档校对技能（P1-P16 严格逐批校验）

↓ 安装后复制到 ↓

~/.opencode/skills/   ← OpenCode 实际加载的位置（不被 git 跟踪）
```

## 单一来源 docs 派生（wps-proofread）

`wps-proofread/SKILL.md` 以相对路径 `docs/xxx.md` 引用设计文档（如 `docs/batch-state-machine.md`）。
这些文档的**唯一事实源是根目录 `docs/`**，skill 源目录内**不带** docs/ 副本；安装期由
`install-addons*.js` 调用 `scripts/lib/derive-skill-docs.js`，从根 `docs/` 把 SKILL.md 引用的
同名文件派生进 `~/.opencode/skills/wps-proofread/docs/`（方案 C 单一来源，git 层不保留双份）。

- 改设计文档：改根 `docs/` 下的对应文件即可，安装时会自动带上
- 校验引用不落空：`node scripts/validate-skill-docs.js`（并入 `npm run validate:skill-docs` / preflight）

## 修改流程（重要！）

1. **只修改此目录**（`skills/`）中的文件
2. **不要直接修改** `~/.opencode/skills/` 中的文件
3. 修改后运行：`node install-addons.js` 同步到用户目录
4. 提交到 git：`git add skills/ && git commit -m "..."`

## AI 编程助手注意事项

如果你是一个 AI 助手，正在帮助修改 skills：
- ✅ 修改 `D:\code\opencode-wps\skills\` 下的文件
- ✅ 修改后提醒用户运行 `node install-addons.js`
- ✅ 修改后提交到 git
- ❌ 不要直接修改 `~/.opencode/skills\` 下的文件
- ❌ 不要只改不提交

## 验证同步状态

> ⚠️ 因 wps-proofread 的 docs 为安装期派生，安装目录 `~/.opencode/skills/wps-proofread/docs/`
> 会比 git 源 `skills/wps-proofread/` 多出派生的 docs/ 子目录——这是**预期**，非漂移。

```bash
# 对比源文件和安装后的文件（排除安装期派生的 docs/ 子目录）
diff -r --exclude=docs skills/ ~/.opencode/skills/
# 校验派生 docs 是否都能命中根 docs/ 单一来源
node scripts/validate-skill-docs.js
```
