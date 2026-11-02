import { splitExpense, validateRepayment, calculateBalances, personalDebts } from '../domain.ts';
import type { Bootstrap, User, Space, Member, Entry, EntryPayload, Review, Dispute, Notice, Revision, ExportData } from '../types.ts';
import { ApiError, hashPassword, verifyPassword, normalizeUsername, validatePassword, randomToken, hashToken, SESSION_SECONDS } from './auth.ts';
import { validatePhotoUpload, MAX_EXPENSE_PHOTOS } from '../expense-photos.ts';
import type { ExpensePhoto } from '../types.ts';

export interface SqlStatement {
  bind(...values:unknown[]):SqlStatement;
  first<T = Record<string,unknown>>():Promise<T|null>;
  all<T = Record<string,unknown>>():Promise<{results:T[]}>;
  run():Promise<unknown>;
}
export interface SqlDatabase {
  prepare(sql:string):SqlStatement;
  batch(statements:SqlStatement[]):Promise<unknown>;
}
interface UserRow { id:string; username:string; display_name:string; auth_type:User['authType']; password_hash:string|null }
interface SpaceRow { id:string; name:string; owner_id:string; code:string; currency:'NPR'; created_at:string }
interface EntryRow { id:string; space_id:string; creator_id:string; revision:number; created_at:string }
interface RevisionRow { entry_id:string; revision:number; payload_json:string; reason:string; actor_id:string; created_at:string }
interface PhotoRow { id:string;space_id:string;entry_id:string;uploaded_by_id:string;file_name:string;media_type:ExpensePhoto['mediaType'];data_base64:string;created_at:string }
const photoView=(row:PhotoRow):ExpensePhoto=>({id:row.id,fileName:row.file_name,mediaType:row.media_type,uploadedById:row.uploaded_by_id,createdAt:row.created_at});
const userView = (r:UserRow):User => ({id:r.id,username:r.username,displayName:r.display_name,authType:r.auth_type});
const spaceView = (r:SpaceRow):Space => ({id:r.id,name:r.name,ownerId:r.owner_id,code:r.code,currency:r.currency,createdAt:r.created_at});
const revisionView = (r:RevisionRow):Revision => ({revision:r.revision,payload:JSON.parse(r.payload_json),reason:r.reason,actorId:r.actor_id,createdAt:r.created_at});
const id = () => crypto.randomUUID();
const textField = (value:unknown,label:string,max=120):string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ApiError(400, `${label} is required and must be at most ${max} characters.`);
  return value.trim();
};
const object = (value:unknown):Record<string,unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400,'Invalid request body.');
  return value as Record<string,unknown>;
};
function validDate(value:string):boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).valueOf()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value; }

