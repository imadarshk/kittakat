import type { ExportKind, ExportData } from './types.ts';
import { calculateBalances, entryStatus } from './domain.ts';

type Cell = string | number | {cents:number};
type Table = {name:string; rows:Cell[][]};
const KINDS:ExportKind[]=['expenses','splits','repayments','balances','history'];
const SHEETS=['Expenses','Splits','Repayments','Balances (all-time)','History'];

function validDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0,10)===value;
}
function validateFilters(data:ExportData):void {
  if((data.from && !validDate(data.from)) || (data.to && !validDate(data.to))) throw new Error('Report filters require valid YYYY-MM-DD dates.');
  if(data.from && data.to && data.from>data.to) throw new Error('Report date range must start before it ends.');
}
function table(kind:ExportKind,data:ExportData):Table {
  validateFilters(data);
  const index=KINDS.indexOf(kind);
  if(index<0) throw new Error('Choose a valid report type.');
  const name=(id:string)=>data.members.find(member=>member.id===id)?.displayName ?? id;
  const inRange=(date:string)=>(!data.from || date>=data.from) && (!data.to || date<=data.to);
  const entries=data.entries.filter(entry=>inRange(entry.payload.date));
  let rows:Cell[][];
  if(kind==='expenses') {
    rows=[['Entry ID','Date','Title','Category','Paid by','Amount (NPR)','Split method','Participants','Status','Revision']];
    for(const entry of entries) {
      const p=entry.payload;
      if(p.kind!=='expense') continue;
      rows.push([entry.id,p.date,p.title,p.category,name(p.paidById),{cents:p.amountCents},p.splitMethod,p.participantIds.map(name).join('; '),entryStatus(entry,data.reviews,data.disputes),entry.revision]);
    }
  } else if(kind==='splits') {
    rows=[['Entry ID','Date','Title','Member ID','Member','Share (NPR)','Paid by','Split method']];
    for(const entry of entries) {
      const p=entry.payload;
      if(p.kind!=='expense') continue;
      for(const person of p.participantIds) rows.push([entry.id,p.date,p.title,person,name(person),{cents:p.portions[person]},name(p.paidById),p.splitMethod]);
    }
  } else if(kind==='repayments') {
    rows=[['Entry ID','Date','Title','From','To','Amount (NPR)','Status','Revision']];
    for(const entry of entries) {
      const p=entry.payload;
      if(p.kind!=='repayment') continue;
      rows.push([entry.id,p.date,p.title,name(p.fromId),name(p.toId),{cents:p.amountCents},entryStatus(entry,data.reviews,data.disputes),entry.revision]);
    }
  } else if(kind==='balances') {
    rows=[['Member ID','Member','Paid (NPR, all-time)','Own share (NPR, all-time)','Net balance (NPR, all-time)','Period']];
    for(const balance of calculateBalances(data.members.map(member=>member.id),data.entries)) rows.push([balance.userId,name(balance.userId),{cents:balance.paidCents},{cents:balance.shareCents},{cents:balance.netCents},'All-time current balance']);
  } else {
    rows=[['Entry ID','Revision','Recorded at','Actor','Reason','Kind','Entry date','Title','Amount (NPR)','Payload snapshot (JSON)']];
    for(const entry of data.entries) {
      const history=entry.history.length ? entry.history : [{revision:entry.revision,payload:entry.payload,reason:'Created',actorId:entry.creatorId,createdAt:entry.createdAt}];
      for(const revision of history) {
        if(!inRange(revision.createdAt.slice(0,10))) continue;
        const p=revision.payload;
        rows.push([entry.id,revision.revision,revision.createdAt,name(revision.actorId),revision.reason,p.kind,p.date,p.title,{cents:p.amountCents},JSON.stringify(p)]);
      }
    }
  }
  return {name:SHEETS[index],rows};
}

