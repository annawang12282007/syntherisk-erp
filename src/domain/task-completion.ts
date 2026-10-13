import type {Context} from '../lib/context';
import {type Client,type Row,fail,str,elevated,scope,operationAccess,patch,notify,assertDependenciesComplete,notifyDependents} from './core';
import {assertRecordRecipient} from './task-visibility';

export function parseConfirmationNote(value:unknown):string|null{
 if(value===undefined)return null;
 if(typeof value!=='string')fail('invalid_text');
 const note=value.trim();
 if(note.length>4000)fail('confirmation_note_too_long');
 return note||null;
}

export async function prepareTaskCompletion(c:Client,ctx:Context,data:Row,old?:Row){
 const next={...data},enabled=data.completion_required??old?.completion_required??false;
 if(typeof enabled!=='boolean')fail('invalid_boolean');
 const raw=data.completion_user_ids??old?.completion_user_ids??[];
 if(!Array.isArray(raw)||raw.length>200||raw.some(id=>typeof id!=='string'||!id))fail('completion_members_required');
 const ids=enabled?[...new Set(raw as string[])].sort():[];
 if(enabled&&!ids.length)fail('completion_members_required');
 const prior=(old?.completion_user_ids as string[]||[]),changed=enabled!==Boolean(old?.completion_required)||JSON.stringify(ids)!==JSON.stringify([...prior].sort());
 if(enabled&&(data.is_private??old?.is_private))fail('private_record_not_shareable',403);
 if(old&&changed){
  if(!elevated(ctx)&&old.created_by!==ctx.userId&&old.owner_id!==ctx.userId)fail('completion_manager_required',403);
  if(['done','cancelled','review'].includes(str(old.status)))fail('completion_locked',409);
  if((old.visibility!=='team'||(data.visibility&&data.visibility!=='team'))&&!elevated(ctx))fail('record_audience_manager_required',403);
 }
 if(changed&&ids.length){const valid=(await c.query("SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::text[]) AND status='active' AND NOT(roles <@ ARRAY['external']::text[]) AND user_id IS DISTINCT FROM (SELECT initial_admin_user_id FROM workspaces WHERE id=$1) FOR SHARE",[ctx.workspaceId,ids])).rows;if(valid.length!==ids.length)fail('completion_members_required');}
 if(!old||changed){next.completion_required=enabled;next.completion_user_ids=ids;}
 return next;
}
export async function synchronizeTaskCompletion(c:Client,ctx:Context,row:Row,old?:Row){
 // Editing the actual assignment starts a new confirmation round; ordinary notes and visibility edits do not.
 const changed=!old||['completion_required','completion_user_ids','title','deliverable','due_date','project_id','parent_task_id'].some(key=>JSON.stringify(old[key])!==JSON.stringify(row[key]));
 if(!row.completion_required)return row;
 if(changed&&old&&['done','cancelled','review'].includes(str(old.status)))fail('completion_locked',409);
 if(old&&changed){const updated=(await c.query('UPDATE tasks SET completion_revision=completion_revision+1 WHERE workspace_id=$1 AND id=$2 RETURNING *',[ctx.workspaceId,row.id])).rows[0];Object.assign(row,updated);}
 for(const user of row.completion_user_ids as string[]){
  await assertRecordRecipient(c,ctx,'tasks',row.id,user,true);
  if(changed)await notify(c,ctx,user,'completion_requested','tasks',row);
 }
 return row;
}
export async function enrichTaskCompletion(c:Client,ctx:Context,rows:Row[]){
 if(!rows.length)return rows;
 const access=scope(ctx,'tasks','r',true);const editable=(await c.query(`SELECT r.id FROM tasks r WHERE ${access.sql} AND r.id=ANY($4::uuid[])`,[...access.values,rows.map(row=>row.id)])).rows;const editableIds=new Set(editable.map(row=>row.id));
 const confirmations=(await c.query('SELECT task_id,user_id,revision,confirmed_at,confirmation_note FROM task_completions WHERE workspace_id=$1 AND task_id=ANY($2::uuid[]) ORDER BY revision DESC,confirmed_at,user_id',[ctx.workspaceId,rows.map(row=>row.id)])).rows;
 // Include prior recipients so changing the confirmation group does not hide its history.
 const users=[...new Set([...rows.flatMap(row=>row.completion_user_ids as string[]||[]),...confirmations.map(item=>str(item.user_id))])];
 const members=users.length?(await c.query('SELECT u.id,u.name,m.status FROM "user" u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=$1 AND u.id=ANY($2::text[])',[ctx.workspaceId,users])).rows:[];
 const memberById=new Map(members.map(member=>[member.id,member]));
 const identity=(id:string)=>({id,name:memberById.get(id)?.name||id,active:memberById.get(id)?.status==='active'});
 for(const row of rows){
  const taskConfirmations=confirmations.filter(item=>item.task_id===row.id);
  row.can_complete_task=Boolean(!row.completion_required&&!row.archived&&['todo','in_progress','review'].includes(str(row.status))&&editableIds.has(row.id)&&operationAccess(ctx,'tasks','action:complete'));
  row.completion_people=(row.completion_user_ids as string[]||[]).map(id=>{
   const confirmation=taskConfirmations.find(item=>item.user_id===id&&item.revision===row.completion_revision);
   return {...identity(id),revision:row.completion_revision,confirmed_at:confirmation?.confirmed_at??null,confirmation_note:confirmation?.confirmation_note??null};
  });
  row.completion_history=taskConfirmations.filter(item=>item.revision<Number(row.completion_revision)||!row.completion_required).map(item=>({...identity(str(item.user_id)),revision:item.revision,confirmed_at:item.confirmed_at,confirmation_note:item.confirmation_note}));
  row.can_confirm_completion=Boolean(operationAccess(ctx,'tasks','action:confirm_completion')&&row.completion_required&&!row.archived&&['todo','in_progress','blocked'].includes(str(row.status))&&(row.completion_user_ids as string[]).includes(ctx.userId));
 }
 return rows;
}
export async function assertTaskConfirmed(c:Client,ctx:Context,row:Row){
 if(!row.completion_required)return;
 const count=(await c.query('SELECT count(*)::integer n FROM task_completions WHERE workspace_id=$1 AND task_id=$2 AND revision=$3 AND user_id=ANY($4::text[])',[ctx.workspaceId,row.id,row.completion_revision,row.completion_user_ids])).rows[0].n;
 if(count!==(row.completion_user_ids as string[]).length)fail('completion_pending',409);
}
export async function confirmTaskCompletion(c:Client,ctx:Context,row:Row,data:Row){
 if(!row.completion_required||!(row.completion_user_ids as string[]).includes(ctx.userId))fail('completion_recipient_required',403);
 if(!['todo','in_progress','blocked','done'].includes(str(row.status)))fail('invalid_transition',409);
 const note=parseConfirmationNote(data.confirmation_note);
 const prior=(await c.query('SELECT 1 FROM task_completions WHERE workspace_id=$1 AND task_id=$2 AND user_id=$3 AND revision=$4',[ctx.workspaceId,row.id,ctx.userId,row.completion_revision])).rowCount;
 if(prior)return row;
 await assertDependenciesComplete(c,ctx,row.id);
 await c.query('INSERT INTO task_completions(workspace_id,task_id,user_id,revision,confirmation_note) VALUES($1,$2,$3,$4,$5)',[ctx.workspaceId,row.id,ctx.userId,row.completion_revision,note]);
 const count=(await c.query('SELECT count(*)::integer n FROM task_completions WHERE workspace_id=$1 AND task_id=$2 AND revision=$3 AND user_id=ANY($4::text[])',[ctx.workspaceId,row.id,row.completion_revision,row.completion_user_ids])).rows[0].n;
 const all=count===(row.completion_user_ids as string[]).length;
 const updated=await patch(c,ctx,'tasks',row,{status:all?'done':row.status},'confirm_completion');
 // Completion identity is the authenticated actor, never a client-supplied user ID.
 if(all){await notifyDependents(c,ctx,updated);for(const user of new Set([row.created_by,row.owner_id,...row.completion_user_ids as string[]]))await notify(c,ctx,user,'task_completed','tasks',updated);}
 return updated;
}
