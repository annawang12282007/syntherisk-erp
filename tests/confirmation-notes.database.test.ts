import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {beforeAll,afterAll,expect,it} from 'vitest';
import type {Context} from '../src/lib/context';
import type {Row} from '../src/domain/core';
import {RICH_PREFIX} from '../src/lib/rich-text';

let db:typeof import('../src/lib/db'),service:typeof import('../src/domain/service'),signatures:typeof import('../src/domain/signatures'),admin:Pool;
const originalUrl=process.env.DATABASE_URL,databaseName=`syntherisk_confirmation_notes_test_${randomUUID().replaceAll('-','')}`;
const workspaceId=randomUUID(),companyId=randomUUID();
const sender:Context={workspaceId,companyId,userId:randomUUID(),roles:['member']},recipient:Context={...sender,userId:randomUUID()},outsider:Context={...sender,userId:randomUUID()};
const names=new Map([[sender.userId,'Confirmation sender'],[recipient.userId,'Confirmation recipient'],[outsider.userId,'Unrelated colleague']]);
const id=(row:Row)=>String(row.id);
const notes=(row:Row)=>row.confirmation_notes as Row[];

beforeAll(async()=>{
 if(!originalUrl)throw new Error('DATABASE_URL required');
 admin=new Pool({connectionString:originalUrl});await admin.query(`CREATE DATABASE "${databaseName}"`);
 const url=new URL(originalUrl);url.pathname=`/${databaseName}`;process.env.DATABASE_URL=url.toString();
 db=await import('../src/lib/db');service=await import('../src/domain/service');signatures=await import('../src/domain/signatures');
 const root=join(process.cwd(),'prisma','migrations');
 for(const entry of(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join(root,entry.name,'migration.sql'),'utf8'));
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'Isolated confirmation notes']);
 await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3)',[companyId,workspaceId,'Confirmation note fixture']);
 for(const ctx of [sender,recipient,outsider]){
  await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[ctx.userId,names.get(ctx.userId),`${ctx.userId}@example.invalid`]);
  await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[workspaceId,ctx.userId,ctx.roles]);
 }
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=originalUrl;if(admin){await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}});

async function act(ctx:Context,resource:string,row:Row,action:string,data:Row={}){
 const values={version:row.version,...data};
 if(!signatures.requiresSignature(resource,action))return service.action(ctx,resource,id(row),action,values);
 if(data.idempotency_key&&(await db.query('SELECT 1 FROM action_keys WHERE workspace_id=$1 AND user_id=$2 AND idempotency_key=$3',[workspaceId,ctx.userId,data.idempotency_key])).length)return service.action(ctx,resource,id(row),action,values);
 const preview=await service.previewSignature(ctx,resource,id(row),action,values);
 return service.action(ctx,resource,id(row),action,{...values,signature:{typed_name:names.get(ctx.userId),consent:true,reviewed_hash:preview.reviewed_hash}});
}

it('persists a signed recipient note on the handoff and original task without duplicating or overwriting it on retry',async()=>{
 const task=await service.create(sender,'tasks',{title:'Receive ownership with note'}),handoff=await service.create(sender,'handoffs',{title:'Transfer work',task_id:task.id,to_user_id:recipient.userId});
 const key=randomUUID(),body='Checked the remaining items.\nWill finish the source review tomorrow.';
 const accepted=await act(recipient,'handoffs',handoff,'accept',{confirmation_note:`  ${body}  `,idempotency_key:key});
 expect(accepted.status).toBe('accepted');
 const source=notes(await service.get(sender,'handoffs',id(handoff))),target=notes(await service.get(recipient,'tasks',id(task)));
 expect(source).toHaveLength(1);expect(source[0]).toMatchObject({resource:'handoffs',record_id:handoff.id,record_version:accepted.version,action:'accept',actor_name:names.get(recipient.userId),body,format:'plain'});
 expect(source[0].id).toBeTruthy();expect(source[0].created_at).toBeTruthy();expect(target).toEqual(source);
 const replay=await act(recipient,'handoffs',handoff,'accept',{confirmation_note:'Changed retry must not overwrite the original note',idempotency_key:key});
 expect(replay.version).toBe(accepted.version);expect(notes(await service.get(recipient,'handoffs',id(handoff)))).toEqual(source);
 expect((await service.listSignatures(recipient,'handoffs',id(handoff)))).toHaveLength(1);
});

it('allows omitted or whitespace-only notes without creating empty confirmation entries',async()=>{
 for(const data of [{},{confirmation_note:' \n\t '}]){
  const handoff=await service.create(sender,'handoffs',{title:'Optional recipient note',to_user_id:recipient.userId});
  const accepted=await act(recipient,'handoffs',handoff,'accept',data);
  expect(accepted.status).toBe('accepted');expect(notes(await service.get(sender,'handoffs',id(handoff)))).toEqual([]);
 }
});

