import { describe, it, expect } from 'vitest';
import { validateTargetUrl, isPrivateIpLiteral } from '../src/security';

describe('validateTargetUrl', () => {
  it('accepts normal http/https URLs', () => {
    expect(validateTargetUrl('https://example.com/article').ok).toBe(true);
    expect(validateTargetUrl('http://example.com').ok).toBe(true);
  });

  it('rejects empty and malformed input', () => {
    expect(validateTargetUrl('').ok).toBe(false);
    expect(validateTargetUrl('   ').ok).toBe(false);
    expect(validateTargetUrl('not a url').ok).toBe(false);
    expect(validateTargetUrl('example.com').ok).toBe(false); // no protocol
  });

  it('rejects non-http protocols', () => {
    expect(validateTargetUrl('ftp://example.com').ok).toBe(false);
    expect(validateTargetUrl('file:///etc/passwd').ok).toBe(false);
    expect(validateTargetUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateTargetUrl('data:text/html,<h1>x</h1>').ok).toBe(false);
  });

  it('blocks localhost and internal hostnames', () => {
    expect(validateTargetUrl('http://localhost/').ok).toBe(false);
    expect(validateTargetUrl('http://api.internal/').ok).toBe(false);
    expect(validateTargetUrl('http://db.local/').ok).toBe(false);
    expect(validateTargetUrl('http://ip6-localhost/').ok).toBe(false);
  });

  it('blocks private and reserved IPs (SSRF)', () => {
    expect(validateTargetUrl('http://127.0.0.1/').ok).toBe(false);
    expect(validateTargetUrl('http://10.0.0.5/').ok).toBe(false);
    expect(validateTargetUrl('http://192.168.1.1/').ok).toBe(false);
    expect(validateTargetUrl('http://172.16.0.1/').ok).toBe(false);
    expect(validateTargetUrl('http://169.254.169.254/').ok).toBe(false); // cloud metadata
    expect(validateTargetUrl('http://[::1]/').ok).toBe(false);
  });

  it('blocks encoded/short-form loopback IPs (inet_aton SSRF bypasses)', () => {
    expect(validateTargetUrl('http://2130706433/').ok).toBe(false); // decimal 127.0.0.1
    expect(validateTargetUrl('http://0x7f000001/').ok).toBe(false); // hex
    expect(validateTargetUrl('http://0177.0.0.1/').ok).toBe(false); // octal first octet
    expect(validateTargetUrl('http://127.1/').ok).toBe(false); // short form
    expect(validateTargetUrl('http://0/').ok).toBe(false); // 0.0.0.0
    expect(validateTargetUrl('http://3232235777/').ok).toBe(false); // decimal 192.168.0.1
  });

  it('still allows public IPs and hostnames after normalization', () => {
    expect(validateTargetUrl('http://8.8.8.8/').ok).toBe(true);
    expect(validateTargetUrl('http://example.com/').ok).toBe(true);
    expect(validateTargetUrl('http://134744072/').ok).toBe(true); // decimal 8.8.8.8 (public)
  });

  it('returns the parsed URL for accepted input', () => {
    const check = validateTargetUrl('https://example.com/x');
    expect(check.ok).toBe(true);
    expect(check.url?.toString()).toBe('https://example.com/x');
  });
});

describe('isPrivateIpLiteral', () => {
  it('flags private/reserved ranges', () => {
    expect(isPrivateIpLiteral('127.0.0.1')).toBe(true);
    expect(isPrivateIpLiteral('10.1.2.3')).toBe(true);
    expect(isPrivateIpLiteral('172.31.255.255')).toBe(true);
    expect(isPrivateIpLiteral('100.64.0.1')).toBe(true); // CGNAT
    expect(isPrivateIpLiteral('0.0.0.0')).toBe(true);
    expect(isPrivateIpLiteral('::ffff:192.168.0.1')).toBe(true);
    expect(isPrivateIpLiteral('fe80::1')).toBe(true);
    expect(isPrivateIpLiteral('fd00::1')).toBe(true); // unique-local
  });

  it('passes public addresses', () => {
    expect(isPrivateIpLiteral('8.8.8.8')).toBe(false);
    expect(isPrivateIpLiteral('172.32.0.1')).toBe(false); // just outside 172.16/12
    expect(isPrivateIpLiteral('1.1.1.1')).toBe(false);
    expect(isPrivateIpLiteral('example.com')).toBe(false);
  });
});
