import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import type {Context} from '../src/lib/context';
import type {Row} from '../src/domain/core';

let db:typeof import('../src/lib/db'),service:typeof import('../src/domain/service'),responsibilities:typeof import('../src/domain/responsibilities'),admin:Pool;
const originalUrl=process.env.DATABASE_URL,databaseName=`syntherisk_responsible_test_${randomUUID().replaceAll('-','')}`;
const workspaceId=randomUUID(),companyId=randomUUID(),foreignWorkspace=randomUUID(),foreignCompany=randomUUID();
const users={admin:randomUUID(),creator:randomUUID(),co:randomUUID(),third:randomUUID(),external:randomUUID(),finance:randomUUID(),foreign:randomUUID(),reviewer:randomUUID()};
const ctx=(who:keyof typeof users,roles:string[]=['member']):Context=>({workspaceId,companyId,userId:users[who],roles});
const creator=ctx('creator'),co=ctx('co'),manager=ctx('admin',['admin','operations','finance']),external=ctx('external',['external']),finance=ctx('finance',['finance']);
beforeAll(async()=>{
 if(!originalUrl)throw new Error('DATABASE_URL required for isolated responsibility tests');admin=new Pool({connectionString:originalUrl});await admin.query(`CREATE DATABASE "${databaseName}"`);const url=new URL(originalUrl);url.pathname=`/${databaseName}`;process.env.DATABASE_URL=url.toString();db=await import('../src/lib/db');service=await import('../src/domain/service');responsibilities=await import('../src/domain/responsibilities');
 const root=join(process.cwd(),'prisma','migrations');for(const entry of(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join(root,entry.name,'migration.sql'),'utf8'));
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2),($3,$4)',[workspaceId,'Responsibility isolated workspace',foreignWorkspace,'Foreign responsibility workspace']);await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3),($4,$5,$6)',[companyId,workspaceId,'Responsibility test',foreignCompany,foreignWorkspace,'Foreign responsibility company']);
 for(const [name,id]of Object.entries(users)){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[id,`Responsible ${name}`,`${id}@example.invalid`]);await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[name==='foreign'?foreignWorkspace:workspaceId,id,name==='admin'?manager.roles:name==='finance'?['finance']:name==='reviewer'?['reviewer']:name==='external'?['external']:['member']]);}
 await service.seedDefaults(manager);
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=originalUrl;if(admin){await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}});
const id=(row:Row)=>String(row.id);
const task=(selected=[users.creator,users.co])=>service.create(creator,'tasks',{title:`Responsibility ${randomUUID()}`,responsible_user_ids:selected});

