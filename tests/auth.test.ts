import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, normalizeUsername, randomToken, hashToken, sessionCookie, assertSameOrigin } from '../lib/server/auth.ts';

test('password hashes are independently salted and verify only the right password', async () => {
  const a = await hashPassword('a-long-password');
  const b = await hashPassword('a-long-password');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('a-long-password', a), true);
  assert.equal(await verifyPassword('wrong-password', a), false);
  assert.equal(await verifyPassword('a-long-password', 'malformed'), false);
  assert.match(a, /^pbkdf2-sha256\$100000\$/);
});

test('Unicode usernames normalize compatibility characters and case without accepting punctuation', () => {
  assert.equal(normalizeUsername('  Ａlice  '), 'alice');
  assert.equal(normalizeUsername('नाम१२३'), 'नाम१२३');
  assert.equal(normalizeUsername('A\u030Angstrom'), normalizeUsername('Ångstrom'));
  for (const value of ['ab', 'a@bc', 'a b c', 'x'.repeat(33), '---', 'abc\u200b']) assert.throws(() => normalizeUsername(value));
});

test('opaque session tokens have entropy, stored digests differ, and cookies are protected', async () => {
  const a = randomToken();
  const b = randomToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 43);
  const digest = await hashToken(a);
  assert.notEqual(digest, a);
  assert.equal(digest, await hashToken(a));
  const cookie = sessionCookie(a, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Domain=/);
});

test('mutations reject cross-origin, missing-origin and null-origin browser requests', () => {
  assert.doesNotThrow(() => assertSameOrigin(new Request('https://example.com/api', { method:'POST', headers:{origin:'https://example.com'} })));
  for (const origin of ['https://evil.test', 'null', '']) {
    assert.throws(() => assertSameOrigin(new Request('https://example.com/api', { method:'POST', headers: origin ? {origin} : {} })));
  }
});

test('trusted Node proxy IP ignores forged Cloudflare IP and separates real clients', async () => {
  const {readClientIp}=await import('../lib/server/auth.ts');
  const a=new Request('https://kittakat.duckdns.org/api/auth/login',{headers:{'x-real-ip':'203.0.113.10','cf-connecting-ip':'198.51.100.99'}});
  const b=new Request(a.url,{headers:{'x-real-ip':'203.0.113.11','cf-connecting-ip':'198.51.100.99'}});
  assert.equal(readClientIp(a,'x-real-ip'),'203.0.113.10');
  assert.equal(readClientIp(b,'x-real-ip'),'203.0.113.11');
  assert.equal(readClientIp(new Request(a.url,{headers:{'cf-connecting-ip':'198.51.100.99'}}),'x-real-ip'),'local');
});
