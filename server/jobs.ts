import { randomUUID } from 'node:crypto';

export interface ClipResult {
  fileName: string;
  start: number;
  end: number;
  duration: number;
}

export interface ExportJob {
  id: string;
  status: 'running' | 'done' | 'error';
  percent: number;
  error?: string;
  stderrTail?: string;
  results?: ClipResult[];
  mergedCuts?: number;
  clipIndex?: number;
  clipCount?: number;
}

const jobs = new Map<string, ExportJob>();

export function createJob(): ExportJob {
  const job: ExportJob = { id: randomUUID(), status: 'running', percent: 0 };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): ExportJob | undefined {
  return jobs.get(id);
}
