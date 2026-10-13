import {richString} from '../lib/rich-text-schema';
import {z} from 'zod';
import {query,transaction} from '../lib/db';
import {type Context,DomainError} from '../lib/context';
import {elevated,permissionScope,type Row} from './core';
import {parseConfirmationNote} from './task-completion';

function allowed(ctx:Context,operation:string,row?:Row){
 const policy=permissionScope(ctx,'announcements',operation);
 if(policy===undefined)return operation==='read'||elevated(ctx);
 if(policy==='none')return false;
 return !row||policy==='all'||policy.split(',').some(scope=>['created','own'].includes(scope))&&row.created_by===ctx.userId;
}
export function canPublishAnnouncements(ctx:Context){return allowed(ctx,'publish');}
function canManage(ctx:Context,row:Row){return allowed(ctx,'read',row)&&(row.created_by===ctx.userId||ctx.roles.includes('admin')||permissionScope(ctx,'announcements','edit')==='all'||permissionScope(ctx,'announcements','publish')==='all');}
export async function announcementList(ctx:Context,archived=false){
 const create=allowed(ctx,'create'),publish=canPublishAnnouncements(ctx);
 const rows=await query(`SELECT a.*,u.name AS publisher_name,r.viewed_at,r.acknowledged_at,r.confirmation_note,EXISTS(SELECT 1 FROM announcement_recipients mine WHERE mine.announcement_id=a.id AND mine.user_id=$3) AS addressed_to_me FROM announcements a JOIN "user" u ON u.id=a.created_by LEFT JOIN announcement_recipients r ON r.announcement_id=a.id AND r.user_id=$3 WHERE a.workspace_id=$1 AND a.company_id=$2 AND a.archived=$5 AND ((a.created_by=$3 OR $4) OR (NOT a.archived AND a.status='published' AND r.user_id=$3 AND (a.expires_at IS NULL OR a.expires_at>now()))) ORDER BY a.created_at DESC LIMIT 200`,[ctx.workspaceId,ctx.companyId,ctx.userId,ctx.roles.includes('admin')||permissionScope(ctx,'announcements','edit')==='all'||permissionScope(ctx,'announcements','publish')==='all',archived]);
 const visible=rows.filter(row=>allowed(ctx,'read',row)||row.addressed_to_me&&permissionScope(ctx,'announcements','read')!=='none');
 for(const row of visible){row.can_manage=canManage(ctx,row);row.can_edit=row.can_manage&&allowed(ctx,'edit',row);row.can_publish=row.can_manage&&allowed(ctx,'publish',row);row.can_archive=row.can_manage&&allowed(ctx,'publish',row);if(row.can_manage)row.recipients=await query('SELECT r.user_id,u.name,r.viewed_at,r.acknowledged_at,r.confirmation_note FROM announcement_recipients r JOIN "user" u ON u.id=r.user_id WHERE r.announcement_id=$1 ORDER BY u.name',[row.id]);}
 return {rows:visible,can_create:create,can_publish:publish,can_manage:create||publish||visible.some(row=>row.can_manage)};
}
const fields=z.object({title:z.string().trim().min(1).max(200),body:richString(20000,1),category:z.string().trim().min(1).max(80),priority:z.enum(['normal','important','urgent']),require_ack:z.boolean(),expires_at:z.iso.datetime({offset:true}).nullable().default(null),recipient_ids:z.array(z.string().min(1)).min(1).max(200)});
export async function announcementAction(ctx:Context,input:Row){
 const action=z.enum(['save','publish','withdraw','archive','restore','view','acknowledge']).parse(input.action);
 const id=input.id===undefined?undefined:z.uuid().parse(input.id);
 return transaction(async client=>{
  let receipt:Row|undefined;
  let row=id?(await client.query('SELECT * FROM announcements WHERE workspace_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE',[ctx.workspaceId,ctx.companyId,id])).rows[0] as Row|undefined:undefined;
  if(id&&!row)throw new DomainError(404,'NOT_FOUND');
  if(action==='view'||action==='acknowledge'){
   if(permissionScope(ctx,'announcements','read')==='none')throw new DomainError(403,'FORBIDDEN');
   if(!row||row.archived||row.status!=='published'||row.expires_at&&new Date(String(row.expires_at))<=new Date())throw new DomainError(404,'NOT_FOUND');
   const note=action==='acknowledge'?parseConfirmationNote(input.confirmation_note):null;
   const result=action==='acknowledge'
    ?await client.query('UPDATE announcement_recipients SET viewed_at=COALESCE(viewed_at,now()),confirmation_note=CASE WHEN acknowledged_at IS NULL THEN $3 ELSE confirmation_note END,acknowledged_at=COALESCE(acknowledged_at,now()) WHERE announcement_id=$1 AND user_id=$2 RETURNING user_id,viewed_at,acknowledged_at,confirmation_note',[id,ctx.userId,note])
    :await client.query('UPDATE announcement_recipients SET viewed_at=COALESCE(viewed_at,now()) WHERE announcement_id=$1 AND user_id=$2 RETURNING user_id',[id,ctx.userId]);
   if(!result.rowCount)throw new DomainError(403,'FORBIDDEN');
   if(action==='acknowledge')receipt=result.rows[0];
  }else{
   if(!allowed(ctx,action==='save'?(row?'edit':'create'):'publish',row)||row&&!canManage(ctx,row))throw new DomainError(403,'FORBIDDEN');
   if(row&&row.version!==input.version)throw new DomainError(409,'VERSION_CONFLICT');
   if(row?.archived&&!['restore'].includes(action))throw new DomainError(409,'INVALID_TRANSITION');
   if(action==='archive'||action==='restore'){
    if(!row||Boolean(row.archived)===(action==='archive'))throw new DomainError(409,'INVALID_TRANSITION');
    row=(await client.query('UPDATE announcements SET archived=$2,archived_at=CASE WHEN $2 THEN now() ELSE NULL END,updated_by=$3,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *',[id,action==='archive',ctx.userId])).rows[0];
   }else if(action==='save'){
    if(row&&row.status!=='draft')throw new DomainError(409,'NOTICE_PUBLISHED_IMMUTABLE');
    const v=fields.parse(input),recipients=[...new Set(v.recipient_ids)];
    if(v.expires_at&&new Date(v.expires_at)<=new Date())throw new DomainError(400,'NOTICE_EXPIRY_PAST');
    const members=await client.query("SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::text[]) AND status='active' AND NOT(roles <@ ARRAY['external']::text[]) FOR SHARE",[ctx.workspaceId,recipients]);
    if(members.rows.length!==recipients.length)throw new DomainError(400,'INVALID_MEMBER');
    if(row)row=(await client.query('UPDATE announcements SET title=$2,body=$3,category=$4,priority=$5,require_ack=$6,expires_at=$7,updated_by=$8,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *',[id,v.title,v.body,v.category,v.priority,v.require_ack,v.expires_at,ctx.userId])).rows[0];
    else row=(await client.query('INSERT INTO announcements(workspace_id,company_id,created_by,updated_by,title,body,category,priority,require_ack,expires_at) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[ctx.workspaceId,ctx.companyId,ctx.userId,v.title,v.body,v.category,v.priority,v.require_ack,v.expires_at])).rows[0];
    await client.query('DELETE FROM announcement_recipients WHERE announcement_id=$1',[row!.id]);await client.query('INSERT INTO announcement_recipients(announcement_id,user_id) SELECT $1,unnest($2::text[])',[row!.id,recipients]);
   }else if(action==='publish'){
    if(!row||row.status!=='draft')throw new DomainError(409,'INVALID_TRANSITION');
    if(row.expires_at&&new Date(String(row.expires_at))<=new Date())throw new DomainError(400,'NOTICE_EXPIRY_PAST');
    const valid=await client.query("SELECT 1 FROM announcement_recipients r JOIN memberships m ON m.user_id=r.user_id AND m.workspace_id=$2 WHERE r.announcement_id=$1 AND m.status='active' AND NOT(m.roles <@ ARRAY['external']::text[]) FOR SHARE OF m",[id,ctx.workspaceId]);
    const total=(await client.query('SELECT count(*)::int n FROM announcement_recipients WHERE announcement_id=$1',[id])).rows[0].n;
    if(!total||valid.rowCount!==total)throw new DomainError(409,'INVALID_MEMBER');
    row=(await client.query("UPDATE announcements SET status='published',published_at=now(),version=version+1,updated_by=$2,updated_at=now() WHERE id=$1 RETURNING *",[id,ctx.userId])).rows[0];
    await client.query("INSERT INTO notifications(workspace_id,user_id,kind,title_key,resource,record_id,dedupe_key) SELECT $2,user_id,'announcement','notification.announcement','announcements',announcement_id,'announcement:'||announcement_id::text||':'||user_id FROM announcement_recipients WHERE announcement_id=$1 ON CONFLICT(workspace_id,user_id,dedupe_key) DO NOTHING",[id,ctx.workspaceId]);
   }else{
    if(!row||row.status!=='published')throw new DomainError(409,'INVALID_TRANSITION');
    const reason=richString(2000,1).parse(input.reason);
    row=(await client.query("UPDATE announcements SET status='withdrawn',withdrawal_reason=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1 RETURNING *",[id,reason,ctx.userId])).rows[0];
   }
  }
  await client.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,'announcements',$3,$4,$5)",[ctx.workspaceId,ctx.userId,row!.id,action,JSON.stringify({version:row!.version,status:row!.status,archived:row!.archived})]);
  return {id:row!.id,version:row!.version,status:row!.status,...(receipt?{viewed_at:receipt.viewed_at,acknowledged_at:receipt.acknowledged_at,confirmation_note:receipt.confirmation_note}:{})};
 });
}
