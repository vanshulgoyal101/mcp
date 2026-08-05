/**
 * Query-focused reading: return only the passages of a page that match a
 * query, instead of the whole document.
 *
 * Agents have a limited context budget. `fetch_markdown` returns an entire
 * page; `searchMarkdown` returns just the relevant blocks — each tagged with
 * its heading breadcrumb and ranked by how well it matches — so an agent can
 * ask "find the pricing" and spend a fraction of the tokens.
 *
 * Deterministic and dependency-free: simple case-insensitive term scoring over
 * Markdown blocks, no LLM and no embeddings.
 */

export interface SearchMatch {
  /** Heading breadcrumb for the block, e.g. "Guide › Pricing". Null at the top of a page. */
  heading: string | null;
  /** The matching Markdown block, trimmed to the context budget. */
  snippet: string;
  /** Number of query-term occurrences in the block (higher = more relevant). */
  score: number;
}

const MAX_HEADING_LEVEL = 6;

/**
 * Rank the blocks of a Markdown document by how well they match `query`.
 *
 * @param markdown  The page content (as produced by `extract`).
 * @param query     Space-separated search terms; matching is case-insensitive.
 * @param maxMatches Maximum number of blocks to return (1–50, default 5).
 * @param contextChars Per-snippet character budget (50–4000, default 500).
 */
export function searchMarkdown(
  markdown: string,
  query: string,
  maxMatches = 5,
  contextChars = 500,
): SearchMatch[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const limit = clamp(maxMatches, 1, 50);
  const budget = clamp(contextChars, 50, 4000);

  const headings: (string | null)[] = new Array(MAX_HEADING_LEVEL + 1).fill(null);
  const matches: Array<SearchMatch & { order: number }> = [];
  let order = 0;

  for (const block of splitBlocks(markdown)) {
    const heading = parseHeading(block);
    if (heading) {
      headings[heading.level] = heading.text;
      for (let l = heading.level + 1; l <= MAX_HEADING_LEVEL; l++) headings[l] = null;
      continue;
    }

    const score = scoreBlock(block, terms);
    if (score > 0) {
      matches.push({
        heading: breadcrumb(headings),
        snippet: windowAround(block, terms, budget),
        score,
        order: order++,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score || a.order - b.order);
  return matches.slice(0, limit).map(({ order: _order, ...m }) => m);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Split Markdown into blocks separated by blank lines. */
function splitBlocks(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/** If a block is a single ATX heading line, return its level and text. */
function parseHeading(block: string): { level: number; text: string } | null {
  if (block.includes('\n')) return null;
  const m = /^(#{1,6})\s+(.*)$/.exec(block);
  if (!m) return null;
  return { level: m[1].length, text: m[2].trim() };
}

function breadcrumb(headings: (string | null)[]): string | null {
  const trail = headings.filter((h): h is string => Boolean(h));
  return trail.length ? trail.join(' › ') : null;
}

/** Count case-insensitive occurrences of each term across the block. */
function scoreBlock(block: string, terms: string[]): number {
  const hay = block.toLowerCase();
  let score = 0;
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(term, from);
      if (at === -1) break;
      score++;
      from = at + term.length;
    }
  }
  return score;
}

/**
 * Trim a block to `budget` characters, centred on the first matched term so the
 * relevant text is always visible. Adds ellipses when content is cut.
 */
function windowAround(block: string, terms: string[], budget: number): string {
  const collapsed = block.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= budget) return collapsed;

  const hay = collapsed.toLowerCase();
  let first = collapsed.length;
  for (const term of terms) {
    const at = hay.indexOf(term);
    if (at !== -1 && at < first) first = at;
  }
  if (first === collapsed.length) first = 0;

  let start = Math.max(0, first - Math.floor(budget / 2));
  let end = Math.min(collapsed.length, start + budget);
  start = Math.max(0, end - budget);

  let snippet = collapsed.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < collapsed.length) snippet = `${snippet}…`;
  return snippet;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
