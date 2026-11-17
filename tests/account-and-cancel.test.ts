import test from 'node:test';
import assert from 'node:assert/strict';
import { LedgerService } from '../lib/server/service.ts';
import { SQLiteD1 } from './helpers/sqlite-d1.ts';
import { calculateBalances, entryStatus } from '../lib/domain.ts';
import type { ExpenseInput } from '../lib/types.ts';

const expense = (payer:string, participants:string[]):ExpenseInput => ({kind:'expense',title:'Lunch',amountCents:9000,category:'Food & dining',date:'2026-11-01',paidById:payer,participantIds:participants,splitMethod:'equal',splitValues:{}});
async function fixture() {
  const db = new SQLiteD1();
  const service = new LedgerService(db);
  const a = await service.register({username:'alice',password:'secret-123',displayName:'Alice'}, '1');
  const b = await service.register({username:'bob',password:'secret-123',displayName:'Bob'}, '2');
  const c = await service.register({username:'carol',password:'secret-123',displayName:'Carol'}, '3');
  const id = await service.createSpace(a.user, 'Trip');
  const code = (await service.bootstrap(a.user, id)).activeSpace!.code;
  await service.joinSpace(b.user, code);
  return {db,service,a,b,c,id};
}

test('creator cancels an entry: balances drop it, history and review remain, others are notified', async () => {
  const f = await fixture();
  const entryId = await f.service.createEntry(f.a.user, f.id, expense(f.a.user.id,[f.a.user.id,f.b.user.id]));
  await assert.rejects(f.service.setEntryCancelled(f.b.user,f.id,entryId,{expectedRevision:1,reason:'Not mine',cancelled:true}), {status:403});
  await assert.rejects(f.service.setEntryCancelled(f.a.user,f.id,entryId,{expectedRevision:1,reason:' ',cancelled:true}), {status:400});
  await assert.rejects(f.service.setEntryCancelled(f.a.user,f.id,entryId,{expectedRevision:2,reason:'Duplicate',cancelled:true}), {status:409});
  await assert.rejects(f.service.setEntryCancelled(f.a.user,f.id,entryId,{expectedRevision:1,reason:'Duplicate',cancelled:false}), {status:400});
  await f.service.setEntryCancelled(f.a.user,f.id,entryId,{expectedRevision:1,reason:'Duplicate',cancelled:true});

  const state = await f.service.bootstrap(f.b.user, f.id);
  const entry = state.entries.find(e=>e.id===entryId)!;
  assert.equal(entry.revision, 2);
  assert.equal(entry.payload.cancelled, true);
  assert.equal(entry.history.length, 2);
  assert.equal(entry.history[0].payload.cancelled, undefined);
  assert.deepEqual(calculateBalances(state.members.map(m=>m.id),state.entries).map(b=>b.netCents), [0,0]);
  assert.equal(entryStatus(entry,state.reviews,state.disputes,state.members), 'Cancelled');
  const notice = state.notices.find(n=>n.entryId===entryId&&n.revision===2)!;
  assert.equal(notice.type, 'cancelled');
  assert.equal(notice.reason, 'Duplicate');
  assert.equal(state.reviews.find(r=>r.entryId===entryId&&r.revision===2&&r.userId===f.b.user.id)!.status, 'pending');

  await assert.rejects(f.service.reviseEntry(f.a.user,f.id,entryId,{...expense(f.a.user.id,[f.a.user.id]),expectedRevision:2,reason:'Edit'}), {status:409});
  await assert.rejects(f.service.setEntryCancelled(f.a.user,f.id,entryId,{expectedRevision:2,reason:'Again',cancelled:true}), {status:400});

  await f.service.setEntryCancelled(f.a.user,f.id,entryId,{expectedRevision:2,reason:'It was not a duplicate',cancelled:false});
  const restored = await f.service.bootstrap(f.b.user, f.id);
  const back = restored.entries.find(e=>e.id===entryId)!;
  assert.equal(back.revision, 3);
  assert.equal(back.payload.cancelled, undefined);
  assert.deepEqual(calculateBalances(restored.members.map(m=>m.id),restored.entries).map(b=>b.netCents), [4500,-4500]);
  assert.equal(restored.notices.find(n=>n.revision===3)!.type, 'restored');
});

