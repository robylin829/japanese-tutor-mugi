// Cleanup-only directories are retained for inspection; files whose removal is part of a test go to Recycle Bin.
import { lstatSync } from 'node:fs';
import { recycleSync } from '../server/recycle.ts';
export function testCleanup(target: string, _options?: unknown): void {
  try { if (lstatSync(target).isDirectory()) return; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  recycleSync(target);
}
