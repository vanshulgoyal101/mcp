# Tool & API reference

The server speaks **JSON-RPC 2.0** over a single `POST https://mcp.vanshul.com/mcp`
endpoint (MCP Streamable HTTP transport). It also exposes `GET /health`.

- Protocol version: `2025-06-18`
- Server info: `{ "name": "vanshul-web-reader", "version": "1.0.0" }`
- Capabilities: `{ "tools": { "listChanged": false } }`

## Protocol methods

| Method | Notes |
| --- | --- |
| `initialize` | Returns protocol version, capabilities, server info and instructions. |
| `ping` | Returns `{}`. |
| `tools/list` | Lists the tools below with their JSON Schemas. |
| `tools/call` | Runs a tool by `name` with `arguments`. |
| notifications (no `id`) | Accepted and answered with HTTP `202`, no body. |

Requests may be a single JSON-RPC object or a **batch** (array). Notification entries in a
batch produce no response.

## Tools

### `fetch_markdown`

Fetch a page and return its main content as clean Markdown (nav, ads and boilerplate removed).
Raw Markdown, plain-text and JSON endpoints (e.g. `raw.githubusercontent.com`) are returned
as-is; clearly-binary responses (images, PDFs, archives) are rejected.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | Absolute `http(s)` URL. |
| `max_chars` | number | no | Truncate the Markdown to at most this many characters (appends `…[truncated]`). |

### `search_page`

Fetch a page and return **only the passages that match a query**, each tagged with its
heading breadcrumb and ranked by relevance — a token-efficient alternative to
`fetch_markdown` when you need one detail.

| Argument | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | string | yes | — | Absolute `http(s)` URL. |
| `query` | string | yes | — | Space-separated terms; matching is case-insensitive. |
| `max_matches` | number | no | 5 | Max passages to return (1–50). |
| `context_chars` | number | no | 500 | Per-passage character budget (50–4000). |

Returns JSON: `{ url, query, count, matches: [{ heading, snippet, score }] }`.

### `fetch_metadata`

Fetch a page and return its metadata as JSON (no body): `{ url, title, byline, siteName,
excerpt, wordCount }`.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | Absolute `http(s)` URL. |

### `extract_links`

Fetch a page and return all outbound `http(s)` links with anchor text.

| Argument | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | string | yes | — | Absolute `http(s)` URL. |
| `limit` | number | no | 200 | Max links to return (1–500). |

Returns JSON: `{ url, count, links: [{ text, href }] }`.

## Result shape

Successful `tools/call`:

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": "…" }] } }
```

## Error handling

Two distinct channels:

- **Protocol errors** use standard JSON-RPC codes in an `error` object:

  | Code | Meaning |
  | --- | --- |
  | `-32700` | Parse error (body is not valid JSON) |
  | `-32600` | Invalid request (not a JSON-RPC object / bad `method`) |
  | `-32601` | Method not found |
  | `-32602` | Unknown tool or invalid params |
  | `-32603` | Internal error |

- **Tool failures** (bad URL, blocked address, non-HTML page, page too large, no readable
  content) are returned as a normal result with `isError: true`, so the agent can read the
  message and recover:

  ```json
  { "jsonrpc": "2.0", "id": 1,
    "result": { "content": [{ "type": "text", "text": "Error: …" }], "isError": true } }
  ```

## Examples

```sh
# List tools
curl -s https://mcp.vanshul.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Read a page as Markdown, capped to 4000 chars
curl -s https://mcp.vanshul.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fetch_markdown","arguments":{"url":"https://example.com","max_chars":4000}}}'

# Find just the passages about pricing
curl -s https://mcp.vanshul.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_page","arguments":{"url":"https://example.com","query":"pricing plan"}}}'
```
