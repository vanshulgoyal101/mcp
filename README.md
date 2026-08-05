# mcp.vanshul.com

A public **Model Context Protocol (MCP)** server, running as a Cloudflare
Worker, that lets any AI agent read the live web as clean Markdown. It builds on
the same extraction pipeline as the sibling [`reader/`](../../reader) project
(Mozilla Readability + Turndown), exposed over the MCP **Streamable HTTP**
transport so agentic clients can plug straight in.

## Endpoint

```
POST https://mcp.vanshul.com/mcp     # JSON-RPC 2.0 (MCP)
GET  https://mcp.vanshul.com/health  # { ok: true, tools: [...] }
```

## Tools

| Tool | Input | Returns |
| --- | --- | --- |
| `fetch_markdown` | `{ url, max_chars? }` | The page's main content as clean Markdown (optionally truncated to `max_chars`) |
| `search_page` | `{ url, query, max_matches?, context_chars? }` | Only the passages matching `query`, each with its heading breadcrumb, ranked by relevance — token-efficient alternative to `fetch_markdown` |
| `fetch_metadata` | `{ url }` | JSON: title, byline, siteName, excerpt, wordCount |
| `extract_links` | `{ url, limit? }` | JSON: all outbound http(s) links + anchor text |

## Connect from an MCP client

Remote/HTTP-capable clients (Claude Desktop, Cursor, Continue, …):

```json
{
  "mcpServers": {
    "web-reader": { "url": "https://mcp.vanshul.com/mcp" }
  }
}
```

Stdio-only clients can bridge with `mcp-remote`:

```sh
npx mcp-remote https://mcp.vanshul.com/mcp
```

## Try it with curl

```sh
curl -s https://mcp.vanshul.com/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s https://mcp.vanshul.com/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"fetch_markdown","arguments":{"url":"https://example.com"}}}'

# Return only the passages matching a query (token-efficient):
curl -s https://mcp.vanshul.com/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call",
       "params":{"name":"search_page","arguments":{"url":"https://example.com","query":"more information"}}}'
```

## Layout

```
mcp/
├── src/
│   ├── worker.ts     # entry: routes /mcp, /health, rate limit, CORS
│   ├── mcp.ts        # JSON-RPC dispatch + tool definitions
│   ├── extract.ts    # HTML -> Markdown / links (Readability + Turndown)
│   ├── search.ts     # query-focused passage search over extracted Markdown
│   ├── fetcher.ts    # fetch with timeout, size cap, re-validated redirects
│   └── security.ts   # SSRF guard (block private/internal addresses)
├── public/
│   ├── index.html    # landing page (served for non-API paths)
│   ├── og.png        # social share image (1200×630)
│   ├── og.svg        # social image source
│   ├── robots.txt
│   └── sitemap.xml
├── tests/            # vitest: security, extract, search, mcp dispatch, fetcher, worker
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Develop & deploy

```sh
cd mcp
npm install
npm run typecheck
npm test          # vitest — security, extraction, search, MCP dispatch, fetcher, worker
npm run dev        # local worker at http://localhost:8787  (POST /mcp)
npm run deploy     # wrangler deploy
```

After the first deploy, attach the custom domain `mcp.vanshul.com` in the
Cloudflare dashboard (Workers & Pages → this worker → Settings → Domains), or
uncomment the `[[routes]]` block in `wrangler.toml`.

## Security

- **SSRF-safe:** only public `http(s)` URLs; localhost, private ranges, cloud
  metadata and every redirect hop are blocked/re-validated.
- **Bounded:** 10s fetch timeout, ~3 MB page cap, max 5 redirects, per-IP rate
  limit.
- **Stateless & private:** no page content is stored; extraction is
  deterministic with no LLM in the loop.

## MCP protocol

Implements `initialize`, `ping`, `tools/list`, `tools/call` and notifications
(protocol version `2025-06-18`). Tool failures are returned as
`{ content, isError: true }` so the agent can read the message and recover;
malformed requests use standard JSON-RPC error codes.

## Documentation

- [docs/architecture.md](docs/architecture.md) — modules, request lifecycle, extraction pipeline, limits
- [docs/tools.md](docs/tools.md) — full tool & JSON-RPC API reference with examples
- [docs/security.md](docs/security.md) — SSRF threat model and mitigations
- [docs/deployment.md](docs/deployment.md) — Cloudflare Worker + custom-domain deploy guide

## License

[MIT](./LICENSE) © Vanshul Goyal
