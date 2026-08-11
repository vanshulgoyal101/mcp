/**
 * Model Context Protocol (MCP) over Streamable HTTP.
 *
 * We speak JSON-RPC 2.0. A single POST endpoint handles `initialize`,
 * `tools/list` and `tools/call`; notifications (no `id`) get an empty 202.
 * Responses are plain application/json — fine for the single-response case of
 * the Streamable HTTP transport (we don't need SSE streaming here).
 *
 * Spec: https://modelcontextprotocol.io  ·  Protocol version 2025-06-18.
 */

import { fetchPage, readCapped, MAX_BYTES } from './fetcher';
import { extract, extractLinks, ExtractionError } from './extract';
import { searchMarkdown } from './search';
import { validateTargetUrl } from './security';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER = { name: 'vanshul-web-reader', version: '1.0.0' };

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

const urlSchema = {
  type: 'object',
  properties: { url: { type: 'string', description: 'The absolute http(s) URL of the page.' } },
  required: ['url'],
} as const;

const TOOLS: ToolDef[] = [
  {
    name: 'fetch_markdown',
    description:
      'Fetch a web page and return its main content as clean Markdown (nav, ads and boilerplate removed). Raw Markdown, plain-text and JSON endpoints are returned as-is. Use this to read an article, docs page or raw file.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The absolute http(s) URL of the page.' },
        max_chars: {
          type: 'number',
          description: 'Optional. Truncate the Markdown to at most this many characters to fit a context budget.',
        },
      },
      required: ['url'],
    },
    async run(args) {
      const page = await loadPage(args.url);
      return truncate(pageText(page), args.max_chars);
    },
  },
  {
    name: 'fetch_metadata',
    description:
      'Fetch a web page and return its metadata as JSON: title, byline, site name, excerpt and word count (no full body).',
    inputSchema: urlSchema,
    async run(args) {
      const page = await loadPage(args.url);
      if (!isHtml(page.contentType)) {
        const wordCount = page.body.match(/\S+/g)?.length ?? 0;
        return JSON.stringify({ url: page.url, contentType: page.contentType || null, title: null, wordCount }, null, 2);
      }
      const { markdown, ...meta } = extract(page.body, page.url);
      void markdown;
      return JSON.stringify({ url: page.url, ...meta }, null, 2);
    },
  },
  {
    name: 'extract_links',
    description:
      'Fetch a web page and return all of its outbound http(s) links (with anchor text) as JSON. Useful for crawling or finding related pages.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The absolute http(s) URL of the page.' },
        limit: { type: 'number', description: 'Max links to return (default 200).' },
      },
      required: ['url'],
    },
    async run(args) {
      const page = await loadPage(args.url);
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(500, args.limit)) : 200;
      const links = extractLinks(page.body, page.url, limit);
      return JSON.stringify({ url: page.url, count: links.length, links }, null, 2);
    },
  },
  {
    name: 'search_page',
    description:
      'Fetch a web page and return only the passages that match a query, instead of the whole page. Each result includes its heading breadcrumb and is ranked by relevance. Use this to find a specific detail (e.g. pricing, a config option) while spending far fewer tokens than fetch_markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The absolute http(s) URL of the page.' },
        query: { type: 'string', description: 'Space-separated search terms; matching is case-insensitive.' },
        max_matches: { type: 'number', description: 'Max passages to return (1-50, default 5).' },
        context_chars: { type: 'number', description: 'Per-passage character budget (50-4000, default 500).' },
      },
      required: ['url', 'query'],
    },
    async run(args) {
      if (typeof args.query !== 'string' || args.query.trim() === '') {
        throw new ToolError('The "query" argument is required and must be a non-empty string.');
      }
      const page = await loadPage(args.url);
      const text = pageText(page);
      const maxMatches = typeof args.max_matches === 'number' ? args.max_matches : undefined;
      const contextChars = typeof args.context_chars === 'number' ? args.context_chars : undefined;
      const matches = searchMarkdown(text, args.query, maxMatches, contextChars);
      return JSON.stringify({ url: page.url, query: args.query, count: matches.length, matches }, null, 2);
    },
  },
];

