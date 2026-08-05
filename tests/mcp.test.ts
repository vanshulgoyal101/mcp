import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRpc, MCP_SERVER_INFO, MCP_TOOL_NAMES } from '../src/mcp';

const ARTICLE_HTML =
  '<html><head><title>Hello</title></head><body><article><h1>Hello</h1>' +
  '<p>This is a reasonably long paragraph so that Readability keeps it as the ' +
  'main article content instead of discarding the whole document. It also links to ' +
  '<a href="https://out.example/page">an outbound page</a> for the link test.</p></article></body></html>';

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function stubFetchHtml(html = ARTICLE_HTML): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => htmlResponse(html)),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleRpc — protocol', () => {
  it('answers initialize with the protocol version and server info', async () => {
    const res = (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' })) as any;
    expect(res.result.protocolVersion).toBe('2025-06-18');
    expect(res.result.serverInfo).toEqual(MCP_SERVER_INFO);
    expect(res.result.capabilities.tools).toBeTruthy();
  });

  it('answers ping with an empty result', async () => {
    const res = (await handleRpc({ jsonrpc: '2.0', id: 2, method: 'ping' })) as any;
    expect(res.result).toEqual({});
  });

  it('lists all tools with an input schema', async () => {
    const res = (await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' })) as any;
    const names = res.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(MCP_TOOL_NAMES);
    for (const tool of res.result.tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('returns null for notifications (no id)', async () => {
    expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  it('rejects a non-object message with an Invalid Request error', async () => {
    const res = (await handleRpc('nonsense')) as any;
    expect(res.error.code).toBe(-32600);
  });

  it('rejects an unknown method', async () => {
    const res = (await handleRpc({ jsonrpc: '2.0', id: 4, method: 'does/not/exist' })) as any;
    expect(res.error.code).toBe(-32601);
  });
});

describe('handleRpc — tools/call', () => {
  it('fetch_markdown returns Markdown for a page', async () => {
    stubFetchHtml();
    const res = (await handleRpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'fetch_markdown', arguments: { url: 'https://example.com/post' } },
    })) as any;
    expect(res.result.isError).toBeUndefined();
    expect(res.result.content[0].text).toContain('reasonably long paragraph');
  });

  it('fetch_markdown honours max_chars and marks truncation', async () => {
    stubFetchHtml();
    const res = (await handleRpc({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'fetch_markdown', arguments: { url: 'https://example.com/post', max_chars: 20 } },
    })) as any;
    const text: string = res.result.content[0].text;
    expect(text).toContain('…[truncated]');
    expect(text.length).toBeLessThanOrEqual(20 + '\n\n…[truncated]'.length);
  });

  it('fetch_metadata returns JSON without the body', async () => {
    stubFetchHtml();
    const res = (await handleRpc({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'fetch_metadata', arguments: { url: 'https://example.com/post' } },
    })) as any;
    const meta = JSON.parse(res.result.content[0].text);
    expect(meta.title).toBe('Hello');
    expect(meta.wordCount).toBeGreaterThan(0);
    expect(meta.markdown).toBeUndefined();
  });

  it('extract_links returns outbound links', async () => {
    stubFetchHtml();
    const res = (await handleRpc({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'extract_links', arguments: { url: 'https://example.com/post' } },
    })) as any;
    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.links.map((l: { href: string }) => l.href)).toContain('https://out.example/page');
  });

  it('search_page returns only passages matching the query', async () => {
    stubFetchHtml();
    const res = (await handleRpc({
      jsonrpc: '2.0',
      id: 81,
      method: 'tools/call',
      params: { name: 'search_page', arguments: { url: 'https://example.com/post', query: 'reasonably long' } },
    })) as any;
    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.query).toBe('reasonably long');
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.matches[0].snippet).toMatch(/reasonably long/i);
  });

  it('search_page reports a missing query as a recoverable tool error', async () => {
    stubFetchHtml();
    const res = (await handleRpc({
      jsonrpc: '2.0',
      id: 82,
      method: 'tools/call',
      params: { name: 'search_page', arguments: { url: 'https://example.com/post', query: '   ' } },
    })) as any;
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/query/i);
  });

  it('reports an unknown tool as a JSON-RPC error', async () => {
    const res = (await handleRpc({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'no_such_tool', arguments: {} },
    })) as any;
    expect(res.error.code).toBe(-32602);
  });

  it('reports a bad URL as a recoverable tool error (isError), not a protocol error', async () => {
    const res = (await handleRpc({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'fetch_markdown', arguments: { url: 'http://127.0.0.1/secret' } },
    })) as any;
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/private or reserved/i);
  });

  it('rejects a non-HTML upstream response as a tool error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    const res = (await handleRpc({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'fetch_markdown', arguments: { url: 'https://example.com/data.json' } },
    })) as any;
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/not HTML/i);
  });
});
