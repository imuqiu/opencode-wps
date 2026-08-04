/**
 * MacPollServer 轮询服务器单元测试
 *
 * 重点覆盖：
 * - getRequiredApp 动态映射（openFile/saveAs 按扩展名推断应用）
 * - 通用动作不切应用（ping/save/getSelectedText 等返回空映射）
 * - COMMAND_APP_MAP 键与 handler 无实现键清理（回归防护）
 */

import MacPollServer from '../../client/mac-poll-server';

describe('MacPollServer.getRequiredApp', () => {
  const server = new MacPollServer('/fake/path/wps-auto.sh');

  it('openFile 按 .xls 扩展名推断 excel', () => {
    expect(server['getRequiredApp']('openFile', { path: '/home/u/data.xlsx' })).toBe('excel');
  });

  it('openFile 按 .doc 扩展名推断 word', () => {
    expect(server['getRequiredApp']('openFile', { filePath: '/home/u/report.docx' })).toBe('word');
  });

  it('openFile 按 .ppt 扩展名推断 ppt', () => {
    expect(server['getRequiredApp']('openFile', { path: '/home/u/deck.pptx' })).toBe('ppt');
  });

  it('saveAs 按扩展名推断应用', () => {
    expect(server['getRequiredApp']('saveAs', { path: '/home/u/sheet.xls' })).toBe('excel');
  });

  it('openFile 无路径参数时不切应用（返回空）', () => {
    expect(server['getRequiredApp']('openFile', {})).toBe('');
  });

  it('通用动作 ping/save/getSelectedText 不切应用', () => {
    expect(server['getRequiredApp']('ping', {})).toBe('');
    expect(server['getRequiredApp']('save', {})).toBe('');
    expect(server['getRequiredApp']('getSelectedText', {})).toBe('');
  });

  it('普通命令查映射表（getCellValue → excel）', () => {
    expect(server['getRequiredApp']('getCellValue', {})).toBe('excel');
  });

  it('未知动作返回空', () => {
    expect(server['getRequiredApp']('nonexistentAction', {})).toBe('');
  });
});
