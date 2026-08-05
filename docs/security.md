# Security

The tools fetch **any URL an agent supplies**, so the primary risk is
[Server-Side Request Forgery (SSRF)](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery):
tricking the server into reaching internal or cloud-metadata addresses. The design blocks
that at every hop and bounds every request.

## Threat model

| Threat | Mitigation | Code |
| --- | --- | --- |
| Fetch `http://localhost` / `.internal` hostnames | Host allow-list check | `security.ts` |
| Fetch private / reserved IP literals | `isPrivateIpLiteral` (IPv4 + IPv6) | `security.ts` |
| Fetch cloud metadata `169.254.169.254` | Blocked by `169.254.0.0/16` rule | `security.ts` |
| Non-HTTP schemes (`file:`, `ftp:`, `javascript:`, `data:`) | Protocol allow-list (`http`/`https`) | `security.ts` |
| **Redirect** from an allowed URL to an internal one | Manual redirect following, each hop re-validated | `fetcher.ts` |
| Huge / slow responses (DoS) | 10 s timeout, ~3 MB streamed cap, ≤5 redirects | `fetcher.ts` |
| Request floods | 60 req/min per IP | `worker.ts` |
| Non-HTML upstream | Content-Type must contain `html` | `mcp.ts` |
| MIME sniffing | `x-content-type-options: nosniff` on every response | `worker.ts` |

## Blocked address ranges

**IPv4:** `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT), `127.0.0.0/8` (loopback),
`169.254.0.0/16` (link-local + metadata), `172.16.0.0/12`, `192.168.0.0/16`.

**IPv6:** `::` (unspecified), `::1` (loopback), `fe80::/10` (link-local), `fc00::/7`
(unique-local), and `::ffff:a.b.c.d` IPv4-mapped addresses (re-checked against the IPv4
rules).

**Hostnames:** `localhost`, `ip6-localhost`, `ip6-loopback`, and any host ending in
`.local`, `.internal` or `.localhost`.

## Redirect safety

A naive `fetch(url, { redirect: 'follow' })` would let an *allowed* page 302-redirect to
`http://127.0.0.1/` or the metadata endpoint. `fetchPage` instead uses `redirect: 'manual'`
and re-runs `validateTargetUrl` on **every** `Location` before following it. An invalid or
blocked hop throws; more than five hops throws.

## Out of scope

Workers cannot perform raw DNS resolution, so **DNS-rebinding** (a public hostname that
resolves to a private IP) is not defended against here. For a personal tool this is an
accepted limitation; a hardened deployment would resolve and pin the IP before fetching.

## Privacy

No page content is stored and there is no LLM in the loop — extraction is deterministic
(Readability + Turndown). The server keeps only an in-memory, per-isolate rate-limit counter.
