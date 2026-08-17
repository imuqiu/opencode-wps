/**
 * Jest测试设置文件 - 老王的测试初始化
 * 在所有测试跑之前，先把环境搞好
 */

// 设置测试超时时间
jest.setTimeout(10000);

// Issue #151 QA 6/12：为每个 Jest worker 隔离校对会话存储目录，消除并行不稳定。
// 根因：Jest 并行 worker 默认共享同一 ~/.opencode-wps/proofread-sessions，且
// proofread-report.test.ts 的 beforeEach 会 `readdirSync` 后删除目录内全部文件，
// 导致并发运行的 proofread-store.test.ts（R3-2/R6-1/R7-1 等真实文件 RMW）被删除/干扰
// 而偶发陈旧读。此处为每个 worker（JEST_WORKER_ID）分配独立临时目录，测试互不干扰。
// 仅在 Jest 测试环境设置（process.env.JEST_WORKER_ID 存在），不影响生产。
if (process.env.JEST_WORKER_ID && !process.env.OPENCODE_WPS_PROOFREAD_DIR) {
  const os = require('os');
  const path = require('path');
  process.env.OPENCODE_WPS_PROOFREAD_DIR = path.join(
    os.tmpdir(),
    `opencode-wps-proofread-test-${process.env.JEST_WORKER_ID}`
  );
}

// 全局Mock console.error，不然测试日志太乱
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // 过滤掉一些不重要的错误日志
    const message = args[0];
    if (
      typeof message === 'string' &&
      (message.includes('Warning:') || message.includes('Deprecation'))
    ) {
      return;
    }
    originalConsoleError.apply(console, args);
  };
});

afterAll(() => {
  console.error = originalConsoleError;
});

// 清理环境变量
beforeEach(() => {
  // 设置测试环境
  process.env.NODE_ENV = 'test';
});

// 全局断言扩展 - 如果需要的话
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeValidToolResult(): R;
    }
  }
}

// 自定义断言：检查Tool调用结果格式
expect.extend({
  toBeValidToolResult(received: unknown) {
    const isValid =
      received !== null &&
      typeof received === 'object' &&
      'success' in received &&
      'content' in received &&
      Array.isArray((received as { content: unknown[] }).content);

    if (isValid) {
      return {
        message: () => `expected ${JSON.stringify(received)} not to be a valid tool result`,
        pass: true,
      };
    }
    return {
      message: () =>
        `expected ${JSON.stringify(received)} to be a valid tool result with success and content properties`,
      pass: false,
    };
  },
});

export {};
