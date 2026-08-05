import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPage, readCapped } from '../src/fetcher';

function html(body = '<html><body>ok</body></html>', status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchPage — redirect re-validation (SSRF)', () => {
  it('returns the response for a direct 200', async () => {
    const fetchMock = vi.fn(async () => html());
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchPage(new URL('https://example.com/'));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to follow a redirect to a private IP', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const target = typeof input === 'string' ? input : input.toString();
      return target.includes('example.com') ? redirect('http://127.0.0.1/admin') : html('secret');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPage(new URL('https://example.com/start'))).rejects.toThrow(/redirect/i);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never fetched the internal target
  });

  it('refuses to follow a redirect to the cloud metadata endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const target = typeof input === 'string' ? input : input.toString();
      return target.includes('example.com') ? redirect('http://169.254.169.254/latest/meta-data/') : html('token');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPage(new URL('https://example.com/start'))).rejects.toThrow(/redirect/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a safe redirect to another public URL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const target = typeof input === 'string' ? input : input.toString();
      return target.includes('start.example.com')
        ? redirect('https://final.example.com/post')
        : html('<html><body>final</body></html>');
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchPage(new URL('https://start.example.com/go'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('final');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after too many redirects', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => redirect(`https://example.com/hop${n++}`));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPage(new URL('https://example.com/loop'))).rejects.toThrow(/too many redirects/i);
  });

  it('returns the 3xx response when there is no Location header', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchPage(new URL('https://example.com/'));
    expect(res.status).toBe(302);
  });

  it('throws on an invalid Location header', async () => {
    const fetchMock = vi.fn(async () => redirect('http://[not a url'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPage(new URL('https://example.com/'))).rejects.toThrow();
  });
});

describe('readCapped — size cap', () => {
  it('returns the decoded body when under the cap', async () => {
    const res = new Response('hello world', { headers: { 'content-type': 'text/html' } });
    expect(await readCapped(res, 1000)).toBe('hello world');
  });

  it('returns null when Content-Length declares a body over the cap', async () => {
    const res = new Response('x'.repeat(100), {
      headers: { 'content-type': 'text/html', 'content-length': '100' },
    });
    expect(await readCapped(res, 50)).toBeNull();
  });

  it('returns null when a streamed body exceeds the cap (even without Content-Length)', async () => {
    const chunk = new Uint8Array(1024);
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk); // keeps emitting until readCapped cancels
      },
    });
    const res = new Response(stream, { headers: { 'content-type': 'text/html' } });
    expect(await readCapped(res, 2048)).toBeNull();
  });
});
