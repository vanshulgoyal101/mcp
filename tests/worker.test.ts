import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';

function rpc(body: unknown, ip = '203.0.113.1'): Request {
  return new Request('https://mcp.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  });
}

const ARTICLE_HTML =
  '<html><head><title>Hello</title></head><body><article><h1>Hello</h1>' +
  '<p>This is a reasonably long paragraph so that Readability keeps it as the ' +
  'main article content instead of discarding the whole document.</p></article></body></html>';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('worker routing', () => {
  it('GET /health reports ok, server and tools', async () => {
    const res = await worker.fetch(new Request('https://mcp.test/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toContain('fetch_markdown');
  });

  it('answers CORS preflight with nosniff and allowed headers', async () => {
    const res = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'OPTIONS' }));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('access-control-allow-headers')).toContain('mcp-session-id');
  });

  it('rejects non-POST on /mcp with 405', async () => {
    const res = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('returns a JSON-RPC parse error for invalid JSON', async () => {
    const res = await worker.fetch(
      new Request('https://mcp.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.2' },
        body: '{ not json',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  it('handles a tools/list request end to end', async () => {
    const res = await worker.fetch(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, '203.0.113.3'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools.length).toBeGreaterThan(0);
  });

  it('returns 202 with no body for a notification', async () => {
    const res = await worker.fetch(
      rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, '203.0.113.4'),
    );
    expect(res.status).toBe(202);
  });

  it('processes a batch and drops notification responses', async () => {
    const res = await worker.fetch(
      rpc(
        [
          { jsonrpc: '2.0', id: 1, method: 'ping' },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 2, method: 'ping' },
        ],
        '203.0.113.5',
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2); // the notification produced no response
  });

  it('serves a fetch_markdown call over HTTP with a stubbed upstream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ARTICLE_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })));
    const res = await worker.fetch(
      rpc(
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fetch_markdown', arguments: { url: 'https://example.com/post' } } },
        '203.0.113.6',
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.content[0].text).toContain('reasonably long paragraph');
  });

  it('rate-limits a noisy IP', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 62; i++) {
      last = await worker.fetch(rpc({ jsonrpc: '2.0', id: i, method: 'ping' }, '198.51.100.9'));
    }
    expect(last?.status).toBe(429);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await worker.fetch(new Request('https://mcp.test/nope'));
    expect(res.status).toBe(404);
  });
});
