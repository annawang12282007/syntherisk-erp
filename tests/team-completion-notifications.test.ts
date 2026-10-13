import {describe,it,expect,vi,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {query} from '../src/lib/db';
import type {Context} from '../src/lib/context';
import {create,get,list,update,action,dashboard,search} from '../src/domain/service';
import {visibleNotifications} from '../src/integrations/service';
import {deliverNotificationMail,scheduleNotificationMail} from '../src/integrations/notification-mail';
import {ProviderError} from '../src/integrations/adapters';
async function fixture(){const workspaceId=randomUUID(),companyId=randomUUID();await query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'Team completion fixture']);await query('INSERT INTO companies(id,workspace_id,name,base_currency) VALUES($1,$2,$3,$4)',[companyId,workspaceId,'Fixture','CAD']);const users:Context[]=[];for(const roles of [['admin','operations'],['member'],['member'],['external']]){const userId=randomUUID();await query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[userId,roles[0],`${userId}@example.invalid`]);await query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[workspaceId,userId,roles]);users.push({workspaceId,companyId,userId,roles});}return users;}
async function team(admin:Context,member:Context){const [row]=await query('INSERT INTO company_teams(workspace_id,name,created_by) VALUES($1,$2,$3) RETURNING id',[admin.workspaceId,'Research team',admin.userId]);await query("INSERT INTO company_team_members(workspace_id,team_id,user_id,role) VALUES($1,$2,$3,'member')",[admin.workspaceId,row.id,member.userId]);return String(row.id);}
afterEach(()=>vi.unstubAllEnvs());
describe('team audiences and completion confirmations',()=>{
 it('uses current team membership, preserves individual mode and prevents stale IDs granting access',async()=>{
  const [admin,a,b,external]=await fixture(),id=await team(admin,a);
  let row=await create(admin,'documents',{title:'Team scope',visibility:'selected_teams',viewer_team_ids:[id],viewer_user_ids:[b.userId]});
  expect((await get(a,'documents',String(row.id))).id).toBe(row.id);await expect(get(b,'documents',String(row.id))).rejects.toMatchObject({status:404});
  expect((await list(b,'documents')).total).toBe(0);
  const [before]=await query('SELECT access_revision FROM workspaces WHERE id=$1',[admin.workspaceId]);await query('DELETE FROM company_team_members WHERE team_id=$1 AND user_id=$2',[id,a.userId]);
  const [after]=await query('SELECT access_revision FROM workspaces WHERE id=$1',[admin.workspaceId]);expect(Number(after.access_revision)).toBeGreaterThan(Number(before.access_revision));
  await expect(get(a,'documents',String(row.id))).rejects.toMatchObject({status:404});
  await query("INSERT INTO company_team_members(workspace_id,team_id,user_id,role) VALUES($1,$2,$3,'member')",[admin.workspaceId,id,b.userId]);expect((await get(b,'documents',String(row.id))).id).toBe(row.id);
  await query("UPDATE memberships SET status='disabled' WHERE workspace_id=$1 AND user_id=$2",[admin.workspaceId,b.userId]);await expect(get(b,'documents',String(row.id))).rejects.toMatchObject({status:404});
  await query("INSERT INTO company_team_members(workspace_id,team_id,user_id,role) VALUES($1,$2,$3,'member')",[admin.workspaceId,id,external.userId]);await expect(get(external,'documents',String(row.id))).rejects.toMatchObject({status:404});
  row=await update(admin,'documents',String(row.id),{version:row.version,visibility:'restricted',viewer_user_ids:[a.userId]});expect((await get(a,'documents',String(row.id))).id).toBe(row.id);
  await expect(get({...a,permissions:[{resource:'documents',operation:'read',scope:'none'}]},'documents',String(row.id))).rejects.toMatchObject({status:404});
 });
 it('rejects invalid or foreign teams, non-manager audiences, and respects private parent records',async()=>{
  const [admin,a]=await fixture(),[foreign,member]=await fixture(),other=await team(foreign,member),id=await team(admin,a);
  for(const ids of [[],[other],['not-a-uuid']])await expect(create(admin,'documents',{title:'Bad',visibility:'selected_teams',viewer_team_ids:ids})).rejects.toMatchObject({status:422});
  await expect(create(a,'documents',{title:'Bad',visibility:'selected_teams',viewer_team_ids:[id]})).rejects.toMatchObject({status:403});
  const project=await create(admin,'projects',{name:'Private parent',is_private:true});const task=await create(admin,'tasks',{title:'Cannot leak',project_id:project.id,visibility:'selected_teams',viewer_team_ids:[id]});await expect(get(a,'tasks',String(task.id))).rejects.toMatchObject({status:404});
 });
 it('preserves task titles in saved records, source references and search when confirmation is toggled',async()=>{
  vi.stubEnv('SMTP_HOST','');
  const [admin,a]=await fixture();
  const titles=['Source title with confirmation','Source title without confirmation'];
  const sources=[
   await create(admin,'tasks',{title:titles[0],completion_required:true,completion_user_ids:[a.userId]}),
   await create(admin,'tasks',{title:titles[1],completion_required:false}),
  ];
  const children:typeof sources=[];
  for(const [index,source] of sources.entries())children.push(await create(admin,'tasks',{title:`Follow-up ${index+1}`,parent_task_id:source.id}));
  const verify=async(enabled:boolean[])=>{
   const listed=(await list(admin,'tasks',{pageSize:100})).rows;
   for(const [index,source] of sources.entries()){
    expect(await get(admin,'tasks',String(source.id))).toMatchObject({title:titles[index],completion_required:enabled[index]});
    expect(listed.find(row=>row.id===source.id)).toMatchObject({title:titles[index],completion_required:enabled[index]});
    expect(await get(admin,'tasks',String(children[index].id))).toMatchObject({parent_task_id:source.id,parent_task_name:titles[index]});
    expect(listed.find(row=>row.id===children[index].id)).toMatchObject({parent_task_id:source.id,parent_task_name:titles[index]});
   }
   const results=(await search(admin,'Source title')).results.filter(row=>row.resource==='tasks');
   expect(results).toHaveLength(2);
   for(const [index,source] of sources.entries())expect(results.find(row=>row.id===source.id)).toMatchObject({title:titles[index],summary:titles[index]});
  };
  await verify([true,false]);
  sources[0]=await update(admin,'tasks',String(sources[0].id),{version:sources[0].version,completion_required:false});
  sources[1]=await update(admin,'tasks',String(sources[1].id),{version:sources[1].version,completion_required:true,completion_user_ids:[a.userId]});
  await verify([false,true]);
 });
 it('publishes to selected members, requires each own confirmation, blocks bypass and completes only once',async()=>{
  const [admin,a,b,external]=await fixture();let task=await create(admin,'tasks',{title:'Do the work',visibility:'restricted',completion_required:true,completion_user_ids:[a.userId,b.userId]});
  expect((await visibleNotifications(a)).some(n=>n.kind==='completion_requested'&&n.record_id===task.id)).toBe(true);
  expect((await dashboard(a,'mine')).counts.tasks).toBe(1);
  await expect(action(admin,'tasks',String(task.id),'complete',{version:task.version})).rejects.toMatchObject({code:'completion_pending'});
  await expect(action(admin,'tasks',String(task.id),'confirm_completion',{version:task.version})).rejects.toMatchObject({code:'completion_recipient_required'});
  await expect(action(external,'tasks',String(task.id),'confirm_completion',{version:task.version})).rejects.toMatchObject({status:404});
  task=await action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,idempotency_key:'a-ack'});expect(task.status).toBe('todo');
  expect((task.completion_people as {confirmed_at:unknown}[]).filter(p=>p.confirmed_at)).toHaveLength(1);
  task=await action(a,'tasks',String(task.id),'confirm_completion',{version:task.version});expect(task.status).toBe('todo');
  task=await action(b,'tasks',String(task.id),'confirm_completion',{version:task.version});expect(task.status).toBe('done');
  const log=await query("SELECT actor_id FROM audit_log WHERE record_id=$1 AND action='confirm_completion'",[task.id]);expect(log).toHaveLength(2);expect(new Set(log.map(x=>x.actor_id))).toEqual(new Set([a.userId,b.userId]));
  await expect(update(admin,'tasks',String(task.id),{version:task.version,title:'Changed completed work'})).rejects.toMatchObject({code:'completion_locked'});
 });
 it('resets confirmations on assignment edits and rejects inaccessible or inactive recipients atomically',async()=>{
  const [admin,a,b,external]=await fixture();let task=await create(admin,'tasks',{title:'First round',completion_required:true,completion_user_ids:[a.userId,b.userId]});task=await action(a,'tasks',String(task.id),'confirm_completion',{version:task.version});
  task=await update(admin,'tasks',String(task.id),{version:task.version,title:'Second round'});expect(task.completion_revision).toBe(2);expect((task.completion_people as {confirmed_at:unknown}[]).every(p=>!p.confirmed_at)).toBe(true);
  await expect(create(admin,'tasks',{title:'Bad recipient',completion_required:true,completion_user_ids:[external.userId]})).rejects.toMatchObject({code:'completion_members_required'});
  await expect(create(admin,'tasks',{title:'Private assignment',completion_required:true,completion_user_ids:[a.userId],is_private:true})).rejects.toMatchObject({code:'private_record_not_shareable'});
  const project=await create(admin,'projects',{name:'Private ancestor',is_private:true});await expect(create(admin,'tasks',{title:'Inaccessible assignment',project_id:project.id,completion_required:true,completion_user_ids:[a.userId]})).rejects.toMatchObject({code:'record_recipient_access_required'});
  expect((await list(admin,'tasks')).total).toBe(1);
 });
 it('validates optional confirmation notes without changing the task on invalid input',async()=>{
  const [admin,a,b]=await fixture();let task=await create(admin,'tasks',{title:'Optional notes',completion_required:true,completion_user_ids:[a.userId,b.userId]});
  for(const note of [null,true,7,{},[]])await expect(action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:note})).rejects.toMatchObject({code:'invalid_text'});
  await expect(action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:'x'.repeat(4001)})).rejects.toMatchObject({code:'confirmation_note_too_long'});
  expect(await query('SELECT 1 FROM task_completions WHERE task_id=$1',[task.id])).toHaveLength(0);
  expect(await get(admin,'tasks',String(task.id))).toMatchObject({status:'todo',version:task.version});
  task=await action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:`  ${'x'.repeat(4000)}  `});
  expect((task.completion_people as Record<string,unknown>[]).find(person=>person.id===a.userId)).toMatchObject({confirmation_note:'x'.repeat(4000),revision:1});
  task=await action(b,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:' \n\t '});
  expect(task.status).toBe('done');expect((task.completion_people as Record<string,unknown>[]).find(person=>person.id===b.userId)).toMatchObject({confirmation_note:null});
  let optional=await create(admin,'tasks',{title:'No note supplied',completion_required:true,completion_user_ids:[a.userId]});
  optional=await action(a,'tasks',String(optional.id),'confirm_completion',{version:optional.version});
  expect(optional.status).toBe('done');expect((optional.completion_people as Record<string,unknown>[])[0]).toMatchObject({confirmation_note:null});
 });
 it('persists notes with the authenticated actor and never overwrites a completed confirmation',async()=>{
  const [admin,a,b,external]=await fixture();let task=await create(admin,'tasks',{title:'Attributed notes',visibility:'restricted',completion_required:true,completion_user_ids:[a.userId,b.userId]});
  await expect(action(admin,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:'Not my confirmation'})).rejects.toMatchObject({code:'completion_recipient_required'});
  await expect(action(external,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:'Unauthorized note'})).rejects.toMatchObject({status:404});
  await expect(action({...a,permissions:[{resource:'tasks',operation:'action:confirm_completion',scope:'none'}]},'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:'Permission denied'})).rejects.toMatchObject({status:403});
  const note='已核對附件。\n第二頁仍需後續追蹤。';
  task=await action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:`  ${note}  `,user_id:b.userId});
  const [stored]=await query('SELECT user_id,revision,confirmed_at,confirmation_note FROM task_completions WHERE task_id=$1',[task.id]);
  expect(stored).toMatchObject({user_id:a.userId,revision:1,confirmation_note:note});expect(stored.confirmed_at).toBeInstanceOf(Date);
  const firstVersion=task.version;task=await action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:'Attempted replacement'});
  expect(task.version).toBe(firstVersion);
  expect(await query('SELECT user_id,revision,confirmed_at,confirmation_note FROM task_completions WHERE task_id=$1',[task.id])).toEqual([stored]);
  task=await action(b,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:'Checked independently'});expect(task.status).toBe('done');
  const saved=await get(b,'tasks',String(task.id));expect((saved.completion_people as Record<string,unknown>[]).find(person=>person.id===a.userId)).toMatchObject({confirmation_note:note,confirmed_at:stored.confirmed_at});
  expect(await query("SELECT actor_id FROM audit_log WHERE record_id=$1 AND action='confirm_completion' ORDER BY created_at",[task.id])).toEqual([{actor_id:a.userId},{actor_id:b.userId}]);
  await expect(get(external,'tasks',String(task.id))).rejects.toMatchObject({status:404});
 });
 it('keeps prior-round notes separate after assignment edits and preserves removed recipient history',async()=>{
  const [admin,a,b]=await fixture();let task=await create(admin,'tasks',{title:'Round one',visibility:'restricted',completion_required:true,completion_user_ids:[a.userId,b.userId]});
  task=await action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:'First-round evidence',idempotency_key:'original-round-confirmation'});
  task=await update(admin,'tasks',String(task.id),{version:task.version,title:'Round two'});
  expect(task.completion_revision).toBe(2);expect((task.completion_people as Record<string,unknown>[]).every(person=>person.confirmed_at===null&&person.confirmation_note===null)).toBe(true);
  expect(task.completion_history).toEqual([expect.objectContaining({id:a.userId,name:'member',revision:1,confirmation_note:'First-round evidence'})]);
  const replay=await action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:'Must not replace history',idempotency_key:'original-round-confirmation'});
  expect(replay).toMatchObject({title:'Round two',completion_revision:2,version:task.version});expect((replay.completion_people as Record<string,unknown>[]).every(person=>person.confirmation_note===null&&person.confirmed_at===null)).toBe(true);
  task=await action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:'Second-round evidence'});
  task=await update(admin,'tasks',String(task.id),{version:task.version,completion_user_ids:[b.userId]});
  expect(task.completion_revision).toBe(3);expect(task.completion_people).toEqual([expect.objectContaining({id:b.userId,revision:3,confirmed_at:null,confirmation_note:null})]);
  expect(task.completion_history).toEqual([expect.objectContaining({id:a.userId,name:'member',revision:2,confirmation_note:'Second-round evidence'}),expect.objectContaining({id:a.userId,name:'member',revision:1,confirmation_note:'First-round evidence'})]);
  await expect(get(a,'tasks',String(task.id))).rejects.toMatchObject({status:404});
  await expect(action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,idempotency_key:'original-round-confirmation'})).rejects.toMatchObject({status:404});
  const visible=await get(b,'tasks',String(task.id));expect(visible.completion_history).toEqual(task.completion_history);
 });
 it('retains confirmation notes when requirements are removed and starts a fresh round when re-enabled',async()=>{
  const [admin,a,b]=await fixture();let task=await create(admin,'tasks',{title:'Confirmation later disabled',completion_required:true,completion_user_ids:[a.userId,b.userId]});
  task=await action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:'Preserve this record'});
  task=await update(admin,'tasks',String(task.id),{version:task.version,completion_required:false});
  expect(task.completion_people).toEqual([]);expect(task.completion_history).toEqual([expect.objectContaining({id:a.userId,revision:1,confirmation_note:'Preserve this record'})]);
  expect((await get(admin,'tasks',String(task.id))).completion_history).toEqual(task.completion_history);
  task=await update(admin,'tasks',String(task.id),{version:task.version,completion_required:true,completion_user_ids:[a.userId,b.userId]});
  expect(task.completion_revision).toBe(2);expect((task.completion_people as Record<string,unknown>[]).every(person=>person.confirmed_at===null&&person.confirmation_note===null)).toBe(true);
  expect(task.completion_history).toEqual([expect.objectContaining({id:a.userId,revision:1,confirmation_note:'Preserve this record'})]);
  task=await action(a,'tasks',String(task.id),'confirm_completion',{version:task.version,confirmation_note:'New confirmation after re-enabling'});
  expect((task.completion_people as Record<string,unknown>[]).find(person=>person.id===a.userId)).toMatchObject({revision:2,confirmation_note:'New confirmation after re-enabling'});
  expect(task.completion_history).toEqual([expect.objectContaining({id:a.userId,revision:1,confirmation_note:'Preserve this record'})]);
 });
});
describe('notification email without real delivery',()=>{
 function setup(){vi.stubEnv('SMTP_HOST','localhost');vi.stubEnv('SMTP_FROM','notifications@example.invalid');vi.stubEnv('SMTP_PORT','1025');vi.stubEnv('APP_URL','http://localhost:3000');}
 it('queues new notices, sends once through a fake transport, uses a login link and records status',async()=>{
  setup();const [admin,a]=await fixture();await create(admin,'tasks',{title:'PRIVATE TITLE NOT IN EMAIL',completion_required:true,completion_user_ids:[a.userId]});const [notice]=await visibleNotifications(a);
  await scheduleNotificationMail();expect(await query("SELECT 1 FROM outbox WHERE kind='notification_mail' AND payload->>'notification_id'=$1",[notice.id])).toHaveLength(1);
  const send=vi.fn(async()=>({messageId:'fake-provider-id'}));await deliverNotificationMail(a.workspaceId,String(notice.id),{send});await deliverNotificationMail(a.workspaceId,String(notice.id),{send});expect(send).toHaveBeenCalledTimes(1);const mail=send.mock.calls[0] as unknown as [{text:string;recipient:string}];expect(mail[0].text).toContain('/data/tasks?record=');expect(mail[0].text).not.toContain('PRIVATE TITLE');expect(mail[0].recipient).toContain(a.userId);
  expect((await query('SELECT email_status FROM notifications WHERE id=$1',[notice.id]))[0].email_status).toBe('sent');
 });
 it('suppresses revoked access, disabled mail preferences, and marks ambiguous delivery without retrying',async()=>{
  setup();const [admin,a]=await fixture();let task=await create(admin,'tasks',{title:'Notification',completion_required:true,completion_user_ids:[a.userId]});const [notice]=await visibleNotifications(a);const send=vi.fn(async()=>({messageId:'fake'}));
  task=await update(admin,'tasks',String(task.id),{version:task.version,completion_required:false,visibility:'restricted'});await deliverNotificationMail(a.workspaceId,String(notice.id),{send});expect(send).not.toHaveBeenCalled();
  await create(admin,'tasks',{title:'Second',completion_required:true,completion_user_ids:[a.userId]});const [second]=await visibleNotifications(a);await query("INSERT INTO notification_preferences(workspace_id,user_id,kind,enabled) VALUES($1,$2,'email',false)",[a.workspaceId,a.userId]);await deliverNotificationMail(a.workspaceId,String(second.id),{send});expect(send).not.toHaveBeenCalled();
  await query("UPDATE notification_preferences SET enabled=true WHERE workspace_id=$1 AND user_id=$2 AND kind='email'",[a.workspaceId,a.userId]);await create(admin,'tasks',{title:'Third',completion_required:true,completion_user_ids:[a.userId]});const [third]=await visibleNotifications(a);
  const ambiguous=vi.fn(async()=>{throw new ProviderError('mail_delivery_uncertain',409);});await expect(deliverNotificationMail(a.workspaceId,String(third.id),{send:ambiguous})).rejects.toMatchObject({code:'mail_delivery_uncertain'});await expect(deliverNotificationMail(a.workspaceId,String(third.id),{send:ambiguous})).rejects.toMatchObject({code:'mail_delivery_uncertain'});expect(ambiguous).toHaveBeenCalledTimes(1);
 });
});
