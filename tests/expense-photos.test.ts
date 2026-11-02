import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NodeSqlite } from '../lib/server/node-sqlite.ts';
import { LedgerService } from '../lib/server/service.ts';
import { csvExport, xlsxExport } from '../lib/exports.ts';
import { splitExpense } from '../lib/domain.ts';
import type { ExpenseInput, ExpensePayload } from '../lib/types.ts';

const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jkWQAAAAASUVORK5CYII=';
const upload=()=>({fileName:'Receipt.png',mediaType:'image/png' as const,dataBase64:PNG});
const expense=(payer:string)=>({kind:'expense' as const,title:'Lunch',description:'Shared lunch\nIncludes tip.',amountCents:10001,category:'Food & dining',date:'2026-11-02',paidById:payer,participantIds:[payer],splitMethod:'equal' as const,splitValues:{},photos:[upload()]});
async function fixture(t:{after(fn:()=>void):void}) {
  const db=new NodeSqlite(':memory:',resolve('drizzle')); t.after(()=>db.close());
  const service=new LedgerService(db);
  const {user:owner}=await service.register({username:'owner',displayName:'Owner',password:'test-password'},'owner');
  const {user:member}=await service.register({username:'member',displayName:'Member',password:'test-password'},'member');
  const space=await service.createSpace(owner,'Trip');
  await service.joinSpace(member,(await service.bootstrap(owner,space)).activeSpace!.code);
  return {db,service,owner,member,space};
}

test('description validation preserves text and rejects non-string or oversized notes without changing money',()=>{
  const base=expense('a');
  assert.equal(splitExpense({...base,description:'  Tip included\nThank you.  '}).description,'Tip included\nThank you.');
  assert.equal(splitExpense({...base,description:'a'.repeat(4000)}).description?.length,4000);
  for(const description of ['a'.repeat(4001),{},null]) assert.throws(()=>splitExpense({...base,description} as unknown as ExpenseInput),/description/i);
  assert.equal(splitExpense(base).portions.a,10001);
});

test('expense descriptions and photo metadata persist, while image bodies stay out of bootstrap and exports',async t=>{
  const f=await fixture(t);
  const id=await f.service.createEntry(f.owner,f.space,expense(f.owner.id));
  const state=await f.service.bootstrap(f.member,f.space);
  const payload=state.entries[0].payload as ExpensePayload;
  assert.equal(payload.description,'Shared lunch\nIncludes tip.');
  assert.equal(payload.photos?.length,1);
  const photo=payload.photos![0];
  assert.equal(photo.fileName,'Receipt.png'); assert.equal(photo.uploadedById,f.owner.id);
  assert.equal(JSON.stringify(state).includes(PNG),false);
  const image=await f.service.readExpensePhoto(f.member,f.space,id,photo.id);
  assert.deepEqual(image.bytes,Uint8Array.from(Buffer.from(PNG,'base64')));
  assert.equal(image.mediaType,'image/png');
  const report=await f.service.exportData(f.member,f.space);
  assert.match(csvExport('expenses',report),/Shared lunch/);
  assert.match(csvExport('expenses',report),/Receipt.png/);
  const workbook=new TextDecoder().decode(xlsxExport(report));
  assert.ok(workbook.includes('Includes tip.')); assert.ok(workbook.includes('Receipt.png')); assert.equal(workbook.includes(PNG),false);
});

test('photos require stored account and space/entry membership; clients cannot forge attribution or reuse another entry photo',async t=>{
  const f=await fixture(t);
  const first=await f.service.createEntry(f.owner,f.space,{...expense(f.owner.id),photos:[{...upload(),uploadedById:f.member.id,createdAt:'forged'}]});
  const payload=(await f.service.bootstrap(f.owner,f.space)).entries[0].payload as ExpensePayload;
  const photo=payload.photos![0]; assert.equal(photo.uploadedById,f.owner.id); assert.notEqual(photo.createdAt,'forged');
  const other=await f.service.createSpace(f.owner,'Other');
  await assert.rejects(f.service.readExpensePhoto(f.member,other,first,photo.id),{status:403});
  await assert.rejects(f.service.readExpensePhoto(f.owner,other,first,photo.id),{status:404});
  const second=await f.service.createEntry(f.owner,f.space,{...expense(f.owner.id),photos:[]});
  await assert.rejects(f.service.readExpensePhoto(f.owner,f.space,second,photo.id),{status:404});
  await assert.rejects(f.service.createEntry(f.owner,f.space,{...expense(f.owner.id),photos:[{id:photo.id}]}),{status:400});
  await assert.rejects(f.service.reviseEntry(f.owner,f.space,second,{...expense(f.owner.id),photos:[{id:photo.id}],expectedRevision:1,reason:'Reuse'}),{status:400});
  const dummy=await f.service.addDummyMember(f.owner,f.space,'Guest');
  await assert.rejects(f.service.readExpensePhoto({...f.owner,id:dummy},f.space,first,photo.id),{status:401});
});