test('a disputed cancellation can be reviewed like any revision', async () => {
  const f = await fixture();
  const entryId = await f.service.createEntry(f.a.user, f.id, expense(f.a.user.id,[f.a.user.id,f.b.user.id]));
  await f.service.setEntryCancelled(f.a.user,f.id,entryId,{expectedRevision:1,reason:'Duplicate',cancelled:true});
  await f.service.reviewEntry(f.b.user,f.id,entryId,{revision:2,action:'dispute',reason:'This was real'});
  const state = await f.service.bootstrap(f.a.user, f.id);
  assert.equal(entryStatus(state.entries[0],state.reviews,state.disputes,state.members), 'Disputed');
});

test('outsiders cannot cancel entries in another space', async () => {
  const f = await fixture();
  const entryId = await f.service.createEntry(f.a.user, f.id, expense(f.a.user.id,[f.a.user.id]));
  await assert.rejects(f.service.setEntryCancelled(f.c.user,f.id,entryId,{expectedRevision:1,reason:'x',cancelled:true}), {status:403});
});

test('people can change their display name, which shows everywhere', async () => {
  const f = await fixture();
  await assert.rejects(f.service.updateProfile(f.a.user,{displayName:'  '}), {status:400});
  await assert.rejects(f.service.updateProfile(f.a.user,{displayName:'x'.repeat(81)}), {status:400});
  const user = await f.service.updateProfile(f.a.user,{displayName:'  Asha  '});
  assert.equal(user.displayName, 'Asha');
  const state = await f.service.bootstrap(f.b.user, f.id);
  assert.equal(state.members.find(m=>m.id===f.a.user.id)!.displayName, 'Asha');
});

test('changing a password needs the current one and signs out every other session', async () => {
  const f = await fixture();
  const other = await f.service.login({username:'alice',password:'secret-123'},'9');
  await assert.rejects(f.service.changePassword(f.a.user,{currentPassword:'wrong-pass',newPassword:'better-pass-1'},'1'), {status:401});
  await assert.rejects(f.service.changePassword(f.a.user,{currentPassword:'secret-123',newPassword:'short'},'1'), {status:400});
  await assert.rejects(f.service.changePassword(f.a.user,{currentPassword:'secret-123',newPassword:'secret-123'},'1'), {status:400});
  const result = await f.service.changePassword(f.a.user,{currentPassword:'secret-123',newPassword:'better-pass-1'},'1');
  assert.equal(await f.service.sessionUser(other.token), null);
  assert.equal(await f.service.sessionUser(f.a.token), null);
  assert.equal((await f.service.sessionUser(result.token))!.id, f.a.user.id);
  await assert.rejects(f.service.login({username:'alice',password:'secret-123'},'1'), {status:401});
  assert.equal((await f.service.login({username:'alice',password:'better-pass-1'},'1')).user.id, f.a.user.id);
});

test('ChatGPT accounts have no password to change', async () => {
  const f = await fixture();
  const user = await f.service.chatgptUser({userId:'gpt-1',displayName:'GPT'});
  await assert.rejects(f.service.changePassword(user,{currentPassword:'whatever-1',newPassword:'better-pass-1'},'1'), {status:400});
});

test('only the owner renames a space or a person without an account', async () => {
  const f = await fixture();
  await assert.rejects(f.service.renameSpace(f.b.user,f.id,'Mine'), {status:403});
  await assert.rejects(f.service.renameSpace(f.c.user,f.id,'Mine'), {status:403});
  await assert.rejects(f.service.renameSpace(f.a.user,f.id,''), {status:400});
  await f.service.renameSpace(f.a.user,f.id,' Pokhara trip ');
  assert.equal((await f.service.bootstrap(f.b.user,f.id)).activeSpace!.name, 'Pokhara trip');

  const dummy = await f.service.addDummyMember(f.a.user,f.id,'Dai');
  await assert.rejects(f.service.renameMember(f.b.user,f.id,dummy,'Brother'), {status:403});
  await assert.rejects(f.service.renameMember(f.a.user,f.id,f.b.user.id,'Robert'), {status:400});
  await f.service.renameMember(f.a.user,f.id,dummy,'Ram dai');
  assert.equal((await f.service.bootstrap(f.a.user,f.id)).members.find(m=>m.id===dummy)!.displayName, 'Ram dai');
});
