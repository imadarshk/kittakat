import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NodeSqlite } from '../lib/server/node-sqlite.ts';
import { LedgerService } from '../lib/server/service.ts';
import { calculateBalances, personalDebts, entryStatus } from '../lib/domain.ts';
import { csvExport, xlsxExport } from '../lib/exports.ts';
import { hashToken } from '../lib/server/auth.ts';
import type { ExpenseInput } from '../lib/types.ts';

async function fixture(t: { after(fn: () => void): void }) {
  const db = new NodeSqlite(':memory:', resolve('drizzle'));
  t.after(() => db.close());
  const service = new LedgerService(db);
  const { user: owner } = await service.register({username:'owner', displayName:'Owner', password:'test-password'}, 'owner');
  const { user: member } = await service.register({username:'member', displayName:'Member', password:'test-password'}, 'member');
  const spaceId = await service.createSpace(owner, 'Trip');
  const state = await service.bootstrap(owner, spaceId);
  await service.joinSpace(member, state.activeSpace!.code);
  return {db, service, owner, member, spaceId};
}
const expense = (payer: string, people: string[]): ExpenseInput => ({kind:'expense', title:'Lunch', amountCents:10001, category:'Food & dining', date:'2026-11-02', paidById:payer, participantIds:people, splitMethod:'equal', splitValues:{}});

test('only the space owner can add a named dummy; names are validated and spaces keep separate identities', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.addDummyMember(f.member, f.spaceId, 'Guest'), {status:403});
  await assert.rejects(f.service.addDummyMember({...f.owner, id:'forged'}, f.spaceId, 'Guest'), {status:401});
  for (const name of [null, {}, '', '  ', 'a'.repeat(81)]) await assert.rejects(f.service.addDummyMember(f.owner, f.spaceId, name), {status:400});
  const guestId = await f.service.addDummyMember(f.owner, f.spaceId, '  बिना खाता  ');
  const state = await f.service.bootstrap(f.member, f.spaceId);
  const guest = state.members.find(m => m.id === guestId)!;
  assert.equal(guest.displayName, 'बिना खाता');
  assert.equal(guest.authType, 'dummy');
  assert.equal(guest.role, 'member');
  const row = await f.db.prepare('SELECT password_hash,chatgpt_id FROM users WHERE id=?').bind(guestId).first();
  assert.deepEqual(row && {...row}, {password_hash:null, chatgpt_id:null});
  const audit = await f.db.prepare("SELECT actor_id FROM audit_events WHERE action='dummy_member_added'").first<{actor_id:string}>();
  assert.equal(audit?.actor_id, f.owner.id);
  const other = await f.service.createSpace(f.owner, 'Other');
  const otherId = await f.service.addDummyMember(f.owner, other, 'बिना खाता');
  assert.notEqual(otherId, guestId);
  assert.equal((await f.service.bootstrap(f.owner, other)).members.some(m => m.id === guestId), false);
  await assert.rejects(f.service.createEntry(f.owner, other, expense(otherId, [guestId])), {status:400});
});

test('dummy creation rolls back identity and membership if the audit cannot be recorded', async t => {
  const f = await fixture(t);
  await f.db.prepare("CREATE TRIGGER reject_dummy_audit BEFORE INSERT ON audit_events WHEN NEW.action='dummy_member_added' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;").run();
  await assert.rejects(f.service.addDummyMember(f.owner, f.spaceId, 'Guest'), /audit unavailable/);
  assert.equal((await f.service.bootstrap(f.owner, f.spaceId)).members.length, 2);
  assert.equal((await f.db.prepare("SELECT count(*) AS n FROM users WHERE auth_type='dummy'").first<{n:number}>())?.n, 0);
});

test('stored dummy identities cannot authenticate or act even with forged auth type or an injected session', async t => {
  const f = await fixture(t);
  const guestId = await f.service.addDummyMember(f.owner, f.spaceId, 'Guest');
  const guest = (await f.service.bootstrap(f.owner, f.spaceId)).members.find(m => m.id === guestId)!;
  const forged = {...guest, authType:'password' as const};
  await assert.rejects(f.service.bootstrap(forged, f.spaceId), {status:401});
  await assert.rejects(f.service.createSpace(forged, 'Forbidden'), {status:401});
  await assert.rejects(f.service.addDummyMember(forged, f.spaceId, 'Another'), {status:401});
  await assert.rejects(f.service.createEntry(forged, f.spaceId, expense(guestId, [guestId])), {status:401});
  const entryId = await f.service.createEntry(f.owner, f.spaceId, expense(f.owner.id, [guestId]));
  for (const action of ['accept', 'dispute']) await assert.rejects(f.service.reviewEntry(forged, f.spaceId, entryId, {revision:1, action, reason:'forged'}), {status:401});
  const token = 'a'.repeat(43);
  await f.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(await hashToken(token), guestId, Date.now()+60000, new Date().toISOString()).run();
  assert.equal(await f.service.sessionUser(token), null);
  await assert.rejects(f.service.login({username:guest.username, password:'test-password'}, 'guest'));
});

