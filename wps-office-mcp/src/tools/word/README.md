content.ts, document.ts, format.ts, index.ts, proofread.ts, proofread-report.ts
Word 工具定义与处理器目录，含内容操作/文档管理/格式化/校对模块。
一旦这里的结构发生变化，请务必更新我。

## 校对模块（proofread.ts / proofread-report.ts）

- `proofread.ts`：基础校对规则引擎 + `proofreadBasic`（结构化输出 issues JSON，供治理插件 P15/P16 解析）
- `proofread-report.ts`：五维校对报告（accumulate 累加 + generate 报告，网关专用 GATEWAY_ONLY）
