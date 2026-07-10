import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Router } from 'express';

export interface DialogCommand {
  cmd: string;
  args: string[];
}

export type DialogRequest = 'file:video' | 'file:image' | 'folder';

export function fileDialogCommand(
  platform: string,
  kind: 'video' | 'image' = 'video',
): DialogCommand {
  if (platform === 'darwin') {
    if (kind === 'image') {
      return {
        cmd: 'osascript',
        args: [
          '-e',
          'POSIX path of (choose file with prompt "Choose a background image" of type {"public.image"})',
        ],
      };
    }
    return {
      cmd: 'osascript',
      args: ['-e', 'POSIX path of (choose file with prompt "Choose a video to split")'],
    };
  }
  if (platform === 'win32') {
    const filter =
      kind === 'image'
        ? "Image files|*.png;*.jpg;*.jpeg;*.webp;*.bmp|All files|*.*"
        : "Video files|*.mp4;*.m4v;*.mov;*.mkv;*.webm;*.avi;*.wmv;*.ts;*.mts|All files|*.*";
    const title = kind === 'image' ? 'Choose a background image' : 'Choose a video to split';
    return {
      cmd: 'powershell',
      args: [
        '-NoProfile',
        '-STA',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; ' +
          '$d = New-Object System.Windows.Forms.OpenFileDialog; ' +
          `$d.Title = '${title}'; ` +
          `$d.Filter = '${filter}'; ` +
          "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }",
      ],
    };
  }
  throw new Error(`Native dialogs are not supported on platform "${platform}"`);
}

export function folderDialogCommand(platform: string): DialogCommand {
  if (platform === 'darwin') {
    return {
      cmd: 'osascript',
      args: ['-e', 'POSIX path of (choose folder with prompt "Choose an output folder")'],
    };
  }
  if (platform === 'win32') {
    return {
      cmd: 'powershell',
      args: [
        '-NoProfile',
        '-STA',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; " +
          "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
          "$d.Description = 'Choose an output folder'; " +
          "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }",
      ],
    };
  }
  throw new Error(`Native dialogs are not supported on platform "${platform}"`);
}

// osascript exits 1 with "User canceled." (error -128) on cancel; PowerShell
// exits 0 printing nothing. Both resolve null. Genuine failures reject.
function isCancellation(stderr: string): boolean {
  return /cancell?ed|-128/i.test(stderr);
}

export function runDialog(command: DialogCommand): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command.cmd, command.args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => {
      out += d;
    });
    proc.stderr.on('data', (d) => {
      err += d;
    });
    proc.on('error', (spawnErr) => {
      reject(new Error(`Failed to launch "${command.cmd}": ${spawnErr.message}`));
    });
    proc.on('close', (code) => {
      if (code === 0) {
        const chosen = out.trim();
        resolve(chosen === '' ? null : chosen);
        return;
      }
      if (isCancellation(err)) {
        resolve(null);
        return;
      }
      const stderrTail = err.trim().split('\n').slice(-5).join('\n');
      reject(
        new Error(
          `Dialog command "${command.cmd}" exited with code ${code}: ${stderrTail || '(no stderr)'}`,
        ),
      );
    });
  });
}

// --- Warm dialog host (Windows) -------------------------------------------
//
// Spawning powershell.exe per request costs 2-5s before the picker appears
// (CLR cold start + AMSI scan + WinForms assembly load). The host below is a
// single long-lived STA PowerShell process that loads WinForms once and then
// opens dialogs on demand over a stdin/stdout line protocol:
//   stdin:  "file:video" | "file:image" | "folder" | "exit"
//   stdout: "READY" once at startup, then per request "OK:<path>" | "CANCEL" | "ERR:<msg>"

const WINDOWS_DIALOG_HOST_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms;',
  "[Console]::Out.WriteLine('READY');",
  'while ($true) {',
  '  $line = [Console]::In.ReadLine();',
  "  if ($null -eq $line -or $line -eq 'exit') { break };",
  "  $result = 'CANCEL';",
  '  try {',
  "    if ($line -eq 'folder') {",
  '      $d = New-Object System.Windows.Forms.FolderBrowserDialog;',
  "      $d.Description = 'Choose an output folder';",
  "      if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $result = 'OK:' + $d.SelectedPath };",
  '    } else {',
  '      $d = New-Object System.Windows.Forms.OpenFileDialog;',
  "      if ($line -eq 'file:image') {",
  "        $d.Title = 'Choose a background image';",
  "        $d.Filter = 'Image files|*.png;*.jpg;*.jpeg;*.webp;*.bmp|All files|*.*';",
  '      } else {',
  "        $d.Title = 'Choose a video to split';",
  "        $d.Filter = 'Video files|*.mp4;*.m4v;*.mov;*.mkv;*.webm;*.avi;*.wmv;*.ts;*.mts|All files|*.*';",
  '      };',
  "      if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $result = 'OK:' + $d.FileName };",
  '    }',
  '  } catch {',
  "    $result = 'ERR:' + $_.Exception.Message;",
  '  };',
  '  [Console]::Out.WriteLine($result);',
  '}',
].join(' ');

