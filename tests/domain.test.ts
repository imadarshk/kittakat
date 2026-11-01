import test from 'node:test';
import assert from 'node:assert/strict';
import { splitExpense, validateRepayment, calculateBalances, personalDebts, entryStatus, parseNpr, formatNpr } from '../lib/domain.ts';
import type { ExpenseInput, Entry, Review, Dispute } from '../lib/types.ts';

const expense = (changes: Partial<ExpenseInput> = {}): ExpenseInput => ({kind:'expense', title:'Lunch', amountCents:100, category:'Food & dining', date:'2024-02-29', paidById:'a', participantIds:['a','b','c'], splitMethod:'equal', splitValues:{}, ...changes});
const entry = (payload: Entry['payload'], id='e'): Entry => ({id,spaceId:'s',creatorId:'a',revision:1,createdAt:'2024-02-29T10:00:00Z',payload,history:[]});

test('equal split preserves every paisa and breaks ties in participant input order', () => {
  assert.deepEqual(splitExpense(expense()).portions, {a:34,b:33,c:33});
  assert.deepEqual(splitExpense(expense({participantIds:['c','b','a']})).portions, {c:34,b:33,a:33});
});
test('payer can be excluded and exact splits preserve specified zero shares', () => {
  assert.deepEqual(splitExpense(expense({participantIds:['b','c'],splitMethod:'exact',splitValues:{b:100,c:0}})).portions,{b:100,c:0});
  assert.throws(() => splitExpense(expense({splitMethod:'exact',splitValues:{a:33,b:33,c:33}})), /total|sum/i);
});
test('percentage split uses hundredth-percent precision and largest remainder', () => {
  assert.deepEqual(splitExpense(expense({splitMethod:'percent',splitValues:{a:33.33,b:33.33,c:33.34}})).portions,{a:33,b:33,c:34});
  assert.deepEqual(splitExpense(expense({amountCents:10000,participantIds:['a','b'],splitMethod:'percent',splitValues:{a:0.29,b:99.71}})).portions,{a:29,b:9971});
  assert.throws(() => splitExpense(expense({splitMethod:'percent',splitValues:{a:33.333,b:33.333,c:33.334}})), /precision|decimal/i);
  assert.throws(() => splitExpense(expense({splitMethod:'percent',splitValues:{a:33,b:33,c:33}})), /100|total|sum/i);
});
test('weighted shares support fractional positive weights and reject zero or negative weights', () => {
  assert.deepEqual(splitExpense(expense({splitMethod:'shares',splitValues:{a:0.5,b:1,c:1.5}})).portions,{a:17,b:33,c:50});
  for (const bad of [0,-1,Infinity,NaN]) assert.throws(() => splitExpense(expense({splitMethod:'shares',splitValues:{a:bad,b:1,c:1}})));
});
test('maximum safe amount never loses precision during allocation', () => {
  assert.deepEqual(splitExpense(expense({amountCents:Number.MAX_SAFE_INTEGER})).portions,{a:3002399751580331,b:3002399751580330,c:3002399751580330});
});
test('expenses validate actual calendar dates, identifiers, totals and numeric boundaries', () => {
  for (const amountCents of [0,-1,1.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(() => splitExpense(expense({amountCents})));
  for (const date of ['2023-02-29','2024-04-31','2024-2-01','0000-01-01','2024-01-01T12:00:00Z']) assert.throws(() => splitExpense(expense({date})), /date/i);
  for (const participantIds of [[],['a','a'],['']]) assert.throws(() => splitExpense(expense({participantIds})));
  assert.throws(() => splitExpense(expense({title:'  '})), /title/i);
  assert.throws(() => splitExpense(expense({category:'not a category'})), /category/i);
  assert.throws(() => splitExpense(expense({splitMethod:'exact',splitValues:{a:34,b:33,c:33,outsider:0}})), /participant|split/i);
  assert.throws(() => splitExpense(expense({splitMethod:'exact',splitValues:{a:34,b:33}})), /participant|split/i);
});
test('repayments reject self transfers, invalid dates and invalid amounts, and default the title', () => {
  assert.deepEqual(validateRepayment({kind:'repayment',amountCents:100,date:'2024-02-29',fromId:'b',toId:'a'}), {kind:'repayment',title:'Repayment',amountCents:100,date:'2024-02-29',fromId:'b',toId:'a'});
  assert.throws(() => validateRepayment({kind:'repayment',amountCents:100,date:'2024-02-29',fromId:'a',toId:'a'}));
  assert.throws(() => validateRepayment({kind:'repayment',amountCents:1.5,date:'2024-02-29',fromId:'b',toId:'a'}));
  assert.throws(() => validateRepayment({kind:'repayment',amountCents:100,date:'2023-02-29',fromId:'b',toId:'a'}));
});

test('balances reconcile expense paid, own share and repayment effects including excluded payer', () => {
  const entries = [entry(splitExpense(expense({amountCents:1000,participantIds:['b','c']}))), entry(validateRepayment({kind:'repayment',amountCents:200,date:'2024-02-29',fromId:'b',toId:'a'}),'r')];
  assert.deepEqual(calculateBalances(['a','b','c','d'], entries),[
    {userId:'a',paidCents:1000,shareCents:0,netCents:800},
    {userId:'b',paidCents:0,shareCents:500,netCents:-300},
    {userId:'c',paidCents:0,shareCents:500,netCents:-500},
    {userId:'d',paidCents:0,shareCents:0,netCents:0},
  ]);
});
test('personal debts offset only the same pair and repayments reduce the correct debt', () => {
  const entries = [
    entry(splitExpense(expense({amountCents:1000,participantIds:['b']})),'ab'),
    entry(splitExpense(expense({amountCents:400,paidById:'b',participantIds:['a']})),'ba'),
    entry(splitExpense(expense({amountCents:300,paidById:'c',participantIds:['b']})),'cb'),
    entry(validateRepayment({kind:'repayment',amountCents:200,date:'2024-02-29',fromId:'b',toId:'a'}),'r'),
  ];
  assert.deepEqual(personalDebts('a',['a','b','c','d'],entries),[
    {userId:'b',theyOweCents:400,youOweCents:0,netCents:400,items:[{entryId:'ab',title:'Lunch',amountCents:1000},{entryId:'ba',title:'Lunch',amountCents:-400},{entryId:'r',title:'Repayment',amountCents:-200}]},
    {userId:'c',theyOweCents:0,youOweCents:0,netCents:0,items:[]},
    {userId:'d',theyOweCents:0,youOweCents:0,netCents:0,items:[]},
  ]);
  assert.equal(personalDebts('b',['a','b','c'],entries)[0].netCents,-400);
});
test('aggregation fails explicitly rather than returning unsafe integer totals', () => {
  const huge = entry(splitExpense(expense({amountCents:Number.MAX_SAFE_INTEGER,participantIds:['b']})));
  assert.throws(() => calculateBalances(['a','b'],[huge,{...huge,id:'other'}]),/safe|limit|large/i);
  assert.throws(() => personalDebts('a',['a','b'],[huge,{...huge,id:'other'}]),/safe|limit|large/i);
});

test('disputes persist through corrections and resolve independently including removed participants', () => {
  const e={...entry(splitExpense(expense({participantIds:['a']}))),revision:2};
  const accepted:Review[]=[{entryId:'e',revision:2,userId:'a',status:'accepted',reason:''}];
  const disputes:Dispute[]=[{id:'db',entryId:'e',userId:'b',openedRevision:1,reason:'Wrong split',resolvedRevision:null},{id:'dc',entryId:'e',userId:'c',openedRevision:1,reason:'Wrong date',resolvedRevision:null}];
  assert.equal(entryStatus(e,accepted,disputes),'Correction under review');
  assert.equal(entryStatus(e,accepted,[{...disputes[0],resolvedRevision:2},disputes[1]]),'Correction under review');
  assert.equal(entryStatus(e,accepted,disputes.map(d=>({...d,resolvedRevision:2}))),'Accepted');
  assert.equal(entryStatus(e,accepted,[{...disputes[1],openedRevision:2}]),'Disputed');
});
test('review status ignores old revisions and unrelated entries', () => {
  const e=entry(splitExpense(expense()));
  const reviews:Review[]=[{entryId:'other',revision:1,userId:'a',status:'disputed',reason:'Other'}, {entryId:'e',revision:0,userId:'a',status:'accepted',reason:''}];
  assert.equal(entryStatus(e,reviews,[]),'Pending review');
  assert.equal(entryStatus(e,['a','b','c'].map(userId=>({entryId:'e',revision:1,userId,status:'accepted' as const,reason:''})),[]),'Accepted');
});
test('NPR parsing and formatting preserve decimal paisa and maximum safe precision', () => {
  assert.equal(parseNpr(' 0012.30 '),1230);
  assert.equal(parseNpr('0.29'),29);
  assert.equal(parseNpr('90071992547409.91'),Number.MAX_SAFE_INTEGER);
  for (const text of ['', '12.345', '1e3', 'NaN', '1,000', '90071992547409.92']) assert.throws(() => parseNpr(text));
  assert.equal(formatNpr(123456),'NPR 1,234.56');
  assert.equal(formatNpr(-1),'NPR -0.01');
  assert.equal(formatNpr(Number.MAX_SAFE_INTEGER),'NPR 90,071,992,547,409.91');
  assert.throws(() => formatNpr(0.1));
});
