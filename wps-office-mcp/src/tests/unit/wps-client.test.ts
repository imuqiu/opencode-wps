/**
 * WPS客户端单元测试
 *
 * 测试Windows PowerShell和Mac轮询两种模式的调用逻辑
 */

// Mock mac-poll-server - 直接在工厂函数内定义，避免 hoisting 问题
jest.mock('../../client/mac-poll-server', () => ({
  macPollServer: {
    isRunning: false,
    start: jest.fn().mockResolvedValue(undefined),
    executeCommand: jest.fn(),
  },
}));

jest.mock('os', () => ({
  platform: jest.fn(() => 'win32'),
}));

// 简单 mock child_process，不使用工厂函数
jest.mock('child_process');

jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  logRequest: jest.fn(),
  logResponse: jest.fn(),
}));

jest.mock('../../utils/error', () => ({
  WpsConnectionError: class WpsConnectionError extends Error {
    constructor(
      message: string,
      public details?: unknown
    ) {
      super(message);
      this.name = 'WpsConnectionError';
    }
  },
  WpsApiError: class WpsApiError extends Error {
    constructor(
      message: string,
      public details?: unknown
    ) {
      super(message);
      this.name = 'WpsApiError';
    }
  },
  TimeoutError: class TimeoutError extends Error {
    constructor(operation: string, timeout: number) {
      super(`Operation '${operation}' timed out after ${timeout}ms`);
      this.name = 'TimeoutError';
    }
  },
  errorUtils: {
    wrap: jest.fn((error: unknown, message: string) => {
      const err = error instanceof Error ? error : new Error(String(error));
      err.message = `${message}: ${err.message}`;
      return err;
    }),
  },
}));

import { WpsClient } from '../../client/wps-client';
import { WpsAppType, WpsApiRequest } from '../../types/wps';
import * as os from 'os';
import * as child_process from 'child_process';

// 导入被 mock 的模块以操控它
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockMacModule = require('../../client/mac-poll-server');

// 获取 mock 函数 - 使用类型断言
const mockedOs = os as jest.Mocked<typeof os>;
const mockedSpawn = child_process.spawn as jest.Mock;

function mockPsProcess(stdoutData: string, exitCode: number = 0, stderrData: string = '') {
  // 修复：spawnPowerShell 的调用顺序是「先 spawn() 返回进程，再注册 stdout/stderr/close 事件」
  // 旧实现在 spawn() 同步调用时检查 handlers，此时事件监听器尚未注册，导致事件永不触发、测试超时。
  // 新实现：在 mock 进程的 on() 注册回调时，用微任务异步触发对应事件（若有数据），
  // 与真实 child_process 的事件时序一致，Promise 能正常 resolve。
  mockedSpawn.mockImplementation(() => {
    const procHandlers: Record<string, (code?: number) => void> = {};
    const stdoutHandlers: Record<string, (data: Buffer) => void> = {};
    const stderrHandlers: Record<string, (data: Buffer) => void> = {};

    const mockProcess = {
      pid: 12345,
      kill: jest.fn(),
      stdout: {
        on: jest.fn((event: string, cb: (data: Buffer) => void) => {
          stdoutHandlers[event] = cb;
          if (event === 'data' && stdoutData) {
            queueMicrotask(() => cb(Buffer.from(stdoutData)));
          }
        }),
      },
      stderr: {
        on: jest.fn((event: string, cb: (data: Buffer) => void) => {
          stderrHandlers[event] = cb;
          if (event === 'data' && stderrData) {
            queueMicrotask(() => cb(Buffer.from(stderrData)));
          }
        }),
      },
      on: jest.fn((event: string, cb: (code?: number) => void) => {
        procHandlers[event] = cb;
        if (event === 'close' && exitCode !== undefined) {
          queueMicrotask(() => cb(exitCode));
        }
        if (event === 'error') {
          // error 事件由需要模拟进程启动失败的用例通过专门函数覆盖
          procHandlers[event] = cb;
        }
      }),
    };

    return mockProcess;
  });
}

