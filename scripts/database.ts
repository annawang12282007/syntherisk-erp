import 'dotenv/config';
import {existsSync,readFileSync,cpSync,renameSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from 'pg';
if(process.env.NODE_ENV==='production')throw new Error('Use a managed PostgreSQL instance or Docker Compose in production.');
const url=new URL(process.env.DATABASE_URL??'');
if(!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Embedded database must bind loopback.');
const databaseDir=resolve(process.env.LOCAL_DATABASE_DIR??'data/postgres');
const name=url.pathname.slice(1);if(!/^[a-z][a-z0-9_]+$/.test(name))throw new Error('Unsafe database name');
const require=createRequire(import.meta.url),embeddedRequire=createRequire(require.resolve('embedded-postgres'));
const binaries={...embeddedRequire(`@embedded-postgres/${process.platform==='win32'?'windows':process.platform}-${process.arch}`)} as {postgres:string;pg_ctl:string};
// PostgreSQL's Windows timezone file reader still has a MAX_PATH boundary.
// Keep its complete runtime under a short project-local path, never in node_modules' nested path.
if(process.platform==='win32'){
 const source=dirname(dirname(binaries.postgres)),short=resolve('work','pg-runtime-18');
 if(!existsSync(resolve(short,'bin',basename(binaries.postgres)))){const staging=short+'-'+process.pid;cpSync(source,staging,{recursive:true});try{renameSync(staging,short);}catch(error){if(!existsSync(resolve(short,'bin',basename(binaries.postgres))))throw error;}}
 binaries.postgres=resolve(short,'bin',basename(binaries.postgres));binaries.pg_ctl=resolve(short,'bin',basename(binaries.pg_ctl));
}
// Isolate initialization: importing embedded-postgres registers force-exit signal hooks.
if(!existsSync(resolve(databaseDir,'PG_VERSION')))await promisify(execFile)(process.execPath,['--input-type=module','-e',`import EmbeddedPostgres from 'embedded-postgres';const url=new URL(process.env.DATABASE_URL);await new EmbeddedPostgres({databaseDir:process.env.LOCAL_DATABASE_DIR,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),port:Number(url.port),persistent:true,authMethod:'scram-sha-256',initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}}).initialise();process.exit(0);`],{windowsHide:true,timeout:90000,env:{...process.env,LOCAL_DATABASE_DIR:databaseDir}});
// Own the process so embedded-postgres's Windows taskkill hook cannot race graceful shutdown.
const child=spawn(binaries.postgres,['-D',databaseDir,'-p',url.port,'-h','127.0.0.1'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let output='',stopping=false;child.stderr?.on('data',chunk=>{output=(output+String(chunk)).slice(-2000);});
child.on('error',()=>{console.error('PostgreSQL process could not start.');process.exit(1);});
function ownsDatabase(){try{return Number(readFileSync(resolve(databaseDir,'postmaster.pid'),'utf8').split(/\r?\n/)[0])===child.pid;}catch{return false;}}
async function stop(code=0){if(stopping)return;stopping=true;try{if(child.exitCode===null){if(ownsDatabase())await promisify(execFile)(binaries.pg_ctl,['-D',databaseDir,'-m','fast','-w','-t','20','stop'],{windowsHide:true,timeout:25000});else child.kill('SIGTERM');}console.log('PostgreSQL stopped cleanly.');process.exit(code);}catch{console.error('PostgreSQL shutdown failed; inspect the local data directory before restarting.');process.exit(1);}}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>void stop());
try{
 let ready=false;
 for(let i=0;i<60;i++){if(child.exitCode!==null)throw new Error(output||'PostgreSQL exited before becoming ready.');if(!ownsDatabase()){await delay(500);continue;}const client=new Client({host:'127.0.0.1',port:Number(url.port),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:'postgres',connectionTimeoutMillis:1000});try{await client.connect();if(!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await client.query(`CREATE DATABASE "${name}"`);ready=true;}catch(error){if(i===59)throw error;}finally{await client.end().catch(()=>{});}if(ready)break;await delay(500);}
 if(!ready)throw new Error('PostgreSQL did not become ready.');console.log(`PostgreSQL ready at 127.0.0.1:${url.port}; persistent data directory ${databaseDir}`);
 child.once('exit',code=>{if(!stopping){console.error('PostgreSQL exited unexpectedly.');process.exit(code??1);}});
}catch{console.error('Local database initialization failed.');await stop(1);}
