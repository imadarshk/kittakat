import { isAbsolute, resolve } from 'node:path';
import { SQLiteDatabase } from './sqlite';

let database:SQLiteDatabase|undefined;
export const env = {
  ENABLE_CHATGPT_AUTH:'false',
  TRUST_YETI_PROXY:'true',
  get PUBLIC_ORIGIN():string {
    if (!process.env.KITTAKAT_PUBLIC_ORIGIN) throw new Error('KITTAKAT_PUBLIC_ORIGIN is required.');
    return process.env.KITTAKAT_PUBLIC_ORIGIN;
  },
  get DB():D1Database {
    const file=process.env.KITTAKAT_DB_PATH;
    if (!file||!isAbsolute(file)) throw new Error('KITTAKAT_DB_PATH must point to an absolute persistent database file.');
    database??=new SQLiteDatabase(file,resolve(process.env.KITTAKAT_MIGRATIONS_DIR||'drizzle'));
    return database as unknown as D1Database;
  },
};