describe('WpsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedOs.platform.mockReturnValue('win32');
    mockMacModule.macPollServer.isRunning = false;
    mockMacModule.macPollServer.executeCommand.mockReset();
  });

  describe('构造函数', () => {
    it('应该使用默认配置创建客户端', () => {
      const client = new WpsClient();
      expect(client).toBeDefined();
    });

    it('应该接受自定义配置', () => {
      const customConfig = { baseUrl: 'http://custom:8080', timeout: 5000 };
      const client = new WpsClient(customConfig);
      expect(client).toBeDefined();
    });

    it('Mac平台应该记录正确的方法', () => {
      mockedOs.platform.mockReturnValue('darwin');
      const client = new WpsClient();
      expect(client).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('应该返回当前状态的副本', () => {
      const client = new WpsClient();
      const status = client.getStatus();
      expect(status).toHaveProperty('connected');
      expect(status.connected).toBe(false);
    });
  });

  describe('checkConnection', () => {
    it('连接成功时应该返回true', async () => {
      mockPsProcess(JSON.stringify({ success: true }), 0);
      const client = new WpsClient();
      const result = await client.checkConnection();
      expect(result).toBe(true);
    });

    it('连接失败时应该返回false', async () => {
      mockPsProcess('Connection refused', 1);
      const client = new WpsClient();
      const result = await client.checkConnection();
      expect(result).toBe(false);
    });
  });

  describe('表格操作（Windows模式）', () => {
    it('getCellValue应该返回单元格值', async () => {
      mockPsProcess(JSON.stringify({ success: true, data: { value: 42 } }), 0);
      const client = new WpsClient();
      const result = await client.getCellValue('Sheet1', 1, 1);
      expect(result).toBe(42);
    });

    it('setCellValue应该设置单元格值', async () => {
      mockPsProcess(JSON.stringify({ success: true }), 0);
      const client = new WpsClient();
      const result = await client.setCellValue('Sheet1', 1, 1, 'Test Value');
      expect(result).toBe(true);
    });

    it('getRangeData应该返回范围数据', async () => {
      const mockData = [
        [1, 2, 3],
        [4, 5, 6],
      ];
      mockPsProcess(JSON.stringify({ success: true, data: { data: mockData } }), 0);
      const client = new WpsClient();
      const result = await client.getRangeData('Sheet1', 'A1:C2');
      expect(result).toEqual(mockData);
    });

    it('setRangeData应该写入范围数据', async () => {
      mockPsProcess(JSON.stringify({ success: true }), 0);
      const client = new WpsClient();
      const result = await client.setRangeData('Sheet1', 'A1:B2', [
        ['A', 'B'],
        ['C', 'D'],
      ]);
      expect(result).toBe(true);
    });
  });

  describe('文档操作（Windows模式）', () => {
    it('getActiveDocument应该返回当前文档信息', async () => {
      const mockDoc = { name: 'test.docx', path: '/path/to', saved: true, readOnly: false };
      mockPsProcess(JSON.stringify({ success: true, data: mockDoc }), 0);
      const client = new WpsClient();
      const result = await client.getActiveDocument();
      expect(result).toEqual(mockDoc);
    });

    it('createDocument应该创建新文档', async () => {
      mockPsProcess(JSON.stringify({ success: true }), 0);
      const client = new WpsClient();
      const result = await client.createDocument();
      expect(result).toBe(true);
    });

    it('insertText应该在文档中插入文本', async () => {
      mockPsProcess(JSON.stringify({ success: true }), 0);
      const client = new WpsClient();
      const result = await client.insertText('Hello World', 100);
      expect(result).toBe(true);
    });
  });

  describe('演示操作（Windows模式）', () => {
    it('getActivePresentation应该返回演示文稿信息', async () => {
      const mockPresentation = {
        name: 'test.pptx',
        path: '/path/to',
        slideCount: 10,
        currentSlideIndex: 1,
      };
      mockPsProcess(JSON.stringify({ success: true, data: mockPresentation }), 0);
      const client = new WpsClient();
      const result = await client.getActivePresentation();
      expect(result).toEqual(mockPresentation);
    });

    it('addSlide应该添加新幻灯片', async () => {
      mockPsProcess(JSON.stringify({ success: true }), 0);
      const client = new WpsClient();
      const result = await client.addSlide('title');
      expect(result).toBe(true);
    });
  });

  describe('通用操作（Windows模式）', () => {
    it('openFile应该打开文件', async () => {
      mockPsProcess(JSON.stringify({ success: true }), 0);
      const client = new WpsClient();
      const result = await client.openFile('/path/to/file.xlsx', WpsAppType.SPREADSHEET);
      expect(result).toBe(true);
    });

    it('saveFile应该保存文件', async () => {
      mockPsProcess(JSON.stringify({ success: true }), 0);
      const client = new WpsClient();
      const result = await client.saveFile(WpsAppType.WRITER);
      expect(result).toBe(true);
    });

    it('executeMethod应该执行自定义方法', async () => {
      mockPsProcess(JSON.stringify({ success: true, data: { custom: 'result' } }), 0);
      const client = new WpsClient();
      const result = await client.executeMethod('custom.method', { arg: 1 });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ custom: 'result' });
    });
  });

  describe('callApi', () => {
    it('应该通过invokeAction调用API', async () => {
      mockPsProcess(JSON.stringify({ success: true, data: { test: 'value' } }), 0);
      const request: WpsApiRequest = { method: 'ping', params: { key: 'value' } };
      const client = new WpsClient();
      const result = await client.callApi(request);
      expect(result.success).toBe(true);
    });

    it('应该在请求失败时抛出错误', async () => {
      mockPsProcess('', 1, 'Network Error');
      const request: WpsApiRequest = { method: 'ping' };
      const client = new WpsClient();
      await expect(client.callApi(request)).rejects.toThrow();
    });
  });

  describe('Mac模式', () => {
    beforeEach(() => {
      mockedOs.platform.mockReturnValue('darwin');
      mockMacModule.macPollServer.isRunning = true;
    });

    it('Mac模式应该使用轮询模式', async () => {
      mockMacModule.macPollServer.executeCommand.mockResolvedValue({
        success: true,
        data: { value: 42 },
      });
      const client = new WpsClient();
      const result = await client.getCellValue('Sheet1', 1, 1);
      expect(mockMacModule.macPollServer.executeCommand).toHaveBeenCalledWith('getCellValue', {
        sheet: 'Sheet1',
        row: 1,
        col: 1,
      });
      expect(result).toBe(42);
    });

    it('Mac模式createDocument应该调用轮询', async () => {
      mockMacModule.macPollServer.executeCommand.mockResolvedValue({ success: true });
      const client = new WpsClient();
      const result = await client.createDocument();
      expect(mockMacModule.macPollServer.executeCommand).toHaveBeenCalledWith('createDocument', {});
      expect(result).toBe(true);
    });
  });
});
