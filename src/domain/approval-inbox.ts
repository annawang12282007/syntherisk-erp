import {pool,query} from '../lib/db';
import {type Context,DomainError} from '../lib/context';
import {find,scope,operationAccess,assertOperation} from './core';
import {resources} from './registry';
import {claimPolicyAllows} from './finance';
type InboxItem={id:string;resource:string;record_id:string;title:string;kind:string;date:unknown;action:string;stale?:boolean};
export async function approvalInbox(ctx:Context){
 const signatures:InboxItem[]=[],approvals:InboxItem[]=[];
 const requests=await query("SELECT q.id,q.label,b.resource,b.record_id,b.record_version,b.requested_at FROM signature_requests q JOIN signature_request_batches b ON b.id=q.batch_id WHERE q.workspace_id=$1 AND q.company_id=$2 AND q.user_id=$3 AND q.kind='internal' AND q.status='pending' ORDER BY b.requested_at DESC LIMIT 200",[ctx.workspaceId,ctx.companyId,ctx.userId]);
 for(const request of requests){try{const row=await find(pool,ctx,String(request.resource),request.record_id);signatures.push({id:String(request.id),resource:String(request.resource),record_id:String(row.id),title:String(row[resources[String(request.resource)].titleField]),kind:String(request.label),date:request.requested_at,action:'request_sign',stale:row.version!==request.record_version});}catch(e){if(!(e instanceof DomainError&&[403,404].includes(e.status)))throw e;}}
 const sources=[
  {resource:'reviews',action:'approve',where:"r.status='pending' AND r.reviewer_id=$3 AND r.created_by<>$3",operation:'read'},
  {resource:'delegations',action:'confirm',where:"r.status='submitted' AND r.requester_id=$3 AND r.review_required",operation:'edit'},
  {resource:'handoffs',action:'accept',where:"r.status='pending' AND r.to_user_id=$3",operation:'read'},
  {resource:'contracts',action:'sign',where:"r.status='under_review'",operation:'edit'},
  {resource:'work_requests',action:'confirm',where:"r.status='submitted' AND r.requester_id=$3",operation:'read'},
  {resource:'expense_claims',action:'approve',where:"r.status='submitted' AND r.created_by<>$3 AND r.owner_id IS DISTINCT FROM $3 AND NOT EXISTS(SELECT 1 FROM record_responsibles rr WHERE rr.workspace_id=$1 AND rr.resource='expense_claims' AND rr.record_id=r.id AND rr.user_id=$3)",operation:'approve'}
 ];
 for(const source of sources){
  if(!operationAccess(ctx,source.resource,source.operation))continue;
  const access=scope(ctx,source.resource,'r',source.operation==='edit');
  const rows=await query(`SELECT r.* FROM ${source.resource} r WHERE ${access.sql} AND NOT r.archived AND (${source.where}) ORDER BY r.updated_at DESC LIMIT 100`,access.values);
  for(const row of rows){try{
   await assertOperation(pool,ctx,source.resource,source.operation,row);
   if(source.resource==='expense_claims'&&!await claimPolicyAllows(pool,ctx,row))continue;
   approvals.push({id:`${source.resource}:${row.id}`,resource:source.resource,record_id:String(row.id),title:String(row[resources[source.resource].titleField]),kind:source.action,date:row.updated_at,action:source.action});
  }catch(e){if(!(e instanceof DomainError&&[403,404].includes(e.status)))throw e;}}
 }
 return {signatures,approvals};
}
