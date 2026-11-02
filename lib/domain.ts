import type { ExpenseInput, ExpensePayload, RepaymentInput, RepaymentPayload, Entry, Balance, PersonalDebt, Review, Dispute, Member } from './types.ts';
import { CATEGORIES } from './types.ts';

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function safeNumber(value:bigint):number {
  if (value > MAX || value < -MAX) throw new Error('Amount exceeds the safe integer paisa limit.');
  return Number(value);
}
function money(value:number, positive=false):void {
  if (!Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
    throw new Error(positive ? 'Amount must be positive integer paisa within the safe limit.' : 'Split amount must be nonnegative integer paisa within the safe limit.');
  }
}
function id(value:string):void {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value) throw new Error('A valid member identifier is required.');
}
function date(value:string):void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date must be a valid YYYY-MM-DD calendar date.');
  const [year,month,day]=value.split('-').map(Number);
  const leap=year%4===0 && (year%100!==0 || year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (year<1 || month<1 || month>12 || day<1 || day>days[month-1]) throw new Error('Date must be a valid YYYY-MM-DD calendar date.');
}
function title(value:string):string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Title is required.');
  if(value.trim().length>200) throw new Error('Title must contain at most 200 characters.');
  return value.trim();
}

/** Decimal arithmetic uses BigInt so proportions cannot lose a paisa near the safe limit. */
function decimal(value:number):{units:bigint;scale:number} {
  const [mantissa,exponent='0']=String(value).toLowerCase().split('e');
  const [whole,fraction='']=mantissa.split('.');
  const scale=fraction.length-Number(exponent);
  const units=BigInt(whole+fraction);
  return scale<0 ? {units:units*10n**BigInt(-scale),scale:0} : {units,scale};
}
function allocate(amount:number, weights:bigint[]):number[] {
  const total=weights.reduce((a,b)=>a+b,0n);
  if(total<=0n) throw new Error('Split weights must have a positive total.');
  const dividends=weights.map(weight=>BigInt(amount)*weight);
  const portions=dividends.map(value=>value/total);
  const remaining=Number(BigInt(amount)-portions.reduce((a,b)=>a+b,0n));
  const order=weights.map((_,index)=>index).sort((a,b)=>{
    const ar=dividends[a]%total,br=dividends[b]%total;
    return ar===br ? a-b : ar>br ? -1 : 1;
  });
  for(let i=0;i<remaining;i++) portions[order[i]]+=1n;
  return portions.map(safeNumber);
}

export function splitExpense(input:ExpenseInput):ExpensePayload {
  if(!input || input.kind!=='expense') throw new Error('Expense input is required.');
  const cleanTitle=title(input.title);
  money(input.amountCents,true); date(input.date); id(input.paidById);
  if(!CATEGORIES.some(category=>category===input.category)) throw new Error('Choose a valid category.');
  if(!Array.isArray(input.participantIds) || !input.participantIds.length) throw new Error('Select at least one participant.');
  input.participantIds.forEach(id);
  if(new Set(input.participantIds).size!==input.participantIds.length) throw new Error('Participants cannot be duplicated.');
  if(!input.splitValues || typeof input.splitValues!=='object' || Array.isArray(input.splitValues)) throw new Error('Split values must be a participant map.');
  const people=[...input.participantIds];
  let values:number[];
  if(input.splitMethod==='equal') {
    values=allocate(input.amountCents,people.map(()=>1n));
  } else {
    if(!['exact','percent','shares'].includes(input.splitMethod)) throw new Error('Choose a valid split method.');
    if(Object.keys(input.splitValues).some(key=>!people.includes(key)) || people.some(key=>!Object.hasOwn(input.splitValues,key))) throw new Error('Split values must match the selected participants.');
    const supplied=people.map(key=>input.splitValues[key]);
    if(input.splitMethod==='exact') {
      supplied.forEach(value=>money(value));
      if(supplied.reduce((sum,value)=>sum+BigInt(value),0n)!==BigInt(input.amountCents)) throw new Error('Exact split total must equal the expense amount.');
      values=supplied;
    } else if(input.splitMethod==='percent') {
      if(supplied.some(value=>typeof value!=='number' || !Number.isFinite(value) || value<0 || value>100)) throw new Error('Percentages must be between 0 and 100.');
      const weights=supplied.map(value=>{
        const part=decimal(value);
        if(part.scale>2) throw new Error('Percentage precision is limited to two decimal places.');
        return part.units*10n**BigInt(2-part.scale);
      });
      if(weights.reduce((sum,value)=>sum+value,0n)!==10000n) throw new Error('Percentage split total must equal 100%.');
      values=allocate(input.amountCents,weights);
    } else {
      if(supplied.some(value=>typeof value!=='number' || !Number.isFinite(value) || value<=0 || value>Number.MAX_SAFE_INTEGER)) throw new Error('Every share weight must be positive and within the safe limit.');
      const parts=supplied.map(decimal),scale=Math.max(...parts.map(part=>part.scale));
      values=allocate(input.amountCents,parts.map(part=>part.units*10n**BigInt(scale-part.scale)));
    }
  }
  return {kind:'expense',title:cleanTitle,amountCents:input.amountCents,category:input.category,date:input.date,paidById:input.paidById,participantIds:people,splitMethod:input.splitMethod,splitValues:{...input.splitValues},portions:Object.fromEntries(people.map((person,i)=>[person,values[i]]))};
}

