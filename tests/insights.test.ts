import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBalances, personalDebts, entryStatus, spendingInsights, settlementFor, isCancelled, filterEntries } from '../lib/domain.ts';
import type { Entry, ExpensePayload, RepaymentPayload } from '../lib/types.ts';

const expense = (changes:Partial<ExpensePayload> = {}):ExpensePayload => ({kind:'expense',title:'Lunch',amountCents:300,category:'Food & dining',date:'2026-11-02',paidById:'a',participantIds:['a','b','c'],splitMethod:'equal',splitValues:{},portions:{a:100,b:100,c:100},...changes});
const repayment = (changes:Partial<RepaymentPayload> = {}):RepaymentPayload => ({kind:'repayment',title:'Repayment',amountCents:100,date:'2026-11-03',fromId:'b',toId:'a',...changes});
const entry = (payload:Entry['payload'],id='e',creatorId='a'):Entry => ({id,spaceId:'s',creatorId,revision:1,createdAt:`${payload.date}T10:00:00Z`,payload,history:[]});

test('cancelled entries stay in history but never affect balances or debts', () => {
  const entries = [entry(expense(),'live'), entry(expense({cancelled:true,amountCents:999,portions:{a:333,b:333,c:333}}),'gone'), entry(repayment({cancelled:true}),'gone-pay')];
  assert.equal(isCancelled(entries[1].payload), true);
  assert.equal(isCancelled(entries[0].payload), false);
  assert.deepEqual(calculateBalances(['a','b','c'], entries).map(b=>b.netCents), [200,-100,-100]);
  assert.deepEqual(personalDebts('a',['a','b','c'],entries).map(d=>[d.userId,d.netCents,d.items.length]), [['b',100,1],['c',100,1]]);
});

test('cancelled status is shown unless someone disputes the cancellation', () => {
  const cancelled = entry(expense({cancelled:true}));
  assert.equal(entryStatus(cancelled, [], []), 'Cancelled');
  assert.equal(entryStatus(cancelled, [{entryId:'e',revision:1,userId:'b',status:'disputed',reason:'We did eat'}], []), 'Disputed');
});

test('spending insights group active expenses by category and by month, including empty months', () => {
  const entries = [
    entry(expense({amountCents:300,date:'2026-11-02'}),'1'),
    entry(expense({amountCents:600,category:'Transport',date:'2026-09-15',portions:{a:200,b:200,c:200}}),'2'),
    entry(expense({amountCents:900,category:'Transport',date:'2026-11-10',paidById:'b',participantIds:['b','c'],portions:{b:450,c:450}}),'3'),
    entry(expense({amountCents:5000,date:'2026-11-11',cancelled:true,portions:{a:5000}}),'4'),
    entry(repayment(),'5'),
    entry(expense({amountCents:100,date:'2025-01-01',portions:{a:100}}),'old'),
  ];
  const result = spendingInsights(entries,'a','2026-11-17',3);
  assert.equal(result.totalCents, 1900);
  assert.equal(result.yourShareCents, 400);
  assert.equal(result.expenseCount, 4);
  assert.deepEqual(result.categories, [
    {category:'Transport',totalCents:1500,yourShareCents:200,count:2},
    {category:'Food & dining',totalCents:400,yourShareCents:200,count:2},
  ]);
  assert.deepEqual(result.months, [
    {month:'2026-09',totalCents:600,yourShareCents:200},
    {month:'2026-10',totalCents:0,yourShareCents:0},
    {month:'2026-11',totalCents:1200,yourShareCents:100},
  ]);
});

test('month window crosses year boundaries', () => {
  const result = spendingInsights([entry(expense({date:'2025-12-31'}))],'a','2026-02-01',3);
  assert.deepEqual(result.months.map(m=>[m.month,m.totalCents]), [['2025-12',300],['2026-01',0],['2026-02',0]]);
});

test('settlement suggestion pays exactly the pairwise net in the right direction', () => {
  assert.deepEqual(settlementFor('a',{userId:'b',theyOweCents:250,youOweCents:0,netCents:250,items:[]}), {fromId:'b',toId:'a',amountCents:250});
  assert.deepEqual(settlementFor('a',{userId:'b',theyOweCents:0,youOweCents:75,netCents:-75,items:[]}), {fromId:'a',toId:'b',amountCents:75});
  assert.equal(settlementFor('a',{userId:'b',theyOweCents:0,youOweCents:0,netCents:0,items:[]}), null);
});

test('ledger filters combine text, kind, category, person, date range and status', () => {
  const names = new Map([['a','Asha'],['b','Bikash'],['c','Chandra'],['d','Dipa']]);
  const entries = [
    entry(expense({title:'Momo night',description:'Thamel',date:'2026-11-02'}),'1'),
    entry(expense({title:'Bus',category:'Transport',paidById:'b',participantIds:['b','c'],portions:{b:150,c:150},date:'2026-10-01'}),'2'),
    entry(repayment({date:'2026-11-05',fromId:'d'}),'3'),
    entry(expense({title:'Duplicate',cancelled:true}),'4'),
  ];
  const ids = (f:Parameters<typeof filterEntries>[1]) => filterEntries(entries,f,id=>names.get(id)??'').map(e=>e.id);
  assert.deepEqual(ids({}), ['1','2','3','4']);
  assert.deepEqual(ids({text:'thamel'}), ['1']);
  assert.deepEqual(ids({text:'dipa'}), ['3']);
  assert.deepEqual(ids({text:'transport'}), ['2']);
  assert.deepEqual(ids({kind:'repayment'}), ['3']);
  assert.deepEqual(ids({category:'Transport'}), ['2']);
  assert.deepEqual(ids({personId:'c'}), ['1','2','4']);
  assert.deepEqual(ids({from:'2026-11-01',to:'2026-11-04'}), ['1','4']);
  assert.deepEqual(ids({hideCancelled:true}), ['1','2','3']);
});
