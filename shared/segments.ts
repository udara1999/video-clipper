export interface Segment {
  index: number;
  start: number;
  end: number;
  duration: number;
}

const EPSILON = 0.01;

export function normalizeSplits(times: number[], duration: number): number[] {
  const valid = times
    .filter((t) => t > EPSILON && t < duration - EPSILON)
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of valid) {
    if (out.length === 0 || t - out[out.length - 1] > EPSILON) out.push(t);
  }
  return out;
}

export function computeSegments(splits: number[], duration: number): Segment[] {
  const bounds = [0, ...normalizeSplits(splits, duration), duration];
  const segments: Segment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    segments.push({
      index: i + 1,
      start: bounds[i],
      end: bounds[i + 1],
      duration: bounds[i + 1] - bounds[i],
    });
  }
  return segments;
}
