import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NodeSqlite } from '../lib/server/node-sqlite.ts';
import { LedgerService } from '../lib/server/service.ts';

test('server accounts persist across database reopen and migrations apply once', async () => {
  const dir=mkdtempSync(join(tmpdir(),'kittakat-db-'));
  const file=join(dir,'private','ledger.sqlite');
  let db:NodeSqlite|undefined;
  try {
    db=new NodeSqlite(file,resolve('drizzle'));
    const account=await new LedgerService(db).register({username:'alice',displayName:'Alice',password:'test-password'},'local');
    const space=await new LedgerService(db).createSpace(account.user,'Trip');
    db.close(); db=new NodeSqlite(file,resolve('drizzle'));
    const service=new LedgerService(db);
    assert.equal((await service.sessionUser(account.token))?.username,'alice');
    assert.equal((await service.bootstrap(account.user,space)).activeSpace?.name,'Trip');
    assert.equal((await db.prepare('SELECT count(*) AS n FROM _kittakat_migrations').first<{n:number}>())?.n,4);
  } finally { db?.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('failed batches roll back all writes; simultaneous batches complete atomically', async () => {
  const db=new NodeSqlite(':memory:',resolve('drizzle'));
  try {
    await assert.rejects(db.batch([
      db.prepare('INSERT INTO login_attempts (key,attempts,reset_at) VALUES (?,?,?)').bind('rollback',1,0),
      db.prepare('INSERT INTO nonexistent_table VALUES (1)'),
    ]));
    assert.equal(await db.prepare('SELECT * FROM login_attempts WHERE key=?').bind('rollback').first(),null);
    await Promise.all(['a','b'].map(key=>db.batch([db.prepare('INSERT INTO login_attempts (key,attempts,reset_at) VALUES (?,?,?)').bind(key,1,0)])));
    assert.equal((await db.prepare('SELECT count(*) AS n FROM login_attempts').first<{n:number}>())?.n,2);
  } finally { db.close(); }
});

test('server ledger keeps immutable revision protection', async () => {
  const db=new NodeSqlite(':memory:',resolve('drizzle'));
  try {
    const service=new LedgerService(db);
    const {user}=await service.register({username:'owner',displayName:'Owner',password:'test-password'},'local');
    const space=await service.createSpace(user,'Trip');
    const entry=await service.createEntry(user,space,{kind:'expense',title:'Lunch',amountCents:10000,category:'Food & dining',date:'2026-11-01',paidById:user.id,participantIds:[user.id],splitMethod:'equal',splitValues:{}});
    await assert.rejects(db.prepare('DELETE FROM revisions WHERE entry_id=?').bind(entry).run(),/Financial revisions are immutable/);
    await assert.rejects(db.prepare('UPDATE revisions SET reason=? WHERE entry_id=?').bind('tamper',entry).run(),/Financial revisions are immutable/);
    assert.equal((await service.bootstrap(user,space)).entries[0].payload.amountCents,10000);
  } finally { db.close(); }
});


test('new migrations preserve accounts; a failed migration rolls back and changed history is rejected', async () => {
  const dir=mkdtempSync(join(tmpdir(),'kittakat-migrate-'));
  const migrations=join(dir,'migrations');
  cpSync(resolve('drizzle'),migrations,{recursive:true});
  const file=join(dir,'ledger.sqlite');
  let db:NodeSqlite|undefined;
  try {
    db=new NodeSqlite(file,migrations);
    await new LedgerService(db).register({username:'alice',displayName:'Alice',password:'test-password'},'local');
    db.close(); db=undefined;
    writeFileSync(join(migrations,'0004_pending.sql'),'CREATE TABLE extra (id INTEGER PRIMARY KEY); INSERT INTO extra VALUES (7);');
    db=new NodeSqlite(file,migrations);
    assert.equal((await db.prepare('SELECT id FROM extra').first<{id:number}>())?.id,7);
    assert.equal((await db.prepare('SELECT username FROM users').first<{username:string}>())?.username,'alice');
    db.close(); db=undefined;
    writeFileSync(join(migrations,'0005_broken.sql'),'CREATE TABLE should_rollback (id INTEGER); INSERT INTO missing_table VALUES (1);');
    assert.throws(()=>new NodeSqlite(file,migrations),/missing_table/);
    const raw=new DatabaseSync(file);
    try {
      assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'").get(),undefined);
      assert.equal(raw.prepare('SELECT count(*) AS n FROM _kittakat_migrations').get()?.n,5);
    } finally { raw.close(); }
    rmSync(join(migrations,'0005_broken.sql'));
    writeFileSync(join(migrations,'0004_pending.sql'),'CREATE TABLE altered (id INTEGER);');
    assert.throws(()=>new NodeSqlite(file,migrations),/Applied migration changed/);
  } finally { db?.close(); rmSync(dir,{recursive:true,force:true}); }
});