/** Keep the decimal literal exact rather than dividing a near-limit number by 100. */
function amount(cents:number):string {
  if(!Number.isSafeInteger(cents)) throw new Error('Report amount exceeds the safe integer paisa limit.');
  const value=BigInt(cents),absolute=value<0n?-value:value;
  return `${value<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;
}
function csvCell(cell:Cell):string {
  let value:string;
  if(typeof cell==='number') value=String(cell);
  else if(typeof cell==='object') value=amount(cell.cents);
  else {
    // Quoting alone does not stop spreadsheet software interpreting user text as a formula.
    value=/^[\s\u0000-\u001f]*[=+\-@]/u.test(cell) || /^[\t\r\n]/.test(cell) ? `'${cell}` : cell;
  }
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g,'""')}"` : value;
}
export function csvExport(kind:ExportKind,data:ExportData):string {
  return table(kind,data).rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

function xml(value:string):string {
  return Array.from(value).filter(character=>{
    const point=character.codePointAt(0)!;
    return point===9 || point===10 || point===13 || (point>=32 && point<=0xd7ff) || (point>=0xe000 && point<=0xfffd) || point>=0x10000;
  }).join('').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function column(index:number):string {
  let value=index+1,result='';
  while(value>0) {value--;result=String.fromCharCode(65+value%26)+result;value=Math.floor(value/26);}
  return result;
}
function worksheet(rows:Cell[][]):string {
  if(rows.length>1048576) throw new Error('Report exceeds the Excel worksheet row limit. Narrow the date range.');
  const body=rows.map((row,index)=>`<row r="${index+1}">${row.map((cell,col)=>{
    const reference=`${column(col)}${index+1}`;
    if(typeof cell==='number') return `<c r="${reference}"><v>${cell}</v></c>`;
    const text=typeof cell==='object' ? amount(cell.cents) : cell;
    // Excel retains only 15 significant numeric digits. Larger paisa integers use
    // exact decimal text so opening the workbook cannot silently round the cost.
    if(typeof cell==='object' && Math.abs(cell.cents)<1e15) return `<c r="${reference}" s="1"><v>${text}</v></c>`;
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const last=`${column(rows[0].length-1)}${rows.length}`;
  return `${XML}<worksheet xmlns="${NS}"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultColWidth="20" defaultRowHeight="15"/><sheetData>${body}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
}

const crcTable=Array.from({length:256},(_,index)=>{
  let value=index;
  for(let i=0;i<8;i++) value=value&1 ? 0xedb88320^(value>>>1) : value>>>1;
  return value>>>0;
});
function crc32(bytes:Uint8Array):number {
  let crc=0xffffffff;
  for(const byte of bytes) crc=crcTable[(crc^byte)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
function concat(parts:Uint8Array[]):Uint8Array {
  const length=parts.reduce((sum,part)=>sum+part.length,0);
  if(length>0xffffffff) throw new Error('Report exceeds the ZIP size limit. Narrow the date range.');
  const result=new Uint8Array(length);
  let offset=0;
  for(const part of parts) {result.set(part,offset);offset+=part.length;}
  return result;
}
/** A standard stored ZIP, generated with platform primitives for Worker portability. */
function zip(files:[string,string][]):Uint8Array {
  const encoder=new TextEncoder(),local:Uint8Array[]=[],central:Uint8Array[]=[];
  let offset=0;
  for(const [path,source] of files) {
    const name=encoder.encode(path),body=encoder.encode(source),crc=crc32(body);
    const header=new Uint8Array(30+name.length),view=new DataView(header.buffer);
    view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800,true);view.setUint16(12,0x21,true);
    view.setUint32(14,crc,true);view.setUint32(18,body.length,true);view.setUint32(22,body.length,true);view.setUint16(26,name.length,true);header.set(name,30);
    local.push(header,body);
    const directory=new Uint8Array(46+name.length),dv=new DataView(directory.buffer);
    dv.setUint32(0,0x02014b50,true);dv.setUint16(4,20,true);dv.setUint16(6,20,true);dv.setUint16(8,0x800,true);dv.setUint16(14,0x21,true);
    dv.setUint32(16,crc,true);dv.setUint32(20,body.length,true);dv.setUint32(24,body.length,true);dv.setUint16(28,name.length,true);dv.setUint32(42,offset,true);directory.set(name,46);
    central.push(directory);offset+=header.length+body.length;
  }
  const directory=concat(central),end=new Uint8Array(22),view=new DataView(end.buffer);
  view.setUint32(0,0x06054b50,true);view.setUint16(8,files.length,true);view.setUint16(10,files.length,true);view.setUint32(12,directory.length,true);view.setUint32(16,offset,true);
  return concat([...local,directory,end]);
}

export function xlsxExport(data:ExportData):Uint8Array {
  const tables=KINDS.map(kind=>table(kind,data));
  const types=`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rootRels=`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook=`${XML}<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tables.map((sheet,i)=>`<sheet name="${xml(sheet.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
  const relations=`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles=`${XML}<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zip([['[Content_Types].xml',types],['_rels/.rels',rootRels],['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',relations],['xl/styles.xml',styles],...tables.map((sheet,i)=>[`xl/worksheets/sheet${i+1}.xml`,worksheet(sheet.rows)] as [string,string])]);
}