export function validateRepayment(input:RepaymentInput):RepaymentPayload {
  if(!input || input.kind!=='repayment') throw new Error('Repayment input is required.');
  money(input.amountCents,true); date(input.date); id(input.fromId); id(input.toId);
  if(input.fromId===input.toId) throw new Error('Repayment sender and recipient must differ.');
  return {kind:'repayment',title:input.title===undefined || input.title==='' ? 'Repayment' : title(input.title),amountCents:input.amountCents,date:input.date,fromId:input.fromId,toId:input.toId};
}

export function calculateBalances(memberIds:string[],entries:Entry[]):Balance[] {
  const balances=new Map(memberIds.map(userId=>[userId,{paid:0n,share:0n,net:0n}]));
  const member=(userId:string)=>{
    const result=balances.get(userId);
    if(!result) throw new Error('Entry contains an unknown space member.');
    return result;
  };
  for(const {payload:p} of entries) {
    if(p.kind==='expense') {
      member(p.paidById).paid+=BigInt(p.amountCents);
      member(p.paidById).net+=BigInt(p.amountCents);
      for(const userId of p.participantIds) {
        member(userId).share+=BigInt(p.portions[userId]);
        member(userId).net-=BigInt(p.portions[userId]);
      }
    } else {
      member(p.fromId).net+=BigInt(p.amountCents);
      member(p.toId).net-=BigInt(p.amountCents);
    }
  }
  return memberIds.map(userId=>{
    const value=member(userId);
    return {userId,paidCents:safeNumber(value.paid),shareCents:safeNumber(value.share),netCents:safeNumber(value.net)};
  });
}

/** A positive pairwise amount is owed to the viewer; debts never move between pairs. */
export function personalDebts(viewerId:string,memberIds:string[],entries:Entry[]):PersonalDebt[] {
  if(!memberIds.includes(viewerId)) throw new Error('Viewer must be a space member.');
  const debts=new Map(memberIds.filter(userId=>userId!==viewerId).map(userId=>[userId,{net:0n,items:[] as PersonalDebt['items']}]));
  const add=(userId:string,entry:Entry,amount:number)=>{
    if(!amount || userId===viewerId) return;
    const debt=debts.get(userId);
    if(!debt) throw new Error('Entry contains an unknown space member.');
    debt.net+=BigInt(amount);
    debt.items.push({entryId:entry.id,title:entry.payload.title,amountCents:amount});
  };
  for(const entry of entries) {
    const p=entry.payload;
    if(p.kind==='expense') {
      if(p.paidById===viewerId) {
        for(const participant of p.participantIds) add(participant,entry,p.portions[participant]);
      } else if(p.participantIds.includes(viewerId)) add(p.paidById,entry,-p.portions[viewerId]);
    } else if(p.fromId===viewerId) add(p.toId,entry,p.amountCents);
    else if(p.toId===viewerId) add(p.fromId,entry,-p.amountCents);
  }
  return [...debts].map(([userId,debt])=>{
    const netCents=safeNumber(debt.net);
    return {userId,theyOweCents:Math.max(netCents,0),youOweCents:Math.max(-netCents,0),netCents,items:debt.items};
  });
}

export function entryStatus(entry:Entry,reviews:Review[],disputes:Dispute[],members:Pick<Member,'id'|'authType'>[]=[]):string {
  const current=reviews.filter(review=>review.entryId===entry.id && review.revision===entry.revision);
  const unresolved=disputes.filter(dispute=>dispute.entryId===entry.id && dispute.openedRevision<=entry.revision && (dispute.resolvedRevision===null || dispute.resolvedRevision>entry.revision));
  if(unresolved.some(dispute=>dispute.openedRevision===entry.revision) || current.some(review=>review.status==='disputed')) return 'Disputed';
  if(unresolved.length) return 'Correction under review';
  const p=entry.payload;
  const involved=p.kind==='expense' ? new Set([p.paidById,...p.participantIds]) : new Set([p.fromId,p.toId]);
  const exempt=new Set(members.filter(member=>member.authType==='dummy').map(member=>member.id));
  if([...involved].every(userId=>exempt.has(userId) || current.some(review=>review.userId===userId && review.status==='accepted')) && !current.some(review=>review.status==='pending')) return 'Accepted';
  return 'Pending review';
}

export function parseNpr(text:string):number {
  if(typeof text!=='string' || !/^-?\d+(?:\.\d{1,2})?$/.test(text.trim())) throw new Error('Enter rupees with at most two decimal places.');
  const clean=text.trim(),negative=clean.startsWith('-');
  const [whole,fraction='']=clean.replace(/^-/,'').split('.');
  return safeNumber((BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')))*(negative?-1n:1n));
}
export function formatNpr(cents:number):string {
  if(!Number.isSafeInteger(cents)) throw new Error('Amount must be integer paisa within the safe limit.');
  const amount=BigInt(cents),absolute=amount<0n?-amount:amount;
  return `NPR ${amount<0n?'-':''}${String(absolute/100n).replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${String(absolute%100n).padStart(2,'0')}`;
}
