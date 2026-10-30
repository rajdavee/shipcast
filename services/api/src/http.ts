import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';

export type Params = Record<string, string>;
export type Handler = (req: IncomingMessage, res: ServerResponse, params: Params, url: URL) => unknown | Promise<unknown>;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Tiny router: `/api/campaigns/:id/files/*` style patterns. */
export class Router {
  routes: Route[] = [];
  on(method: string, pattern: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/\/\*$/, '/(?<rest>.*)').replace(/:(\w+)/g, (_, k) => {
          keys.push(k);
          return `(?<${k}>[^/]+)`;
        }) +
        '$',
    );
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get = (p: string, h: Handler) => this.on('GET', p, h);
  post = (p: string, h: Handler) => this.on('POST', p, h);
  put = (p: string, h: Handler) => this.on('PUT', p, h);
  delete = (p: string, h: Handler) => this.on('DELETE', p, h);

  match(method: string, path: string): { handler: Handler; params: Params } | null {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (m) {
        const params: Params = {};
        for (const [k, v] of Object.entries(m.groups ?? {})) params[k] = decodeURIComponent(v);
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

export function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

export async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson<T = any>(req: IncomingMessage): Promise<T> {
  const buf = await readBody(req);
  if (!buf.length) return {} as T;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

export const contentType = (p: string) => TYPES[extname(p).toLowerCase()] ?? 'application/octet-stream';

/** Stream a file with HTTP Range support (videos need it to seek). */
export function sendFile(req: IncomingMessage, res: ServerResponse, file: string, extraHeaders: Record<string, string> = {}) {
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error();
    size = st.size;
  } catch {
    throw new HttpError(404, 'not found');
  }
  const type = contentType(file);
  const headers: Record<string, string | number> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  };
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && size > 0) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}