export class LedgerService {
  private db:SqlDatabase;
  private clock:()=>number;
  constructor(db:SqlDatabase, clock:()=>number=Date.now) { this.db=db; this.clock=clock; }
  private stmt(sql:string,...values:unknown[]) { return this.db.prepare(sql).bind(...values); }
  private now() { return new Date(this.clock()).toISOString(); }
  private async all<T>(sql:string,...values:unknown[]):Promise<T[]> { return (await this.stmt(sql,...values).all<T>()).results; }
  private async requireUser(user:User):Promise<void> {
    if (!user?.id || !await this.stmt("SELECT id FROM users WHERE id = ? AND auth_type IN ('password','chatgpt')",user.id).first()) throw new ApiError(401,'Sign in to continue.');
  }
  private async membership(user:User,spaceId:string):Promise<Space> {
    await this.requireUser(user);
    const row = await this.stmt('SELECT s.* FROM spaces s JOIN memberships m ON m.space_id=s.id WHERE s.id=? AND m.user_id=?',spaceId,user.id).first<SpaceRow>();
    if (!row) throw new ApiError(403,'You do not have access to this space.');
    return spaceView(row);
  }
  private audit(spaceId:string,userId:string,action:string,entryId:string|null=null,revision:number|null=null,metadata:unknown={}) {
    return this.stmt('INSERT INTO audit_events (id,space_id,entry_id,actor_id,action,revision,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)',id(),spaceId,entryId,userId,action,revision,JSON.stringify(metadata),this.now());
  }
  /** Every condition is checked again inside D1's serial, atomic batch. */
  private async atomicEntry(entryId:string,spaceId:string,revision:number,statements:SqlStatement[],spaceVersion?:number):Promise<void> {
    const guardId=id();
    const guard=this.stmt('INSERT INTO mutation_guards (id,ok) VALUES (?, (SELECT CASE WHEN EXISTS (SELECT 1 FROM entries WHERE id=? AND space_id=? AND revision=?) THEN 1 ELSE NULL END))',guardId,entryId,spaceId,revision);
    try {
      const batch=[guard,...statements,this.stmt('DELETE FROM mutation_guards WHERE id=?',guardId)];
      if (spaceVersion===undefined) await this.db.batch(batch);
      else await this.atomicFinancial(spaceId,spaceVersion,batch);
    }
    catch (error) {
      if (/mutation_guards|revisions\.entry_id|UNIQUE constraint failed: revisions/i.test(String(error))) throw new ApiError(409,'This entry changed. Refresh and review the latest revision.');
      throw error;
    }
  }
  private async financialVersion(spaceId:string,payload:EntryPayload,entryId?:string):Promise<number> {
    const state=await this.stmt('SELECT ledger_version FROM spaces WHERE id=?',spaceId).first<{ledger_version:number}>();
    if (!state) throw new ApiError(404,'Space not found.');
    const members=await this.members(spaceId);
    const existing=await this.entries(spaceId);
    const next=entryId?existing.map(entry=>entry.id===entryId?{...entry,payload}:entry):[...existing,{id:'new',spaceId,creatorId:'',revision:1,createdAt:this.now(),payload,history:[]}];
    try {
      const memberIds=members.map(m=>m.id);
      calculateBalances(memberIds,next);
      for (const person of memberIds) {
        const debts=personalDebts(person,memberIds,next);
        const receivables=debts.reduce((sum,debt)=>sum+BigInt(debt.theyOweCents),0n);
        const payables=debts.reduce((sum,debt)=>sum+BigInt(debt.youOweCents),0n);
        if (receivables>BigInt(Number.MAX_SAFE_INTEGER)||payables>BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('Total receivables or payables exceed the safe integer paisa limit.');
        }
      }
      const spending=next.reduce((sum,entry)=>sum+(entry.payload.kind==='expense'?BigInt(entry.payload.amountCents):0n),0n);
      if (spending>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Total spending exceeds the safe integer paisa limit.');
    } catch(error) { throw new ApiError(400,error instanceof Error?error.message:'Amount exceeds the safe ledger limit.'); }
    return state.ledger_version;
  }
  private async atomicFinancial(spaceId:string,version:number,statements:SqlStatement[]):Promise<void> {
    const guardId=id();
    try {
      await this.db.batch([
        this.stmt('INSERT INTO mutation_guards (id,ok) VALUES (?,(SELECT CASE WHEN EXISTS (SELECT 1 FROM spaces WHERE id=? AND ledger_version=?) THEN 1 ELSE NULL END))',guardId,spaceId,version),
        ...statements,
        this.stmt('UPDATE spaces SET ledger_version=ledger_version+1 WHERE id=? AND ledger_version=?',spaceId,version),
        this.stmt('DELETE FROM mutation_guards WHERE id=?',guardId),
      ]);
    } catch(error) {
      if (/mutation_guards/i.test(String(error))) throw new ApiError(409,'This space changed. Refresh and try again.');
      throw error;
    }
  }
  private async throttle(key:string,limit:number,windowMs:number):Promise<void> {
    const now=this.clock();
    const result=await this.stmt(`INSERT INTO login_attempts (key,attempts,reset_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,
      reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING attempts`,key,now+windowMs,now,now,now+windowMs).first<{attempts:number}>();
    if (!result || result.attempts>limit) throw new ApiError(429,'Too many attempts. Please try again later.');
  }
  private async newSession(userId:string):Promise<{token:string;statement:SqlStatement}> {
    const token=randomToken();
    return {token,statement:this.stmt('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)',await hashToken(token),userId,this.clock()+SESSION_SECONDS*1000,this.now())};
  }
  async register(body:unknown,ip:string):Promise<{user:User;token:string}> {
    const input=object(body); const username=normalizeUsername(input.username); validatePassword(input.password);
    const displayName=textField(input.displayName,'Display name',80);
    await this.throttle(`register:${await hashToken(ip)}`,20,3600_000);
    const user:User={id:id(),username,displayName,authType:'password'};
    const passwordHash=await hashPassword(input.password);
    const session=await this.newSession(user.id);
    try { await this.db.batch([this.stmt('INSERT INTO users (id,username,display_name,auth_type,password_hash,created_at) VALUES (?,?,?,?,?,?)',user.id,username,displayName,'password',passwordHash,this.now()),session.statement]); }
    catch(error) { if (/users\.username|UNIQUE constraint failed/i.test(String(error))) throw new ApiError(409,'That username is already taken.'); throw error; }
    return {user,token:session.token};
  }
  async login(body:unknown,ip:string):Promise<{user:User;token:string}> {
    const input=object(body); const username=normalizeUsername(input.username); validatePassword(input.password);
    const key=`login:${await hashToken(`${ip}\0${username}`)}`;
    await this.throttle(`login-ip:${await hashToken(ip)}`,60,15*60_000);
    await this.throttle(key,5,15*60_000);
    const row=await this.stmt("SELECT * FROM users WHERE username=? AND auth_type='password'",username).first<UserRow>();
    // Do the same PBKDF2 work for unknown usernames to avoid a fast account probe.
    const dummy='pbkdf2-sha256$100000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';
    const correct=await verifyPassword(input.password,row?.password_hash??dummy);
    if (!row || !correct) throw new ApiError(401,'Username or password is incorrect.');
    const session=await this.newSession(row.id);
    await this.db.batch([session.statement,this.stmt('DELETE FROM login_attempts WHERE key=?',key)]);
    return {user:userView(row),token:session.token};
  }
  async sessionUser(token:string|null):Promise<User|null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row=await this.stmt("SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.auth_type IN ('password','chatgpt')",await hashToken(token),this.clock()).first<UserRow>();
    return row?userView(row):null;
  }
  async logout(token:string|null):Promise<void> {
    if (token) await this.stmt('DELETE FROM sessions WHERE token_hash=?',await hashToken(token)).run();
  }
  async chatgptUser(identity:{userId:string;displayName:string}):Promise<User> {
    if (!identity.userId) throw new ApiError(401,'Sign in to continue.');
    const existing=await this.stmt('SELECT * FROM users WHERE chatgpt_id=?',identity.userId).first<UserRow>();
    if (existing) return userView(existing);
    const username=`chatgpt:${(await hashToken(identity.userId)).slice(0,24)}`;
    await this.stmt("INSERT INTO users (id,username,display_name,auth_type,chatgpt_id,created_at) VALUES (?,?,?,'chatgpt',?,?) ON CONFLICT(chatgpt_id) DO NOTHING",id(),username,identity.displayName?.trim().slice(0,80)||'ChatGPT member',identity.userId,this.now()).run();
    const row=await this.stmt('SELECT * FROM users WHERE chatgpt_id=?',identity.userId).first<UserRow>();
    if (!row) throw new ApiError(409,'Please retry signing in.');
    return userView(row);
  }
  async createSpace(user:User,name:unknown):Promise<string> {
    await this.requireUser(user);
    const value=textField(name,'Space name',80); const spaceId=id(); const now=this.now();
    await this.db.batch([
      this.stmt("INSERT INTO spaces (id,name,owner_id,code,currency,created_at) VALUES (?,?,?,?,'NPR',?)",spaceId,value,user.id,randomToken(),now),
      this.stmt("INSERT INTO memberships (space_id,user_id,role,joined_at) VALUES (?,?,'owner',?)",spaceId,user.id,now),
      this.audit(spaceId,user.id,'space_created'),
    ]);
    return spaceId;
  }
  async joinSpace(user:User,code:unknown):Promise<string> {
    await this.requireUser(user);
    if (typeof code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(code.trim())) throw new ApiError(404,'Invitation code is invalid or has been rotated.');
    const row=await this.stmt('SELECT id FROM spaces WHERE code=?',code.trim()).first<{id:string}>();
    if (!row) throw new ApiError(404,'Invitation code is invalid or has been rotated.');
    await this.db.batch([
      this.stmt("INSERT INTO memberships (space_id,user_id,role,joined_at) SELECT id,?,'member',? FROM spaces WHERE id=? AND code=? ON CONFLICT(space_id,user_id) DO NOTHING",user.id,this.now(),row.id,code.trim()),
      // Rotation racing the read must not grant a membership from an obsolete code.
      this.stmt('INSERT INTO mutation_guards (id,ok) VALUES (?,(SELECT CASE WHEN EXISTS (SELECT 1 FROM spaces WHERE id=? AND code=?) THEN 1 ELSE NULL END))',`join:${user.id}:${row.id}`,row.id,code.trim()),
      this.stmt('DELETE FROM mutation_guards WHERE id=?',`join:${user.id}:${row.id}`),
      this.audit(row.id,user.id,'joined'),
    ]).catch(error=>{if (/mutation_guards/i.test(String(error))) throw new ApiError(404,'Invitation code is invalid or has been rotated.'); throw error;});
    return row.id;
  }
  async rotateCode(user:User,spaceId:string):Promise<void> {
    const space=await this.membership(user,spaceId);
    if (space.ownerId!==user.id) throw new ApiError(403,'Only the owner can rotate this invitation.');
    await this.db.batch([this.stmt('UPDATE spaces SET code=? WHERE id=? AND owner_id=?',randomToken(),spaceId,user.id),this.audit(spaceId,user.id,'code_rotated')]);
  }
  async addDummyMember(user:User,spaceId:string,displayName:unknown):Promise<string> {
    const space=await this.membership(user,spaceId);
    if (space.ownerId!==user.id) throw new ApiError(403,'Only the space creator can add people without accounts.');
    const name=textField(displayName,'Name',80),personId=id(),now=this.now();
    // The reserved username cannot be registered or used for password login.
    // This is a ledger identity only: there are no credentials or sessions.
    await this.db.batch([
      this.stmt("INSERT INTO users (id,username,display_name,auth_type,created_at) VALUES (?,?,?,'dummy',?)",personId,`dummy:${personId}`,name,now),
      this.stmt("INSERT INTO memberships (space_id,user_id,role,joined_at) VALUES (?,?,'member',?)",spaceId,personId,now),
      this.audit(spaceId,user.id,'dummy_member_added',null,null,{userId:personId,displayName:name}),
    ]);
    return personId;
  }
  private async members(spaceId:string):Promise<Member[]> {
    const rows=await this.all<UserRow&{role:'owner'|'member';joined_at:string}>('SELECT u.*,m.role,m.joined_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY m.joined_at,u.id',spaceId);
    return rows.map(row=>({...userView(row),role:row.role,joinedAt:row.joined_at}));
  }
  private async entries(spaceId:string):Promise<Entry[]> {
    const rows=await this.all<EntryRow>('SELECT * FROM entries WHERE space_id=? ORDER BY created_at DESC,id',spaceId);
    const snapshots=await this.all<RevisionRow>('SELECT r.* FROM revisions r JOIN entries e ON e.id=r.entry_id WHERE e.space_id=? ORDER BY r.revision',spaceId);
    const history=new Map<string,Revision[]>();
    for (const row of snapshots) { const values=history.get(row.entry_id)??[]; values.push(revisionView(row)); history.set(row.entry_id,values); }
    return rows.map(row=>{ const revisions=history.get(row.id)??[];const current=revisions.find(r=>r.revision===row.revision); if (!current) throw new Error('Entry snapshot unavailable'); return {id:row.id,spaceId:row.space_id,creatorId:row.creator_id,revision:row.revision,createdAt:row.created_at,payload:current.payload,history:revisions}; });
  }
  private async reviews(spaceId:string):Promise<Review[]> {
    const rows=await this.all<{entry_id:string;revision:number;user_id:string;status:Review['status'];reason:string}>('SELECT r.* FROM reviews r JOIN entries e ON e.id=r.entry_id WHERE e.space_id=?',spaceId);
    return rows.map(r=>({entryId:r.entry_id,revision:r.revision,userId:r.user_id,status:r.status,reason:r.reason}));
  }
  private async disputes(spaceId:string):Promise<Dispute[]> {
    const rows=await this.all<{id:string;entry_id:string;user_id:string;opened_revision:number;reason:string;resolved_revision:number|null}>('SELECT d.* FROM disputes d JOIN entries e ON e.id=d.entry_id WHERE e.space_id=?',spaceId);
    return rows.map(r=>({id:r.id,entryId:r.entry_id,userId:r.user_id,openedRevision:r.opened_revision,reason:r.reason,resolvedRevision:r.resolved_revision}));
  }
  async bootstrap(user:User|null,requestedSpace?:string,chatgptEnabled=false):Promise<Bootstrap> {
    const empty:Bootstrap={user,chatgptEnabled,spaces:[],activeSpace:null,members:[],entries:[],notices:[],reviews:[],disputes:[]};
    if (!user) return empty;
    await this.requireUser(user);
    const rows=await this.all<SpaceRow>('SELECT s.* FROM spaces s JOIN memberships m ON m.space_id=s.id WHERE m.user_id=? ORDER BY s.created_at,s.id',user.id);
    const spaces=rows.map(spaceView);
    const activeSpace=requestedSpace?spaces.find(s=>s.id===requestedSpace):spaces[0];
    if (requestedSpace&&!activeSpace) throw new ApiError(403,'You do not have access to this space.');
    if (!activeSpace) return {...empty,spaces};
    const [members,entries,reviews,disputes,noticeRows]=await Promise.all([
      this.members(activeSpace.id),this.entries(activeSpace.id),this.reviews(activeSpace.id),this.disputes(activeSpace.id),
      this.all<{id:string;space_id:string;entry_id:string;revision:number;recipient_id:string;actor_id:string;type:Notice['type'];reason:string;created_at:string;read_at:string|null}>('SELECT * FROM notifications WHERE space_id=? AND recipient_id=? ORDER BY created_at DESC,id',activeSpace.id,user.id),
    ]);
    const notices=noticeRows.map(r=>({id:r.id,spaceId:r.space_id,entryId:r.entry_id,revision:r.revision,recipientId:r.recipient_id,actorId:r.actor_id,type:r.type,reason:r.reason,createdAt:r.created_at,readAt:r.read_at}));
    return {user,chatgptEnabled,spaces,activeSpace,members,entries,notices,reviews,disputes};
  }
  private async payload(spaceId:string,body:unknown):Promise<EntryPayload> {
    const input=object(body);
    let payload:EntryPayload;
    try {
      if (input.kind==='expense') payload=splitExpense(input as unknown as Parameters<typeof splitExpense>[0]);
      else if (input.kind==='repayment') payload=validateRepayment(input as unknown as Parameters<typeof validateRepayment>[0]);
      else throw new ApiError(400,'Choose an expense or repayment.');
    } catch(error) { if(error instanceof ApiError) throw error; throw new ApiError(400,error instanceof Error?error.message:'Invalid entry.'); }
    const members=await this.members(spaceId); const ids=new Set(members.map(m=>m.id));
    const involved=payload.kind==='expense'?[payload.paidById,...payload.participantIds]:[payload.fromId,payload.toId];
    if (involved.some(id=>!ids.has(id))) throw new ApiError(400,'Every payer, sender, recipient and participant must belong to this space.');
    return payload;
  }
  private involved(payload:EntryPayload):string[] { return [...new Set(payload.kind==='expense'?[payload.paidById,...payload.participantIds]:[payload.fromId,payload.toId])]; }
  private async preparePhotos(user:User,spaceId:string,entryId:string,payload:EntryPayload,body:unknown,previous?:EntryPayload):Promise<SqlStatement[]> {
    if (payload.kind!=='expense') return [];
    const input=object(body);
    if (input.description===undefined && previous?.kind==='expense' && previous.description!==undefined) payload.description=previous.description;
    const values=input.photos===undefined?(previous?.kind==='expense'?previous.photos??[]:[]):input.photos;
    if (!Array.isArray(values) || values.length>MAX_EXPENSE_PHOTOS) throw new ApiError(400,'Attach at most four photos.');
    const photos:ExpensePhoto[]=[],statements:SqlStatement[]=[];
    for (const value of values) {
      const photo=object(value);
      if (Object.hasOwn(photo,'id')) {
        if (typeof photo.id!=='string' || photos.some(p=>p.id===photo.id)) throw new ApiError(400,'Choose distinct existing photos.');
        const existing=await this.stmt('SELECT * FROM expense_photos WHERE id=? AND space_id=? AND entry_id=?',photo.id,spaceId,entryId).first<PhotoRow>();
        if (!existing) throw new ApiError(400,'Photo does not belong to this expense.');
        photos.push(photoView(existing));
      } else {
        let upload;
        try { upload=validatePhotoUpload(photo); } catch(error) { throw new ApiError(400,error instanceof Error?error.message:'Invalid photo.'); }
        const saved:ExpensePhoto={id:id(),fileName:upload.fileName,mediaType:upload.mediaType,uploadedById:user.id,createdAt:this.now()};
        photos.push(saved);
        statements.push(this.stmt('INSERT INTO expense_photos (id,space_id,entry_id,uploaded_by_id,file_name,media_type,data_base64,created_at) VALUES (?,?,?,?,?,?,?,?)',saved.id,spaceId,entryId,user.id,saved.fileName,saved.mediaType,upload.dataBase64,saved.createdAt));
      }
    }
    if (photos.length || input.photos!==undefined || (previous?.kind==='expense'&&previous.photos!==undefined)) payload.photos=photos;
    return statements;
  }
  async readExpensePhoto(user:User,spaceId:string,entryId:string,photoId:string):Promise<{bytes:Uint8Array;mediaType:ExpensePhoto['mediaType'];fileName:string}> {
    await this.membership(user,spaceId);
    const row=await this.stmt('SELECT * FROM expense_photos WHERE id=? AND space_id=? AND entry_id=?',photoId,spaceId,entryId).first<PhotoRow>();
    if (!row) throw new ApiError(404,'Photo not found in this expense.');
    return {bytes:Uint8Array.from(atob(row.data_base64),c=>c.charCodeAt(0)),mediaType:row.media_type,fileName:row.file_name};
  }
  private async reviewers(spaceId:string,people:string[]):Promise<string[]> {
    const real=new Set((await this.members(spaceId)).filter(member=>member.authType!=='dummy').map(member=>member.id));
    return people.filter(person=>real.has(person));
  }
  private notice(spaceId:string,entryId:string,revision:number,recipientId:string,actorId:string,type:Notice['type'],reason=''):SqlStatement {
    return this.stmt('INSERT INTO notifications (id,space_id,entry_id,revision,recipient_id,actor_id,type,reason,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?,NULL)',id(),spaceId,entryId,revision,recipientId,actorId,type,reason,this.now());
  }
  private reviewRow(entryId:string,revision:number,userId:string,actorId:string):SqlStatement {
    return this.stmt('INSERT INTO reviews (entry_id,revision,user_id,status,reason) VALUES (?,?,?,?,?)',entryId,revision,userId,userId===actorId?'accepted':'pending','');
  }
  async createEntry(user:User,spaceId:string,body:unknown):Promise<string> {
    await this.membership(user,spaceId);
    const payload=await this.payload(spaceId,body); const entryId=id(); const involved=await this.reviewers(spaceId,this.involved(payload)); const now=this.now();
    const photoStatements=await this.preparePhotos(user,spaceId,entryId,payload,body);
    const version=await this.financialVersion(spaceId,payload);
    await this.atomicFinancial(spaceId,version,[
      this.stmt('INSERT INTO entries (id,space_id,creator_id,revision,created_at) VALUES (?,?,?,1,?)',entryId,spaceId,user.id,now),
      ...photoStatements,
      this.stmt('INSERT INTO revisions (entry_id,revision,payload_json,reason,actor_id,created_at) VALUES (?,1,?,?,?,?)',entryId,JSON.stringify(payload),'Created',user.id,now),
      ...[...new Set([...involved,user.id])].map(person=>this.reviewRow(entryId,1,person,user.id)),
      ...involved.filter(person=>person!==user.id).map(person=>this.notice(spaceId,entryId,1,person,user.id,'added')),
      this.audit(spaceId,user.id,'created',entryId,1),
    ]);
    return entryId;
  }
  private async entry(spaceId:string,entryId:string):Promise<EntryRow> {
    const row=await this.stmt('SELECT * FROM entries WHERE id=? AND space_id=?',entryId,spaceId).first<EntryRow>();
    if (!row) throw new ApiError(404,'Entry not found in this space.');
    return row;
  }
  async reviseEntry(user:User,spaceId:string,entryId:string,body:unknown):Promise<void> {
    await this.membership(user,spaceId); const row=await this.entry(spaceId,entryId);
    if (row.creator_id!==user.id) throw new ApiError(403,'Only the original creator can correct this entry.');
    const input=object(body); const expected=input.expectedRevision;
    if (!Number.isSafeInteger(expected)||Number(expected)<1) throw new ApiError(400,'A current expected revision is required.');
    if (expected!==row.revision) throw new ApiError(409,'This entry changed. Refresh before correcting it.');
    const reason=textField(input.reason,'Correction reason',2000); const payload=await this.payload(spaceId,input);
    const snapshot=await this.stmt('SELECT payload_json FROM revisions WHERE entry_id=? AND revision=?',entryId,row.revision).first<{payload_json:string}>();
    const photoStatements=await this.preparePhotos(user,spaceId,entryId,payload,input,snapshot?JSON.parse(snapshot.payload_json):undefined);
    const version=await this.financialVersion(spaceId,payload,entryId);
    const previous=await this.all<{user_id:string}>('SELECT DISTINCT user_id FROM reviews WHERE entry_id=?',entryId);
    const involved=await this.reviewers(spaceId,[...new Set([...previous.map(r=>r.user_id),...this.involved(payload),row.creator_id])]); const revision=row.revision+1;
    await this.atomicEntry(entryId,spaceId,row.revision,[
      ...photoStatements,
      this.stmt('INSERT INTO revisions (entry_id,revision,payload_json,reason,actor_id,created_at) VALUES (?,?,?,?,?,?)',entryId,revision,JSON.stringify(payload),reason,user.id,this.now()),
      this.stmt('UPDATE entries SET revision=? WHERE id=? AND space_id=? AND revision=?',revision,entryId,spaceId,row.revision),
      ...involved.map(person=>this.reviewRow(entryId,revision,person,user.id)),
      ...involved.filter(person=>person!==user.id).map(person=>this.notice(spaceId,entryId,revision,person,user.id,'revised',reason)),
      this.audit(spaceId,user.id,'revised',entryId,revision,{reason}),
    ],version);
  }
  async reviewEntry(user:User,spaceId:string,entryId:string,body:unknown):Promise<void> {
    await this.membership(user,spaceId); const row=await this.entry(spaceId,entryId); const input=object(body);
    if (row.creator_id===user.id) throw new ApiError(403,'Your review is automatic. Correct the entry to make a change.');
    if (!Number.isSafeInteger(input.revision)||Number(input.revision)<1) throw new ApiError(400,'A current revision is required.');
    if (input.revision!==row.revision) throw new ApiError(409,'This entry changed. Review the latest revision.');
    if (input.action!=='accept'&&input.action!=='dispute') throw new ApiError(400,'Choose accept or dispute.');
    const reviewer=await this.stmt('SELECT status FROM reviews WHERE entry_id=? AND revision=? AND user_id=?',entryId,row.revision,user.id).first<{status:string}>();
    if (!reviewer) throw new ApiError(403,'Only people involved in this entry can review it.');
    const reason=input.action==='dispute'?textField(input.reason,'Dispute reason',2000):'';
    const status=input.action==='accept'?'accepted':'disputed';
    const statements=[this.stmt('UPDATE reviews SET status=?,reason=? WHERE entry_id=? AND revision=? AND user_id=?',status,reason,entryId,row.revision,user.id)];
    const people=await this.all<{user_id:string}>('SELECT DISTINCT user_id FROM reviews WHERE entry_id=?',entryId);
    if (input.action==='dispute') {
      // A repeated request with an already-disputed review does not create duplicate disputes.
      statements.push(this.stmt("INSERT INTO disputes (id,entry_id,user_id,opened_revision,reason,resolved_revision) SELECT ?,?,?,?,?,NULL WHERE NOT EXISTS (SELECT 1 FROM disputes WHERE entry_id=? AND user_id=? AND opened_revision=? AND resolved_revision IS NULL)",id(),entryId,user.id,row.revision,reason,entryId,user.id,row.revision));
      statements.push(...people.filter(p=>p.user_id!==user.id).map(p=>this.notice(spaceId,entryId,row.revision,p.user_id,user.id,'disputed',reason)));
    } else {
      const open=await this.stmt('SELECT id FROM disputes WHERE entry_id=? AND user_id=? AND resolved_revision IS NULL AND opened_revision<? LIMIT 1',entryId,user.id,row.revision).first();
      statements.push(this.stmt('UPDATE disputes SET resolved_revision=? WHERE entry_id=? AND user_id=? AND resolved_revision IS NULL AND opened_revision<?',row.revision,entryId,user.id,row.revision));
      if (open) statements.push(...people.filter(p=>p.user_id!==user.id).map(p=>this.notice(spaceId,entryId,row.revision,p.user_id,user.id,'resolved','Correction accepted')));
    }
    statements.push(this.audit(spaceId,user.id,input.action==='accept'?'accepted':'disputed',entryId,row.revision,{reason}));
    await this.atomicEntry(entryId,spaceId,row.revision,statements);
  }
  async markNoticesRead(user:User,spaceId:string,ids?:unknown):Promise<void> {
    await this.membership(user,spaceId);
    if (ids!==undefined && (!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'))) throw new ApiError(400,'Provide at most 500 notification IDs.');
    const values=ids as string[]|undefined;
    if (values?.length===0) return;
    const filter=values?' AND id IN (SELECT value FROM json_each(?))':'';
    await this.stmt(`UPDATE notifications SET read_at=? WHERE space_id=? AND recipient_id=? AND read_at IS NULL${filter}`,this.now(),spaceId,user.id,...(values?[JSON.stringify(values)]:[])).run();
  }
  async exportData(user:User,spaceId:string,from?:string,to?:string):Promise<ExportData> {
    await this.membership(user,spaceId);
    if ((from&&!validDate(from))||(to&&!validDate(to))||(from&&to&&from>to)) throw new ApiError(400,'Use valid report dates in chronological order.');
    const data=await this.bootstrap(user,spaceId);
    return {space:data.activeSpace!,members:data.members,entries:data.entries,reviews:data.reviews,disputes:data.disputes,from,to};
  }
}
