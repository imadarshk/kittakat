import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { LedgerService } from '../../../lib/server/service';
import { ApiError, assertSameOrigin, readClientIp, readSessionToken, sessionCookie } from '../../../lib/server/auth';
import { csvExport, xlsxExport } from '../../../lib/exports';
import type { ExportKind, User } from '../../../lib/types';

export const dynamic = 'force-dynamic';
const json = (data:unknown,status=200,headers:HeadersInit={}) => Response.json(data,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie',...headers}});
const EXPORT_KINDS:ExportKind[] = ['expenses','splits','repayments','balances','history'];

async function readBody(request:Request):Promise<Record<string,unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415,'Send a JSON request body.');
  const reader=request.body?.getReader();
  if (!reader) throw new ApiError(400,'A JSON request body is required.');
  const decoder=new TextDecoder(); let text=''; let size=0;
  while (true) {
    const {done,value}=await reader.read();
    if (done) break;
    size+=value.byteLength;
    if (size>65536) { await reader.cancel(); throw new ApiError(413,'Request body is too large.'); }
    text+=decoder.decode(value,{stream:true});
  }
  text+=decoder.decode();
  let value:unknown;
  try { value=JSON.parse(text); } catch { throw new ApiError(400,'Invalid JSON request body.'); }
  if (!value||typeof value!=='object'||Array.isArray(value)) throw new ApiError(400,'Invalid JSON request body.');
  return value as Record<string,unknown>;
}

async function handle(request:Request):Promise<Response> {
  try {
    const url=new URL(request.url);
    const segments=url.pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean);
    const chatgptEnabled=env.ENABLE_CHATGPT_AUTH==='true';
    if (!env.DB) throw new ApiError(503,'Database is unavailable. Please try again later.');
    const service=new LedgerService(env.DB);
    const token=readSessionToken(request);
    let user:User|null=await service.sessionUser(token);
    if (!user&&chatgptEnabled) {
      const identity=await getChatGPTUser();
      if (identity) user=await service.chatgptUser(identity);
    }
    if (request.method==='GET'&&segments.length===1&&segments[0]==='bootstrap') {
      return json(await service.bootstrap(user,url.searchParams.get('spaceId')||undefined,chatgptEnabled));
    }
    if (request.method==='POST') {
      assertSameOrigin(request);
      const body=await readBody(request);
      const ip=readClientIp(request,env.CLIENT_IP_HEADER);
      if (segments.length===2&&segments[0]==='auth') {
        if (segments[1]==='register'||segments[1]==='login') {
          const result=segments[1]==='register'?await service.register(body,ip):await service.login(body,ip);
          return json({id:result.user.id},200,{'Set-Cookie':sessionCookie(result.token,url.protocol==='https:')});
        }
        if (segments[1]==='logout') {
          await service.logout(token);
          return json({ok:true},200,{'Set-Cookie':sessionCookie('',url.protocol==='https:',true)});
        }
      }
      if (!user) throw new ApiError(401,'Sign in to continue.');
      if (segments[0]==='spaces') {
        if (segments.length===1) return json({id:await service.createSpace(user,body.name)});
        if (segments.length===2&&segments[1]==='join') return json({id:await service.joinSpace(user,body.code)});
        const spaceId=segments[1];
        if (segments.length===3&&segments[2]==='code') { await service.rotateCode(user,spaceId); return json({ok:true}); }
        if (segments.length===3&&segments[2]==='entries') return json({id:await service.createEntry(user,spaceId,body)});
        if (segments.length===5&&segments[2]==='entries') {
          const entryId=segments[3];
          if (segments[4]==='revise') { await service.reviseEntry(user,spaceId,entryId,body); return json({ok:true}); }
          if (segments[4]==='review') { await service.reviewEntry(user,spaceId,entryId,body); return json({ok:true}); }
        }
        if (segments.length===4&&segments[2]==='notifications'&&segments[3]==='read') { await service.markNoticesRead(user,spaceId,body.ids); return json({ok:true}); }
      }
    }
    if (request.method==='GET'&&segments.length===3&&segments[0]==='spaces'&&segments[2]==='export') {
      if (!user) throw new ApiError(401,'Sign in to continue.');
      const format=url.searchParams.get('format')||'csv';
      const kind=url.searchParams.get('type')||'expenses';
      if (format!=='csv'&&format!=='xlsx') throw new ApiError(400,'Choose CSV or Excel format.');
      if (!EXPORT_KINDS.includes(kind as ExportKind)) throw new ApiError(400,'Choose a valid report type.');
      const data=await service.exportData(user,segments[1],url.searchParams.get('from')||undefined,url.searchParams.get('to')||undefined);
      const headers={'Cache-Control':'no-store','Content-Disposition':`attachment; filename="kittakat-${format==='xlsx'?'report':kind}.${format}"`,'X-Content-Type-Options':'nosniff'};
      if (format==='csv') return new Response('\uFEFF'+csvExport(kind as ExportKind,data),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8'}});
      const bytes=xlsxExport(data);
      return new Response(new Uint8Array(bytes).buffer,{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
    }
    throw new ApiError(404,'API endpoint not found.');
  } catch(error) {
    if (error instanceof ApiError) return json({error:error.message},error.status);
    console.error('Kittakat API failure',error instanceof Error ? error.message : 'Unknown error');
    return json({error:'Something went wrong. Please try again.'},500);
  }
}
export const GET=handle;
export const POST=handle;
