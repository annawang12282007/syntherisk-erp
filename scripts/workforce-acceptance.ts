import 'dotenv/config';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import type {Context} from '../src/lib/context';
import type {WorkforceAttendance,WorkforceShift} from '../src/lib/workforce-types';

// Dedicated synthetic fixture. Never seeds the configured business database.
const configured=new URL(process.env.DATABASE_URL!);
if(!['127.0.0.1','localhost'].includes(configured.hostname))throw Error('Acceptance database must be local.');
const name='erp_workforce_acceptance_'+randomUUID().replaceAll('-','');
const admin=new Pool({connectionString:configured.toString()});
await admin.query(`CREATE DATABASE "${name}"`);
const database=new URL(configured);database.pathname='/'+name;
const origin='http://127.0.0.1:3031',directory=resolve('work/workforce-acceptance');
Object.assign(process.env,{DATABASE_URL:database.toString(),APP_URL:origin,PORT:'3031',HOSTNAME:'127.0.0.1',NODE_ENV:'production',BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',GOOGLE_LOGIN_ENABLED:'false',SMTP_HOST:'',SMTP_FROM:'',SMTP_USER:'',SMTP_PASSWORD:'',S3_BUCKET:'',ANTHROPIC_API_KEY:'',AUTH_REQUIRE_EMAIL_VERIFICATION:'false',AUTH_MAIL_MODE:'file-test',AUTH_MAIL_DIR:resolve(directory,'mail'),ATTACHMENT_DIR:resolve(directory,'attachments')});
await new Promise<void>((done,fail)=>{const child=spawn(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,windowsHide:true,stdio:'ignore'});child.once('error',fail);child.once('exit',code=>code===0?done():fail(Error('Fixture migrations failed')));});
const {bootstrap}=await import('../src/lib/identity');
const {auth}=await import('../src/lib/auth');
const {pool,query}=await import('../src/lib/db');
const {workforceAction}=await import('../src/domain/workforce');
const password=randomBytes(24).toString('base64url');
const initial=await bootstrap({name:'示範主管',email:'manager@workforce.invalid',password,workspace:'排班薪資示範'});
const manager:Context={...initial,roles:['admin']};
const user=(await auth.api.signUpEmail({body:{name:'示範同仁',email:'member@workforce.invalid',password}})).user;
await query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[manager.workspaceId,user.id,['member']]);
const member:Context={...manager,userId:user.id,roles:['member']};
for(const person of [manager,member]){
 await workforceAction(manager,{action:'save_worker',user_id:person.userId,start_date:'2026-01-01',active:true,version:0});
 await query('INSERT INTO user_preferences(workspace_id,user_id,settings) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET settings=$3',[person.workspaceId,person.userId,JSON.stringify({locale:'zh-TW',timezone:'Asia/Taipei',theme:{mode:'light',density:'standard'}})]);
}
await workforceAction(manager,{action:'save_pay_rate',user_id:manager.userId,basis:'hourly',amount_minor:'200',effective_from:'2026-01-01'});
await workforceAction(manager,{action:'save_pay_rate',user_id:member.userId,basis:'monthly',amount_minor:'36000',effective_from:'2026-01-01'});
const pending=await workforceAction(manager,{action:'correct_attendance',user_id:manager.userId,clock_in_at:'2026-09-07T09:00:00+08:00',clock_out_at:'2026-09-07T19:00:00+08:00',unpaid_break_seconds:3600,day_type:'regular',reason:'合成出勤資料，供核准流程驗收'}) as WorkforceAttendance;
const past=await workforceAction(manager,{action:'correct_attendance',user_id:member.userId,clock_in_at:'2026-09-08T09:00:00+08:00',clock_out_at:'2026-09-08T20:00:00+08:00',unpaid_break_seconds:3600,day_type:'regular',reason:'合成月薪出勤資料'}) as WorkforceAttendance;
await workforceAction(manager,{action:'approve_attendance',id:past.id,version:past.version,day_type:'regular'});
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=await workforceAction(manager,{action:'save_shift',user_id:member.userId,title:'門市早班',start_at:`${today}T09:00:00+08:00`,end_at:`${today}T18:00:00+08:00`,unpaid_break_minutes:60,day_type:'regular',notes:'合成資料：交接時清點庫存'}) as WorkforceShift;
await workforceAction(manager,{action:'publish_shift',id:shift.id,version:shift.version});
const period=await workforceAction(manager,{action:'create_payroll',title:'2026 年 9 月應發薪資',start_date:'2026-09-01',end_date_exclusive:'2026-10-01'});
await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,'runtime.json'),JSON.stringify({database:name,origin,password,manager,member,pending,period},null,2),{mode:0o600});
await pool.end();
const app=spawn(process.execPath,['scripts/start.mjs'],{env:process.env,windowsHide:true,stdio:['ignore','inherit','inherit']});
console.log(`Synthetic workforce acceptance starting at ${origin}. Private runtime in work/workforce-acceptance/runtime.json.`);
let stopping=false;
async function stop(){if(stopping)return;stopping=true;if(app.exitCode===null&&app.signalCode===null)await new Promise<void>(done=>{app.once('exit',()=>done());app.kill('SIGTERM');});if(!/^erp_workforce_acceptance_[a-f0-9]{32}$/.test(name))throw Error('Invalid fixture database');await admin.query(`DROP DATABASE IF EXISTS "${name}"`);await admin.end();process.exit(0);}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());app.once('exit',()=>void stop());
