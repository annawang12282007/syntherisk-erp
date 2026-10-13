import {richString} from '../lib/rich-text-schema';
import {z} from 'zod';
import {transaction,pool} from '../lib/db';
import {type Context,DomainError} from '../lib/context';
import {resources} from './registry';
import {scope,find,def,assertOperation,operationAccess,audit,patch,checkVersion,parentKeys,type Client,type Row} from './core';
export const retentionTiers=['owner','authorized','approval','archive_only','locked'] as const;
export type RetentionTier=typeof retentionTiers[number];
const zero='00000000-0000-0000-0000-000000000000';
const error=(code:string,status=409):never=>{throw new DomainError(status,code);};
function supported(resource:string){const r=def(resource);if(r.parent||r.hidden||r.module==='settings')error('RETENTION_UNSUPPORTED',422);return r;}
export async function lockRetention(c:Client,ctx:Context,resource:string){await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[ctx.workspaceId+':retention:'+resource]);}
export async function retentionInfo(c:Client,ctx:Context,resource:string,row?:Row){
 const r=def(resource),policies=(await c.query('SELECT record_id,tier,version FROM retention_policies WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=ANY($4::uuid[])',[ctx.workspaceId,ctx.companyId,resource,[zero,...(row?[row.id]:[])]])).rows;
 const base=policies.find(p=>p.record_id===zero),specific=row&&policies.find(p=>p.record_id===row.id);
 const configured=(specific?.tier??base?.tier??'authorized') as RetentionTier;
 let floor:RetentionTier|undefined;
 if(r.readonly||(r.module==='finance'&&!r.parent&&!parentKeys[resource])||r.module==='settings')floor='locked';
 if(row&&!floor&&(await c.query("SELECT 1 FROM electronic_signatures WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4 UNION ALL SELECT 1 FROM signature_request_batches b JOIN signature_requests q ON q.batch_id=b.id WHERE b.workspace_id=$1 AND b.company_id=$2 AND b.resource=$3 AND b.record_id=$4 AND q.status IN ('signed','external_recorded') LIMIT 1",[ctx.workspaceId,ctx.companyId,resource,row.id])).rowCount)floor='archive_only';
 const tier=floor==='locked'?'locked':floor==='archive_only'&&configured!=='locked'?'archive_only':configured;
 return {tier,configured,floor:floor??null,policy_version:specific?.version??0,default_version:base?.version??0,stamp:[base?.version??0,specific?.version??0,tier].join(':')};
}
export async function assertRetentionArchive(c:Client,ctx:Context,resource:string,row:Row){
 if(def(resource).module==='settings')return;
 await lockRetention(c,ctx,resource);
 if((await retentionInfo(c,ctx,resource,row)).tier==='locked')error('RETENTION_LOCKED',403);
}
async function archivedRecord(c:Client,ctx:Context,resource:string,id:string,deleted=false,write=false){
 supported(resource);const s=scope(ctx,resource,'r',write,true,undefined,false,deleted);
 const row=(await c.query('SELECT r.* FROM '+resource+' r WHERE '+s.sql+' AND r.id=$4 FOR UPDATE OF r',[...s.values,id])).rows[0];
 if(!row)error('record_not_found',404);return row;
}
async function mayDelete(c:Client,ctx:Context,resource:string,row:Row,tier:RetentionTier){
 if(['archive_only','locked'].includes(tier))error('RETENTION_DELETE_PROTECTED',403);
 if(tier==='owner'){if(row.created_by!==ctx.userId)error('RETENTION_CREATOR_REQUIRED',403);}
 else await assertOperation(c,ctx,resource,'delete',row);
}
async function references(c:Client,ctx:Context,resource:string,id:unknown){
 for(const r of Object.values(resources))for(const f of r.fields.filter(f=>f.ref===resource)){
  const ownedParent=parentKeys[r.key]??(r.parent?[r.parent,r.fields.find(field=>field.ref===r.parent)?.key]:undefined);
  if(ownedParent?.[0]===resource&&ownedParent[1]===f.key)continue; // Owned child rows follow the parent's recycle state through scope().
  if((await c.query('SELECT 1 FROM '+r.key+' x WHERE x.workspace_id=$1 AND x.company_id=$2 AND x.'+f.key+'=$3 AND NOT (x.id=$3 AND $5=$4) AND NOT EXISTS(SELECT 1 FROM record_disposals d WHERE d.workspace_id=x.workspace_id AND d.company_id=x.company_id AND d.resource=$5 AND d.record_id=x.id) LIMIT 1',[ctx.workspaceId,ctx.companyId,id,resource,r.key])).rowCount)error('RETENTION_REFERENCED');
 }
 if((await c.query("SELECT 1 FROM signature_request_batches b JOIN signature_requests q ON q.batch_id=b.id WHERE b.workspace_id=$1 AND b.company_id=$2 AND b.resource=$3 AND b.record_id=$4 AND q.status='pending' LIMIT 1",[ctx.workspaceId,ctx.companyId,resource,id])).rowCount)error('RETENTION_PENDING_SIGNATURE');
}
export async function retentionDependencies(ctx:Context,resource:string,id:string){
 supported(resource);z.uuid().parse(id);
 return transaction(async c=>{
  await c.query('SET LOCAL jit=off');await find(c,ctx,resource,id);
  const records:{resource:string;id:string;title:string;field:string;archived:boolean;protected:boolean;url:string}[]=[];let restricted=false,more=false;
  for(const r of Object.values(resources))for(const f of r.fields.filter(f=>f.ref===resource)){
   const parent=parentKeys[r.key]??(r.parent?[r.parent,r.fields.find(field=>field.ref===r.parent)?.key]:undefined);
   if(parent?.[0]===resource&&parent[1]===f.key)continue;
   const candidates=(await c.query('SELECT x.id FROM '+r.key+' x WHERE x.workspace_id=$1 AND x.company_id=$2 AND x.'+f.key+'=$3 AND NOT (x.id=$3 AND $5=$4) AND NOT EXISTS(SELECT 1 FROM record_disposals d WHERE d.workspace_id=x.workspace_id AND d.company_id=x.company_id AND d.resource=$5 AND d.record_id=x.id) LIMIT 51',[ctx.workspaceId,ctx.companyId,id,resource,r.key])).rows;
   if(!candidates.length)continue;more ||= candidates.length>50;
   const s=scope(ctx,r.key,'x'),visible=(await c.query('SELECT x.* FROM '+r.key+' x WHERE '+s.sql+' AND x.id=ANY($4::uuid[])',[...s.values,candidates.slice(0,50).map(row=>row.id)])).rows;
   restricted ||= visible.length<candidates.slice(0,50).length;
   for(const row of visible)records.push({resource:r.key,id:row.id,title:String(row[r.titleField]||r.label[1]),field:f.key,archived:Boolean(row.archived),protected:Boolean(r.readonly),url:'/data/'+(parent?.[0]??r.key)+'?record='+encodeURIComponent(String(parent?.[1]?row[parent[1]]:row.id))});
  }
  const pending=Boolean((await c.query("SELECT 1 FROM signature_request_batches b JOIN signature_requests q ON q.batch_id=b.id WHERE b.workspace_id=$1 AND b.company_id=$2 AND b.resource=$3 AND b.record_id=$4 AND q.status='pending' LIMIT 1",[ctx.workspaceId,ctx.companyId,resource,id])).rowCount);
  return {records,restricted,more,pending_signatures:pending,blocked:records.length>0||restricted||more||pending};
 });
}
async function dispose(c:Client,ctx:Context,resource:string,row:Row,reason:string){
 if(!row.archived)error('RETENTION_ARCHIVE_FIRST');await references(c,ctx,resource,row.id);
 await c.query('INSERT INTO record_disposals(workspace_id,company_id,resource,record_id,deleted_by,reason) VALUES($1,$2,$3,$4,$5,$6)',[ctx.workspaceId,ctx.companyId,resource,row.id,ctx.userId,reason]);
 await patch(c,ctx,resource,row,{},'delete_to_recycle');return {deleted:true};
}
function closed(resource:string,row:Row){
 const terminal:Record<string,string[]>={tasks:['done','cancelled'],projects:['completed','cancelled'],events:['cancelled'],handoffs:['accepted','rejected','withdrawn'],work_requests:['completed','declined','withdrawn'],delegations:['confirmed','cancelled','revoked','completed'],reviews:['approved','returned']};
 if(terminal[resource]&&!terminal[resource].includes(String(row.status)))error('RETENTION_CLOSE_FIRST');
}
async function currentContext(c:Client,ctx:Context,userId:string):Promise<Context>{
 const member=(await c.query("SELECT roles FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'",[ctx.workspaceId,userId])).rows[0];if(!member)error('RETENTION_REVIEWER_UNAVAILABLE',403);
 const permissions=member.roles.includes('admin')?[]:(await c.query('SELECT resource,operation,scope FROM effective_permissions($1,$3,$2::text[])',[ctx.workspaceId,member.roles,userId])).rows;
 return {...ctx,userId,roles:member.roles,permissions};
}
async function canReview(c:Client,ctx:Context,resource:string,row:Row){await find(c,ctx,resource,row.id);await assertOperation(c,ctx,resource,'delete_review',row);}
export async function retentionAction(ctx:Context,input:unknown){
 const d=z.object({action:z.enum(['archive','restore','delete','recover','request','approve','reject','cancel','policy']),resource:z.string().optional(),id:z.uuid().optional(),version:z.number().int().nonnegative(),tier:z.enum(retentionTiers).optional(),reason:richString(2000).optional(),reviewer_id:z.string().min(1).optional(),request_id:z.uuid().optional()}).strict().parse(input);
 return transaction(async c=>{
  const actor=await currentContext(c,ctx,ctx.userId);
  if(['approve','reject','cancel'].includes(d.action)){
   const req=(await c.query('SELECT * FROM record_deletion_requests WHERE id=$1 AND workspace_id=$2 AND company_id=$3',[d.request_id,ctx.workspaceId,ctx.companyId])).rows[0];if(!req)error('NOT_FOUND',404);
   await lockRetention(c,ctx,req.resource);
   const locked=(await c.query('SELECT * FROM record_deletion_requests WHERE id=$1 FOR UPDATE',[req.id])).rows[0];
   if(locked.status!=='pending'||locked.version!==d.version)error('VERSION_CONFLICT');
   const row=await archivedRecord(c,actor,req.resource,req.record_id);
   if(d.action==='cancel'){if(req.requested_by!==ctx.userId)error('forbidden',403);}
   else {if(req.reviewer_id!==ctx.userId||req.requested_by===ctx.userId)error('RETENTION_REVIEWER_REQUIRED',403);await canReview(c,actor,req.resource,row);}
   if(!d.reason)error('reason_required',422);
   if(d.action==='approve'){
    const info=await retentionInfo(c,actor,req.resource,row);
    if(info.tier!=='approval'||info.stamp!==req.policy_stamp||row.version!==req.record_version)error('RETENTION_REVIEW_CHANGED');
    const requester=await currentContext(c,ctx,req.requested_by);await find(c,requester,req.resource,row.id,true);await mayDelete(c,requester,req.resource,row,info.tier);
    await dispose(c,actor,req.resource,row,req.reason);
   }
   const status=d.action==='approve'?'approved':d.action==='reject'?'rejected':'cancelled';
   await c.query('UPDATE record_deletion_requests SET status=$2,review_reason=$3,resolved_at=now(),version=version+1 WHERE id=$1',[req.id,status,d.reason]);
   await audit(c,actor,req.resource,req.record_id,'deletion_'+status,null,{request_id:req.id,reason:d.reason});return {status};
  }
  const resource=z.string().parse(d.resource);supported(resource);await lockRetention(c,ctx,resource);
  if(d.action==='policy'){
   if(!actor.roles.includes('admin'))error('forbidden',403);if(!d.tier)error('VALIDATION_ERROR',400);
   const id=d.id??zero;if(d.id)await archivedRecord(c,actor,resource,d.id,true);
   const row=(await c.query('SELECT * FROM retention_policies WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4 FOR UPDATE',[ctx.workspaceId,ctx.companyId,resource,id])).rows[0];
   if((row?.version??0)!==d.version)error('VERSION_CONFLICT');
   await c.query('INSERT INTO retention_policies(workspace_id,company_id,resource,record_id,tier,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,company_id,resource,record_id) DO UPDATE SET tier=$5,updated_by=$6,version=retention_policies.version+1,updated_at=now()',[ctx.workspaceId,ctx.companyId,resource,id,d.tier,ctx.userId]);
   await audit(c,actor,resource,id,'retention_policy',row??null,{tier:d.tier});return {saved:true};
  }
  const id=z.uuid().parse(d.id),row=await archivedRecord(c,actor,resource,id,d.action==='recover',true);checkVersion(row,d);
  const info=await retentionInfo(c,actor,resource,row);
  if(d.action==='archive'||d.action==='restore'){
   await assertOperation(c,actor,resource,'action:'+d.action,row);
   if(info.tier==='locked')error('RETENTION_LOCKED',403);
   if(d.action==='archive')closed(resource,row);
   if(Boolean(row.archived)===(d.action==='archive'))error('VERSION_CONFLICT');
   await patch(c,actor,resource,row,{archived:d.action==='archive'},d.action);
   await c.query("UPDATE record_deletion_requests SET status='cancelled',review_reason='record_restored',resolved_at=now(),version=version+1 WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4 AND status='pending'",[ctx.workspaceId,ctx.companyId,resource,id]);return {saved:true};
  }
  if(d.action==='recover'){
   await mayDelete(c,actor,resource,row,info.tier);
   const deleted=await c.query('DELETE FROM record_disposals WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4 RETURNING *',[ctx.workspaceId,ctx.companyId,resource,id]);if(!deleted.rowCount)error('NOT_FOUND',404);
   await patch(c,actor,resource,row,{},'recover_to_archive');return {restored:true};
  }
  if(!row.archived)error('RETENTION_ARCHIVE_FIRST');await mayDelete(c,actor,resource,row,info.tier);if(!d.reason)error('reason_required',422);
  if(d.action==='delete'){if(info.tier==='approval')error('RETENTION_APPROVAL_REQUIRED',403);return dispose(c,actor,resource,row,d.reason!);}
  if(info.tier!=='approval')error('RETENTION_REVIEW_CHANGED');
  if(!d.reviewer_id||d.reviewer_id===ctx.userId)error('RETENTION_REVIEWER_REQUIRED',403);
  const reviewer=await currentContext(c,ctx,d.reviewer_id!);await canReview(c,reviewer,resource,row);await references(c,actor,resource,id);
  const request=(await c.query('INSERT INTO record_deletion_requests(workspace_id,company_id,resource,record_id,record_version,requested_by,reviewer_id,reason,policy_stamp) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[ctx.workspaceId,ctx.companyId,resource,id,row.version,ctx.userId,d.reviewer_id,d.reason,info.stamp])).rows[0];
  await audit(c,actor,resource,id,'request_deletion',null,{request_id:request.id,reviewer_id:d.reviewer_id,reason:d.reason});
  await c.query("INSERT INTO notifications(workspace_id,user_id,kind,title_key,resource,record_id,dedupe_key) VALUES($1,$2,'deletion_review','notification.deletion_review',$3,$4,$5)",[ctx.workspaceId,d.reviewer_id,resource,id,'deletion:'+request.id]);return {requested:true};
 });
}
export async function retentionList(ctx:Context,input:Record<string,string>){
 const resource=input.resource??'documents',r=supported(resource),view=z.enum(['active','archived','deleted','requests']).parse(input.view??'archived'),s=scope(ctx,resource,'r',false,true,undefined,false,view==='deleted'),offset=z.coerce.number().int().min(0).max(100000).parse(input.offset??0),q=(input.q??'').slice(0,200);
 const info=await retentionInfo(pool,ctx,resource);
 const requests=(await pool.query('SELECT q.*,u.name requester_name,v.name reviewer_name FROM record_deletion_requests q JOIN "user" u ON u.id=q.requested_by JOIN "user" v ON v.id=q.reviewer_id WHERE q.workspace_id=$1 AND q.company_id=$2 AND q.resource=$3 AND (q.requested_by=$4 OR q.reviewer_id=$4) ORDER BY q.created_at DESC LIMIT 100',[ctx.workspaceId,ctx.companyId,resource,ctx.userId])).rows;
 const visibleRequests=[];for(const request of requests){try{const rs=scope(ctx,resource,'r',false,true,undefined,false,true);const row=(await pool.query('SELECT r.* FROM '+resource+' r WHERE '+rs.sql+' AND r.id=$4',[...rs.values,request.record_id])).rows[0];if(row)visibleRequests.push({...request,title:row[r.titleField]});}catch{ /* Inaccessible requests expose no details. */ }}
 const rows=view==='requests'?[]:(await pool.query('SELECT r.* FROM '+resource+' r WHERE '+s.sql+' AND r.archived=$4 AND '+(view==='deleted'?'':'NOT ')+'EXISTS(SELECT 1 FROM record_disposals d WHERE d.workspace_id=r.workspace_id AND d.company_id=r.company_id AND d.resource=$5 AND d.record_id=r.id) AND ($6=\'\' OR r.'+r.titleField+'::text ILIKE \'%\'||$6||\'%\') ORDER BY r.updated_at DESC,r.id LIMIT 51 OFFSET $7',[...s.values,view!=='active',resource,q,offset])).rows;
 const result=[];for(const row of rows.slice(0,50)){
  const retention=await retentionInfo(pool,ctx,resource,row);let editable=true,deletable=true;
  const write=scope(ctx,resource,'r',true,true,undefined,false,view==='deleted');editable=Boolean((await pool.query('SELECT 1 FROM '+resource+' r WHERE '+write.sql+' AND r.id=$4',[...write.values,row.id])).rowCount);
  try{await mayDelete(pool,ctx,resource,row,retention.tier);}catch{deletable=false;}
  result.push({id:row.id,title:row[r.titleField],version:row.version,status:row.status,archived:row.archived,retention,can_edit:editable,can_delete:editable&&deletable});
 }
 const reviewers:Row[]=[];
 if(input.id){const row=await find(pool,ctx,resource,z.uuid().parse(input.id));const users=(await pool.query('SELECT m.user_id,u.name FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status=\'active\' AND m.user_id<>$2',[ctx.workspaceId,ctx.userId])).rows;for(const user of users){try{const reviewer=await currentContext(pool,ctx,user.user_id);await canReview(pool,reviewer,resource,row);reviewers.push(user);}catch{}}}
 return {rows:result,requests:visibleRequests,reviewers,more:rows.length>50,policy:info,can_manage:ctx.roles.includes('admin'),can_review:operationAccess(ctx,resource,'delete_review')};
}