test('dummy members share every split method with paisa preserved and may pay without participating', async t => {
  const f = await fixture(t);
  const guest = await f.service.addDummyMember(f.owner, f.spaceId, 'Guest');
  const ids = [f.owner.id, f.member.id, guest];
  const variants = [
    {splitMethod:'equal' as const, splitValues:{}, want:[3334,3334,3333]},
    {splitMethod:'exact' as const, splitValues:{[ids[0]]:2000,[ids[1]]:3000,[guest]:5001}, want:[2000,3000,5001]},
    {splitMethod:'percent' as const, splitValues:{[ids[0]]:50,[ids[1]]:25,[guest]:25}, want:[5001,2500,2500]},
    {splitMethod:'shares' as const, splitValues:{[ids[0]]:1,[ids[1]]:1,[guest]:2}, want:[2500,2500,5001]},
  ];
  for (const variant of variants) {
    const id = await f.service.createEntry(f.member, f.spaceId, {...expense(guest, ids), splitMethod:variant.splitMethod, splitValues:variant.splitValues});
    const state = await f.service.bootstrap(f.owner, f.spaceId);
    const payload = state.entries.find(e => e.id === id)!.payload;
    assert.ok(payload.kind === 'expense');
    assert.deepEqual(ids.map(id => payload.portions[id]), variant.want);
    assert.equal(Object.values(payload.portions).reduce((a,b) => a+b, 0), 10001);
  }
  const id = await f.service.createEntry(f.owner, f.spaceId, expense(guest, [f.owner.id]));
  const state = await f.service.bootstrap(f.owner, f.spaceId);
  const entry = state.entries.find(e => e.id === id)!;
  assert.deepEqual(calculateBalances(ids, [entry]).find(b => b.userId === guest), {userId:guest, paidCents:10001, shareCents:0, netCents:10001});
  assert.equal(personalDebts(f.owner.id, ids, [entry]).find(d => d.userId === guest)?.youOweCents, 10001);
});

test('dummy members never receive reviews or notices; real reviews and corrected disputes still control status', async t => {
  const f = await fixture(t);
  const guest = await f.service.addDummyMember(f.owner, f.spaceId, 'Guest');
  const input = expense(guest, [f.owner.id, f.member.id, guest]);
  const id = await f.service.createEntry(f.owner, f.spaceId, input);
  let state = await f.service.bootstrap(f.owner, f.spaceId);
  assert.equal(entryStatus(state.entries[0], state.reviews, state.disputes, state.members), 'Pending review');
  await f.service.reviewEntry(f.member, f.spaceId, id, {revision:1, action:'dispute', reason:'Wrong amount'});
  await f.service.reviseEntry(f.owner, f.spaceId, id, {...expense(guest, [f.owner.id, guest]), expectedRevision:1, reason:'Removed member'});
  state = await f.service.bootstrap(f.owner, f.spaceId);
  assert.equal(entryStatus(state.entries[0], state.reviews, state.disputes, state.members), 'Correction under review');
  assert.equal(state.reviews.find(r => r.revision === 2 && r.userId === f.member.id)?.status, 'pending');
  await f.service.reviewEntry(f.member, f.spaceId, id, {revision:2, action:'accept'});
  state = await f.service.bootstrap(f.owner, f.spaceId);
  assert.equal(entryStatus(state.entries[0], state.reviews, state.disputes, state.members), 'Accepted');
  assert.equal(state.reviews.some(r => r.userId === guest), false);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM notifications WHERE recipient_id=?').bind(guest).first<{n:number}>())?.n, 0);
  assert.ok((await f.service.bootstrap(f.member, f.spaceId)).notices.some(n => n.type === 'revised'));
  assert.equal(state.entries[0].history.length, 2);
  const report = await f.service.exportData(f.owner, f.spaceId);
  assert.match(csvExport('expenses', report), /Accepted/);
  assert.match(csvExport('splits', report), /Guest/);
  assert.match(csvExport('balances', report), /Guest/);
  assert.match(new TextDecoder().decode(xlsxExport(report)), /Guest/);
});

test('dummy-only expenses and repayments settle immediately; both repayment directions adjust pairwise debt', async t => {
  const f = await fixture(t);
  const guest = await f.service.addDummyMember(f.owner, f.spaceId, 'Guest');
  const other = await f.service.addDummyMember(f.owner, f.spaceId, 'Other guest');
  await f.service.createEntry(f.owner, f.spaceId, expense(guest, [other]));
  await f.service.createEntry(f.owner, f.spaceId, {kind:'repayment', amountCents:4000, date:'2026-11-02', fromId:other, toId:guest});
  await f.service.createEntry(f.owner, f.spaceId, {kind:'repayment', amountCents:1000, date:'2026-11-02', fromId:guest, toId:other});
  const state = await f.service.bootstrap(f.owner, f.spaceId);
  for (const entry of state.entries) assert.equal(entryStatus(entry, state.reviews, state.disputes, state.members), 'Accepted');
  assert.equal(personalDebts(guest, state.members.map(m => m.id), state.entries).find(d => d.userId === other)?.theyOweCents, 7001);
  const report = await f.service.exportData(f.owner, f.spaceId);
  assert.match(csvExport('repayments', report), /Guest,Other guest,10.00,Accepted/);
});

test('dummy identities, shares and exemptions survive reopening an existing persistent database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kittakat-dummy-'));
  const file = join(directory, 'ledger.sqlite');
  let db = new NodeSqlite(file, resolve('drizzle'));
  try {
    let service = new LedgerService(db);
    const {user} = await service.register({username:'owner', displayName:'Owner', password:'test-password'}, 'owner');
    const space = await service.createSpace(user, 'Trip');
    db.close(); db = new NodeSqlite(file, resolve('drizzle')); service = new LedgerService(db);
    const guest = await service.addDummyMember(user, space, 'Guest');
    await service.createEntry(user, space, expense(user.id, [user.id, guest]));
    db.close(); db = new NodeSqlite(file, resolve('drizzle')); service = new LedgerService(db);
    const state = await service.bootstrap(user, space);
    assert.equal(state.members.find(m => m.id === guest)?.authType, 'dummy');
    assert.equal(calculateBalances(state.members.map(m => m.id), state.entries).find(b => b.userId === guest)?.netCents, -5000);
    assert.equal(entryStatus(state.entries[0], state.reviews, state.disputes, state.members), 'Accepted');
  } finally { db.close(); rmSync(directory, {recursive:true, force:true}); }
});
