import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const configPath=path.resolve('dist/server/wrangler.json');
if(!fs.existsSync(configPath)){console.error('Run npm run build before applying local migrations.');process.exit(1);}
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const binding=config.d1_databases?.find(item=>item.binding==='DB');
if(!binding){console.error('The generated configuration does not declare the DB binding.');process.exit(1);}
binding.migrations_dir=path.resolve('drizzle');
fs.writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
const args=process.argv.slice(2),index=args.indexOf('--persist-to');
const persist=index>=0?args[index+1]:'.wrangler/state';
if(!persist){console.error('Provide a directory after --persist-to.');process.exit(1);}
const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config',configPath,'--persist-to',persist],{stdio:'inherit',env:process.env});
process.exit(result.status??1);
