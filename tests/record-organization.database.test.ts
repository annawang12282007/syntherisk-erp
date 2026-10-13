import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import type {Context} from '../src/lib/context';
import type {Row} from '../src/domain/core';

let db:typeof import('../src/lib/db'),organization:typeof import('../src/domain/record-organization'),admin:Pool;
const originalUrl=process.env.DATABASE_URL,databaseName=`syntherisk_organization_test_${randomUUID().replaceAll('-','')}`;
const workspaceId=randomUUID(),companyId=randomUUID(),userId=randomUUID(),otherUser=randomUUID(),foreignWorkspace=randomUUID(),foreignCompany=randomUUID();
const ctx:Context={workspaceId,companyId,userId,roles:['admin']},member:Context={...ctx,roles:['member']},stranger:Context={...member,userId:otherUser};
const legacyWorkspace=randomUUID(),legacyCompany=randomUUID(),legacyActor=randomUUID(),legacyCustom=randomUUID();
beforeAll(async()=>{
 if(!originalUrl)throw new Error('DATABASE_URL required for isolated record organization tests');admin=new Pool({connectionString:originalUrl});await admin.query(`CREATE DATABASE "${databaseName}"`);const url=new URL(originalUrl);url.pathname=`/${databaseName}`;process.env.DATABASE_URL=url.toString();db=await import('../src/lib/db');organization=await import('../src/domain/record-organization');
 const root=join(process.cwd(),'prisma','migrations');for(const entry of(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.name==='202610070017_builtin_record_categories'){
   await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[legacyWorkspace,'Pre-migration categories']);await db.query('INSERT INTO companies(id,workspace_id) VALUES($1,$2)',[legacyCompany,legacyWorkspace]);await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[legacyActor,'Pre-migration actor',`${legacyActor}@example.invalid`]);await db.query('INSERT INTO record_categories(id,workspace_id,name,created_by,updated_by) VALUES($1,$2,$3,$4,$4)',[legacyCustom,legacyWorkspace,'財務',legacyActor]);
  }
  await db.query(await readFile(join(root,entry.name,'migration.sql'),'utf8'));
 }
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2),($3,$4)',[workspaceId,'Organization isolated workspace',foreignWorkspace,'Foreign workspace']);await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3),($4,$5,$6)',[companyId,workspaceId,'Organization test',foreignCompany,foreignWorkspace,'Foreign company']);
 for(const user of[userId,otherUser]){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[user,'Isolated classification member',`${user}@example.invalid`]);await db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['member'])",[workspaceId,user]);}
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=originalUrl;if(admin){await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}});
const sid=(value:unknown)=>String(value);
async function project(name:string,owner=userId,foreign=false){return(await db.query('INSERT INTO projects(workspace_id,company_id,name,owner_id,created_by,updated_by) VALUES($1,$2,$3,$4,$4,$4) RETURNING *',[foreign?foreignWorkspace:workspaceId,foreign?foreignCompany:companyId,name,owner]))[0];}
async function task(primary:string|null=null){return(await db.query('INSERT INTO tasks(workspace_id,company_id,title,project_id,owner_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5,$5) RETURNING *',[workspaceId,companyId,'Isolated classification task',primary,userId]))[0];}
async function category(name:string){return await organization.updateRecordOrganization(member,{action:'category_create',name}) as Row;}
async function replace(row:Row,categories:string[],projects:string[],who:Context=member){return await organization.updateRecordOrganization(who,{action:'replace',resource:'tasks',id:row.id,version:row.version,category_ids:categories,project_ids:projects}) as Row;}

