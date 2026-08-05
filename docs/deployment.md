# Deployment

The server runs as a Cloudflare Worker with a custom domain at `mcp.vanshul.com`.

## Prerequisites

- A Cloudflare account (free plan is sufficient).
- `vanshul.com` managed as a **Cloudflare zone** (nameservers pointed at Cloudflare) — this
  is required for a Worker custom domain. Without it, deploy to a `*.workers.dev` subdomain
  instead.
- `wrangler` authenticated: `npx wrangler login`.

## Configuration (`wrangler.toml`)

```toml
name = "vanshul-mcp"
main = "src/worker.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./public"          # serves the landing page for non-API paths

[[routes]]
pattern = "mcp.vanshul.com"     # Cloudflare creates the DNS record + TLS cert
custom_domain = true
```

`nodejs_compat` is required so linkedom / Readability / Turndown run in the Workers runtime.

## Commands

```sh
cd mcp
npm install
npm run typecheck    # tsc --noEmit
npm test             # vitest — full suite
npm run dev          # local worker at http://localhost:8787  (POST /mcp)
npm run deploy       # wrangler deploy
```

## First deploy

1. `npm run deploy`. With the `[[routes]]` block above, Cloudflare provisions the
   `mcp.vanshul.com` DNS record and TLS certificate automatically.
2. If you deploy **without** a custom domain, wrangler will ask you to register a
   `*.workers.dev` subdomain; the server is then reachable there.

## Verify

```sh
curl -s https://mcp.vanshul.com/health
# {"ok":true,"server":{"name":"vanshul-web-reader","version":"1.0.0"},"tools":[…]}

curl -s https://mcp.vanshul.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

If DNS was only just moved to Cloudflare, global resolution can lag until nameserver
propagation completes; you can verify the deployment early by querying Cloudflare's
authoritative nameserver directly:

```sh
ip=$(dig @<zone-ns>.ns.cloudflare.com mcp.vanshul.com +short | tail -1)
curl -s --resolve mcp.vanshul.com:443:"$ip" https://mcp.vanshul.com/health
```

## Connect an MCP client

```json
{ "mcpServers": { "web-reader": { "url": "https://mcp.vanshul.com/mcp" } } }
```

Stdio-only clients bridge with `npx mcp-remote https://mcp.vanshul.com/mcp`.

## Cost & limits

The Workers free plan (100k requests/day, ~10 ms CPU per request) is ample for personal use.
Extraction of unusually large pages can approach the free-tier CPU limit; the Workers Paid
plan ($5/mo) raises it to 30 s per request if that ever becomes an issue.