export function dialogHostCommand(platform: string): DialogCommand {
  if (platform !== 'win32') {
    throw new Error('The persistent dialog host is only used on win32');
  }
  return {
    cmd: 'powershell',
    args: ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_DIALOG_HOST_SCRIPT],
  };
}

// Host process/spawn failures — the caller may fall back to a one-shot dialog.
// Dialog-level errors (ERR:<msg> responses) are plain Errors and must not
// trigger a fallback, which would pop a second dialog.
export class HostTransportError extends Error {}

export function parseHostResponse(line: string): string | null {
  if (line === 'CANCEL') return null;
  if (line.startsWith('OK:')) return line.slice(3);
  if (line.startsWith('ERR:')) throw new Error(`Dialog failed: ${line.slice(4)}`);
  throw new Error(`Unexpected dialog host response: ${line}`);
}

export class DialogHost {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private waiter: { resolve: (line: string) => void; reject: (err: Error) => void } | null = null;
  private buffer = '';

  constructor(private readonly command: DialogCommand) {}

  // Fire-and-forget: spawn the host so the first click is already warm.
  warmUp(): void {
    void this.ensureStarted().catch(() => {
      // Failure here is non-fatal — request() retries and can fall back.
    });
  }

  request(req: DialogRequest): Promise<string | null> {
    const run = this.queue.then(async () => {
      await this.ensureStarted();
      const line = await this.exchange(req);
      return parseHostResponse(line);
    });
    // Keep the queue alive after failures so later requests still run.
    this.queue = run.catch(() => undefined);
    return run;
  }

  dispose(): void {
    const proc = this.proc;
    this.proc = null;
    this.starting = null;
    if (proc) {
      proc.stdin.write('exit\n', () => proc.kill());
    }
  }

  private ensureStarted(): Promise<void> {
    if (this.proc) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private start(): Promise<void> {
    return new Promise((resolve, reject) => {
      let readied = false;
      const proc = spawn(this.command.cmd, this.command.args, { windowsHide: true });
      this.buffer = '';

      proc.stdout.on('data', (d) => {
        this.buffer += String(d);
        let idx: number;
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, idx).replace(/\r$/, '');
          this.buffer = this.buffer.slice(idx + 1);
          if (!readied) {
            if (line === 'READY') {
              readied = true;
              this.proc = proc;
              resolve();
            }
            continue;
          }
          const waiter = this.waiter;
          this.waiter = null;
          waiter?.resolve(line);
        }
      });

      const fail = (message: string) => {
        const err = new HostTransportError(message);
        if (this.proc === proc) this.proc = null;
        if (!readied) reject(err);
        const waiter = this.waiter;
        this.waiter = null;
        waiter?.reject(err);
      };

      proc.on('error', (err) => fail(`Failed to launch dialog host: ${err.message}`));
      proc.on('close', (code) => fail(`Dialog host exited with code ${code}`));
    });
  }

  private exchange(req: DialogRequest): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = this.proc;
      if (!proc) {
        reject(new HostTransportError('Dialog host is not running'));
        return;
      }
      this.waiter = { resolve, reject };
      proc.stdin.write(`${req}\n`, (err) => {
        if (err && this.waiter) {
          this.waiter = null;
          reject(new HostTransportError(`Failed to reach dialog host: ${err.message}`));
        }
      });
    });
  }
}

const defaultHost = new DialogHost(
  process.platform === 'win32' ? dialogHostCommand('win32') : { cmd: 'false', args: [] },
);

export function warmUpDialogHost(): void {
  if (process.platform === 'win32') defaultHost.warmUp();
}

// Windows: try the warm host first; if its process died or can't spawn, fall
// back to the original one-shot spawn. Dialog-level errors propagate as-is.
async function pickPath(req: DialogRequest, fallback: DialogCommand): Promise<string | null> {
  if (process.platform === 'win32') {
    try {
      return await defaultHost.request(req);
    } catch (err) {
      if (!(err instanceof HostTransportError)) throw err;
    }
  }
  return runDialog(fallback);
}

export const dialogRouter = Router();

dialogRouter.post('/api/dialog/file', async (req, res) => {
  const kind = req.body?.kind === 'image' ? 'image' : 'video';
  try {
    res.json({
      path: await pickPath(`file:${kind}`, fileDialogCommand(process.platform, kind)),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

dialogRouter.post('/api/dialog/folder', async (_req, res) => {
  try {
    res.json({ path: await pickPath('folder', folderDialogCommand(process.platform)) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
