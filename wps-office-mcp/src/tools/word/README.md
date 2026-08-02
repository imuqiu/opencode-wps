content.ts, document.ts, format.ts, index.ts, proofread.ts, proofread-report.ts
Word 工具定义与处理器目录，含内容操作/文档管理/格式化/校对模块。
- proofread.ts：基础校对 + 修订模式 + 替换（#55 T1 结构化输出）
- proofread-report.ts：五维评分报告累加/生成（#55 T2 type 兜底、T3 修订数口径）
一旦这里的结构发生变化，请务必更新我。

## 校对模块（proofread.ts / proofread-report.ts）

- `proofread.ts`：基础校对规则引擎 + `proofreadBasic`（结构化输出 issues JSON，供治理插件 P15/P16 解析）
- `proofread-report.ts`：五维校对报告（accumulate 累加 + generate 报告，网关专用 GATEWAY_ONLY）
