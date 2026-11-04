// Never permanently delete user or cache files. Unsupported systems retain files and report the failure.
import { lstatSync } from 'node:fs';
import { resolve, parse } from 'node:path';
import { spawnSync } from 'node:child_process';
export function recycleSync(target: string, _options?: unknown): void {
  const p = resolve(target);
  if (p === parse(p).root) throw new Error('拒絕移動根目錄');
  try { lstatSync(p); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  if (process.platform !== 'win32') throw new Error('無法移入垃圾桶，已保留檔案，請詢問使用者');
  const script = `Add-Type -AssemblyName Microsoft.VisualBasic
$p = [Console]::In.ReadToEnd()
if ([System.IO.Directory]::Exists($p)) {
 [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin', 'ThrowException')
} else {
 [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin', 'ThrowException')
}`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { input: p, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('無法移入垃圾桶，已停止清理，請詢問使用者');
}
export async function recycle(target: string): Promise<void> { recycleSync(target); }
