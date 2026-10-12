/** INPUT: JSON 请求与专用水龙头服务。 OUTPUT: /faucet HTTP。 POSITION: 独立 EP8 服务边界。 SYNC: folder.md。 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readJson, corsHeaders } from '../api/http-body';
import { ApiError } from '../api/errors';
import { FaucetLimit } from './service';
import type { FaucetResponse } from '../api/types';
export type FaucetHandler = (input: unknown, ip: string) => Promise<FaucetResponse>;
export async function faucetRoute(method: string, url: string, input: unknown, ip: string, grant: FaucetHandler) {
  try {
    if (method === 'OPTIONS') return { status: 204, headers: corsHeaders, body: '' };
    if (method === 'GET' && url === '/health') return { status: 200, headers: corsHeaders, body: '{"ok":true}' }; // 存活检查(check-ready 用)
    if (method !== 'POST' || url !== '/faucet') throw new ApiError(404, 'not found');
    return { status: 200, headers: corsHeaders, body: JSON.stringify(await grant(input, ip)) };
  } catch (error) { return faucetFailure(error); }
}
function faucetFailure(error: unknown) {
  return { status: error instanceof ApiError ? error.status : 503, headers: corsHeaders,
    body: JSON.stringify({ error: error instanceof ApiError ? error.message : 'faucet unavailable',
      ...(error instanceof FaucetLimit ? { next_allowed_at: error.next_allowed_at } : {}) }) };
}
export async function handleFaucet(req: IncomingMessage, res: ServerResponse, grant: FaucetHandler) {
  let result;
  try { result = await faucetRoute(req.method ?? 'GET', req.url ?? '/', req.method === 'POST' ? await readJson(req) : undefined,
    // 只信 socket IP，任意客户端都能伪造 X-Forwarded-For。代理部署需另行配置可信代理。
    req.socket?.remoteAddress ?? 'unknown', grant); }
  catch (error) { result = faucetFailure(error); }
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  res.statusCode = result.status; res.end(result.body);
}
export const createFaucetServer = (grant: FaucetHandler) => createServer((req, res) => { void handleFaucet(req, res, grant); });
