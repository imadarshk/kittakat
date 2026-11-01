import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync, renameSync, readdirSync, lstatSync, unlinkSync } from 'node:fs';
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
// Retain at least 31 completed snapshots and every snapshot less than 31 days old.
// Never prune unless the new backup has already passed both integrity checks.
const snapshots=readdirSync(directory).filter(name=>/^kittakat-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.sqlite$/.test(name)).sort().reverse();
for (const name of snapshots.slice(31)) {
  const file=join(directory,name),stat=lstatSync(file);
  if (file!==target&&stat.isFile()&&stat.mtimeMs<Date.now()-31*86400_000) unlinkSync(file);
}
