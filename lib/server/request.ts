/** A configured origin avoids trusting forwarded host/protocol headers. */
export function normalizeServerRequest(request:Request,publicOrigin?:string):Request {
  if (!publicOrigin) return request;
  const canonical=new URL(publicOrigin);
  const loopback=['localhost','127.0.0.1','[::1]'].includes(canonical.hostname);
  if ((canonical.protocol!=='https:'&&!(canonical.protocol==='http:'&&loopback))||canonical.username||canonical.password||canonical.pathname!=='/'||canonical.search||canonical.hash) throw new Error('Invalid KITTAKAT_PUBLIC_ORIGIN.');
  const url=new URL(request.url);
  url.protocol=canonical.protocol; url.hostname=canonical.hostname; url.port=canonical.port; url.username=''; url.password='';
  return new Request(url,request);
}

/** Yeti's SLB supplies x-real-ip; cf-connecting-ip is untrusted on Yeti. */
export function clientAddress(request:Request,trustYetiProxy:boolean):string {
  if (!trustYetiProxy) return request.headers.get('cf-connecting-ip')||'local';
  const ip=request.headers.get('x-real-ip')?.trim();
  return ip&&ip.length<=64&&/^[0-9a-f:.]+$/i.test(ip)?ip:'local';
}
