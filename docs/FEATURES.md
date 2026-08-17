# Features — mcp.vanshul.com (MCP server)

> **TL;DR** — Capability catalog: ✅ shipped, 🔜 proposed, ⛔ non-goal. A public MCP
> server (Cloudflare Worker) that lets any AI agent **read the live web as clean
> Markdown**. Sibling to [`ctx`](../../ctx) (repos/docs) and [`reader`](../../reader).

**Legend:** ✅ shipped · 🔜 proposed/potential · ⛔ deliberate non-goal.

## MCP tools (✅ shipped)

| Tool | Returns |
|------|---------|
| `fetch_markdown` | the page's main content as clean Markdown (optional `max_chars`) |
| `search_page` | only the passages matching a query, each with heading breadcrumb, ranked — token-efficient vs. fetching the whole page |
| `fetch_metadata` | JSON: title, byline, siteName, excerpt, wordCount |
| `extract_links` | JSON: all outbound http(s) links + anchor text |

## Platform (✅)

- ✅ **Cloudflare Worker**, JSON-RPC 2.0 over MCP **Streamable HTTP** at `POST /mcp`;
  `GET /health` (`{ ok, tools }`).
- ✅ **Extraction pipeline** — Mozilla Readability + Turndown (same engine as
  [`reader`](../../reader)).
- ✅ **SSRF-guarded** fetching (http/https only; blocks localhost/private/metadata
  ranges; redirect re-validation); body/time limits + per-IP rate limit.
- ✅ **Listed in the MCP Registry** (`io.github.vanshulgoyal101/mcp`); bridged for
  stdio clients via `npx mcp-remote`.

## Proposed / potential 🔜

- Response caching for hot URLs; readability tuning per site class; optional
  screenshot/OG extraction.

## Non-goals ⛔

- **LLM/summarization** — returns clean content + matches; the agent reasons.
- **Rendering JS-heavy SPAs** — deterministic HTML extraction, no headless browser.
