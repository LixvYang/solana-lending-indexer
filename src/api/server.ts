/** INPUT: Db、HTTP method/url。 OUTPUT: route / handle / createApiServer，无框架。 POSITION: EP7 只读 HTTP 边界。 SYNC: 同步 folder.md。 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Db } from '../store/db';
import { toJson } from '../store/json';
import { decodeBase58 } from '../core/base58';
import { getPool, getAccounts, getRateCurve, getActivity, getXray } from './queries';
import { ApiError } from './errors';
export function portNumber(value: string | undefined): number {
  if (value === undefined)
    return 8787;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
    throw new Error('invalid PORT');
  return Number(value);
}
function address(value: string | null, width: number): string {
  try {
    if (!value || decodeBase58(value).length !== width)
      throw Error();
    return value;
  }
  catch {
    throw new ApiError(400, width === 32 ? 'invalid bank address' : 'invalid transaction signature');
  }
}
export async function route(db: Db, method: string, requestUrl: string) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  try {
    let url: URL;
    try {
      url = new URL(requestUrl, 'http://localhost');
    }
    catch {
      throw new ApiError(400, 'invalid URL');
    }
    if (method === 'OPTIONS')
      return { status: 204, headers, body: '' };
    if (method !== 'GET')
      throw new ApiError(404, 'not found');
    let body: unknown;
    switch (url.pathname) {
      case '/api/health':
        await db.query('SELECT 1');
        body = { ok: true };
        break;
      case '/api/pool':
        body = await getPool(db);
        break;
      case '/api/accounts':
        body = await getAccounts(db);
        break;
      case '/api/activity': {
        const value = url.searchParams.get('limit');
        if (value !== null && !/^\d+$/.test(value))
          throw new ApiError(400, 'invalid limit');
        body = await getActivity(db, { limit: value === null ? undefined : Number(value), before: url.searchParams.get('before') ?? undefined });
        break;
      }
      case '/api/rate-curve':
        body = await getRateCurve(db, address(url.searchParams.get('bank'), 32));
        break;
      default: {
        const match = /^\/api\/tx\/([^/]+)$/.exec(url.pathname);
        if (!match)
          throw new ApiError(404, 'not found');
        let signature: string;
        try {
          signature = decodeURIComponent(match[1]);
        }
        catch {
          throw new ApiError(400, 'invalid transaction signature');
        }
        body = await getXray(db, address(signature, 64));
      }
    }
    if (body === null)
      throw new ApiError(404, 'not found');
    return { status: 200, headers, body: toJson(body) };
  }
  catch (error) {
    // 驱动异常可包含带凭据的 URL；只返回固定消息，不记录异常对象或请求 URL。
    return { status: error instanceof ApiError ? error.status : 500, headers,
      body: toJson({ error: error instanceof ApiError ? error.message : 'internal server error' }) };
  }
}
export async function handle(db: Db, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const result = await route(db, req.method ?? 'GET', req.url ?? '/');
  for (const [key, value] of Object.entries(result.headers))
    res.setHeader(key, value);
  res.statusCode = result.status;
  res.end(result.body);
}
export const createApiServer = (db: Db) => createServer((req, res) => { void handle(db, req, res); });
