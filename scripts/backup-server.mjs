import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync, renameSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

const source=process.env.KITTAKAT_DB_PATH;
if (!source||!isAbsolute(source)) throw new Error('Set KITTAKAT_DB_PATH to the persistent database file.');
const directory=process.env.KITTAKAT_BACKUP_DIR||join(dirname(source),'backups');
mkdirSync(directory,{recursive:true,mode:0o700});
const target=join(directory,`kittakat-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
const temporary=target+'.partial';
const live=new DatabaseSync(source,{readOnly:true});
try { await backup(live,temporary); } finally { live.close(); }
chmodSync(temporary,0o600);
const restored=new DatabaseSync(temporary,{readOnly:true});
try {
  const integrity=restored.prepare('PRAGMA integrity_check').all();
  if (integrity.length!==1||integrity[0].integrity_check!=='ok'||restored.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup validation failed; partial file retained for inspection.');
} finally { restored.close(); }
renameSync(temporary,target);
console.log(`Validated backup: ${target}`);
