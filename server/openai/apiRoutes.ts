import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { apiStatus } from './api.ts';
import { isLocalRequest } from './routes.ts';
import { updateEnvFile } from '../envFile.ts';
import { parseBudget, formatUsd } from '../settingsRoutes.ts';
import { trustedForSettings } from '../settingsAccess.ts';
import type { GuardOptions } from '../apiGuard.ts';
export async function handleApiSettings(req: IncomingMessage, res: ServerResponse, root: string, mode: string, guard: GuardOptions) {
  const answer = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET') { answer(200, apiStatus(root, mode)); return; }
  if (req.method !== 'POST') { answer(405, { message: '不支援的操作' }); return; }
  if (!isLocalRequest(req) || !trustedForSettings(req, guard)) { answer(403, { message: 'OpenAI API 預算只能在電腦上修改' }); return; }
  try {
    let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024) throw new Error(); }
    const usd = parseBudget(JSON.parse(body).usd);
    updateEnvFile(join(root, '.env.local'), { MUGI_OPENAI_DAILY_USD: formatUsd(usd) });
    answer(200, apiStatus(root, mode));
  } catch { answer(400, { message: '預算需為 0 到 100 美元，最多兩位小數。0 表示停止 API 請求。' }); }
}