test('photo corrections retain server metadata, remove current photos without deleting history, and preserve real reviews',async t=>{
  const f=await fixture(t);
  const input={...expense(f.owner.id),participantIds:[f.owner.id,f.member.id]};
  const id=await f.service.createEntry(f.owner,f.space,input);
  let payload=(await f.service.bootstrap(f.owner,f.space)).entries[0].payload as ExpensePayload;
  const original=payload.photos![0];
  await f.service.reviseEntry(f.owner,f.space,id,{...input,description:'Corrected note',photos:[{id:original.id,fileName:'fake.png',uploadedById:f.member.id},upload()],expectedRevision:1,reason:'Add receipt'});
  let state=await f.service.bootstrap(f.member,f.space); payload=state.entries[0].payload as ExpensePayload;
  assert.deepEqual(payload.photos![0],original); assert.equal(payload.photos!.length,2);
  assert.equal(state.reviews.find(r=>r.revision===2&&r.userId===f.member.id)?.status,'pending');
  await assert.rejects(f.service.reviseEntry(f.member,f.space,id,{...input,photos:[],expectedRevision:2,reason:'Remove'}),{status:403});
  await f.service.reviseEntry(f.owner,f.space,id,{...input,description:undefined,photos:undefined,expectedRevision:2,reason:'Amount-only correction'});
  payload=(await f.service.bootstrap(f.owner,f.space)).entries[0].payload as ExpensePayload;
  assert.equal(payload.description,'Corrected note'); assert.equal(payload.photos!.length,2);
  await f.service.reviseEntry(f.owner,f.space,id,{...input,description:'',photos:[],expectedRevision:3,reason:'Remove photos'});
  state=await f.service.bootstrap(f.owner,f.space); payload=state.entries[0].payload as ExpensePayload;
  assert.equal(payload.photos?.length||0,0); assert.equal(payload.description||'','');
  assert.equal((state.entries[0].history[0].payload as ExpensePayload).photos![0].id,original.id);
  assert.equal((await f.service.readExpensePhoto(f.member,f.space,id,original.id)).bytes.length,Buffer.from(PNG,'base64').length);
  await assert.rejects(f.db.prepare('UPDATE expense_photos SET file_name=? WHERE id=?').bind('tamper',original.id).run(),/immutable/i);
  await assert.rejects(f.db.prepare('DELETE FROM expense_photos WHERE id=?').bind(original.id).run(),/immutable/i);
});

test('invalid photo formats, encoding, dimensions, counts and limits fail before any entry/photo is saved',async t=>{
  const f=await fixture(t);
  const largePng=Buffer.from(PNG,'base64'); largePng.writeUInt32BE(50000,16);
  const invalid=[null,{},[null],[{...upload(),dataBase64:'not base64!'}],[{...upload(),mediaType:'image/svg+xml'}],[{...upload(),mediaType:'image/jpeg'}],[{...upload(),fileName:'x'.repeat(181)}],[{...upload(),dataBase64:largePng.toString('base64')}],[{...upload(),dataBase64:Buffer.alloc(512*1024+1).toString('base64')}],Array.from({length:5},upload)];
  for(const photos of invalid) await assert.rejects(f.service.createEntry(f.owner,f.space,{...expense(f.owner.id),photos}),{status:400});
  assert.equal((await f.service.bootstrap(f.owner,f.space)).entries.length,0);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM expense_photos').first<{n:number}>())?.n,0);
});

test('late entry failure rolls back photos and stale corrections cannot leave orphan image rows',async t=>{
  const f=await fixture(t);
  const id=await f.service.createEntry(f.owner,f.space,expense(f.owner.id));
  await f.service.reviseEntry(f.owner,f.space,id,{...expense(f.owner.id),photos:undefined,expectedRevision:1,reason:'Amount-only correction'});
  await assert.rejects(f.service.reviseEntry(f.owner,f.space,id,{...expense(f.owner.id),expectedRevision:1,reason:'stale'}),{status:409});
  await f.db.prepare("CREATE TRIGGER reject_photo_audit BEFORE INSERT ON audit_events WHEN NEW.action='created' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;").run();
  await assert.rejects(f.service.createEntry(f.owner,f.space,expense(f.owner.id)),/audit unavailable/);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM expense_photos').first<{n:number}>())?.n,1);
  assert.equal((await f.service.bootstrap(f.owner,f.space)).entries.length,1);
});

test('legacy expenses and new photos survive migration and database reopen',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'kittakat-photos-')),file=join(directory,'ledger.sqlite');
  const oldMigrations=join(directory,'old-migrations');
  cpSync(resolve('drizzle'),oldMigrations,{recursive:true,filter:source=>!source.endsWith('0003_expense_photos.sql')});
  let db=new NodeSqlite(file,oldMigrations);
  try {
    let service=new LedgerService(db);
    const {user}=await service.register({username:'owner',displayName:'Owner',password:'test-password'},'owner');
    const space=await service.createSpace(user,'Trip');
    const legacy={...expense(user.id),description:undefined,photos:undefined};
    await service.createEntry(user,space,legacy);
    db.close(); db=new NodeSqlite(file,resolve('drizzle')); service=new LedgerService(db);
    const id=await service.createEntry(user,space,expense(user.id));
    const entry=(await service.bootstrap(user,space)).entries.find(e=>e.id===id)!;
    const photo=(entry.payload as ExpensePayload).photos![0];
    db.close(); db=new NodeSqlite(file,resolve('drizzle')); service=new LedgerService(db);
    assert.equal((await service.bootstrap(user,space)).entries.length,2);
    assert.equal((await service.readExpensePhoto(user,space,id,photo.id)).bytes.length,Buffer.from(PNG,'base64').length);
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});
