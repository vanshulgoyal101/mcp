import { describe, it, expect } from 'vitest';
import { searchMarkdown } from '../src/search';

const DOC = `# Product

Intro paragraph about the product with some generic words.

## Pricing

The Pro plan costs $20 per month and includes priority support.

The Free plan costs nothing and is rate limited.

## Features

We support Markdown extraction and link crawling for any page.

### Security

Every request is SSRF guarded and bounded by a size cap.
`;

describe('searchMarkdown', () => {
  it('returns only blocks that match the query', () => {
    const matches = searchMarkdown(DOC, 'plan costs');
    expect(matches.length).toBe(2);
    for (const m of matches) {
      expect(m.snippet.toLowerCase()).toContain('plan');
    }
  });

  it('tags each match with its heading breadcrumb', () => {
    const matches = searchMarkdown(DOC, 'Pro plan');
    expect(matches[0].heading).toBe('Product › Pricing');
  });

  it('builds a nested breadcrumb from deeper headings', () => {
    const matches = searchMarkdown(DOC, 'SSRF guarded');
    expect(matches[0].heading).toBe('Product › Features › Security');
  });

  it('ranks blocks with more term occurrences first', () => {
    const matches = searchMarkdown(DOC, 'plan');
    expect(matches[0].score).toBeGreaterThanOrEqual(matches[1].score);
  });

  it('excludes heading lines from the matches themselves', () => {
    const matches = searchMarkdown(DOC, 'Pricing');
    // "## Pricing" is a heading, so the only body hit is via breadcrumb, not a block.
    expect(matches.every((m) => !m.snippet.startsWith('#'))).toBe(true);
  });

  it('returns nothing for an empty query', () => {
    expect(searchMarkdown(DOC, '   ')).toEqual([]);
  });

  it('returns nothing when there is no match', () => {
    expect(searchMarkdown(DOC, 'kubernetes helm chart')).toEqual([]);
  });

  it('respects the max_matches limit', () => {
    const matches = searchMarkdown(DOC, 'the', 1);
    expect(matches.length).toBe(1);
  });

  it('trims long blocks to the context budget and marks the cut', () => {
    const long = `# Long\n\n${'alpha '.repeat(200)}needle ${'omega '.repeat(200)}`;
    const [match] = searchMarkdown(long, 'needle', 5, 100);
    expect(match.snippet.length).toBeLessThanOrEqual(102); // budget + up to two ellipses
    expect(match.snippet).toContain('needle');
    expect(match.snippet).toContain('…');
  });
});
