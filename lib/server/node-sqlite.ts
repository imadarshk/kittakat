import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { SqlDatabase, SqlStatement } from './service.ts';

/** D1's small query interface backed by the server's private SQLite file. */
export class NodeSqlite implements SqlDatabase {
  private raw:DatabaseSync;
  private runners=new WeakMap<SqlStatement,()=>unknown>();
  constructor(file:string, migrationsDir:string) {
    if(file!==':memory:') mkdirSync(dirname(resolve(file)),{recursive:true,mode:0o700});
    this.raw=new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.raw.exec('CREATE TABLE IF NOT EXISTS _kittakat_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
    try {
      for(const name of readdirSync(migrationsDir).filter(x=>x.endsWith('.sql')).sort()) {
        const sql=readFileSync(resolve(migrationsDir,name),'utf8');
        const hash=createHash('sha256').update(sql).digest('hex');
        const applied=this.raw.prepare('SELECT hash FROM _kittakat_migrations WHERE name=?').get(name);
        if(applied) {
          if(applied.hash!==hash) throw new Error(`Applied migration changed: ${name}`);
          continue;
        }
        this.raw.exec('BEGIN IMMEDIATE');
        try {
          this.raw.exec(sql);
          this.raw.prepare('INSERT INTO _kittakat_migrations (name,hash) VALUES (?,?)').run(name,hash);
          this.raw.exec('COMMIT');
        } catch(error) { this.raw.exec('ROLLBACK'); throw error; }
      }
    } catch(error) { this.raw.close(); throw error; }
  }
  prepare(sql:string):SqlStatement {
    let values:SQLInputValue[]=[];
    const run=()=>({meta:{changes:Number(this.raw.prepare(sql).run(...values).changes)}});
    const statement:SqlStatement={
      bind(...args:unknown[]) { values=args as SQLInputValue[]; return statement; },
      first:async <T>()=>(this.raw.prepare(sql).get(...values)??null) as T|null,
      all:async <T>()=>({results:this.raw.prepare(sql).all(...values) as T[]}),
      run:async ()=>run(),
    };
    this.runners.set(statement,run);
    return statement;
  }
  async batch(statements:SqlStatement[]):Promise<unknown> {
    // Do not yield between BEGIN and COMMIT: another request must never enter
    // an unfinished transaction on this shared connection.
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const results=statements.map(statement=>{
        const run=this.runners.get(statement);
        if(!run) throw new Error('Statement belongs to a different database');
        return run();
      });
      this.raw.exec('COMMIT'); return results;
    } catch(error) { this.raw.exec('ROLLBACK'); throw error; }
  }
  close() { this.raw.close(); }
}
