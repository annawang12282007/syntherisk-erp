import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import type {Context} from '../src/lib/context';
import type {Row} from '../src/domain/core';

const original=process.env.DATABASE_URL,name=`syntherisk_admin_test_${randomUUID().replaceAll('-','')}`;
let root:Pool,db:typeof import('../src/lib/db'),roles:typeof import('../src/lib/roles'),policies:typeof import('../src/lib/permission-policies'),core:typeof import('../src/domain/core'),notices:typeof import('../src/domain/announcements'),profiles:typeof import('../src/lib/signature-profile');
const ctx:Context={workspaceId:randomUUID(),companyId:randomUUID(),userId:randomUUID(),roles:['admin']};
const member:Context={...ctx,userId:randomUUID(),roles:['member']},other:Context={...member,userId:randomUUID()};
beforeAll(async()=>{
 root=new Pool({connectionString:original});await root.query(`CREATE DATABASE "${name}"`);const url=new URL(original!);url.pathname=`/${name}`;process.env.DATABASE_URL=url.toString();
 db=await import('../src/lib/db');roles=await import('../src/lib/roles');policies=await import('../src/lib/permission-policies');core=await import('../src/domain/core');notices=await import('../src/domain/announcements');profiles=await import('../src/lib/signature-profile');
 for(const entry of (await readdir('prisma/migrations',{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join('prisma/migrations',entry.name,'migration.sql'),'utf8'));
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[ctx.workspaceId,'Administration isolated']);await db.query('INSERT INTO companies(id,workspace_id) VALUES($1,$2)',[ctx.companyId,ctx.workspaceId]);
 for(const actor of [ctx,member,other]){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[actor.userId,actor===ctx?'Administrator':'Member',`${actor.userId}@example.invalid`]);await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[ctx.workspaceId,actor.userId,actor.roles]);}
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=original;if(root){await root.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await root.end();}});
async function task(owner:string,creator:string){return (await db.query('INSERT INTO tasks(workspace_id,company_id,title,owner_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5) RETURNING *',[ctx.workspaceId,ctx.companyId,randomUUID(),owner,creator]))[0];}
describe('administrator-defined roles and combined record scopes',()=>{
 it('denies custom roles by default and rejects foreign or unregistered role assignment',async()=>{
  const role=await roles.saveRole(ctx,{name:'Restricted reviewer'});expect(core.permissionScope({...member,roles:[role.code]},'contacts','read')).toBe('none');
  expect(core.operationAccess({...member,roles:[role.code]},'tasks','create')).toBe(false);
  await expect(roles.saveRole(member,{name:'Escalation'})).rejects.toMatchObject({status:403});
  await expect(roles.validateRoles(randomUUID(),[role.code])).rejects.toMatchObject({code:'INVALID_ROLES'});
  await expect(db.query('UPDATE memberships SET roles=$3 WHERE workspace_id=$1 AND user_id=$2',[ctx.workspaceId,member.userId,['custom_'+randomUUID()]])).rejects.toMatchObject({code:'23514'});
 });

it('stores proportional signature display width per version without changing original uploaded bytes',async()=>{
 const sharp=(await import('sharp')).default;
 const bytes=await sharp({create:{width:300,height:100,channels:4,background:'#267777'}}).png().toBuffer();
 const current=await profiles.getSignatureProfile(ctx);
 const first=await profiles.saveSignatureProfile(ctx,{mode:'uploaded',version:current.version,image:'data:image/png;base64,'+bytes.toString('base64'),display_width:120,label:'Small'});
 const second=await profiles.saveSignatureProfile(ctx,{mode:'uploaded',version:first.version,display_width:500,label:'Large'});
 expect(second.sha256).toBe(first.sha256);expect(second.data_url).toBe(first.data_url);expect(second.display_width).toBe(500);
 const restored=await profiles.activateSignatureVersion(ctx,{action:'activate',revision:first.saved_version,version:second.version});expect(restored.display_width).toBe(120);
 await expect(profiles.saveSignatureProfile(ctx,{mode:'uploaded',version:restored.version,display_width:701})).rejects.toThrow();
});
 it('combines multiple selected scopes and operations without dropping either branch',async()=>{
  const role=await roles.saveRole(ctx,{name:'Creator and shared records'});
  await policies.savePermissionPolicy(ctx,{role_code:role.code,resource:'tasks',operations:['read','edit'],scopes:['created','granted']});
  const permissions=await db.query<{resource:string;operation:string;scope:string}>('SELECT resource,operation,scope FROM permissions WHERE workspace_id=$1 AND role_code=$2',[ctx.workspaceId,role.code]);
  const restricted={...member,roles:[role.code],permissions};
  const created=await task(other.userId,member.userId),shared=await task(other.userId,other.userId),hidden=await task(other.userId,other.userId);
  await db.query("INSERT INTO record_grants(workspace_id,resource,record_id,user_id,can_edit) VALUES($1,'tasks',$2,$3,true)",[ctx.workspaceId,shared.id,member.userId]);
  expect((await core.find(db.pool,restricted,'tasks',created.id)).id).toBe(created.id);expect((await core.find(db.pool,restricted,'tasks',shared.id)).id).toBe(shared.id);
  await core.assertOperation(db.pool,restricted,'tasks','edit',shared);await core.assertOperation(db.pool,restricted,'tasks','edit',created);
  await expect(core.find(db.pool,restricted,'tasks',hidden.id)).rejects.toMatchObject({status:404});
  await expect(core.assertOperation(db.pool,restricted,'tasks','edit',hidden)).rejects.toMatchObject({status:403});
  await db.query('UPDATE memberships SET roles=$3 WHERE workspace_id=$1 AND user_id=$2',[ctx.workspaceId,member.userId,[role.code]]);
  await expect(roles.saveRole(ctx,{...role,active:false})).rejects.toMatchObject({code:'ROLE_IN_USE'});
 });
 it('rejects irrelevant financial operations and contradictory scope selections atomically',async()=>{
  await expect(policies.savePermissionPolicy(ctx,{role_code:'member',resource:'contacts',operations:['read','pay'],scopes:['all']})).rejects.toMatchObject({code:'INVALID_POLICY_OPERATION'});
  await expect(policies.savePermissionPolicy(ctx,{role_code:'member',resource:'tasks',operations:['read'],scopes:['all','created']})).rejects.toMatchObject({code:'INVALID_POLICY_SCOPE'});
  expect(await db.query("SELECT 1 FROM permissions WHERE workspace_id=$1 AND role_code='member'",[ctx.workspaceId])).toHaveLength(0);
 });
});
describe('targeted announcements',()=>{
 it('archives and restores announcements with preserved acknowledgements, scoped notifications and version checks',async()=>{
  const draft=await notices.announcementAction(ctx,{action:'save',title:'Archive test',body:'Protected content',category:'general',priority:'normal',require_ack:true,recipient_ids:[member.userId]});
  const published=await notices.announcementAction(ctx,{action:'publish',...draft});await notices.announcementAction(member,{action:'acknowledge',id:draft.id,confirmation_note:'Acknowledgment survives archive and restore.'});
  const {visibleNotifications}=await import('../src/integrations/service');expect((await visibleNotifications(member)).some(r=>r.record_id===draft.id)).toBe(true);expect((await visibleNotifications(other)).some(r=>r.record_id===draft.id)).toBe(false);
  await expect(notices.announcementAction(member,{action:'archive',...published})).rejects.toMatchObject({status:403});
  const archived=await notices.announcementAction(ctx,{action:'archive',...published});expect((await notices.announcementList(ctx)).rows.some(r=>r.id===draft.id)).toBe(false);expect((await notices.announcementList(ctx,true)).rows.some(r=>r.id===draft.id)).toBe(true);expect((await notices.announcementList(member,true)).rows).toHaveLength(0);expect((await visibleNotifications(member)).some(r=>r.record_id===draft.id)).toBe(false);
  await expect(notices.announcementAction(ctx,{action:'restore',...published})).rejects.toMatchObject({code:'VERSION_CONFLICT'});await expect(notices.announcementAction(member,{action:'acknowledge',id:draft.id})).rejects.toMatchObject({status:404});
  await notices.announcementAction(ctx,{action:'restore',...archived});expect((await notices.announcementList(member)).rows.find(r=>r.id===draft.id)).toMatchObject({acknowledged_at:expect.any(Date),confirmation_note:'Acknowledgment survives archive and restore.'});
  expect(await db.query("SELECT id FROM notifications WHERE resource='announcements' AND record_id=$1",[draft.id])).toHaveLength(1);
  // Remove from the current list before existing fixture assertions.
  const current=(await notices.announcementList(ctx)).rows.find(r=>r.id===draft.id)!;await notices.announcementAction(ctx,{action:'archive',id:draft.id,version:current.version});
 });
 it('requires publication permission, limits audience, freezes published content, records acknowledgement and withdrawal',async()=>{
  const draft={action:'save',title:'Team update',body:'Internal test notice',category:'operations',priority:'important',require_ack:true,recipient_ids:[member.userId]};
  await expect(notices.announcementAction(member,draft)).rejects.toMatchObject({status:403});
  const row=await notices.announcementAction(ctx,draft);expect((await notices.announcementList(member)).rows).toHaveLength(0);
  const published=await notices.announcementAction(ctx,{action:'publish',...row});
  expect((await notices.announcementList(member)).rows).toHaveLength(1);expect((await notices.announcementList(other)).rows).toHaveLength(0);
  await expect(notices.announcementAction(other,{action:'acknowledge',id:row.id})).rejects.toMatchObject({status:403});
  await notices.announcementAction(member,{action:'acknowledge',id:row.id});
  expect((await notices.announcementList(ctx)).rows[0].recipients).toEqual([expect.objectContaining({user_id:member.userId,acknowledged_at:expect.any(Date),viewed_at:expect.any(Date)})]);
  await expect(notices.announcementAction(ctx,{...draft,...published})).rejects.toMatchObject({code:'NOTICE_PUBLISHED_IMMUTABLE'});
  await notices.announcementAction(ctx,{action:'withdraw',...published,reason:'Replaced'});expect((await notices.announcementList(member)).rows).toHaveLength(0);
  expect((await db.query('SELECT acknowledged_at FROM announcement_recipients WHERE announcement_id=$1',[row.id]))[0].acknowledged_at).not.toBeNull();
 });
});
describe('announcement confirmation notes',()=>{
 async function publishedNotice(recipients=[member.userId]){
  const draft=await notices.announcementAction(ctx,{action:'save',title:'Confirmation note test',body:'Original notice',category:'general',priority:'normal',require_ack:true,recipient_ids:recipients});
  return notices.announcementAction(ctx,{action:'publish',...draft});
 }
 it('stores a trimmed literal note for the acting recipient, shows managers all notes, and preserves the first acknowledgment on retry',async()=>{
  const notice=await publishedNotice([member.userId,other.userId]),body='<!--syntherisk-rich:v1--><b>Literal receipt</b>\nFollow-up next week.';
  await expect(notices.announcementAction(ctx,{action:'acknowledge',id:notice.id,confirmation_note:'Not a recipient'})).rejects.toMatchObject({status:403});
  await expect(notices.announcementAction({...member,workspaceId:randomUUID()},{action:'acknowledge',id:notice.id,confirmation_note:'Wrong workspace'})).rejects.toMatchObject({status:404});
  const receipt=await notices.announcementAction(member,{action:'acknowledge',id:notice.id,user_id:other.userId,confirmation_note:`  ${body}  `});
  expect(receipt).toMatchObject({acknowledged_at:expect.any(Date),viewed_at:expect.any(Date),confirmation_note:body});
  const mine=(await notices.announcementList(member)).rows.find(row=>row.id===notice.id)!;
  expect(mine).toMatchObject({confirmation_note:body,acknowledged_at:receipt.acknowledged_at});expect(mine.recipients).toBeUndefined();
  const colleague=(await notices.announcementList(other)).rows.find(row=>row.id===notice.id)!;
  expect(colleague).toMatchObject({acknowledged_at:null,confirmation_note:null});expect(colleague.recipients).toBeUndefined();
  const managed=(await notices.announcementList(ctx)).rows.find(row=>row.id===notice.id)!;
  expect(managed.recipients).toEqual(expect.arrayContaining([expect.objectContaining({user_id:member.userId,confirmation_note:body}),expect.objectContaining({user_id:other.userId,confirmation_note:null})]));
  const retry=await notices.announcementAction(member,{action:'acknowledge',id:notice.id,confirmation_note:'Attempted replacement'});
  expect(retry).toEqual(receipt);
  await notices.announcementAction(member,{action:'view',id:notice.id,confirmation_note:'Views cannot change notes'});
  expect((await notices.announcementList(member)).rows.find(row=>row.id===notice.id)).toMatchObject({confirmation_note:body,acknowledged_at:receipt.acknowledged_at});
 });
 it('rejects malformed and oversized notes without changing recipient state',async()=>{
  const notice=await publishedNotice();
  await expect(notices.announcementAction(member,{action:'acknowledge',id:notice.id,confirmation_note:true})).rejects.toMatchObject({code:'invalid_text'});
  await expect(notices.announcementAction(member,{action:'acknowledge',id:notice.id,confirmation_note:'x'.repeat(4001)})).rejects.toMatchObject({code:'confirmation_note_too_long'});
  expect((await notices.announcementList(member)).rows.find(row=>row.id===notice.id)).toMatchObject({acknowledged_at:null,viewed_at:null,confirmation_note:null});
  await expect(db.query('UPDATE announcement_recipients SET confirmation_note=$2 WHERE announcement_id=$1',[notice.id,'x'.repeat(4001)])).rejects.toMatchObject({code:'23514'});
 });
 it('accepts omitted or blank notes and does not add a note after the acknowledgment is already recorded',async()=>{
  for(const values of [{},{confirmation_note:' \n\t '}]){
   const notice=await publishedNotice();
   const receipt=await notices.announcementAction(member,{action:'acknowledge',id:notice.id,...values});
   expect(receipt).toMatchObject({acknowledged_at:expect.any(Date),confirmation_note:null});
   const retry=await notices.announcementAction(member,{action:'acknowledge',id:notice.id,confirmation_note:'Too late to replace receipt'});
   expect(retry).toEqual(receipt);
  }
 });
});

