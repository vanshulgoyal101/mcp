/**
 * Cloudflare Worker entry point for mcp.vanshul.com.
 *
 *   POST /mcp      -> MCP (JSON-RPC 2.0) over Streamable HTTP. Point any MCP
 *                     client (Claude Desktop, Cursor, Continue…) at this URL.
 *   GET  /health   -> { ok: true }
 *   GET  /          -> the static landing page (served by the [assets] binding).
 *
 * A tiny per-isolate rate limit deters casual abuse; a production setup would
 * use Cloudflare rate-limiting or a Durable Object so the limit is shared.
 */

import { handleRpc, MCP_SERVER_INFO, MCP_TOOL_NAMES } from './mcp';

const RATE_LIMIT = 60; // requests
const RATE_WINDOW_MS = 60_000; // per minute, per IP
const hits = new Map<string, number[]>();

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === '/health') {
      return json(200, { ok: true, server: MCP_SERVER_INFO, tools: MCP_TOOL_NAMES });
    }

    if (url.pathname === '/mcp') {
      return handleMcp(request);
    }

    // Anything else falls through to the static landing page (assets binding).
    return new Response('Not found', { status: 404 });
  },
};

async function handleMcp(request: Request): Promise<Response> {
  // The Streamable HTTP transport uses POST for messages. (A GET would open an
  // SSE stream for server-initiated messages, which this server doesn't need.)
  if (request.method !== 'POST') {
    return json(405, rpcError(null, -32600, 'Use POST to send JSON-RPC messages'));
  }

  const ip = request.headers.get('cf-connecting-ip') ?? 'anonymous';
  if (isRateLimited(ip)) {
    return json(429, rpcError(null, -32000, 'Rate limit exceeded, slow down a little'), {
      'retry-after': String(Math.ceil(RATE_WINDOW_MS / 1000)),
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, rpcError(null, -32700, 'Parse error: body is not valid JSON'));
  }

  // A batch is an array of messages; a single call is one object.
  if (Array.isArray(payload)) {
    const responses = (await Promise.all(payload.map((m) => handleRpc(m)))).filter(Boolean);
    if (responses.length === 0) return new Response(null, { status: 202, headers: corsHeaders() });
    return json(200, responses);
  }

  const response = await handleRpc(payload);
  if (!response) return new Response(null, { status: 202, headers: corsHeaders() });
  return json(200, response);
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  for (const [key, times] of hits) {
    if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(key);
  }
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(), ...extra },
  });
}

function rpcError(id: string | number | null, code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
