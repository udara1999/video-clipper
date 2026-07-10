import { afterEach, describe, expect, test } from 'vitest';
import {
  DialogHost,
  HostTransportError,
  dialogHostCommand,
  parseHostResponse,
  type DialogCommand,
} from '../../server/dialogs';

// A stand-in for the Windows PowerShell host: same line protocol, plain sh.
const FAKE_HOST: DialogCommand = {
  cmd: 'sh',
  args: [
    '-c',
    `printf '%s\\n' READY
while IFS= read -r line; do
  case "$line" in
    'file:video') printf '%s\\n' 'OK:C:\\videos\\clip.mp4';;
    'file:image') printf '%s\\n' 'CANCEL';;
    'folder') printf '%s\\n' 'ERR:boom';;
    'die') exit 1;;
    'exit') exit 0;;
  esac
done`,
  ],
};

let hosts: DialogHost[] = [];

function makeHost(command: DialogCommand = FAKE_HOST): DialogHost {
  const host = new DialogHost(command);
  hosts.push(host);
  return host;
}

afterEach(() => {
  for (const host of hosts) host.dispose();
  hosts = [];
});

describe('parseHostResponse', () => {
  test('OK lines yield the path (colons in the path preserved)', () => {
    expect(parseHostResponse('OK:C:\\videos\\clip.mp4')).toBe('C:\\videos\\clip.mp4');
  });
  test('CANCEL yields null', () => {
    expect(parseHostResponse('CANCEL')).toBeNull();
  });
  test('ERR lines throw with the message', () => {
    expect(() => parseHostResponse('ERR:no display')).toThrow(/no display/);
  });
  test('unexpected lines throw', () => {
    expect(() => parseHostResponse('what')).toThrow(/unexpected/i);
  });
});

describe('dialogHostCommand', () => {
  test('builds a persistent STA PowerShell host on win32', () => {
    const c = dialogHostCommand('win32');
    expect(c.cmd).toBe('powershell');
    expect(c.args).toContain('-STA');
    const script = c.args.join(' ');
    expect(script).toContain('READY');
    expect(script).toContain('OpenFileDialog');
    expect(script).toContain('FolderBrowserDialog');
    expect(script).toContain('file:image');
  });
  test('throws on other platforms', () => {
    expect(() => dialogHostCommand('darwin')).toThrow(/win32/);
  });
});

describe('DialogHost', () => {
  test('round-trips a file request through a warm host', async () => {
    const host = makeHost();
    await expect(host.request('file:video')).resolves.toBe('C:\\videos\\clip.mp4');
  });

  test('resolves null on cancel', async () => {
    const host = makeHost();
    await expect(host.request('file:image')).resolves.toBeNull();
  });

  test('propagates dialog errors without a transport error', async () => {
    const host = makeHost();
    const err = await host.request('folder').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/boom/);
    expect(err).not.toBeInstanceOf(HostTransportError);
  });

  test('serializes concurrent requests', async () => {
    const host = makeHost();
    const [a, b, c] = await Promise.all([
      host.request('file:video'),
      host.request('file:image'),
      host.request('file:video'),
    ]);
    expect(a).toBe('C:\\videos\\clip.mp4');
    expect(b).toBeNull();
    expect(c).toBe('C:\\videos\\clip.mp4');
  });

  test('rejects with HostTransportError when the host dies mid-request, then respawns', async () => {
    const host = makeHost();
    const err = await host.request('die' as never).catch((e: Error) => e);
    expect(err).toBeInstanceOf(HostTransportError);
    // Next request spawns a fresh host and works.
    await expect(host.request('file:video')).resolves.toBe('C:\\videos\\clip.mp4');
  });

  test('rejects with HostTransportError when the command cannot spawn', async () => {
    const host = makeHost({ cmd: 'definitely-not-a-real-binary-xyz', args: [] });
    const err = await host.request('file:video').catch((e: Error) => e);
    expect(err).toBeInstanceOf(HostTransportError);
  });

  test('warmUp starts the host so a later request reuses it', async () => {
    const host = makeHost();
    host.warmUp();
    await expect(host.request('folder').catch((e: Error) => e.message)).resolves.toMatch(/boom/);
  });
});
