export function parseTimestamp(input: string): number | null {
  const s = input.trim();
  if (!/^[\d:.]+$/.test(s)) return null;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => p === '')) return null;
  // Only the last part may be fractional.
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].includes('.')) return null;
  }
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (parts.length >= 2) {
    if (nums[nums.length - 1] >= 60) return null;
    if (nums[nums.length - 2] >= 60) return null;
  }
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatTimestamp(seconds: number): string {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const ms = totalMs % 1000;
  const totalSec = (totalMs - ms) / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const frac = ms ? '.' + String(ms).padStart(3, '0').replace(/0+$/, '') : '';
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':') + frac;
}