it('retains both sides of a request lifecycle and filters linked notes for viewers who cannot read the source',async()=>{
 const task=await service.create(sender,'tasks',{title:'Original team task'});
 let request=await service.create(sender,'work_requests',{title:'Request source review',task_id:task.id,recipient_id:recipient.userId,kind:'review'});
 request=await act(recipient,'work_requests',request,'accept',{confirmation_note:'I will check the primary sources.'});
 request=await act(recipient,'work_requests',request,'start');
 request=await act(recipient,'work_requests',request,'submit',{result:'Primary sources checked.'});
 request=await act(sender,'work_requests',request,'confirm',{confirmation_note:'The returned source review is complete.'});
 expect(request.status).toBe('completed');
 const source=notes(await service.get(sender,'work_requests',id(request))),target=notes(await service.get(sender,'tasks',id(task)));
 expect(source).toHaveLength(2);expect(target).toEqual(source);
 expect(source).toEqual(expect.arrayContaining([
  expect.objectContaining({action:'accept',actor_name:names.get(recipient.userId),body:'I will check the primary sources.'}),
  expect.objectContaining({action:'confirm',actor_name:names.get(sender.userId),body:'The returned source review is complete.'}),
 ]));
 await expect(service.get(outsider,'work_requests',id(request))).rejects.toMatchObject({status:404});
 const publicTask=await service.get(outsider,'tasks',id(task));expect(publicTask.id).toBe(task.id);expect(notes(publicTask)).toEqual([]);
});

it('projects confirmation notes back to explicitly linked original records as well as task references',async()=>{
 const project=await service.create(sender,'projects',{name:'Original programme'});
 const request=await service.create(sender,'work_requests',{title:'Accept programme work',recipient_id:recipient.userId,kind:'help',target_resource:'projects',target_id:project.id});
 await act(recipient,'work_requests',request,'accept',{confirmation_note:'Programme context received.'});
 expect(notes(await service.get(sender,'projects',id(project)))).toEqual([expect.objectContaining({resource:'work_requests',record_id:request.id,body:'Programme context received.'})]);
 expect(notes(await service.get(outsider,'projects',id(project)))).toEqual([]);
});

it('rejects unauthorized, oversized and non-text notes atomically while preserving a valid plain-text note literally',async()=>{
 const request=await service.create(sender,'work_requests',{title:'Validate optional response',recipient_id:recipient.userId,kind:'help'});
 await expect(act(sender,'work_requests',request,'accept',{confirmation_note:'Not the assigned recipient'})).rejects.toMatchObject({status:403});
 await expect(act(recipient,'work_requests',request,'accept',{confirmation_note:'x'.repeat(4001)})).rejects.toMatchObject({code:'confirmation_note_too_long'});
 await expect(act(recipient,'work_requests',request,'accept',{confirmation_note:true})).rejects.toMatchObject({code:'invalid_text'});
 const untouched=await service.get(sender,'work_requests',id(request));expect(untouched).toMatchObject({version:request.version,status:'pending'});expect(notes(untouched)).toEqual([]);
 const body='<b>Keep this as literal text</b>\nSecond line';await act(recipient,'work_requests',request,'accept',{confirmation_note:body});
 expect(notes(await service.get(sender,'work_requests',id(request)))).toEqual([expect.objectContaining({body,format:'plain'})]);
});

it('binds optional notes to the reviewed signature and rejects altered note text without completing the action',async()=>{
 const handoff=await service.create(sender,'handoffs',{title:'Signature-bound response',to_user_id:recipient.userId});
 const values={version:handoff.version,confirmation_note:'Reviewed note.'},preview=await service.previewSignature(recipient,'handoffs',id(handoff),'accept',values);
 await expect(service.action(recipient,'handoffs',id(handoff),'accept',{...values,confirmation_note:'Altered after preview.',signature:{typed_name:names.get(recipient.userId),consent:true,reviewed_hash:preview.reviewed_hash}})).rejects.toMatchObject({code:'signature_snapshot_changed'});
 const untouched=await service.get(sender,'handoffs',id(handoff));expect(untouched).toMatchObject({status:'pending',version:handoff.version});expect(notes(untouched)).toEqual([]);
 expect(await service.listSignatures(recipient,'handoffs',id(handoff))).toEqual([]);
});

it('reuses the existing review reason as a single rich confirmation entry on the review and original task',async()=>{
 let task=await service.create(sender,'tasks',{title:'Review existing opinion field'});
 task=await act(sender,'tasks',task,'submit_review',{reviewer_id:recipient.userId,deliverable:'Reviewed evidence package'});
 const review=(await service.list(recipient,'reviews',{task_id:task.id})).rows[0],reason=RICH_PREFIX+'<p>Checked the <strong>original sources</strong>.</p>';
 await act(recipient,'reviews',review,'approve',{reason});
 const reviewed=await service.get(recipient,'reviews',id(review)),original=await service.get(sender,'tasks',id(task));
 expect(reviewed).toMatchObject({status:'approved',comments:reason});expect(original.status).toBe('done');
 expect(notes(reviewed)).toEqual([expect.objectContaining({body:reason,format:'rich',action:'approve',resource:'reviews',record_id:review.id})]);
 expect(notes(original)).toEqual(notes(reviewed));
});
