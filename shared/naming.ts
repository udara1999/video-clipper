export function padWidth(count: number): number {
  return Math.max(2, String(count).length);
}

export function clipFileName(index: number, count: number, prefix: string, ext: string): string {
  return `${String(index).padStart(padWidth(count), '0')} - ${prefix}.${ext}`;
}

export function segmentPattern(count: number, prefix: string, ext: string): string {
  return `%0${padWidth(count)}d - ${prefix.replace(/%/g, '%%')}.${ext}`;
}

export function defaultPrefix(sourceFileName: string): string {
  return sourceFileName.replace(/\.[^.]+$/, '');
}

export function sourceExtension(sourcePath: string): string {
  const m = sourcePath.match(/\.([^./\\]+)$/);
  return m ? m[1] : 'mp4';
}

export function sanitizePrefix(prefix: string): string {
  const clean = prefix.replace(/[\\/:*?"<>|]/g, '').trim();
  return clean === '' ? 'clip' : clean;
}