describe('personal signature appearance',()=>{
 it('renders an escaped generated signature and decodes only bounded raster uploads with version checks',async()=>{
  const initial=await profiles.getSignatureProfile(member);expect(initial.mode).toBe('generated');expect(initial.version).toBe(0);
  await expect(profiles.saveSignatureProfile(member,{mode:'uploaded',version:0,image:'data:image/svg+xml;base64,PHN2Zy8+'})).rejects.toMatchObject({code:'SIGNATURE_IMAGE_INVALID'});
  const sharp=(await import('sharp')).default;const png=await sharp({create:{width:120,height:40,channels:4,background:'#173c4a'}}).png().toBuffer();
  const saved=await profiles.saveSignatureProfile(member,{mode:'uploaded',version:0,image:`data:image/png;base64,${png.toString('base64')}`});
  expect(saved).toMatchObject({mode:'uploaded',version:1});expect(saved.sha256).toMatch(/^[a-f0-9]{64}$/);
  await expect(profiles.saveSignatureProfile(member,{mode:'generated',version:0})).rejects.toMatchObject({status:409});
  const changed=await profiles.saveSignatureProfile(member,{mode:'generated',style:'serif',version:1});expect(changed.sha256).not.toBe(saved.sha256);expect(saved.data_url).toContain('data:image/png;');
 });
});

