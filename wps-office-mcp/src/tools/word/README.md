content.ts, document.ts, format.ts, index.ts, proofread.ts, proofread-report.ts, proofread-store.ts
Word 工具定义与处理器目录，含内容操作/文档管理/格式化/校对模块。
- proofread.ts：基础校对 + 修订模式 + 替换（#55 T1 结构化输出）
- proofread-report.ts：五维评分报告累加/生成（#55 T2 type 兜底、T3 修订数口径；
  #70 验收遗留：TC-13 source 兜底、F14 修饰不当误判修正、奇数修订口径、落盘失败语义）
- proofread-store.ts：校对会话落盘持久化存储（Issue #116：数据易失根治）
一旦这里的结构发生变化，请务必更新我。

## 校对模块（proofread.ts / proofread-report.ts）

- `proofread.ts`：基础校对规则引擎 + `proofreadBasic`（结构化输出 issues JSON，供治理插件 P15/P16 解析）
- `proofread-report.ts`：五维校对报告（accumulate 累加 + generate 报告，网关专用 GATEWAY_ONLY）

### proofread-report.ts 功能清单（#55/#70 演进）

- **T2 type 兜底**：accumulate 入口对缺 type / type='ai'（SKILL 合并 bug 产物）的 issue 调用
  `normalizeIssueType`（trim 归一化 + `inferTypeFromContent` 文本推断），避免报告五维全 10 分失真
- **TC-13 source 兜底**（#70）：accumulate 入口对缺 source 的 issue 调用 `normalizeIssueSource`——
  大小写归一（MCP/AI→小写）、F11–F15 AI 专属模式（`AI_ONLY_PATTERN`，F14 需数量词+丰富/充分
  同时出现，避免"丰富的经验"误判）→ ai、Layer 1 规则命中 → mcp、无法判断 → 保守 mcp；
  报告"未标注来源"统计不再失真
- **T3/TC-12 修订数口径**：报告明确"问题数 = 修订记录数 ÷ 2"；奇数修订（删除类修复只产生 1 条）
  显示 `≈N.N` 并提示"换算不整除、请人工核对"，不再误导性硬算
- **落盘失败语义**（#70）：generate 指定 `output_file` 时，写盘失败返回 `success=false` + 失败原因
  （含目标路径），会话保留供修正路径后重试；成功（或未指定）才回收会话。空报告/主报告两分支
  均自动创建父目录，行为一致
- **报告生成后会话释放**（评审第 3 轮 I3）：报告生成成功即 `releaseSession`（清内存+磁盘文件），
  「报告是流程终点」。如需二次生成（换路径/格式），需重新 `proofreadAccumulate` 累加后再生成
- **报告生成**：五维评分（fluency/conciseness/accuracy/consistency/completeness）原始分 [1,5]
  → 归一化 [0,2] → X.X/10 展示，含雷达图 JSON、按维度问题详情、统计摘要（MCP/AI 来源计数）

### proofread-report.ts 功能清单（Issue #116 新增）

- **必填字段校验**：accumulate 入口对缺 `original`/`suggestion`（或空串）的 issue 明确报错，
  而非静默通过——早期暴露错误（而非报告阶段因 `.replace()` 读 undefined 而崩溃）
- **报告生成器兜底**：`.replace()` 处统一改为 `(issue.original || '')`，即使历史坏数据漏过校验也不崩溃
- **落盘持久化**：accumulate 每次累加后增量写盘到 `~/.opencode-wps/proofread-sessions/{sessionId}.json`，
  报告生成优先读内存 Map、缺失时从磁盘恢复（`getSessionOrLoad`）；releaseSession / LRU 淘汰同步删除磁盘文件
- **疑似问题机制**：accumulate 支持 `suspected_issues` 参数（AI 识别但未确认的问题），
  报告单独列出「待确认问题」节并标注「未修改，请人工核对」，不纳入五维评分
