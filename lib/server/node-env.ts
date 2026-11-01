import { resolve } from 'node:path';
import { NodeSqlite } from './node-sqlite';

let database:NodeSqlite|undefined;
export const env={
  ENABLE_CHATGPT_AUTH:'false',
  CLIENT_IP_HEADER:'x-real-ip',
  get DB() {
    return database??=new NodeSqlite(
      process.env.KITTAKAT_DB_PATH||resolve('data/kittakat.sqlite'),
      resolve(process.env.KITTAKAT_MIGRATIONS_DIR||'drizzle'),
    );
  },
};