async function loadPage(rawUrl: unknown): Promise<LoadedPage> {
  if (typeof rawUrl !== 'string') throw new ToolError('The "url" argument is required and must be a string.');
  const check = validateTargetUrl(rawUrl);
  if (!check.ok || !check.url) throw new ToolError(check.reason ?? 'Invalid url');

  const res = await fetchPage(check.url);
  if (!res.ok) throw new ToolError(`Upstream returned ${res.status}`);
  const contentType = res.headers.get('content-type') ?? '';
  if (isBinaryType(contentType)) throw new ToolError(`Page is not a text or HTML document (got ${contentType})`);

  const body = await readCapped(res, MAX_BYTES);
  if (body === null) throw new ToolError('Page is too large to process');
  return { url: check.url.toString(), body, contentType };
}

interface LoadedPage {
  url: string;
  body: string;
  contentType: string;
}

function isHtml(contentType: string): boolean {
  return contentType.includes('html');
}

/** Reject clearly-binary responses; allow HTML, text/*, JSON, XML and unknown types. */
function isBinaryType(contentType: string): boolean {
  if (!contentType) return false;
  return (
    /^(image|audio|video|font)\//.test(contentType) ||
    /application\/(octet-stream|pdf|zip|gzip|x-tar|x-7z-compressed|wasm)/.test(contentType)
  );
}

/** Readable text of a page: extracted Markdown for HTML, the raw body otherwise. */
function pageText(page: LoadedPage): string {
  return isHtml(page.contentType)
    ? extract(page.body, page.url).markdown || '(no readable content)'
    : page.body.trim();
}

class ToolError extends Error {}

/** Truncate long Markdown to a character budget, appending a clear marker. */
function truncate(markdown: string, maxChars: unknown): string {
  if (typeof maxChars !== 'number' || !Number.isFinite(maxChars) || maxChars <= 0) return markdown;
  const limit = Math.floor(maxChars);
  if (markdown.length <= limit) return markdown;
  return `${markdown.slice(0, limit).trimEnd()}\n\n…[truncated]`;
}

/** Handle one JSON-RPC message; returns the response object, or null for notifications. */
export async function handleRpc(message: unknown): Promise<object | null> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return err(null, -32600, 'Invalid Request: expected a JSON-RPC object');
  }
  const { id, method, params } = message as JsonRpcRequest;

  // Notifications (e.g. notifications/initialized) have no id and need no reply.
  if (id === undefined || id === null) return null;
  if (typeof method !== 'string') return err(id, -32600, 'Invalid Request: "method" must be a string');

  try {
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER,
          instructions:
            'Tools to read the live web as clean Markdown. Pass an absolute http(s) URL.',
        });

      case 'ping':
        return ok(id, {});

      case 'tools/list':
        return ok(id, {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case 'tools/call': {
        const name = (params?.name as string) ?? '';
        const args = (params?.arguments as Record<string, unknown>) ?? {};
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) return err(id, -32602, `Unknown tool: ${name}`);
        try {
          const text = await tool.run(args);
          return ok(id, { content: [{ type: 'text', text }] });
        } catch (e) {
          // Tool-level failures are reported via isError, not JSON-RPC errors,
          // so the agent can read the message and recover.
          const message = e instanceof ToolError || e instanceof ExtractionError ? e.message : messageOf(e);
          return ok(id, { content: [{ type: 'text', text: `Error: ${message}` }], isError: true });
        }
      }

      default:
        return err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return err(id, -32603, messageOf(e));
  }
}

function ok(id: JsonRpcRequest['id'], result: unknown): object {
  return { jsonrpc: '2.0', id, result };
}
function err(id: JsonRpcRequest['id'], code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const MCP_SERVER_INFO = SERVER;
export const MCP_TOOL_NAMES = TOOLS.map((t) => t.name);
