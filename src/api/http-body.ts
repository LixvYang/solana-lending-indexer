/** INPUT: IncomingMessage 字节流。 OUTPUT: 64KB 内 JSON。 POSITION: M7 POST 边界。 SYNC: folder.md。 */
import type { IncomingMessage } from 'node:http';
import { ApiError } from './errors';
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const length = req.headers?.['content-length'];
  if (length && Number(length) > 65536) throw new ApiError(413, 'request body exceeds 64KB');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 65536) throw new ApiError(413, 'request body exceeds 64KB');
    chunks.push(bytes);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] ?? ''))) throw new ApiError(400, 'JSON content-type required');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'invalid JSON'); }
}
export const corsHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
