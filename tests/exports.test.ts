import test from 'node:test';
import assert from 'node:assert/strict';
import { csvExport, xlsxExport } from '../lib/exports.ts';
import type { ExportData, Entry } from '../lib/types.ts';

const payload:Entry['payload']={kind:'expense',title:'=SUM(1,2)',amountCents:1001,category:'Food & dining',date:'2024-02-29',paidById:'a',participantIds:['a','b'],splitMethod:'equal',splitValues:{},portions:{a:501,b:500}};
const data:ExportData={
  space:{id:'s',name:'कित्ताकाट & friends',ownerId:'a',code:'secret',currency:'NPR',createdAt:'2024-01-01T00:00:00Z'},
  members:[{id:'a',username:'alice',displayName:'आदर्श <A>',authType:'password',role:'owner',joinedAt:'2024-01-01'},{id:'b',username:'bob',displayName:'+Bob',authType:'password',role:'member',joinedAt:'2024-01-01'}],
  entries:[{id:'e',spaceId:'s',creatorId:'a',revision:2,createdAt:'2024-02-01T10:00:00Z',payload,history:[{revision:1,payload:{...payload,title:'Original, "lunch"',date:'2024-01-15'},reason:'Created',actorId:'a',createdAt:'2024-01-15T10:00:00Z'},{revision:2,payload,reason:'Fix amount\nand date',actorId:'a',createdAt:'2024-03-01T10:00:00Z'}]},
    {id:'r',spaceId:'s',creatorId:'b',revision:1,createdAt:'2024-03-02T10:00:00Z',payload:{kind:'repayment',title:'Repayment',amountCents:200,date:'2024-03-02',fromId:'b',toId:'a'},history:[]}],reviews:[],disputes:[],
};
function readCsv(text:string):string[][] {
  const result:string[][]=[]; let row:string[]=[]; let cell=''; let quoted=false;
  for(let i=0;i<text.length;i++) {const c=text[i]; if(c==='"') {if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;} else if(!quoted&&c===','){row.push(cell);cell='';}else if(!quoted&&c==='\r'&&text[i+1]==='\n'){row.push(cell);result.push(row);row=[];cell='';i++;}else cell+=c;}
  if(cell||row.length){row.push(cell);result.push(row);} return result;
}

