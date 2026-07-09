import { describe, expect, test } from 'vitest';
import { fileDialogCommand, folderDialogCommand, runDialog } from '../../server/dialogs';

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

describe('fileDialogCommand image kind', () => {
  test('macOS image picker restricts to images', () => {
    const c = fileDialogCommand('darwin', 'image');
    expect(c.args.join(' ')).toContain('public.image');
    expect(c.args.join(' ')).toContain('background image');
  });
  test('Windows image picker filters image extensions', () => {
    const c = fileDialogCommand('win32', 'image');
    expect(c.args.join(' ')).toContain('*.png');
  });
  test('defaults to the video picker', () => {
    const c = fileDialogCommand('darwin');
    expect(c.args.join(' ')).toContain('video');
  });
});

describe('runDialog', () => {
  test('resolves trimmed stdout on success', async () => {
    await expect(
      runDialog({ cmd: 'sh', args: ['-c', 'echo /tmp/some path.mp4'] }),
    ).resolves.toBe('/tmp/some path.mp4');
  });

  test('resolves null on empty stdout with exit 0', async () => {
    await expect(runDialog({ cmd: 'sh', args: ['-c', 'true'] })).resolves.toBeNull();
  });

  test('resolves null on cancel-style failure', async () => {
    await expect(
      runDialog({
        cmd: 'sh',
        args: ['-c', 'echo "execution error: User canceled. (-128)" >&2; exit 1'],
      }),
    ).resolves.toBeNull();
  });

  test('rejects on genuine failure with stderr in the message', async () => {
    await expect(
      runDialog({ cmd: 'sh', args: ['-c', 'echo boom >&2; exit 2'] }),
    ).rejects.toThrow(/boom/);
  });

  test('rejects on missing binary', async () => {
    await expect(
      runDialog({ cmd: 'definitely-not-a-real-binary-xyz', args: [] }),
    ).rejects.toThrow();
  });
});
