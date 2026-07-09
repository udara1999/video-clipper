import open from 'open';
import { createApp } from './app';

const PORT = 4859;

createApp().listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Video Clipper running at ${url}`);
  open(url).catch(() => {
    console.log('Could not auto-open a browser; open the URL above manually.');
  });
});
