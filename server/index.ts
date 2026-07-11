import open from 'open';
import { createApp } from './app';
import { warmUpDialogHost } from './dialogs';
import { SchedulerEngine } from './scheduler/engine';
import { SchedulerStore } from './scheduler/store';

const PORT = 4859;

const schedulerStore = new SchedulerStore();

createApp(schedulerStore).listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Video Clipper running at ${url}`);
  // Windows: pre-start the PowerShell dialog host so the first file picker
  // opens instantly instead of paying the CLR/WinForms cold-start cost.
  warmUpDialogHost();
  // Scheduled social posts publish only while this server is running.
  new SchedulerEngine(schedulerStore).start();
  open(url).catch(() => {
    console.log('Could not auto-open a browser; open the URL above manually.');
  });
});
