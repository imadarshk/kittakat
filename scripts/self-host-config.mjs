import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
const databaseId=args.includes('--database-id')?value('--database-id'):'';
const name=args.includes('--name')?value('--name'):'kittakat';
if(!/^[a-z][a-z0-9-]{1,62}$/.test(name)||! /^[0-9a-f-]{36}$/i.test(databaseId)){console.error('Usage: node scripts/self-host-config.mjs --database-id YOUR_D1_DATABASE_UUID [--name kittakat]');process.exit(1);}
const file=path.resolve('dist/server/wrangler.json');
if(!fs.existsSync(file)){console.error('Run npm run build first.');process.exit(1);}
const config=JSON.parse(fs.readFileSync(file,'utf8'));
config.name=name;config.vars={...config.vars,ENABLE_CHATGPT_AUTH:'false'};
config.d1_databases=[{binding:'DB',database_name:name,database_id:databaseId,migrations_dir:path.resolve('drizzle')}];
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');
console.log('Self-host configuration prepared. Username/password authentication is enabled; ChatGPT sign-in is disabled.');
