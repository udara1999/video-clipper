import { describe, expect, test } from 'vitest';
import {
  clipFileName,
  defaultPrefix,
  padWidth,
  sanitizePrefix,
  segmentPattern,
  sourceExtension,
} from '../../shared/naming';

describe('padWidth', () => {
  test('minimum width is 2', () => {
    expect(padWidth(1)).toBe(2);
    expect(padWidth(9)).toBe(2);
    expect(padWidth(99)).toBe(2);
  });

  test('grows with clip count', () => {
    expect(padWidth(100)).toBe(3);
    expect(padWidth(1000)).toBe(4);
  });
});

describe('clipFileName', () => {
  test('formats zero-padded index, prefix, extension', () => {
    expect(clipFileName(1, 12, 'movie', 'mp4')).toBe('01 - movie.mp4');
    expect(clipFileName(12, 12, 'movie', 'mp4')).toBe('12 - movie.mp4');
    expect(clipFileName(7, 120, 'movie', 'mkv')).toBe('007 - movie.mkv');
  });
});

describe('segmentPattern', () => {
  test('builds ffmpeg printf pattern with matching width', () => {
    expect(segmentPattern(12, 'movie', 'mp4')).toBe('%02d - movie.mp4');
    expect(segmentPattern(120, 'movie', 'mp4')).toBe('%03d - movie.mp4');
  });

  test('escapes percent signs in the prefix', () => {
    expect(segmentPattern(2, '100% done', 'mp4')).toBe('%02d - 100%% done.mp4');
  });
});

describe('defaultPrefix', () => {
  test('strips only the last extension', () => {
    expect(defaultPrefix('my.video.mp4')).toBe('my.video');
    expect(defaultPrefix('clip.mkv')).toBe('clip');
    expect(defaultPrefix('noext')).toBe('noext');
  });
});

describe('sourceExtension', () => {
  test('returns the extension without the dot', () => {
    expect(sourceExtension('/a/b/clip.mp4')).toBe('mp4');
    expect(sourceExtension('C:\\videos\\clip.MKV')).toBe('MKV');
  });

  test('falls back to mp4 when there is none', () => {
    expect(sourceExtension('/a/b/noext')).toBe('mp4');
  });
});

describe('sanitizePrefix', () => {
  test('strips filename-illegal characters and trims', () => {
    expect(sanitizePrefix('a/b:c*d?e"f<g>h|i\\j')).toBe('abcdefghij');
    expect(sanitizePrefix('  padded  ')).toBe('padded');
  });

  test('falls back to clip when nothing remains', () => {
    expect(sanitizePrefix('???')).toBe('clip');
    expect(sanitizePrefix('')).toBe('clip');
  });
});
