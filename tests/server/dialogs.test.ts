import { describe, expect, test } from 'vitest';
import { fileDialogCommand, folderDialogCommand } from '../../server/dialogs';

describe('fileDialogCommand', () => {
  test('macOS uses osascript choose file', () => {
    const c = fileDialogCommand('darwin');
    expect(c.cmd).toBe('osascript');
    expect(c.args.join(' ')).toContain('choose file');
    expect(c.args.join(' ')).toContain('POSIX path');
  });

  test('Windows uses PowerShell OpenFileDialog', () => {
    const c = fileDialogCommand('win32');
    expect(c.cmd).toBe('powershell');
    expect(c.args).toContain('-STA');
    expect(c.args.join(' ')).toContain('OpenFileDialog');
  });

  test('throws on unsupported platforms', () => {
    expect(() => fileDialogCommand('linux')).toThrow(/not supported/);
  });
});

describe('folderDialogCommand', () => {
  test('macOS uses osascript choose folder', () => {
    const c = folderDialogCommand('darwin');
    expect(c.cmd).toBe('osascript');
    expect(c.args.join(' ')).toContain('choose folder');
  });

  test('Windows uses PowerShell FolderBrowserDialog', () => {
    const c = folderDialogCommand('win32');
    expect(c.cmd).toBe('powershell');
    expect(c.args.join(' ')).toContain('FolderBrowserDialog');
  });

  test('throws on unsupported platforms', () => {
    expect(() => folderDialogCommand('linux')).toThrow(/not supported/);
  });
});
