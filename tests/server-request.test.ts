import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerRequest, clientAddress } from '../lib/server/request.ts';
import { assertSameOrigin } from '../lib/server/auth.ts';

test('canonical public origin preserves the body while allowing only matching browser origins', async () => {
  const request=new Request('http://localhost:3000/api/auth/register',{method:'POST',headers:{Origin:'https://kittakat.duckdns.org','Content-Type':'application/json'},body:'{"username":"test"}'});
  const normalized=normalizeServerRequest(request,'https://kittakat.duckdns.org');
  assert.equal(normalized.url,'https://kittakat.duckdns.org/api/auth/register');
  assertSameOrigin(normalized);
  assert.deepEqual(await normalized.json(),{username:'test'});
  assert.throws(()=>assertSameOrigin(normalizeServerRequest(new Request('http://localhost/api/auth/login',{method:'POST',headers:{Origin:'https://attacker.invalid'}}),'https://kittakat.duckdns.org')),{status:403});
});

test('public origin rejects plaintext nonlocal URLs and URLs containing credentials, paths or queries', () => {
  const request=new Request('http://localhost/api/bootstrap');
  for(const origin of ['http://kittakat.duckdns.org','https://user:pass@example.com','https://example.com/path','https://example.com?x=1','https://example.com#hash']) assert.throws(()=>normalizeServerRequest(request,origin));
  assert.equal(normalizeServerRequest(request,'http://127.0.0.1:5187').url,'http://127.0.0.1:5187/api/bootstrap');
});

test('Yeti mode ignores forged Cloudflare client IP headers and uses the proxy-provided address', () => {
  const req=new Request('https://kittakat.duckdns.org',{headers:{'cf-connecting-ip':'forged','x-real-ip':'27.34.64.242','x-forwarded-for':'spoofed, 27.34.64.242'}});
  assert.equal(clientAddress(req,true),'27.34.64.242');
  assert.equal(clientAddress(new Request(req,{headers:{'cf-connecting-ip':'forged'}}),true),'local');
  assert.equal(clientAddress(req,false),'forged');
});
