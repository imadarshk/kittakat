import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteDatabase } from '../lib/server/sqlite.ts';
import { LedgerService } from '../lib/server/service.ts';

test('native SQLite persists accounts and sessions across reopen and applies migrations only once', async () => {
  const dir=mkdtempSync(join(tmpdir(),'kittakat-sqlite-'));
  try {
    const file=join(dir,'ledger.sqlite');
    let db=new SQLiteDatabase(file);
    const account=await new LedgerService(db).register({username:'persistent',displayName:'Persistent',password:'long-password-123'},'127.0.0.1');
    const space=await new LedgerService(db).createSpace(account.user,'Persistent trip');
    db.close();
    db=new SQLiteDatabase(file);
    try {
      const service=new LedgerService(db);
      assert.equal((await service.sessionUser(account.token))?.username,'persistent');
      assert.equal((await service.bootstrap(account.user,space)).activeSpace?.name,'Persistent trip');
      assert.equal((await db.prepare('PRAGMA integrity_check').first<{integrity_check:string}>())?.integrity_check,'ok');
    } finally { db.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('native SQLite batches roll back every statement on failure and concurrent batches remain isolated', async () => {
  const db=new SQLiteDatabase(':memory:');
  try {
    await db.prepare('CREATE TABLE test_atomic (id INTEGER PRIMARY KEY, value TEXT NOT NULL)').run();
    await assert.rejects(db.batch([
      db.prepare('INSERT INTO test_atomic VALUES (?,?)').bind(1,'must roll back'),
      db.prepare('INSERT INTO test_atomic VALUES (?,?)').bind(2,null),
    ]));
    assert.equal((await db.prepare('SELECT count(*) AS count FROM test_atomic').first<{count:number}>())?.count,0);
    await Promise.all([db.batch([db.prepare('INSERT INTO test_atomic VALUES (?,?)').bind(1,'first')]),db.batch([db.prepare('INSERT INTO test_atomic VALUES (?,?)').bind(2,'second')])]);
    assert.deepEqual((await db.prepare('SELECT value FROM test_atomic ORDER BY id').all<{value:string}>()).results.map(r=>r.value),['first','second']);
  } finally { db.close(); }
});

test('online backups reopen with the same records and valid financial integrity triggers', async () => {
  const dir=mkdtempSync(join(tmpdir(),'kittakat-backup-'));
  const db=new SQLiteDatabase(join(dir,'live.sqlite'));
  try {
    const service=new LedgerService(db);
    const {user,token}=await service.register({username:'backup',displayName:'Backup',password:'long-password-123'},'127.0.0.1');
    await service.createSpace(user,'Restored trip');
    await db.backupTo(join(dir,'backup.sqlite'));
    const restored=new SQLiteDatabase(join(dir,'backup.sqlite'));
    try {
      assert.equal((await new LedgerService(restored).sessionUser(token))?.id,user.id);
      assert.equal((await restored.prepare('SELECT count(*) AS n FROM spaces').first<{n:number}>())?.n,1);
      assert.ok((await restored.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()).results.length>0);
    } finally { restored.close(); }
  } finally { db.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('a broken migration rolls back the whole upgrade and changing an applied migration is rejected', () => {
  const dir=mkdtempSync(join(tmpdir(),'kittakat-migration-'));
  try {
    const file=join(dir,'live.sqlite');
    const migration=join(dir,'0000.sql');
    writeFileSync(migration,'CREATE TABLE persisted (id INTEGER PRIMARY KEY);');
    const db=new SQLiteDatabase(file,dir); db.close();
    const original=readFileSync(migration,'utf8');
    writeFileSync(migration,original+'\n-- tampered');
    assert.throws(()=>new SQLiteDatabase(file,dir),/migration changed/);
    writeFileSync(migration,original);
    writeFileSync(join(dir,'0001.sql'),'CREATE TABLE partial (id INTEGER); INVALID SQL;');
    assert.throws(()=>new SQLiteDatabase(file,dir));
    const raw=new DatabaseSync(file);
    try {
      assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get(),undefined);
      assert.equal((raw.prepare('SELECT count(*) AS n FROM _kittakat_migrations').get() as {n:number}).n,1);
    } finally { raw.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
