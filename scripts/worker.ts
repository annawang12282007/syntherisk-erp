import 'dotenv/config';
import { setTimeout as wait } from 'node:timers/promises';
import { workerTick } from '../src/integrations/worker';
import { pool } from '../src/lib/db';
let stopped=false;
process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
async function main(){
  console.log('Syntherisk background worker started');
  do{try{await workerTick();}catch(error){console.error('Worker tick failed:',error instanceof Error?error.name:'UnknownError');if(process.argv.includes('--once'))process.exitCode=1;}if(!stopped&&!process.argv.includes('--once'))await wait(5000);}while(!stopped&&!process.argv.includes('--once'));
  await pool.end();
}
void main();
