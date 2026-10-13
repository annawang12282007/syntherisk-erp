import {richString} from '../lib/rich-text-schema';
import {z} from 'zod';
import {query,transaction} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {isExternal} from '../domain/core';
import {assertAccess,get} from '../domain/service';
import {teamMembership} from '../lib/team-boards';
import {session,type Data} from './workspace-core';
import {getMail,mailAttachment} from './workspace-reads';
import {createHash} from 'node:crypto';
import {safeMailHtml} from '../lib/mail-content';
const access=`(i.owner_id=$3 OR EXISTS(SELECT 1 FROM external_item_audience a WHERE a.item_id=i.id AND (a.user_id=$3 OR EXISTS(SELECT 1 FROM company_team_members tm WHERE tm.team_id=a.team_id AND tm.workspace_id=$1 AND tm.user_id=$3))))`;
async function item(ctx:Context,id:string){
 if(isExternal(ctx))throw new DomainError(404,'NOT_FOUND');
 const [row]=await query(`SELECT i.* FROM shared_external_items i WHERE i.workspace_id=$1 AND i.company_id=$2 AND ${access} AND EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=$1 AND m.user_id=$3 AND m.status='active') AND i.id=$4`,[ctx.workspaceId,ctx.companyId,ctx.userId,z.uuid().parse(id)]);
 if(!row)throw new DomainError(404,'NOT_FOUND');return row;
}
export async function sharedList(ctx:Context,mode='received',provider?:string){
 if(isExternal(ctx))return [];
 return query(`SELECT i.id,i.provider,i.title,i.category,i.notes,i.version,i.owner_id,i.updated_at,u.name owner_name FROM shared_external_items i JOIN "user" u ON u.id=i.owner_id WHERE i.workspace_id=$1 AND i.company_id=$2 AND ${access} AND ${mode==='owned'?'i.owner_id=$3':'i.owner_id<>$3'} AND ($4::text IS NULL OR i.provider=$4 OR ($4='cloud' AND i.provider IN ('drive','docs','sheets'))) ORDER BY i.updated_at DESC LIMIT 200`,[ctx.workspaceId,ctx.companyId,ctx.userId,provider??null]);
}
export async function sharedDetail(ctx:Context,id:string){
 const row=await item(ctx,id),owner=row.owner_id===ctx.userId;
 const audience=await query('SELECT user_id,team_id,can_comment FROM external_item_audience WHERE item_id=$1',[id]);
 const canComment=owner||Boolean((await query(`SELECT 1 FROM external_item_audience a WHERE a.item_id=$1 AND can_comment AND (a.user_id=$2 OR EXISTS(SELECT 1 FROM company_team_members m WHERE m.team_id=a.team_id AND m.user_id=$2 AND m.workspace_id=$3)) LIMIT 1`,[id,ctx.userId,ctx.workspaceId])).length);
 const comments=await query('SELECT c.id,c.body,c.created_at,u.name author_name FROM external_item_comments c JOIN "user" u ON u.id=c.author_id WHERE c.item_id=$1 ORDER BY c.created_at LIMIT 500',[id]);
 const linked=await query('SELECT resource,record_id FROM external_item_records WHERE item_id=$1',[id]),records=[];
 for(const link of linked){try{const r=await get(ctx,String(link.resource),String(link.record_id));records.push({...link,title:r.title??r.name??link.record_id});}catch(error){if(!(error instanceof DomainError&&[403,404].includes(error.status)))throw error;}}
 const attachments=await query('SELECT id,filename,mime_type,byte_size FROM shared_mail_attachments WHERE item_id=$1 ORDER BY filename',[id]);
 const snapshot=row.snapshot as Data??{};if(snapshot.html)snapshot.html=safeMailHtml(String(snapshot.html));
 return {...row,snapshot,attachments,can_manage:owner,can_comment:canComment,comments,records,...(owner?{audience}:{})};
}
const audienceSchema=z.object({user_ids:z.array(z.string().min(1)).max(200).default([]),team_ids:z.array(z.uuid()).max(100).default([]),can_comment:z.boolean().default(true)});
export async function shareSelected(ctx:Context,input:unknown,preserveAudience=false){
 const d=audienceSchema.extend({item_ids:z.array(z.uuid()).min(1).max(50),category:z.string().trim().max(100).default(''),notes:richString(10000).default('')}).strict().parse(input);
 if(isExternal(ctx)||!preserveAudience&&!d.user_ids.length&&!d.team_ids.length)throw new DomainError(422,'RECIPIENT_REQUIRED');
 const users=[...new Set(d.user_ids)],teams=[...new Set(d.team_ids)];
 const prepared=new Map<string,{data:Data;files:{key:string;filename:string;mime:string;bytes:Buffer}[]}>();let total=0;
 // Fetch only the current user's explicitly selected messages. Recipients never use the owner's Google token.
 for(const sourceId of new Set(d.item_ids)){
  const [source]=await query('SELECT * FROM integration_items WHERE workspace_id=$1 AND user_id=$2 AND id=$3',[ctx.workspaceId,ctx.userId,sourceId]);
  if(!source)throw new DomainError(404,'NOT_FOUND');if(source.kind!=='gmail_message')continue;
  const live=await session(ctx,source.connection_id,'gmail'),data=await getMail(live,String(source.external_id)),files=[];
  for(const attachment of data.attachments){if(!attachment.attachment_id)continue;const key=String(attachment.attachment_id),file=await mailAttachment(live,String(data.id),key);total+=file.bytes.length;if(total>10_000_000)throw new DomainError(413,'FILE_TOO_LARGE');files.push({key,...file});}
  prepared.set(sourceId,{data,files});
 }

 return transaction(async c=>{
  const valid=await c.query("SELECT m.user_id FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.user_id=ANY($2::text[]) AND m.status='active' AND NOT(m.roles <@ ARRAY['external']::text[]) AND m.user_id IS DISTINCT FROM w.initial_admin_user_id FOR SHARE OF m",[ctx.workspaceId,users]);if(valid.rowCount!==users.length)throw new DomainError(422,'invalid_member');
  for(const id of teams){await c.query('SELECT id FROM company_teams WHERE id=$1 FOR SHARE',[id]);await teamMembership(ctx,id,c);}
  const results=[];
  for(const sourceId of [...new Set(d.item_ids)]){
   const [source]=(await c.query('SELECT i.*,c.provider FROM integration_items i JOIN integration_connections c ON c.id=i.connection_id WHERE i.workspace_id=$1 AND i.user_id=$2 AND i.id=$3 FOR SHARE OF i',[ctx.workspaceId,ctx.userId,sourceId])).rows;
   if(!source||!['gmail_message','drive_file','generated_doc','document','meet_link','meet_record','meet_conference'].includes(String(source.kind)))throw new DomainError(404,'NOT_FOUND');
   const data=prepared.get(sourceId)?.data??source.data as Data;const title=String(data.subject??data.name??data.title??source.external_id);
   // Explicitly selected content is copied into an ERP snapshot. No token, folder inheritance or whole-mailbox grant is shared.
   const [saved]=(await c.query('INSERT INTO shared_external_items(workspace_id,company_id,owner_id,source_item_id,provider,title,snapshot,category,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(workspace_id,owner_id,source_item_id) DO UPDATE SET title=$6,snapshot=$7,category=$8,notes=$9,version=shared_external_items.version+1,updated_at=now() RETURNING *',[ctx.workspaceId,ctx.companyId,ctx.userId,sourceId,source.provider,title,JSON.stringify(data),d.category,d.notes])).rows;
   if(source.kind==='gmail_message'){
    await c.query('DELETE FROM shared_mail_attachments WHERE item_id=$1',[saved.id]);
    for(const file of prepared.get(sourceId)?.files??[])await c.query('INSERT INTO shared_mail_attachments(item_id,source_key,filename,mime_type,content,sha256,byte_size) VALUES($1,$2,$3,$4,$5,$6,$7)',[saved.id,file.key,file.filename,file.mime,file.bytes,createHash('sha256').update(file.bytes).digest('hex'),file.bytes.length]);
   }
   // Re-sharing adds chosen recipients; removing access is a separate reviewed operation.
   for(const id of preserveAudience?[]:users)await c.query('INSERT INTO external_item_audience(item_id,user_id,can_comment) VALUES($1,$2,$3) ON CONFLICT(item_id,user_id) WHERE user_id IS NOT NULL DO UPDATE SET can_comment=$3',[saved.id,id,d.can_comment]);
   for(const id of preserveAudience?[]:teams)await c.query('INSERT INTO external_item_audience(item_id,team_id,can_comment) VALUES($1,$2,$3) ON CONFLICT(item_id,team_id) WHERE team_id IS NOT NULL DO UPDATE SET can_comment=$3',[saved.id,id,d.can_comment]);
   await c.query('INSERT INTO external_item_versions(item_id,version,actor_id,snapshot) VALUES($1,$2,$3,$4)',[saved.id,saved.version,ctx.userId,JSON.stringify({title,notes:d.notes,category:d.category,snapshot:data})]);results.push({id:saved.id,title,version:saved.version});
  }return results;
 });
}
export async function sharedAttachment(ctx:Context,id:string,attachmentId:unknown){
 await item(ctx,id);
 const [file]=await query('SELECT filename,mime_type,content FROM shared_mail_attachments WHERE item_id=$1 AND id=$2',[id,z.uuid().parse(attachmentId)]);
 if(!file)throw new DomainError(404,'NOT_FOUND');return {filename:String(file.filename),mime:String(file.mime_type),bytes:file.content as Buffer};
}
export async function sharedAction(ctx:Context,input:Data){
 const action=String(input.action),id=z.uuid().parse(input.id);const row=await item(ctx,id);
 if(action==='attachment'){
  const file=await sharedAttachment(ctx,id,input.attachment_id);return {filename:file.filename,mime:file.mime,content_base64:file.bytes.toString('base64')};
 }
 if(action==='remove'){
  if(row.owner_id!==ctx.userId)throw new DomainError(403,'FORBIDDEN');
  const version=z.number().int().positive().parse(input.version);
  return transaction(async c=>{
   const [current]=(await c.query('SELECT id,version,owner_id FROM shared_external_items WHERE id=$1 AND workspace_id=$2 AND company_id=$3 FOR UPDATE',[id,ctx.workspaceId,ctx.companyId])).rows;
   if(!current)throw new DomainError(404,'NOT_FOUND');
   if(current.owner_id!==ctx.userId)throw new DomainError(403,'FORBIDDEN');
   if(current.version!==version)throw new DomainError(409,'VERSION_CONFLICT');
   await c.query('DELETE FROM external_item_records WHERE item_id=$1',[id]);
   await c.query('DELETE FROM external_item_comments WHERE item_id=$1',[id]);
   await c.query('DELETE FROM external_item_versions WHERE item_id=$1',[id]);
   await c.query('DELETE FROM shared_external_items WHERE id=$1',[id]);
   await c.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,'shared_external_items',$3,'remove',$4)",[ctx.workspaceId,ctx.userId,id,JSON.stringify({shared_snapshot_removed:true,source_retained:true})]);
   return {removed:true};
  });
 }
 if(action==='refresh_mail'){
  if(row.owner_id!==ctx.userId||row.provider!=='gmail')throw new DomainError(403,'FORBIDDEN');
  const audience=await query('SELECT user_id,team_id,can_comment FROM external_item_audience WHERE item_id=$1',[id]);
  return shareSelected(ctx,{item_ids:[row.source_item_id],user_ids:audience.map(a=>a.user_id).filter(Boolean),team_ids:audience.map(a=>a.team_id).filter(Boolean),can_comment:audience.some(a=>a.can_comment),category:row.category,notes:row.notes},true);
 }
 if(action==='history')return query('SELECT version,created_at,snapshot FROM external_item_versions WHERE item_id=$1 ORDER BY version DESC',[id]);
 if(action==='comment'){
  const value=richString(10000,1).parse(input.body);return transaction(async c=>{await c.query('SELECT id FROM shared_external_items WHERE id=$1 FOR UPDATE',[id]);const current=await sharedDetail(ctx,id);if(!current.can_comment)throw new DomainError(403,'FORBIDDEN');await c.query('INSERT INTO external_item_comments(item_id,author_id,body) VALUES($1,$2,$3)',[id,ctx.userId,value]);return {saved:true};});
 }
 if(action==='link'){
  const resource=z.string().min(1).parse(input.resource),recordId=z.uuid().parse(input.record_id);await assertAccess(ctx,resource,recordId,'write');
  await query('INSERT INTO external_item_records(item_id,resource,record_id,created_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,resource,recordId,ctx.userId]);return {linked:true};
 }
 if(action==='access'){
  if(row.owner_id!==ctx.userId)throw new DomainError(403,'FORBIDDEN');
  const d=audienceSchema.extend({version:z.number().int().positive()}).parse(input);
  await transaction(async c=>{for(const team of d.team_ids){await c.query('SELECT id FROM company_teams WHERE id=$1 FOR SHARE',[team]);await teamMembership(ctx,team,c);}const valid=await c.query("SELECT m.user_id FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.user_id=ANY($2::text[]) AND m.status='active' AND NOT(m.roles <@ ARRAY['external']::text[]) AND m.user_id IS DISTINCT FROM w.initial_admin_user_id FOR SHARE OF m",[ctx.workspaceId,d.user_ids]);if(valid.rowCount!==new Set(d.user_ids).size)throw new DomainError(422,'invalid_member');const updated=await c.query('UPDATE shared_external_items SET version=version+1,updated_at=now() WHERE id=$1 AND version=$2 RETURNING version',[id,d.version]);if(!updated.rowCount)throw new DomainError(409,'VERSION_CONFLICT');await c.query('DELETE FROM external_item_audience WHERE item_id=$1',[id]);for(const user of new Set(d.user_ids))await c.query('INSERT INTO external_item_audience(item_id,user_id,can_comment) VALUES($1,$2,$3)',[id,user,d.can_comment]);for(const team of new Set(d.team_ids))await c.query('INSERT INTO external_item_audience(item_id,team_id,can_comment) VALUES($1,$2,$3)',[id,team,d.can_comment]);await c.query('INSERT INTO external_item_versions(item_id,version,actor_id,snapshot) VALUES($1,$2,$3,$4)',[id,updated.rows[0].version,ctx.userId,JSON.stringify({action:'access_changed',users:d.user_ids,teams:d.team_ids,can_comment:d.can_comment})]);});return {saved:true};
 }
 throw new DomainError(422,'INVALID_ACTION');
}