test('expense CSV preserves Unicode, numeric rupees and neutralizes formula injection', () => {
  const rows=readCsv(csvExport('expenses',data));
  assert.ok(rows[0].includes('Amount (NPR)'));
  assert.ok(rows[1].includes("'=SUM(1,2)"));
  assert.ok(rows[1].includes('10.01'));
  assert.ok(rows[1].includes('आदर्श <A>'));
  assert.equal(rows[0].length,rows[1].length);
  assert.ok(readCsv(csvExport('splits',data)).some(row=>row.includes("'+Bob")));
});
test('CSV quote and newline escaping round-trips immutable history', () => {
  const rows=readCsv(csvExport('history',data));
  assert.ok(rows.some(row=>row.includes('Original, "lunch"')));
  assert.ok(rows.some(row=>row.includes('Fix amount\nand date')));
  assert.ok(rows.some(row=>row.some(cell=>cell.includes('"portions":{"a":501,"b":500}'))));
});
test('date filters include matching records and history action dates but retain all-time balances', () => {
  const filtered={...data,from:'2024-02-01',to:'2024-02-29'};
  assert.equal(readCsv(csvExport('expenses',filtered)).length,2);
  assert.equal(readCsv(csvExport('splits',filtered)).length,3);
  assert.equal(readCsv(csvExport('repayments',filtered)).length,1);
  assert.equal(readCsv(csvExport('history',filtered)).length,1);
  const balances=readCsv(csvExport('balances',filtered));
  assert.ok(balances[0].some(cell=>/all.time/i.test(cell)));
  assert.ok(balances[1].includes('3.00'));
  assert.ok(balances[2].includes('-3.00'));
  assert.throws(()=>csvExport('expenses',{...data,from:'2024-02-30'}),/date/i);
  assert.throws(()=>csvExport('expenses',{...data,from:'2024-03-01',to:'2024-01-01'}),/range|before|after/i);
});
function unzipStored(bytes:Uint8Array):Map<string,string> {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); const files=new Map<string,string>(); let at=0;
  while(v.getUint32(at,true)===0x04034b50) {
    assert.equal(v.getUint16(at+8,true),0,'native workbook uses uncompressed ZIP records');
    const size=v.getUint32(at+18,true),nameLength=v.getUint16(at+26,true),extra=v.getUint16(at+28,true),start=at+30+nameLength+extra;
    files.set(new TextDecoder().decode(bytes.slice(at+30,at+30+nameLength)),new TextDecoder().decode(bytes.slice(start,start+size)));at=start+size;
  }
  assert.equal(v.getUint32(at,true),0x02014b50,'central directory follows entries');
  assert.equal(v.getUint32(bytes.length-22,true),0x06054b50,'ZIP has end-of-central-directory record');
  assert.equal(v.getUint16(bytes.length-12,true),files.size,'central directory file count matches');
  return files;
}
test('XLSX is a complete five-sheet ZIP workbook with Unicode, numeric cells and safe inline text', () => {
  const files=unzipStored(xlsxExport(data));
  assert.ok(files.has('[Content_Types].xml'));
  assert.ok(files.has('_rels/.rels'));
  const workbook=files.get('xl/workbook.xml')!;
  for(const sheet of ['Expenses','Splits','Repayments','Balances (all-time)','History']) assert.ok(workbook.includes(`name="${sheet}"`));
  assert.equal((workbook.match(/<sheet /g)||[]).length,5);
  const expenses=files.get('xl/worksheets/sheet1.xml')!;
  assert.ok(expenses.includes('आदर्श &lt;A&gt;'));
  assert.ok(expenses.includes('=SUM(1,2)'));
  assert.ok(!expenses.includes('<f>'),'untrusted strings must never become formulas');
  assert.match(expenses,/<c r="[A-Z]+2" s="1"><v>10\.01<\/v><\/c>/);
  assert.ok(files.get('xl/styles.xml')!.includes('0.00'));
  assert.ok(files.get('xl/_rels/workbook.xml.rels')!.includes('worksheets/sheet5.xml'));
});
test('XLSX preserves amounts beyond Excel precision as exact text, including negative balances', () => {
  const cases=[
    {cents:999999999999999,rupees:'9999999999999.99',numeric:true},
    {cents:1000000000000000,rupees:'10000000000000.00',numeric:false},
    {cents:1000000000000001,rupees:'10000000000000.01',numeric:false},
    {cents:Number.MAX_SAFE_INTEGER,rupees:'90071992547409.91',numeric:false},
  ];
  for(const {cents,rupees,numeric} of cases) {
    const largePayload:Entry['payload']={...payload,amountCents:cents,participantIds:['b'],portions:{b:cents}};
    const boundaryData:ExportData={...data,entries:[{...data.entries[0],payload:largePayload,history:[]}]};
    const files=unzipStored(xlsxExport(boundaryData));
    const expenses=files.get('xl/worksheets/sheet1.xml')!;
    const balances=files.get('xl/worksheets/sheet4.xml')!;
    if(numeric) {
      assert.ok(expenses.includes(`<c r="F2" s="1"><v>${rupees}</v></c>`),'15-digit paisa amounts remain numeric');
      assert.ok(balances.includes(`<c r="E3" s="1"><v>-${rupees}</v></c>`),'negative amounts within precision remain numeric');
    } else {
      assert.ok(expenses.includes(`<c r="F2" t="inlineStr"><is><t xml:space="preserve">${rupees}</t></is></c>`),'more than 15 paisa digits must be exact text');
      assert.ok(balances.includes(`<c r="E2" t="inlineStr"><is><t xml:space="preserve">${rupees}</t></is></c>`),'large positive balances must preserve every paisa');
      assert.ok(balances.includes(`<c r="E3" t="inlineStr"><is><t xml:space="preserve">-${rupees}</t></is></c>`),'large negative balances must preserve every paisa');
    }
  }
});
test('XLSX applies date filters and strips XML-disallowed control characters', () => {
  const invalidXml={...data,entries:[{...data.entries[0],payload:{...payload,title:'safe\u0000\u0001 & <text>'}}],from:'2024-01-01',to:'2024-01-31'};
  const files=unzipStored(xlsxExport(invalidXml));
  assert.ok(!files.get('xl/worksheets/sheet1.xml')!.includes('10.01'));
  const all=unzipStored(xlsxExport({...invalidXml,from:undefined,to:undefined}));
  const text=all.get('xl/worksheets/sheet1.xml')!;
  assert.ok(text.includes('safe &amp; &lt;text&gt;'));
  assert.ok(!text.includes('\u0000')&&!text.includes('\u0001'));
});
