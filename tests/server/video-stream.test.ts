import { beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import request from 'supertest';
import { createApp } from '../../server/app';
import { ensureFixture } from '../helpers/fixture';

let fixture: string;

beforeAll(async () => {
  fixture = await ensureFixture();
});

describe('GET /api/video/stream', () => {
  test('serves a byte range with 206', async () => {
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: fixture })
      .set('Range', 'bytes=0-99')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-99/${fs.statSync(fixture).size}`);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect((res.body as Buffer).length).toBe(100);
    expect((res.body as Buffer).equals(fs.readFileSync(fixture).subarray(0, 100))).toBe(true);
  });

  test('serves a suffix range (last N bytes)', async () => {
    const size = fs.statSync(fixture).size;
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: fixture })
      .set('Range', 'bytes=-50')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes ${size - 50}-${size - 1}/${size}`);
    expect((res.body as Buffer).length).toBe(50);
    expect((res.body as Buffer).equals(fs.readFileSync(fixture).subarray(size - 50))).toBe(true);
  });

  test('suffix range larger than the file serves the whole file', async () => {
    const size = fs.statSync(fixture).size;
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: fixture })
      .set('Range', 'bytes=-999999999')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-${size - 1}/${size}`);
    expect((res.body as Buffer).length).toBe(size);
  });

  test('serves an open-ended range to EOF', async () => {
    const size = fs.statSync(fixture).size;
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: fixture })
      .set('Range', `bytes=${size - 50}-`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(206);
    expect((res.body as Buffer).length).toBe(50);
  });

  test('serves the whole file with 200 when no Range is sent', async () => {
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: fixture })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(Number(res.headers['content-length'])).toBe(fs.statSync(fixture).size);
    expect(res.headers['content-type']).toBe('video/mp4');
  });

  test('416 for an unsatisfiable range', async () => {
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: fixture })
      .set('Range', 'bytes=999999999-');
    expect(res.status).toBe(416);
  });

  test('416 when start is greater than end', async () => {
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: fixture })
      .set('Range', 'bytes=100-50');
    expect(res.status).toBe(416);
  });

  test('404 for a missing file', async () => {
    const res = await request(createApp())
      .get('/api/video/stream')
      .query({ path: '/nope/missing.mp4' });
    expect(res.status).toBe(404);
  });
});
