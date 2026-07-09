import { describe, expect, test } from 'vitest';
import {
  buildComposeFilter,
  decodePngDataUrl,
  validateComposeInput,
} from '../../server/compose';

// 1x1 transparent PNG
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('decodePngDataUrl', () => {
  test('decodes a valid PNG data URL', () => {
    const buf = decodePngDataUrl(PNG_DATA_URL);
    expect(buf).not.toBeNull();
    expect(buf!.readUInt32BE(0)).toBe(0x89504e47);
  });
  test('rejects non-PNG payloads and garbage', () => {
    expect(decodePngDataUrl('data:image/jpeg;base64,/9j/4AAQ')).toBeNull();
    expect(decodePngDataUrl('data:image/png;base64,aGVsbG8=')).toBeNull(); // not PNG magic
    expect(decodePngDataUrl('nonsense')).toBeNull();
  });
});

describe('validateComposeInput', () => {
  const good = {
    compose: {
      video: { x: 0, y: 656, width: 1080 },
      backgroundPng: PNG_DATA_URL,
      texts: [{ pngs: PNG_DATA_URL, start: 0, end: 3 }],
    },
  };
  test('accepts a valid payload', () => {
    const r = validateComposeInput(good, 2);
    expect(r.ok).toBe(true);
  });
  test('rejects missing compose, bad placement, bad png, bad texts', () => {
    expect(validateComposeInput({}, 2).ok).toBe(false);
    expect(
      validateComposeInput(
        { compose: { ...good.compose, video: { x: 0, y: 0, width: 0 } } },
        2,
      ).ok,
    ).toBe(false);
    expect(
      validateComposeInput({ compose: { ...good.compose, backgroundPng: 'nope' } }, 2).ok,
    ).toBe(false);
    expect(
      validateComposeInput(
        { compose: { ...good.compose, texts: [{ pngs: 5, start: 0, end: 3 }] } },
        2,
      ).ok,
    ).toBe(false);
  });
  test('per-clip png arrays must match the clip count', () => {
    const perClip = {
      compose: {
        ...good.compose,
        texts: [{ pngs: [PNG_DATA_URL], start: 0, end: 3 }],
      },
    };
    expect(validateComposeInput(perClip, 2).ok).toBe(false);
    const okPerClip = {
      compose: {
        ...good.compose,
        texts: [{ pngs: [PNG_DATA_URL, PNG_DATA_URL], start: 0, end: 3 }],
      },
    };
    expect(validateComposeInput(okPerClip, 2).ok).toBe(true);
  });
});

describe('buildComposeFilter', () => {
  test('no texts: scale video onto background', () => {
    expect(buildComposeFilter({ x: 0, y: 656, width: 1080 }, [])).toBe(
      "[0:v]scale=1080:-2[v0];[1:v][v0]overlay=0:656:shortest=1[c0]",
    );
  });
  test('texts chain with enable timing', () => {
    expect(
      buildComposeFilter({ x: 10, y: 20, width: 1000 }, [
        { start: 0, end: 3 },
        { start: 1.5, end: 4 },
      ]),
    ).toBe(
      "[0:v]scale=1000:-2[v0];[1:v][v0]overlay=10:20:shortest=1[c0];" +
        "[c0][2:v]overlay=0:0:enable='between(t,0,3)'[c1];" +
        "[c1][3:v]overlay=0:0:enable='between(t,1.5,4)'[c2]",
    );
  });
  test('rounds odd widths up to even and rounds positions', () => {
    expect(buildComposeFilter({ x: 1.6, y: 2.4, width: 1079 }, [])).toBe(
      "[0:v]scale=1080:-2[v0];[1:v][v0]overlay=2:2:shortest=1[c0]",
    );
  });
});
