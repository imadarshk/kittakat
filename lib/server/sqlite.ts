import { DatabaseSync, backup, type SQLInputValue } from 'node:sqlite';
import { chmodSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { SqlDatabase, SqlStatement } from './service.ts';

class Statement implements SqlStatement {
  private values: SQLInputValue[]=[];
  readonly owner: SQLiteDatabase;
  private sql: string;
  constructor(owner:SQLiteDatabase,sql:string) { this.owner=owner; this.sql=sql; }
  bind(...values:unknown[]):this { this.values=values as SQLInputValue[]; return this; }
  async first<T>():Promise<T|null> { return (this.owner.connection.prepare(this.sql).get(...this.values)??null) as T|null; }
  async all<T>():Promise<{results:T[]}> { return {results:this.owner.connection.prepare(this.sql).all(...this.values) as T[]}; }
  execute() { const result=this.owner.connection.prepare(this.sql).run(...this.values); return {meta:{changes:Number(result.changes)}}; }
  async run() { return this.execute(); }
}

/** Native server storage. Batches never yield while a transaction is open. */
export class SQLiteDatabase implements SqlDatabase {
  readonly connection:DatabaseSync;
  constructor(file:string,migrationsDir=resolve('drizzle')) {
    if (file!==':memory:') mkdirSync(dirname(resolve(file)),{recursive:true,mode:0o700});
    this.connection=new DatabaseSync(file);
    try {
      if (file!==':memory:') chmodSync(file,0o600);
      this.connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.migrate(migrationsDir);
    } catch(error) { this.connection.close(); throw error; }
  }
  private migrate(directory:string) {
    const files=readdirSync(directory).filter(file=>file.endsWith('.sql')).sort();
    if (!files.length) throw new Error('No database migrations found.');
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec('CREATE TABLE IF NOT EXISTS _kittakat_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)');
      const applied=this.connection.prepare('SELECT name,sha256 FROM _kittakat_migrations').all() as {name:string;sha256:string}[];
      if (applied.some(row=>!files.includes(row.name))) throw new Error('An applied database migration is missing.');
      for (const name of files) {
        const sql=readFileSync(resolve(directory,name),'utf8');
        const digest=createHash('sha256').update(sql).digest('hex');
        const previous=applied.find(row=>row.name===name);
        if (previous) {
          if (previous.sha256!==digest) throw new Error(`Applied database migration changed: ${name}`);
          continue;
        }
        this.connection.exec(sql);
        this.connection.prepare('INSERT INTO _kittakat_migrations VALUES (?,?,?)').run(name,digest,new Date().toISOString());
      }
      this.connection.exec('COMMIT');
    } catch(error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  prepare(sql:string):SqlStatement { return new Statement(this,sql); }
  async batch(statements:SqlStatement[]) {
    if (!statements.every(s=>s instanceof Statement&&s.owner===this)) throw new Error('Batch statements must belong to this database.');
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const results=statements.map(s=>(s as Statement).execute());
      this.connection.exec('COMMIT');
      return results;
    } catch(error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  async backupTo(file:string) { await backup(this.connection,file); chmodSync(file,0o600); }
  close() { this.connection.close(); }
}
