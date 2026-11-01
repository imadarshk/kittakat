import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { LedgerService, type SqlDatabase, type SqlStatement } from '../lib/server/service.ts';
import type { ExpenseInput } from '../lib/types.ts';

/** Real SQLite executes the production queries and rollback behavior used by D1. */
class SQLiteD1 implements SqlDatabase {
  raw = new DatabaseSync(':memory:');
  constructor() {
    this.raw.exec('PRAGMA foreign_keys=ON');
    for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(x => x.endsWith('.sql')).sort()) {
      this.raw.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
    }
  }
  prepare(sql:string):SqlStatement {
    let values:unknown[] = [];
    const raw = this.raw;
    const statement:SqlStatement = {
      bind(...args:unknown[]) { if (args.length>100) throw new Error("D1 maximum bound parameters exceeded"); values = args; return statement; },
      async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T|null; },
      async all<T>() { return {results:raw.prepare(sql).all(...values as never[]) as T[]}; },
      async run() { const result = raw.prepare(sql).run(...values as never[]); return {meta:{changes:Number(result.changes)}}; },
    };
    return statement;
  }
  private queue:Promise<unknown> = Promise.resolve();
  async batch(statements:SqlStatement[]) {
    const work = this.queue.then(async () => {
      this.raw.exec('BEGIN IMMEDIATE');
      try { const result = []; for (const s of statements) result.push(await s.run()); this.raw.exec('COMMIT'); return result; }
      catch (error) { this.raw.exec('ROLLBACK'); throw error; }
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
}
const expense = (payer:string, participants:string[]):ExpenseInput => ({kind:'expense',title:'Lunch',amountCents:10001,category:'Food & dining',date:'2026-11-01',paidById:payer,participantIds:participants,splitMethod:'equal',splitValues:{}});
async function fixture() {
  const db = new SQLiteD1();
  let now = Date.now();
  const service = new LedgerService(db, () => now);
  const a = await service.register({username:'alice',password:'secret-123',displayName:'Alice'}, '1');
  const b = await service.register({username:'bob',password:'secret-123',displayName:'Bob'}, '2');
  const c = await service.register({username:'carol',password:'secret-123',displayName:'Carol'}, '3');
  const id = await service.createSpace(a.user, 'Trip');
  const state = await service.bootstrap(a.user, id);
  const code = state.activeSpace!.code;
  await service.joinSpace(b.user, code);
  await service.joinSpace(c.user, code);
  return {db,service,a,b,c,id,code,advance:(ms:number) => {now += ms;}};
}

test('registration enforces normalized uniqueness, sessions expire, logout invalidates, and passwords never leak', async () => {
  const f = await fixture();
  await assert.rejects(f.service.register({username:'ＡLICE',password:'secret-123',displayName:'Clone'}, '4'), {status:409});
  const login = await f.service.login({username:'ALICE',password:'secret-123'}, '1');
  assert.equal((await f.service.sessionUser(login.token))!.id, f.a.user.id);
  assert.equal('password_hash' in login.user, false);
  const stored = f.db.raw.prepare('select token_hash from sessions where user_id = ?').all(f.a.user.id) as {token_hash:string}[];
  assert.ok(stored.every(row => row.token_hash !== login.token));
  await f.service.logout(login.token);
  assert.equal(await f.service.sessionUser(login.token), null);
  f.advance(31 * 86400_000);
  assert.equal(await f.service.sessionUser(f.a.token), null);
});

test('persistent throttling rejects repeated credentials and survives a new service instance', async () => {
  const f = await fixture();
  for (let i=0;i<5;i++) await assert.rejects(f.service.login({username:'alice',password:'bad-password'}, 'attacker'), {status:401});
  const another = new LedgerService(f.db);
  await assert.rejects(another.login({username:'alice',password:'secret-123'}, 'attacker'), {status:429});
  assert.equal((await f.service.login({username:'alice',password:'secret-123'}, 'different-ip')).user.id, f.a.user.id);
});

test('anonymous bootstrap is empty; forged users and foreign space IDs cannot read or mutate records', async () => {
  const f = await fixture();
  const anonymous = await f.service.bootstrap(null, f.id);
  assert.equal(anonymous.user, null); assert.equal(anonymous.activeSpace, null); assert.deepEqual(anonymous.spaces, []);
  const outsider = await f.service.register({username:'outsider',password:'secret-123',displayName:'Outside'}, '4');
  await assert.rejects(f.service.bootstrap(outsider.user, f.id), {status:403});
  await assert.rejects(f.service.createEntry(outsider.user, f.id, expense(f.a.user.id,[f.a.user.id])), {status:403});
  await assert.rejects(f.service.createSpace({...f.a.user,id:'forged'},'Bad'), {status:401});
  await assert.rejects(f.service.createEntry(f.a.user, f.id, expense(outsider.user.id,[f.a.user.id])), {status:400});
  await assert.rejects(f.service.createEntry(f.a.user, f.id, expense(f.a.user.id,[outsider.user.id])), {status:400});
});

test('joins are idempotent and owner-only invitation rotation invalidates the old high entropy code', async () => {
  const f = await fixture();
  assert.ok(f.code.length >= 32);
  assert.equal(await f.service.joinSpace(f.b.user, f.code),f.id);
  assert.equal((await f.service.bootstrap(f.a.user,f.id)).members.length,3);
  await assert.rejects(f.service.rotateCode(f.b.user,f.id),{status:403});
  await f.service.rotateCode(f.a.user,f.id);
  await assert.rejects(f.service.joinSpace(f.b.user,f.code),{status:404});
});

test('entry saves notify only payer and participants and accepting changes no financial payload', async () => {
  const f = await fixture();
  const entryId = await f.service.createEntry(f.a.user,f.id,expense(f.b.user.id,[f.a.user.id]));
  const bob = await f.service.bootstrap(f.b.user,f.id);
  const carol = await f.service.bootstrap(f.c.user,f.id);
  assert.equal(bob.notices.length,1); assert.equal(carol.notices.length,0);
  assert.deepEqual(bob.entries[0].payload.kind === 'expense' && bob.entries[0].payload.portions,{[f.a.user.id]:10001});
  const before = JSON.stringify(bob.entries[0].payload);
  await f.service.reviewEntry(f.b.user,f.id,entryId,{revision:1,action:'accept'});
  const after = await f.service.bootstrap(f.b.user,f.id);
  assert.equal(JSON.stringify(after.entries[0].payload),before);
  await assert.rejects(f.service.reviewEntry(f.c.user,f.id,entryId,{revision:1,action:'accept'}),{status:403});
});

test('creator-only corrections preserve snapshots, reject stale edits/reviews and retain removed participant review', async () => {
  const f = await fixture();
  const entryId = await f.service.createEntry(f.a.user,f.id,expense(f.a.user.id,[f.b.user.id,f.c.user.id]));
  await f.service.reviewEntry(f.b.user,f.id,entryId,{revision:1,action:'dispute',reason:'I did not attend'});
  const corrected = expense(f.a.user.id,[f.c.user.id]);
  await assert.rejects(f.service.reviseEntry(f.b.user,f.id,entryId,{...corrected,expectedRevision:1,reason:'Remove me'}),{status:403});
  await f.service.reviseEntry(f.a.user,f.id,entryId,{...corrected,expectedRevision:1,reason:'Removed Bob'});
  await assert.rejects(f.service.reviseEntry(f.a.user,f.id,entryId,{...corrected,expectedRevision:1,reason:'Stale'}),{status:409});
  await assert.rejects(f.service.reviewEntry(f.c.user,f.id,entryId,{revision:1,action:'accept'}),{status:409});
  let state = await f.service.bootstrap(f.b.user,f.id);
  assert.equal(state.entries[0].history.length,2);
  assert.equal(state.entries[0].history[0].payload.kind === 'expense' && state.entries[0].history[0].payload.participantIds.includes(f.b.user.id),true);
  assert.equal(state.disputes[0].resolvedRevision,null);
  assert.equal(state.reviews.find(r=>r.userId===f.b.user.id&&r.revision===2)?.status,'pending');
  await f.service.reviewEntry(f.b.user,f.id,entryId,{revision:2,action:'accept'});
  state = await f.service.bootstrap(f.b.user,f.id);
  assert.equal(state.disputes[0].resolvedRevision,2);
});

test('separate disputes resolve only for the accepting disputer on a later revision; accepting allows later dispute', async () => {
  const f = await fixture();
  const input = expense(f.a.user.id,[f.b.user.id,f.c.user.id]);
  const entryId = await f.service.createEntry(f.a.user,f.id,input);
  await f.service.reviewEntry(f.b.user,f.id,entryId,{revision:1,action:'dispute',reason:'Wrong amount'});
  await f.service.reviewEntry(f.c.user,f.id,entryId,{revision:1,action:'dispute',reason:'Wrong date'});
  await f.service.reviewEntry(f.b.user,f.id,entryId,{revision:1,action:'accept'});
  assert.equal((await f.service.bootstrap(f.a.user,f.id)).disputes.filter(d=>d.resolvedRevision===null).length,2);
  await f.service.reviseEntry(f.a.user,f.id,entryId,{...input,expectedRevision:1,reason:'Corrected receipt'});
  await f.service.reviewEntry(f.b.user,f.id,entryId,{revision:2,action:'accept'});
  let state = await f.service.bootstrap(f.a.user,f.id);
  assert.equal(state.disputes.find(d=>d.userId===f.b.user.id)?.resolvedRevision,2);
  assert.equal(state.disputes.find(d=>d.userId===f.c.user.id)?.resolvedRevision,null);
  await f.service.reviewEntry(f.b.user,f.id,entryId,{revision:2,action:'dispute',reason:'Still incorrect'});
  state = await f.service.bootstrap(f.a.user,f.id);
  assert.equal(state.disputes.filter(d=>d.resolvedRevision===null).length,2);
});

test('cross-space entry IDs and notice IDs cannot mutate another space or another recipient', async () => {
  const f = await fixture();
  const entryId = await f.service.createEntry(f.a.user,f.id,expense(f.a.user.id,[f.b.user.id]));
  const second = await f.service.createSpace(f.a.user,'Another');
  await assert.rejects(f.service.reviewEntry(f.a.user,second,entryId,{revision:1,action:'accept'}),{status:404});
  await assert.rejects(f.service.reviseEntry(f.a.user,second,entryId,{...expense(f.a.user.id,[f.a.user.id]),expectedRevision:1,reason:'Spoof'}),{status:404});
  const bob = await f.service.bootstrap(f.b.user,f.id);
  await f.service.markNoticesRead(f.a.user,f.id,[bob.notices[0].id]);
  assert.equal((await f.service.bootstrap(f.b.user,f.id)).notices[0].readAt,null);
  await f.service.markNoticesRead(f.b.user,f.id,[bob.notices[0].id]);
  assert.ok((await f.service.bootstrap(f.b.user,f.id)).notices[0].readAt);
});

test('atomic batches roll back losing revision and its notices, reviews and audit', async () => {
  const f = await fixture();
  const entryId = await f.service.createEntry(f.a.user,f.id,expense(f.a.user.id,[f.b.user.id]));
  const input = {...expense(f.a.user.id,[f.b.user.id]),expectedRevision:1,reason:'Correction'};
  // Two reads may see the same revision; one unique revision/guard wins inside D1's atomic batch.
  const outcomes = await Promise.allSettled([f.service.reviseEntry(f.a.user,f.id,entryId,input),f.service.reviseEntry(f.a.user,f.id,entryId,input)]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  const loser = outcomes.find(x=>x.status==='rejected') as PromiseRejectedResult;
  assert.equal(loser.reason.status,409);
  const state = await f.service.bootstrap(f.a.user,f.id);
  assert.equal(state.entries[0].revision,2);
  assert.equal(state.entries[0].history.length,2);
  assert.equal((f.db.raw.prepare("select count(*) n from audit_events where action='revised'").get() as {n:number}).n,1);
});

test('repayment participants and export access are validated against membership', async () => {
  const f = await fixture();
  await f.service.createEntry(f.a.user,f.id,{kind:'repayment',amountCents:100,date:'2026-11-01',fromId:f.b.user.id,toId:f.a.user.id});
  assert.equal((await f.service.bootstrap(f.b.user,f.id)).notices[0].type,'added');
  const outsider = await f.service.register({username:'david',password:'secret-123',displayName:'David'},'4');
  await assert.rejects(f.service.exportData(outsider.user,f.id),{status:403});
  assert.equal((await f.service.exportData(f.a.user,f.id)).entries.length,1);
  await assert.rejects(f.service.exportData(f.a.user,f.id,'2026-02-30'),{status:400});
});

test('aggregate monetary overflow is rejected before persisting a new record or correction', async () => {
  const f = await fixture();
  const input = {...expense(f.a.user.id,[f.b.user.id]),amountCents:Number.MAX_SAFE_INTEGER-10};
  const entryId = await f.service.createEntry(f.a.user,f.id,input);
  await assert.rejects(f.service.createEntry(f.a.user,f.id,{...input,amountCents:11}),{status:400});
  const smallId = await f.service.createEntry(f.a.user,f.id,{...input,amountCents:10});
  await assert.rejects(f.service.reviseEntry(f.a.user,f.id,smallId,{...input,amountCents:11,expectedRevision:1,reason:'Too much'}),{status:400});
  const state = await f.service.bootstrap(f.a.user,f.id);
  assert.equal(state.entries.length,2);
  assert.equal(state.entries.find(e=>e.id===entryId)!.payload.amountCents,Number.MAX_SAFE_INTEGER-10);
  assert.equal(state.entries.find(e=>e.id===smallId)!.revision,1);
});

test('concurrent financial writes assert a space version and cannot jointly overflow balances', async () => {
  const f = await fixture();
  const input = {...expense(f.a.user.id,[f.b.user.id]),amountCents:Number.MAX_SAFE_INTEGER-1};
  await f.service.createEntry(f.a.user,f.id,input);
  const results = await Promise.allSettled([
    f.service.createEntry(f.a.user,f.id,{...input,amountCents:1}),
    f.service.createEntry(f.a.user,f.id,{...input,amountCents:1}),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const state = await f.service.bootstrap(f.a.user,f.id);
  assert.equal(state.entries.length,2);
});

test('ChatGPT identities are stable and cannot link to password accounts with a similar name', async () => {
  const f = await fixture();
  const one = await f.service.chatgptUser({userId:'stable-one',displayName:'Alice'});
  const again = await f.service.chatgptUser({userId:'stable-one',displayName:'Changed'});
  const two = await f.service.chatgptUser({userId:'stable-two',displayName:'Alice'});
  assert.equal(one.id,again.id);
  assert.notEqual(one.id,f.a.user.id);
  assert.notEqual(one.id,two.id);
  assert.equal(one.authType,'chatgpt');
  assert.deepEqual((await f.service.bootstrap(one)).spaces,[]);
});


test('mark-read handles hundreds of explicit notification IDs within the D1 parameter limit', async () => {
  const f = await fixture();
  await f.service.createEntry(f.a.user,f.id,expense(f.a.user.id,[f.b.user.id]));
  const notice = (await f.service.bootstrap(f.b.user,f.id)).notices[0];
  await f.service.markNoticesRead(f.b.user,f.id,[notice.id,...Array.from({length:499},(_,i)=>`missing-${i}`)]);
  assert.ok((await f.service.bootstrap(f.b.user,f.id)).notices[0].readAt);
});

test('creator review is automatic and creators correct entries instead of accepting or disputing them', async () => {
  const f = await fixture();
  const input = expense(f.a.user.id,[f.b.user.id]);
  const entryId = await f.service.createEntry(f.a.user,f.id,input);
  for (const action of ['accept','dispute']) {
    await assert.rejects(f.service.reviewEntry(f.a.user,f.id,entryId,{revision:1,action,reason:'Creator review is automatic'}),{status:403});
  }
  let state = await f.service.bootstrap(f.a.user,f.id);
  assert.equal(state.reviews.find(r=>r.entryId===entryId&&r.userId===f.a.user.id&&r.revision===1)?.status,'accepted');
  assert.equal(state.disputes.length,0);
  await f.service.reviseEntry(f.a.user,f.id,entryId,{...input,amountCents:9900,expectedRevision:1,reason:'Corrected receipt amount'});
  state = await f.service.bootstrap(f.a.user,f.id);
  assert.equal(state.entries[0].revision,2);
  assert.equal(state.reviews.find(r=>r.entryId===entryId&&r.userId===f.a.user.id&&r.revision===2)?.status,'accepted');
});

test('aggregate receivables and payables cannot exceed safe paisa even when individual debts and net balances fit', async () => {
  for (const reverse of [false,true]) {
  const f = await fixture();
  const d = await f.service.register({username:'david',password:'secret-123',displayName:'David'},'4');
  await f.service.joinSpace(d.user,f.code);
  const amountCents = Number.MAX_SAFE_INTEGER;
  const repayment = (fromId:string,toId:string) => ({kind:'repayment',amountCents,date:'2026-11-01',fromId:reverse?toId:fromId,toId:reverse?fromId:toId});
  await f.service.createEntry(f.a.user,f.id,repayment(f.a.user.id,f.b.user.id));
  await f.service.createEntry(d.user,f.id,repayment(d.user.id,f.a.user.id));
  const counts = () => Object.fromEntries(['entries','revisions','notifications','audit_events'].map(table=>[table,(f.db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n]));
  const before = counts();
  await assert.rejects(f.service.createEntry(f.a.user,f.id,repayment(f.a.user.id,f.c.user.id)),{status:400});
  assert.deepEqual(counts(),before);
  assert.equal((await f.service.bootstrap(f.a.user,f.id)).entries.length,2);
  }
});
