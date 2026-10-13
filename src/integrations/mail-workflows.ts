import {readAudienceGroup} from '../lib/audience-groups';
import {query,transaction} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {get,assertAccess} from '../domain/service';
import {connection} from './service';
import {uuid,strings,text,type Data} from './workspace-core';

/** Local selected mail and links remain personal even after Google disconnects. */
export async function localMailAction(ctx:Context,action:string,data:Data){
 const conn=await connection(ctx,uuid(data.connection_id));
 if(conn.provider!=='gmail')throw new DomainError(422,'INVALID_PROVIDER');
 if(action==='gmail_sent_saved'){
  const offset=Math.max(0,Math.min(100000,Number(data.offset)||0));
  const rows=await query("SELECT id item_id,external_id,data,updated_at FROM integration_items WHERE connection_id=$1 AND workspace_id=$2 AND user_id=$3 AND kind='gmail_message' AND data->'labels' ? 'SENT' ORDER BY COALESCE(data->>'internal_date','0')::bigint DESC,updated_at DESC LIMIT 26 OFFSET $4",[conn.id,ctx.workspaceId,ctx.userId,offset]);
  const organization=await query('SELECT external_id,category,notes,pinned,version FROM personal_mail_organization WHERE connection_id=$1 AND user_id=$2 AND external_id=ANY($3::text[])',[conn.id,ctx.userId,rows.map(r=>r.external_id)]);
  return {messages:rows.slice(0,25).map(r=>({...r.data as Data,id:r.external_id,item_id:r.item_id,saved_at:r.updated_at,organization:organization.find(o=>o.external_id===r.external_id)??{category:'',notes:'',pinned:false,version:0}})),next_offset:rows.length>25?offset+25:null,last_synced_at:(conn.settings as Data)?.sent_last_success_at??null};
 }
 const ids=strings(data.item_ids??[data.item_id],25).map(uuid);
 if(!ids.length)throw new DomainError(422,'INVALID_FIELD');
 const rows=await query("SELECT id FROM integration_items WHERE id=ANY($1::uuid[]) AND connection_id=$2 AND workspace_id=$3 AND user_id=$4 AND kind='gmail_message'",[ids,conn.id,ctx.workspaceId,ctx.userId]);
 if(rows.length!==ids.length)throw new DomainError(404,'NOT_FOUND');
 if(action==='gmail_item_links'){
  const links=await query('SELECT DISTINCT resource,record_id FROM integration_item_links WHERE item_id=ANY($1::uuid[]) AND workspace_id=$2',[ids,ctx.workspaceId]);
  const visible=[];for(const link of links){try{const record=await get(ctx,String(link.resource),String(link.record_id));visible.push({...link,title:record.title??record.name??record.subject??record.id});}catch(error){if(!(error instanceof DomainError&&[403,404].includes(error.status)))throw error;}}
  return {links:visible};
 }
 if(!['gmail_link_items','gmail_unlink_items'].includes(action))throw new DomainError(404,'ACTION_NOT_FOUND');
 const resource=text(data.resource),recordId=uuid(data.record_id);await assertAccess(ctx,resource,recordId,'write');
 return transaction(async c=>{
  // Lock owned items and recheck the entire selection before any mutation.
  const owned=(await c.query("SELECT id FROM integration_items WHERE id=ANY($1::uuid[]) AND connection_id=$2 AND workspace_id=$3 AND user_id=$4 FOR UPDATE",[ids,conn.id,ctx.workspaceId,ctx.userId])).rows;
  if(owned.length!==ids.length)throw new DomainError(404,'NOT_FOUND');
  for(const item of owned){
   if(action==='gmail_unlink_items'){await c.query('DELETE FROM integration_item_links WHERE item_id=$1 AND resource=$2 AND record_id=$3',[item.id,resource,recordId]);await c.query('UPDATE integration_items SET resource=NULL,record_id=NULL WHERE id=$1 AND resource=$2 AND record_id=$3',[item.id,resource,recordId]);}
   else await c.query("INSERT INTO integration_item_links(item_id,workspace_id,resource,record_id,origin) VALUES($1,$2,$3,$4,'link') ON CONFLICT DO NOTHING",[item.id,ctx.workspaceId,resource,recordId]);
  }
  return {linked:action==='gmail_link_items',count:owned.length};
 });
}
export async function groupRecipients(ctx:Context,groupId:unknown){
 const result=await readAudienceGroup(ctx,uuid(groupId));
 const recipients=result.members.filter(m=>m.status==='ready').map(m=>({id:m.contact_id,name:m.name,email:m.email}));
 return {group:{id:result.group.id,name:result.group.name},recipients,excluded:result.total-recipients.length,total:result.total,
  reasons:result.members.filter(m=>m.status!=='ready').map(m=>({name:m.name,reason:m.status})),inaccessible:result.inaccessible};
}
