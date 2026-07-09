import { spawn } from 'node:child_process';
import { Router } from 'express';

export interface DialogCommand {
  cmd: string;
  args: string[];
}

export function fileDialogCommand(platform: string): DialogCommand {
  if (platform === 'darwin') {
    return {
      cmd: 'osascript',
      args: ['-e', 'POSIX path of (choose file with prompt "Choose a video to split")'],
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
          "$d = New-Object System.Windows.Forms.OpenFileDialog; " +
          "$d.Title = 'Choose a video to split'; " +
          "$d.Filter = 'Video files|*.mp4;*.m4v;*.mov;*.mkv;*.webm;*.avi;*.wmv;*.ts;*.mts|All files|*.*'; " +
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

// Cancelling produces no stdout (osascript exits 1, PowerShell prints nothing) → null.
function runDialog(command: DialogCommand): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(command.cmd, command.args);
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d;
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const chosen = out.trim();
      resolve(chosen === '' ? null : chosen);
    });
  });
}

export const dialogRouter = Router();

dialogRouter.post('/api/dialog/file', async (_req, res) => {
  try {
    res.json({ path: await runDialog(fileDialogCommand(process.platform)) });
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
