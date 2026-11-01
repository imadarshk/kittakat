import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const command=process.argv[2];
if(!['build','start'].includes(command)) throw new Error('Expected build or start');
const args=command==='start'?['--port',process.env.PORT||'8080','--hostname',process.env.HOST||'0.0.0.0']:[];
const result=spawnSync(process.execPath,[fileURLToPath(new URL('../node_modules/vinext/dist/cli.js',import.meta.url)),command,...args],{
  stdio:'inherit',env:{...process.env,KITTAKAT_TARGET:'node',ENABLE_CHATGPT_AUTH:'false',NODE_ENV:'production'},
});
if(result.error) throw result.error;
process.exit(result.status??1);