describe('multiple responsible users with legacy primary ownership',()=>{
 it('creates multiple responsible users atomically, enriches pages, includes them in Mine and sends one assignment each',async()=>{
  const record=await task([users.creator,users.co,users.third]);expect(record.owner_id).toBe(users.creator);expect(record.responsible_user_ids).toEqual([users.creator,...[users.co,users.third].sort()]);expect(record.responsible_users).toEqual(expect.arrayContaining([{id:users.co,name:'Responsible co',active:true}]));
  expect(JSON.stringify(record.responsible_users)).not.toMatch(/email|roles/);
  expect((await service.get(co,'tasks',id(record))).responsible_user_ids).toContain(users.co);
  expect((await service.list(co,'tasks',{owner_id:users.co})).rows.map(row=>row.id)).toContain(record.id);
  expect((await service.list(co,'tasks',{dashboard:'tasks',scope:'mine'})).rows.map(row=>row.id)).toContain(record.id);
  expect((await service.dashboard(co,'mine')).items.tasks.map(row=>row.id)).toContain(record.id);
  const notifications=await db.query("SELECT user_id FROM notifications WHERE workspace_id=$1 AND resource='tasks' AND record_id=$2 AND kind='assigned'",[workspaceId,record.id]);expect(notifications.map(row=>row.user_id).sort()).toEqual([users.co,users.third].sort());
 });
 it('joint responsibility permits ordinary edits, preserves extras for legacy owner changes, and rejects stale replacements',async()=>{
  const original=await task([users.creator,users.co,users.third]);const updated=await service.update(co,'tasks',id(original),{version:original.version,notes:'Joint edit'});expect(updated.version).toBe(2);
  const legacy=await service.update(creator,'tasks',id(original),{version:2,owner_id:users.co});expect(legacy.owner_id).toBe(users.co);expect(legacy.responsible_user_ids).toEqual([users.co,users.third]);
  const replaced=await service.update(co,'tasks',id(original),{version:3,responsible_user_ids:[users.third]});expect(replaced).toMatchObject({owner_id:users.third,version:4,responsible_user_ids:[users.third]});
  await expect(service.update(creator,'tasks',id(original),{version:3,responsible_user_ids:[]})).rejects.toMatchObject({code:'version_conflict'});
  const audit=await db.query<{after_data:{responsible_user_ids:string[]}}>("SELECT after_data FROM audit_log WHERE workspace_id=$1 AND resource='tasks' AND record_id=$2 AND action='responsibility_update' ORDER BY created_at",[workspaceId,original.id]);expect(audit).toHaveLength(3);expect(audit.at(-1)?.after_data.responsible_user_ids).toEqual([users.third]);
 });
 it('supports zero assignments on ordinary records and does not fabricate a default selection',async()=>{
  const record=await task([]);expect(record).toMatchObject({owner_id:null,responsible_user_ids:[],responsible_users:[]});
  const assigned=await service.update(creator,'tasks',id(record),{version:1,responsible_user_ids:[users.co]});expect(assigned.owner_id).toBe(users.co);
  const cleared=await service.update(creator,'tasks',id(record),{version:2,responsible_user_ids:[]});expect(cleared).toMatchObject({owner_id:null,responsible_user_ids:[]});
 });
 it('rejects foreign or newly disabled members and rolls back accompanying field changes',async()=>{
  const record=await task();await db.query("UPDATE memberships SET status='disabled' WHERE workspace_id=$1 AND user_id=$2",[workspaceId,users.third]);
  try{for(const invalid of[users.foreign,users.third,randomUUID()])await expect(service.update(creator,'tasks',id(record),{version:1,title:'Must rollback',responsible_user_ids:[users.creator,invalid]})).rejects.toMatchObject({code:'invalid_responsible_member'});}finally{await db.query("UPDATE memberships SET status='active' WHERE workspace_id=$1 AND user_id=$2",[workspaceId,users.third]);}
  expect(await service.get(creator,'tasks',id(record))).toMatchObject({title:record.title,version:1,responsible_user_ids:record.responsible_user_ids});
 });
 it('retains existing disabled assignments when unrelated fields are edited',async()=>{
  const record=await task();await db.query("UPDATE memberships SET status='disabled' WHERE workspace_id=$1 AND user_id=ANY($2::text[])",[workspaceId,[users.creator,users.co]]);
  try{const updated=await service.update(manager,'tasks',id(record),{version:1,owner_id:users.creator,responsible_user_ids:[users.creator,users.co],notes:'Other field'});expect(updated.responsible_users).toEqual(expect.arrayContaining([{id:users.creator,name:'Responsible creator',active:false},{id:users.co,name:'Responsible co',active:false}]));}finally{await db.query("UPDATE memberships SET status='active' WHERE workspace_id=$1 AND user_id=ANY($2::text[])",[workspaceId,[users.creator,users.co]]);}
 });
 it('respects explicit own/assigned/none policies and never grants external access by responsibility alone',async()=>{
  const record=await task([users.creator,users.co,users.external]);
  for(const rule of['own','assigned']){const scoped:Context={...co,permissions:[{resource:'tasks',operation:'read',scope:rule},{resource:'tasks',operation:'edit',scope:rule}]};expect((await service.get(scoped,'tasks',id(record))).id).toBe(record.id);}
  await expect(service.get({...co,permissions:[{resource:'tasks',operation:'read',scope:'none'}]},'tasks',id(record))).rejects.toMatchObject({status:404});
  await expect(service.get(external,'tasks',id(record))).rejects.toMatchObject({status:404});await db.query("INSERT INTO record_grants(workspace_id,resource,record_id,user_id,can_edit) VALUES($1,'tasks',$2,$3,true)",[workspaceId,record.id,users.external]);
  await expect(service.update(external,'tasks',id(record),{version:1,responsible_user_ids:[users.external,users.third]})).rejects.toMatchObject({code:'responsibility_assignment_forbidden'});
  const unchanged=await service.update(external,'tasks',id(record),{version:1,owner_id:users.creator,responsible_user_ids:record.responsible_user_ids,notes:'Granted record edit'});expect(unchanged.version).toBe(2);
 });
 it('does not grant finance access or override immutable financial states and claimant identity',async()=>{
  const invoice=await service.create(finance,'customer_invoices',{title:'Finance role boundary',currency:'CAD',responsible_user_ids:[users.finance,users.co]});await expect(service.get(co,'customer_invoices',id(invoice))).rejects.toMatchObject({status:404});await expect(service.update(co,'customer_invoices',id(invoice),{version:1,notes:'Denied'})).rejects.toMatchObject({status:404});
  const claim=await service.create(creator,'expense_claims',{title:'Preserved claimant',currency:'CAD',responsible_user_ids:[users.co,users.creator]});expect(claim.owner_id).toBe(users.creator);await expect(service.update(creator,'expense_claims',id(claim),{version:1,responsible_user_ids:[users.co]})).rejects.toMatchObject({code:'immutable_claimant'});
  await db.query("UPDATE expense_claims SET status='submitted' WHERE id=$1",[claim.id]);await expect(service.update(creator,'expense_claims',id(claim),{version:1,responsible_user_ids:[users.creator,users.third]})).rejects.toMatchObject({code:'record_locked'});
 });
 it('works for settings and child records while preserving their role and parent permissions',async()=>{
  const setting=await service.create(manager,'expense_categories',{name:'Shared setting',responsible_user_ids:[users.admin,users.co]});expect(setting.responsible_user_ids).toContain(users.co);await expect(service.update(co,'expense_categories',id(setting),{version:1,name:'Forbidden'})).rejects.toMatchObject({status:404});
  const parent=await task([users.creator,users.co]);const child=await service.create(creator,'task_checklist',{task_id:parent.id,title:'Shared checklist',responsible_user_ids:[users.creator,users.third]});expect(child.responsible_user_ids).toContain(users.third);
  await expect(service.update(ctx('third'),'task_checklist',id(child),{version:1,completed:true})).rejects.toMatchObject({status:404});expect((await service.update(co,'task_checklist',id(child),{version:1,completed:true})).completed).toBe(true);
 });
 it('provides stable sorted responsibility identities for signature snapshots',async()=>{
  const record=await task([users.creator,users.co]);expect(await responsibilities.recordResponsibleSnapshot(db.pool,creator,'tasks',id(record))).toEqual([users.creator,users.co].sort());await service.update(creator,'tasks',id(record),{version:1,responsible_user_ids:[users.creator,users.third]});expect(await responsibilities.recordResponsibleSnapshot(db.pool,creator,'tasks',id(record))).toEqual([users.creator,users.third].sort());
 });
 it('background reminders include joint task, subscription and event responsibility with dedupe and opt-out',async()=>{
  const {scheduleDueNotifications}=await import('../src/integrations/worker');
  const taskRecord=await service.create(creator,'tasks',{title:'Joint reminder',due_date:'2020-01-01',responsible_user_ids:[users.creator,users.co]});
  const subscription=await service.create(finance,'subscriptions',{name:'Joint renewal',currency:'CAD',due_date:'2020-01-01',amount_minor:'100',responsible_user_ids:[users.finance,users.co]});
  const start=new Date(Date.now()+5*60_000),end=new Date(start.getTime()+60*60_000);const event=await service.create(creator,'events',{title:'Joint event reminder',start_at:start.toISOString(),end_at:end.toISOString(),time_zone:'UTC',reminder_minutes:15,responsible_user_ids:[users.creator,users.co]});
  await scheduleDueNotifications();await scheduleDueNotifications();
  for(const record of[taskRecord,subscription,event]){const notifications=await db.query("SELECT user_id FROM notifications WHERE workspace_id=$1 AND record_id=$2 AND kind IN ('due','renewal')",[workspaceId,record.id]);expect(notifications).toHaveLength(2);expect(notifications.map(row=>row.user_id)).toContain(users.co);}
  await db.query("INSERT INTO notification_preferences(workspace_id,user_id,kind,enabled) VALUES($1,$2,'due',false)",[workspaceId,users.co]);
  try{const muted=await service.create(creator,'tasks',{title:'Muted joint reminder',due_date:'2020-01-01',responsible_user_ids:[users.creator,users.co]});await scheduleDueNotifications();expect((await db.query("SELECT user_id FROM notifications WHERE workspace_id=$1 AND record_id=$2 AND kind='due'",[workspaceId,muted.id])).map(row=>row.user_id)).toEqual([users.creator]);}finally{await db.query("DELETE FROM notification_preferences WHERE workspace_id=$1 AND user_id=$2 AND kind='due'",[workspaceId,users.co]);}
 });
});
