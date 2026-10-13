import type {Context} from '../lib/context';
import {DomainError} from '../lib/context';
import {type Client,type Row,scope,find,def,str,fail,patch,notify,isExternal,elevated,finance,operationAccess,parentKeys,uuid} from './core';
import {recordResponsibleSnapshot} from './responsibilities';
import {assertRecordAudienceChange} from './task-visibility';
import {delegationTargets} from './registry';
import {delegatedPredicate} from './delegation-scope';
import {recordSnapshot,canonicalJson,signatureHash} from './signatures';
export async function originalAccess(c:Client,ctx:Context,resource:string,id:unknown,write=false,lock=false){const s=scope(ctx,resource,'r',write,false);return(await c.query(`SELECT r.* FROM ${def(resource).key} r WHERE ${s.sql} AND r.id=$4${lock?' FOR SHARE OF r':''}`,[...s.values,uuid(id)])).rows[0] as Row|undefined;}
export async function isDelegatedOnly(c:Client,ctx:Context,resource:string,id:unknown){if(await originalAccess(c,ctx,resource,id,true))return false;const parent=parentKeys[resource];if(parent){const row=await find(c,ctx,resource,id);return isDelegatedOnly(c,ctx,parent[0],row[parent[1]]);}return Boolean((await c.query(`SELECT 1 FROM ${def(resource).key} r WHERE r.workspace_id=$1 AND r.company_id=$2 AND r.id=$4 AND ${delegatedPredicate(resource)}`,[ctx.workspaceId,ctx.companyId,ctx.userId,id])).rowCount);}
async function explicitEditGrant(c:Client,ctx:Context,resource:string,id:unknown){return Boolean((await c.query('SELECT 1 FROM record_grants WHERE workspace_id=$1 AND resource=$2 AND record_id=$3 AND user_id=$4 AND can_edit',[ctx.workspaceId,resource,id,ctx.userId])).rowCount);}
/** Scoped grants lock before their target, matching report/revoke actions and avoiding a revoked-grant race. */
export async function lockDelegatedAccess(c:Client,ctx:Context,resource:string,id:unknown):Promise<void>{
 if(await originalAccess(c,ctx,resource,id,true)||await explicitEditGrant(c,ctx,resource,id))return;
 const parent=parentKeys[resource];if(parent){const row=await find(c,ctx,resource,id);return lockDelegatedAccess(c,ctx,parent[0],row[parent[1]]);}
 await c.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE',[ctx.workspaceId]);
 const active=`EXISTS(SELECT 1 FROM ${def(resource).key} r WHERE r.workspace_id=$1 AND r.company_id=$2 AND r.id=$4 AND ${delegatedPredicate(resource,'r',true)})`;
 const grants=await c.query(`SELECT dg.id FROM delegations dg WHERE dg.workspace_id=$1 AND dg.company_id=$2 AND dg.assignee_id=$3 AND dg.target_id=$4 AND dg.target_resource=$5 AND dg.access_level='edit' AND dg.status IN('assigned','in_progress','needs_changes') AND ${active} ORDER BY dg.id FOR SHARE OF dg`,[ctx.workspaceId,ctx.companyId,ctx.userId,id,resource]);
 if(!grants.rowCount)fail('delegation_access_inactive',403);
}
export async function validateTarget(c:Client,ctx:Context,row:Row,original=false,write=false){
 if(Boolean(row.target_resource)!==Boolean(row.target_id))fail('target_pair_required');if(!row.target_resource)return;
 const resource=str(row.target_resource);if(!delegationTargets.includes(resource))fail('unsupported_delegation_target');
 const target=original?await originalAccess(c,ctx,resource,row.target_id,write,true):await find(c,ctx,resource,row.target_id,write);if(!target)fail('delegation_original_access_required',403);if(target.archived)fail('reference_archived');
 if(row.task_id&&(resource!=='tasks'||row.target_id!==row.task_id))fail('target_reference_mismatch');if(row.document_id&&(resource!=='documents'||row.target_id!==row.document_id))fail('target_reference_mismatch');return target;
}
export async function prepareDelegation(c:Client,ctx:Context,data:Row):Promise<Row>{
 if(isExternal(ctx))fail('delegation_internal_required',403);if(data.assignee_id===ctx.userId)fail('delegation_self_assignment');
 const actor=(await c.query("SELECT roles FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active' FOR SHARE",[ctx.workspaceId,ctx.userId])).rows[0];if(!actor||ctx.roles.some(role=>!actor.roles.includes(role)))fail('delegation_authority_changed',403);
 const policies=(await c.query('SELECT resource,operation,scope FROM effective_permissions($1,$3,$2::text[])',[ctx.workspaceId,actor.roles,ctx.userId])).rows;const live:Context={...ctx,roles:actor.roles,permissions:policies as NonNullable<Context['permissions']>};
 const member=(await c.query("SELECT roles FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active' FOR SHARE",[ctx.workspaceId,data.assignee_id])).rows[0];if(!member||!Array.isArray(member.roles)||member.roles.every((role:string)=>role==='external'))fail('delegation_internal_assignee_required');
 if(member.roles.includes('admin')&&!ctx.roles.includes('admin')||member.roles.includes('operations')&&!elevated(ctx))fail('delegation_upward_forbidden',403);
 if(data.access_level==='edit'&&(!data.target_id||!elevated(ctx)&&!finance(ctx)))fail('delegation_edit_authority_required',403);
 if(data.target_id){const target=await validateTarget(c,ctx,data,true,data.access_level==='edit');await validateTarget(c,live,data,true,data.access_level==='edit');if(data.access_level==='edit'&&(def(str(data.target_resource)).readonly||!operationAccess(ctx,str(data.target_resource),'edit')))fail('delegation_edit_authority_required',403);if(!target)fail('delegation_original_access_required',403);}else await validateTarget(c,ctx,data);
 if(data.target_resource)await assertRecordAudienceChange(c,ctx,str(data.target_resource),data.target_id);
 if(data.expires_at&&new Date(str(data.expires_at)).getTime()<=Date.now())fail('delegation_expiry_in_past');
 const authority=(await c.query('SELECT access_revision FROM workspaces WHERE id=$1 FOR SHARE',[ctx.workspaceId])).rows[0];
 const targetAuthority=data.target_id?(await c.query('SELECT revision FROM delegation_target_revisions WHERE workspace_id=$1 AND resource=$2 AND record_id=$3',[ctx.workspaceId,data.target_resource,data.target_id])).rows[0]?.revision??'0':'0';
 return {...data,requester_id:ctx.userId,owner_id:ctx.userId,authority_revision:authority.access_revision,target_authority_revision:targetAuthority,access_level:data.access_level??'read',review_required:data.review_required??true};
}
/** Receiving a scoped edit grant cannot be used to grant lasting ownership/access to anyone. */
export async function assertDelegatedMutation(c:Client,ctx:Context,resource:string,row:Row,data:Row){
 if(await originalAccess(c,ctx,resource,row.id,true)||await explicitEditGrant(c,ctx,resource,row.id))return;
 const parent=parentKeys[resource],targetResource=parent?.[0]??resource,targetId=parent?row[parent[1]]:row.id;
 if(parent&&(await originalAccess(c,ctx,parent[0],targetId,true)||await explicitEditGrant(c,ctx,parent[0],targetId)))return;
 const current=await c.query(`SELECT 1 FROM ${def(targetResource).key} r WHERE r.workspace_id=$1 AND r.company_id=$2 AND r.id=$4 AND ${delegatedPredicate(targetResource,'r',true)}`,[ctx.workspaceId,ctx.companyId,ctx.userId,targetId]);
 if(!current.rowCount)fail('delegation_access_inactive',403);
 if(['task_collaborators','engagement_collaborators','project_members','event_participants'].includes(resource))fail('delegation_access_change_forbidden',403);
 if(Object.hasOwn(data,'owner_id')&&data.owner_id!==row.owner_id)fail('delegation_access_change_forbidden',403);
 if(Object.hasOwn(data,'responsible_user_ids')){const before=await recordResponsibleSnapshot(c,ctx,resource,str(row.id));if(!Array.isArray(data.responsible_user_ids)||JSON.stringify([...new Set(data.responsible_user_ids)].sort())!==JSON.stringify(before))fail('delegation_access_change_forbidden',403);}
 const relation=parentKeys[resource];if(relation&&Object.hasOwn(data,relation[1])&&data[relation[1]]!==row[relation[1]])fail('immutable_parent');
}
async function reviewerAllowed(c:Client,ctx:Context,row:Row){if(row.assignee_id===ctx.userId)fail('self_review_forbidden',403);if(row.requester_id===ctx.userId)return;if(!elevated(ctx))fail('delegation_requester_required',403);if(row.target_id&&!await originalAccess(c,ctx,str(row.target_resource),row.target_id,true))fail('delegation_original_access_required',403);}
export async function delegationAction(c:Client,ctx:Context,row:Row,name:string,data:Row):Promise<Row>{
 if(['completed','revoked'].includes(str(row.status)))fail('invalid_transition',409);
 if(name==='revoke'){await reviewerAllowed(c,ctx,row);if(!str(data.reason).trim())fail('reason_required');return patch(c,ctx,'delegations',row,{status:'revoked',revoked_at:new Date(),review_comments:data.reason},name);}
 if(name==='reissue'){if(row.requester_id!==ctx.userId)fail('delegation_requester_required',403);const renewed=await prepareDelegation(c,ctx,{...row,expires_at:data.expires_at??row.expires_at});return patch(c,ctx,'delegations',row,{authority_revision:renewed.authority_revision,target_authority_revision:renewed.target_authority_revision,expires_at:renewed.expires_at},name);}
 if(name==='start'||name==='report'){
  if(row.assignee_id!==ctx.userId)fail('delegation_assignee_required',403);if(!['assigned','in_progress','needs_changes'].includes(str(row.status)))fail('invalid_transition',409);
  if(name==='start'){if(row.status==='in_progress')fail('invalid_transition',409);return patch(c,ctx,'delegations',row,{status:'in_progress'},name);}
  if(!str(data.report).trim())fail('result_required');let target:Awaited<ReturnType<typeof recordSnapshot>>|undefined;
  if(row.target_id){try{target=await recordSnapshot(c,ctx,str(row.target_resource),str(row.target_id),true);}catch(error){if(!(error instanceof DomainError&&[403,404].includes(error.status)))throw error;}}
  const result=await patch(c,ctx,'delegations',row,{report:data.report,status:row.review_required?'submitted':'completed',submitted_target_version:target?.record.version??null,submitted_snapshot:target?JSON.stringify(target):null,submitted_at:new Date(),completed_at:row.review_required?null:new Date()},name);await notify(c,ctx,row.requester_id,'request_updated','delegations',result);return result;
 }
 if(name==='request_changes'||name==='confirm'){
  await reviewerAllowed(c,ctx,row);if(row.status!=='submitted'||!row.review_required)fail('invalid_transition',409);if(!str(data.reason).trim())fail('reason_required');
  if(name==='confirm'&&row.target_id&&row.submitted_snapshot){const target=await recordSnapshot(c,ctx,str(row.target_resource),str(row.target_id),true);if(signatureHash(canonicalJson(target))!==signatureHash(canonicalJson(row.submitted_snapshot)))fail('review_version_changed',409);}
  const result=await patch(c,ctx,'delegations',row,{status:name==='confirm'?'completed':'needs_changes',review_comments:data.reason,...(name==='confirm'?{completed_at:new Date()}:{})},name);await notify(c,ctx,row.assignee_id,'request_updated','delegations',result);return result;
 }
 fail('unsupported_action');
}
