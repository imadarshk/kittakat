import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import type { SqlDatabase, SqlStatement } from '../../lib/server/service.ts';

/** Real SQLite executes the production queries and rollback behavior used by D1. */
export class SQLiteD1 implements SqlDatabase {
  raw = new DatabaseSync(':memory:');
  constructor() {
    this.raw.exec('PRAGMA foreign_keys=ON');
    for (const file of readdirSync(new URL('../../drizzle/', import.meta.url)).filter(x => x.endsWith('.sql')).sort()) {
      this.raw.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), 'utf8'));
    }
  }
  prepare(sql:string):SqlStatement {
    let values:unknown[] = [];
    const raw = this.raw;
    const statement:SqlStatement = {
      bind(...args:unknown[]) { if (args.length>100) throw new Error("D1 maximum bound parameters exceeded"); values = args; return statement; },
      async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T|null; },
      async all<T>() { return {results:raw.prepare(sql).all(...values as never[]) as T[]}; },
      async run() { const result = raw.prepare(sql).run(...values as never[]); return {meta:{changes:Number(result.changes)}}; },
    };
    return statement;
  }
  private queue:Promise<unknown> = Promise.resolve();
  async batch(statements:SqlStatement[]) {
    const work = this.queue.then(async () => {
      this.raw.exec('BEGIN IMMEDIATE');
      try { const result = []; for (const s of statements) result.push(await s.run()); this.raw.exec('COMMIT'); return result; }
      catch (error) { this.raw.exec('ROLLBACK'); throw error; }
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
}
