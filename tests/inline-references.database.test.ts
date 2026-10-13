import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {beforeAll,afterAll,expect,it} from 'vitest';
import type {Context} from '../src/lib/context';
let db:typeof import('../src/lib/db'),service:typeof import('../src/domain/service'),admin:Pool;
const originalUrl=process.env.DATABASE_URL,databaseName=`syntherisk_inline_test_${randomUUID().replaceAll('-','')}`;
beforeAll(async()=>{
 if(!originalUrl)throw new Error('DATABASE_URL required');admin=new Pool({connectionString:originalUrl});await admin.query(`CREATE DATABASE "${databaseName}"`);const url=new URL(originalUrl);url.pathname=`/${databaseName}`;process.env.DATABASE_URL=url.toString();db=await import('../src/lib/db');service=await import('../src/domain/service');
 const root=join(process.cwd(),'prisma','migrations');for(const entry of(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join(root,entry.name,'migration.sql'),'utf8'));
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=originalUrl;if(admin){await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}});
async function fixture(){const workspaceId=randomUUID(),companyId=randomUUID(),users:Context[]=[];await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'Isolated optional references']);await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3)',[companyId,workspaceId,'Reference fixture']);for(const roles of [['member'],['admin','operations']]){const userId=randomUUID();await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[userId,'Reference fixture member',`${userId}@example.invalid`]);await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[workspaceId,userId,roles]);users.push({workspaceId,companyId,userId,roles});}return users;}
it('persists unlinked names without creating records and preserves them on unrelated edits',async()=>{
 const [ctx]=await fixture();let row=await service.create(ctx,'decisions',{title:'Unlinked decision',content:'Record only',reference_inputs:{project_id:{text:'  Independent programme  ',create:false},meeting_id:{text:'Informal discussion',create:false}}});
 expect(row).toMatchObject({project_id:null,meeting_id:null,reference_notes:{project_id:'Independent programme',meeting_id:'Informal discussion'}});expect((await service.list(ctx,'projects')).total).toBe(0);expect((await service.list(ctx,'meetings')).total).toBe(0);
 row=await service.update(ctx,'decisions',String(row.id),{version:row.version,notes:'Additional note'});expect((await service.get(ctx,'decisions',String(row.id)))).toMatchObject({project_name:'Independent programme',meeting_name:'Informal discussion'});expect(row.reference_notes).toEqual({project_id:'Independent programme',meeting_id:'Informal discussion'});
});
it('can later link existing records or create explicitly, clearing only the replaced free names',async()=>{
 const [ctx]=await fixture(),project=await service.create(ctx,'projects',{name:'Existing programme'});let row=await service.create(ctx,'decisions',{title:'Link later',content:'Draft',reference_inputs:{project_id:{text:'Unlinked programme'},meeting_id:{text:'Unlinked discussion'}}});
 row=await service.update(ctx,'decisions',String(row.id),{version:row.version,project_id:project.id});expect(row.reference_notes).toEqual({meeting_id:'Unlinked discussion'});expect((await service.list(ctx,'projects')).total).toBe(1);
 row=await service.update(ctx,'decisions',String(row.id),{version:row.version,reference_inputs:{meeting_id:{text:'Created discussion',create:true}}});expect(row.reference_notes).toEqual({});expect(await service.get(ctx,'meetings',String(row.meeting_id))).toMatchObject({title:'Created discussion',project_id:project.id});
});
it('creates a project and meeting atomically in dependency order and inherits private visibility',async()=>{
 const [ctx,manager]=await fixture(),row=await service.create(ctx,'decisions',{title:'Private decision',content:'Private terms',is_private:true,reference_inputs:{meeting_id:{text:'Private discussion',create:true},project_id:{text:'Private programme',create:true}}});
 expect(await service.get(ctx,'meetings',String(row.meeting_id))).toMatchObject({project_id:row.project_id,is_private:true});expect(await service.get(ctx,'projects',String(row.project_id))).toMatchObject({is_private:true});for(const [resource,id] of [['projects',row.project_id],['meetings',row.meeting_id]])await expect(service.get(manager,String(resource),String(id))).rejects.toMatchObject({status:404});
});
it('rolls back all inline creations when enclosing validation or target creation is denied',async()=>{
 const [ctx]=await fixture();await expect(service.create(ctx,'decisions',{title:'Missing content',reference_inputs:{project_id:{text:'Must roll back',create:true}}})).rejects.toBeDefined();
 const denied={...ctx,permissions:[{resource:'meetings',operation:'create',scope:'none'}]};await expect(service.create(denied,'decisions',{title:'Denied meeting',content:'Draft',reference_inputs:{project_id:{text:'Also rolls back',create:true},meeting_id:{text:'Denied',create:true}}})).rejects.toMatchObject({status:403});expect((await service.list(ctx,'projects')).total).toBe(0);expect((await service.list(ctx,'meetings')).total).toBe(0);expect((await service.list(ctx,'decisions')).total).toBe(0);
});
it('rejects hidden references, mixed link/text payloads and attempts to bypass required parent references',async()=>{
 const [ctx,manager]=await fixture(),privateProject=await service.create(manager,'projects',{name:'Hidden programme',is_private:true});await expect(service.create(ctx,'decisions',{title:'Unavailable link',content:'Draft',project_id:privateProject.id})).rejects.toBeDefined();
 const project=await service.create(ctx,'projects',{name:'Visible programme'});await expect(service.create(ctx,'decisions',{title:'Ambiguous link',content:'Draft',project_id:project.id,reference_inputs:{project_id:{text:'Other programme'}}})).rejects.toMatchObject({code:'inline_reference_conflict'});
 await expect(service.create(ctx,'project_members',{reference_inputs:{project_id:{text:'Cannot replace required parent'}}})).rejects.toMatchObject({code:'inline_reference_unsupported'});await expect(service.create(ctx,'decisions',{title:'Direct write',content:'Draft',reference_notes:{project_id:'Injected'}})).rejects.toMatchObject({code:'readonly_or_unknown_field'});
});
it('reconsideration carries an unlinked project name without creating a project or copying the old meeting',async()=>{
 const [ctx]=await fixture(),original=await service.create(ctx,'decisions',{title:'Original decision',content:'Original terms',reference_inputs:{project_id:{text:'Unlinked programme'},meeting_id:{text:'Old discussion'}}});const draft=await service.action(ctx,'decisions',String(original.id),'reconsider',{version:original.version,reason:'Revisit the terms',create_meeting:true});expect(draft.reference_notes).toEqual({project_id:'Unlinked programme'});expect(await service.get(ctx,'meetings',String(draft.meeting_id))).toMatchObject({project_id:null,reference_notes:{project_id:'Unlinked programme'}});expect((await service.list(ctx,'projects')).total).toBe(0);
});
it('includes unlinked names in generic and financial print and selected-field exports',async()=>{
 const [,ctx]=await fixture(),{printRecord}=await import('../src/lib/print'),{exportRecords}=await import('../src/lib/io');const decision=await service.create(ctx,'decisions',{title:'Print free references',content:'Printable content',reference_inputs:{project_id:{text:'Unlinked programme <North>'},meeting_id:{text:'Independent discussion'}}});const html=await(await printRecord(ctx,'decisions',String(decision.id))).text();expect(html).toContain('Unlinked programme &lt;North&gt;');expect(html).toContain('Independent discussion');const exported=JSON.parse((await exportRecords(ctx,'decisions',{columns:'title,project_id,meeting_id'},'json')).content);expect(exported.records[0]).toMatchObject({project_id:null,project_name:'Unlinked programme <North>',meeting_id:null,meeting_name:'Independent discussion'});
 const claim=await service.create(ctx,'expense_claims',{title:'Unassigned expense',currency:'CAD',reference_inputs:{project_id:{text:'Independent operating expense'}}});expect(await(await printRecord(ctx,'expense_claims',String(claim.id))).text()).toContain('Independent operating expense');
});