it('enforces report access policies and only offers report-level scopes',async()=>{
 await expect(policies.savePermissionPolicy(ctx,{role_code:'member',resource:'analytics',operations:['read'],scopes:['created']})).rejects.toMatchObject({code:'INVALID_POLICY_SCOPE'});
 const reports=await import('../src/domain/reports');await expect(reports.analytics({...member,permissions:[{resource:'analytics',operation:'read',scope:'none'}]})).rejects.toMatchObject({status:403});
});

 it('stores independent signature text and immutable named versions; activating an older version does not change history',async()=>{
  const a=await profiles.saveSignatureProfile(other,{mode:'generated',style:'clean',version:0,signature_text:'Custom <Signer>',label:'Company English'});
  expect(a.signature_text).toBe('Custom <Signer>');expect(Buffer.from(a.data_url.split(',')[1],'base64').toString()).toContain('Custom &lt;Signer&gt;');
  const b=await profiles.saveSignatureProfile(other,{mode:'generated',style:'serif',version:a.version,signature_text:'自訂簽名',label:'中文版本'});
  await db.query('UPDATE "user" SET name=$2 WHERE id=$1',[other.userId,'Changed account name']);expect((await profiles.getSignatureProfile(other)).signature_text).toBe('自訂簽名');
  const selected=await profiles.activateSignatureVersion(other,{action:'activate',revision:1,version:b.version});expect(selected.signature_text).toBe(a.signature_text);expect(selected.sha256).toBe(a.sha256);expect(selected.versions).toHaveLength(2);
  await expect(profiles.activateSignatureVersion(member,{action:'activate',revision:selected.version,version:2})).rejects.toMatchObject({status:404});
  await expect(db.query('UPDATE signature_profile_versions SET signature_text=$2 WHERE user_id=$1',[other.userId,'Overwrite'])).rejects.toThrow('immutable');
  await expect(profiles.activateSignatureVersion(other,{action:'activate',revision:2,version:b.version})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 });
