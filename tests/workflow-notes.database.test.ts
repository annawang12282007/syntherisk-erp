import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {beforeAll,afterAll,expect,it} from 'vitest';
import type {Context} from '../src/lib/context';
let db:typeof import('../src/lib/db'),service:typeof import('../src/domain/service'),admin:Pool;
const originalUrl=process.env.DATABASE_URL,databaseName=`syntherisk_notes_test_${randomUUID().replaceAll('-','')}`;
const workspaceId=randomUUID(),companyId=randomUUID();const sender:Context={workspaceId,companyId,userId:randomUUID(),roles:['member']},recipient:Context={...sender,userId:randomUUID()};
beforeAll(async()=>{
 if(!originalUrl)throw new Error('DATABASE_URL required');admin=new Pool({connectionString:originalUrl});await admin.query(`CREATE DATABASE "${databaseName}"`);const url=new URL(originalUrl);url.pathname=`/${databaseName}`;process.env.DATABASE_URL=url.toString();db=await import('../src/lib/db');service=await import('../src/domain/service');
 const root=join(process.cwd(),'prisma','migrations');for(const entry of(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join(root,entry.name,'migration.sql'),'utf8'));
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'Isolated workflow notes']);await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3)',[companyId,workspaceId,'Notes fixture']);
 for(const ctx of [sender,recipient]){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[ctx.userId,'Note fixture member',`${ctx.userId}@example.invalid`]);await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[workspaceId,ctx.userId,ctx.roles]);}
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=originalUrl;if(admin){await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}});
for(const resource of ['handoffs','work_requests'])it(`${resource} retains separate resubmission and withdrawal explanations in history`,async()=>{
 let row=await service.create(sender,resource,{title:'Action note acceptance',...(resource==='handoffs'?{to_user_id:recipient.userId}:{recipient_id:recipient.userId,kind:'help'})});
 row=await service.action(recipient,resource,String(row.id),'needs_info',{version:row.version,reason:'Please include the remaining items.'});
 row=await service.action(sender,resource,String(row.id),'resubmit',{version:row.version,reason:'The remaining items have been added.'});expect(row.reason).toBe('The remaining items have been added.');expect(row.status).toBe('pending');
 await expect(service.action(recipient,resource,String(row.id),'withdraw',{version:row.version,reason:'Not the sender'})).rejects.toMatchObject({status:403});
 row=await service.action(sender,resource,String(row.id),'withdraw',{version:row.version,reason:'The assignment will be rescheduled.'});expect(row.status).toBe('withdrawn');expect((await service.get(sender,resource,String(row.id))).reason).toBe('The assignment will be rescheduled.');
 const audit=await db.query('SELECT action,actor_id,created_at,before_data,after_data FROM audit_log WHERE workspace_id=$1 AND resource=$2 AND record_id=$3 ORDER BY created_at',[workspaceId,resource,row.id]);
 expect(audit.find(event=>event.action==='resubmit')).toMatchObject({actor_id:sender.userId,after_data:{reason:'The remaining items have been added.'}});expect(audit.find(event=>event.action==='withdraw')).toMatchObject({actor_id:sender.userId,before_data:{reason:'The remaining items have been added.'},after_data:{reason:'The assignment will be rescheduled.'}});
});
