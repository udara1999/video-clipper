import { spawn } from 'node:child_process';
import { Router } from 'express';

export interface DialogCommand {
  cmd: string;
  args: string[];
}

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

export const dialogRouter = Router();

dialogRouter.post('/api/dialog/file', async (req, res) => {
  const kind = req.body?.kind === 'image' ? 'image' : 'video';
  try {
    res.json({ path: await runDialog(fileDialogCommand(process.platform, kind)) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

dialogRouter.post('/api/dialog/folder', async (_req, res) => {
  try {
    res.json({ path: await runDialog(folderDialogCommand(process.platform)) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
