import { describe, it, expect } from 'vitest';
import { extract, extractLinks, ExtractionError } from '../src/extract';

const ARTICLE = `
<!doctype html>
<html>
  <head><title>Page Title Tag</title></head>
  <body>
    <nav><a href="/">Home</a> <a href="/about">About</a> <a href="/login">Login</a></nav>
    <aside class="ads"><a href="/buy">BUY NOW</a></aside>
    <article>
      <h1>The Real Headline</h1>
      <p>This is the first substantial paragraph of the article with enough words to
         look like genuine body content rather than navigation or boilerplate text.</p>
      <p>Here is a second paragraph that also contains a fair amount of readable prose,
         a <a href="/rel">relative link</a>, and more sentences to reinforce the signal.</p>
    </article>
    <footer><a href="/tos">Terms</a> <a href="/privacy">Privacy</a></footer>
    <script>console.log('junk that should never appear');</script>
  </body>
</html>`;

describe('extract', () => {
  it('keeps the article body and drops nav/ads/scripts', () => {
    const result = extract(ARTICLE, 'https://example.com/post');
    expect(result.markdown).toContain('first substantial paragraph');
    expect(result.markdown).toContain('second paragraph');
    expect(result.markdown).not.toContain('BUY NOW');
    expect(result.markdown).not.toContain('junk that should never appear');
    expect(result.markdown).not.toContain('Login');
  });

  it('produces a title, excerpt and a word count', () => {
    const result = extract(ARTICLE, 'https://example.com/post');
    expect(result.title).toBeTruthy();
    expect(result.wordCount).toBeGreaterThan(10);
    expect(typeof result.excerpt === 'string' || result.excerpt === null).toBe(true);
  });

  it('resolves relative links to absolute using the source URL', () => {
    const result = extract(ARTICLE, 'https://example.com/post');
    expect(result.markdown).toContain('https://example.com/rel');
  });

  it('throws ExtractionError when there is no readable content', () => {
    expect(() => extract('<html><body></body></html>', 'https://example.com')).toThrow(
      ExtractionError,
    );
  });
});

describe('extractLinks', () => {
  it('returns absolute http(s) links with anchor text, de-duplicated', () => {
    const links = extractLinks(ARTICLE, 'https://example.com/post');
    const hrefs = links.map((l) => l.href);
    expect(hrefs).toContain('https://example.com/about');
    expect(hrefs).toContain('https://example.com/rel');
    expect(new Set(hrefs).size).toBe(hrefs.length); // no duplicates
    const about = links.find((l) => l.href === 'https://example.com/about');
    expect(about?.text).toBe('About');
  });

  it('skips non-http(s) schemes like mailto: and javascript:', () => {
    const html =
      '<a href="mailto:a@b.com">mail</a><a href="javascript:void(0)">js</a>' +
      '<a href="https://ok.example/x">ok</a>';
    const links = extractLinks(html, 'https://example.com/');
    expect(links.map((l) => l.href)).toEqual(['https://ok.example/x']);
  });

  it('honours the limit argument', () => {
    const html = Array.from({ length: 10 }, (_, i) => `<a href="https://e.com/${i}">${i}</a>`).join('');
    const links = extractLinks(html, 'https://example.com/', 3);
    expect(links.length).toBe(3);
  });
});