describe('optional record categories and additional project relationships',()=>{
 it('backfills general categories while preserving similarly named custom categories and initializes new companies idempotently',async()=>{
  const legacy=await db.query('SELECT id,name,builtin_key FROM record_categories WHERE workspace_id=$1',[legacyWorkspace]);expect(legacy).toHaveLength(8);expect(legacy.find(row=>row.id===legacyCustom)).toMatchObject({name:'財務',builtin_key:null});expect(legacy.filter(row=>row.name==='財務')).toHaveLength(2);
  const initial=await organization.getRecordOrganization(ctx);const builtins=initial.categories.filter(row=>row.builtin_key);expect(builtins.map(row=>row.builtin_key).sort()).toEqual(['administration','business','finance','legal','people','product','projects']);expect(builtins.every(row=>row.can_manage===false&&row.created_by===null)).toBe(true);
  const ids=builtins.map(row=>row.id).sort();await db.query('SELECT ensure_builtin_record_categories($1)',[workspaceId]);await db.query('INSERT INTO companies(workspace_id,name) VALUES($1,$2)',[workspaceId,'Second company same catalogue']);expect((await organization.getRecordOrganization(ctx)).categories.filter(row=>row.builtin_key).map(row=>row.id).sort()).toEqual(ids);
  const {seedDefaults}=await import('../src/domain/service');await seedDefaults(ctx);await seedDefaults(ctx);expect((await organization.getRecordOrganization(ctx)).categories.filter(row=>row.builtin_key).map(row=>row.id).sort()).toEqual(ids);
  expect((await db.query('SELECT count(*) AS total FROM record_category_links WHERE workspace_id=$1',[workspaceId]))[0].total).toBe('0');
 });
 it('general categories can be selected with custom categories but cannot be renamed or archived by managers',async()=>{
  const builtin=(await organization.getRecordOrganization(ctx)).categories.find(row=>row.builtin_key==='finance')!;const custom=await category('財務'),record=await task();const selected=await replace(record,[builtin.id,sid(custom.id)],[]);expect(selected.category_ids).toHaveLength(2);
  for(const action of ['category_rename','category_archive'])await expect(organization.updateRecordOrganization(ctx,{action,id:builtin.id,version:1,name:'Modified'})).rejects.toMatchObject({code:'builtin_category_immutable',status:403});
  await expect(db.query('UPDATE record_categories SET name=$2 WHERE id=$1',[builtin.id,'Modified'])).rejects.toMatchObject({code:'23514'});await expect(db.query('DELETE FROM record_categories WHERE id=$1',[builtin.id])).rejects.toMatchObject({code:'23514'});
  const filtered=await(await import('../src/domain/service')).list(member,'tasks',{classification_id:builtin.id});expect(filtered.rows.map(row=>row.id)).toContain(record.id);
  expect((await organization.recordOrganizationSnapshot(db.pool,ctx,'tasks',sid(record.id))).category_ids).toEqual([builtin.id,sid(custom.id)].sort());
 });
 it('allows zero or multiple associations, preserves primary project, versions changes and writes one auditable relationship event',async()=>{
  const primary=await project('Primary'),a=await project('Related A'),b=await project('Related B'),record=await task(sid(primary.id)),one=await category('Internal'),two=await category('Research');
  const blank=await organization.getRecordOrganization(member,'tasks',sid(record.id));expect(blank).toMatchObject({category_ids:[],project_ids:[],version:1,primary_project:{id:primary.id}});
  const organized=await replace(record,[sid(one.id),sid(two.id),sid(one.id)],[sid(a.id),sid(b.id),sid(primary.id)]);
  expect(organized.category_ids).toHaveLength(2);expect(organized.project_ids).toEqual([sid(a.id),sid(b.id)].sort());expect(organized.version).toBe(2);
  expect((await db.query('SELECT project_id FROM tasks WHERE id=$1',[record.id]))[0].project_id).toBe(primary.id);
  const logs=await db.query("SELECT before_data,after_data FROM audit_log WHERE workspace_id=$1 AND resource='tasks' AND record_id=$2 AND action='organization_links'",[workspaceId,record.id]);expect(logs).toHaveLength(1);expect(logs[0].before_data).toMatchObject({category_ids:[],project_ids:[],version:1});expect(logs[0].after_data).toMatchObject({version:2});
  const cleared=await replace({...record,version:2},[],[]);expect(cleared).toMatchObject({category_ids:[],project_ids:[],version:3,primary_project:{id:primary.id}});
 });
 it('rejects stale and concurrent replacement without merging stale selections',async()=>{
  const record=await task(),a=await category('Concurrent A'),b=await category('Concurrent B');
  const result=await Promise.allSettled([replace(record,[sid(a.id)],[]),replace(record,[sid(b.id)],[])]);expect(result.filter(value=>value.status==='fulfilled')).toHaveLength(1);expect(result.find(value=>value.status==='rejected')).toMatchObject({reason:{status:409,code:'version_conflict'}});
  const state=await organization.getRecordOrganization(member,'tasks',sid(record.id));expect(state).toMatchObject({version:2});expect('category_ids'in state&&state.category_ids).toHaveLength(1);
 });
 it('validates write access, resource eligibility, same-workspace categories and projects with full rollback',async()=>{
  const record=await task(),a=await category('Authorization A'),foreign=await project('Foreign project',userId,true);
  await expect(replace(record,[sid(a.id)],[],stranger)).rejects.toMatchObject({status:404});
  await expect(replace(record,[randomUUID()],[])).rejects.toMatchObject({code:'category_unavailable'});
  await expect(replace(record,[sid(a.id)],[sid(foreign.id)])).rejects.toMatchObject({status:404});
  await expect(organization.updateRecordOrganization(member,{action:'replace',resource:'invoice_lines',id:record.id,version:1,category_ids:[],project_ids:[]})).rejects.toMatchObject({code:'organization_resource_unsupported'});
  expect(await organization.getRecordOrganization(member,'tasks',sid(record.id))).toMatchObject({version:1,category_ids:[],project_ids:[]});
  await expect(organization.getRecordOrganization({...ctx,workspaceId:foreignWorkspace,companyId:foreignCompany},'tasks',sid(record.id))).rejects.toMatchObject({status:404});
 });
 it('preserves unreadable existing project links without disclosing their names or IDs',async()=>{
  const record=await task(),visible=await project('Visible project'),hidden=await project('Hidden project',otherUser);await replace(record,[],[sid(visible.id),sid(hidden.id)]);
  const restricted:Context={...member,permissions:[{resource:'projects',operation:'read',scope:'own'}]};
  const state=await organization.getRecordOrganization(restricted,'tasks',sid(record.id));expect(state).toMatchObject({version:2,project_ids:[visible.id],protected_project_count:1});expect(JSON.stringify(state)).not.toContain(sid(hidden.id));expect(JSON.stringify(state)).not.toContain('Hidden project');
  const updated=await replace({...record,version:2},[],[],restricted);expect(updated).toMatchObject({version:3,project_ids:[],protected_project_count:1});
  expect((await organization.recordOrganizationSnapshot(db.pool,ctx,'tasks',sid(record.id))).project_ids).toEqual([hidden.id]);
 });
 it('category administration permits creator and managers, checks versions, archives without deleting history, and excludes external creation',async()=>{
  const created=await category(' Category label ');expect(created.name).toBe('Category label');
  await expect(organization.updateRecordOrganization(stranger,{action:'category_rename',id:created.id,version:1,name:'Unauthorized'})).rejects.toMatchObject({status:403});
  const renamed=await organization.updateRecordOrganization(member,{action:'category_rename',id:created.id,version:1,name:'Renamed label'}) as Row;expect(renamed.version).toBe(2);
  await expect(organization.updateRecordOrganization(member,{action:'category_archive',id:created.id,version:1})).rejects.toMatchObject({code:'version_conflict'});
  const record=await task();await replace(record,[sid(created.id)],[]);await organization.updateRecordOrganization(ctx,{action:'category_archive',id:created.id,version:2});
  const state=await organization.getRecordOrganization(member,'tasks',sid(record.id));expect(state).toMatchObject({category_ids:[created.id],selected_categories:[{id:created.id,archived:true}]});expect(state.categories.some(category=>category.id===created.id)).toBe(false);
  await expect(replace(await task(),[sid(created.id)],[])).rejects.toMatchObject({code:'category_unavailable'});
  await expect(organization.updateRecordOrganization({...member,roles:['external']},{action:'category_create',name:'Forbidden'})).rejects.toMatchObject({status:403});
 });
 it('canonical snapshots have stable identity while classification labels are renamed',async()=>{
  const record=await task(),tag=await category('Snapshot label'),linked=await project('Snapshot related');await replace(record,[sid(tag.id)],[sid(linked.id)]);
  const before=await organization.recordOrganizationSnapshot(db.pool,ctx,'tasks',sid(record.id));await organization.updateRecordOrganization(member,{action:'category_rename',id:tag.id,version:1,name:'Changed display label'});
  expect(await organization.recordOrganizationSnapshot(db.pool,ctx,'tasks',sid(record.id))).toEqual(before);
 });
 it('list filters use classifications and either primary or extra projects, while unassigned means no links',async()=>{
  const {list}=await import('../src/domain/service');
  const primary=await project('Filter primary'),extra=await project('Filter extra'),tag=await category('Filter classification'),assigned=await task(sid(primary.id)),uncategorized=await task();
  await replace(assigned,[sid(tag.id)],[sid(extra.id)]);
  const byCategory=await list(member,'tasks',{classification_id:tag.id});expect(byCategory.rows.map(row=>row.id)).toEqual([assigned.id]);
  for(const id of[primary.id,extra.id])expect((await list(member,'tasks',{linked_project_id:id})).rows.map(row=>row.id)).toEqual([assigned.id]);
  const noCategory=await list(member,'tasks',{classification_id:'unassigned',pageSize:200}),noProject=await list(member,'tasks',{linked_project_id:'unassigned',pageSize:200});
  expect(noCategory.rows.map(row=>row.id)).toContain(uncategorized.id);expect(noCategory.rows.map(row=>row.id)).not.toContain(assigned.id);expect(noProject.rows.map(row=>row.id)).toContain(uncategorized.id);expect(noProject.rows.map(row=>row.id)).not.toContain(assigned.id);
  const foreign=await project('Filter foreign',userId,true);await expect(list(member,'tasks',{linked_project_id:foreign.id})).rejects.toMatchObject({status:404});
 });
 it('distinguishes a protected primary project from an actually unassigned record',async()=>{
  const hidden=await project('Private primary',otherUser),record=await task(sid(hidden.id)),restricted:Context={...member,permissions:[{resource:'projects',operation:'read',scope:'own'}]};
  const state=await organization.getRecordOrganization(restricted,'tasks',sid(record.id));expect(state).toMatchObject({primary_project:null,primary_project_protected:true,protected_project_count:1});expect(JSON.stringify(state)).not.toContain('Private primary');
  expect(await replace(record,[],[],restricted)).toMatchObject({version:1,primary_project_protected:true});expect((await db.query('SELECT project_id FROM tasks WHERE id=$1',[record.id]))[0].project_id).toBe(hidden.id);
 });
});
