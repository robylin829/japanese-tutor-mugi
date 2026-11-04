// Process control only for this PC and only when Start-Mugi launched this exact Vite process.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { browserHeadersRefusal, type GuardOptions } from './apiGuard.ts';
import { trustedForSettings } from './settingsAccess.ts';
import { isLocalRequest } from './openai/routes.ts';
export function managedServer(root: string): boolean {
  if (process.env.MUGI_MANAGED_SERVER !== '1') return false;
  try {
    const state = JSON.parse(readFileSync(join(root, '.local-run', 'server.json'), 'utf8').replace(/^\uFEFF/, ''));
    // PowerShell writes UTF-8; the PID and project root must still belong to this process.
    return state.pid === process.pid && typeof state.root === 'string' && resolve(state.root).toLowerCase() === resolve(root).toLowerCase();
  } catch { return false; }
}
export type ServerControlDeps = { canStop: () => boolean; stop: () => Promise<void>; schedule?: (run: () => void) => void };
export async function handleServerControl(req: IncomingMessage, res: ServerResponse, guard: GuardOptions, deps: ServerControlDeps): Promise<void> {
  const answer = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const browser = browserHeadersRefusal(req.headers);
  if (browser && !browser.ok) { answer(browser.status, { message: browser.message }); return; }
  const local = isLocalRequest(req) && trustedForSettings(req, guard);
  if (req.method === 'GET') { answer(200, { running: true, canStop: local && deps.canStop() }); return; }
  if (req.method !== 'POST') { answer(405, { message: '不支援的操作' }); return; }
  if (!local) { answer(403, { message: '請在電腦本機關閉服務；手機不能操作。' }); return; }
  if (!deps.canStop()) { answer(409, { message: '請先使用桌面的 Mugi 服務控制面板啟動，才能在這裡關閉。' }); return; }
  try {
    let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024) throw new Error(); }
    if (JSON.parse(body)?.action !== 'stop') throw new Error();
  } catch { answer(400, { message: '關閉指令格式不正確。' }); return; }
  answer(200, { stopping: true, message: '服務正在關閉。重新啟動請使用桌面資料夾裡的「Mugi 服務控制」捷徑。' });
  const schedule = deps.schedule ?? ((run) => { setTimeout(run, 200); });
  schedule(() => { void deps.stop().catch(() => { console.warn('[server-control] 無法正常關閉服務，請使用桌面控制面板。'); }); });
}
