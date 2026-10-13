import {initialAdministrator} from '@/lib/company-information';
import {isRetiredResource} from '@/domain/retired-features';
import {savePermissionPolicy,permissionPolicyCatalog,canEditRolePolicy} from '@/lib/permission-policies';
import {roleCatalog} from '@/lib/roles';
import {permittedOperations} from '@/domain/permission-options';
import {z} from 'zod';
import {handle,body} from '@/lib/http';
import {requireRole,DomainError} from '@/lib/context';
import {query} from '@/lib/db';
import {resources} from '@/domain/registry';
import {assertAccess} from '@/domain/service';
import {scope} from '@/domain/core';
import type {Context} from '@/lib/context';
export async function GET(r:Request){return handle(r,async ctx=>{requireRole(ctx,'admin');const root=await initialAdministrator(ctx);return{roles:(await roleCatalog(ctx)).map(role=>({...role,can_edit_policy:canEditRolePolicy(role.code,root)})),operation_options:Object.fromEntries([...Object.keys(resources),'*','analytics','team_directory','team_private','announcements','google_integrations','team_boards','workforce'].filter(key=>!isRetiredResource(key)).map(key=>[key,permittedOperations(key)])),permissions:await permissionPolicyCatalog(ctx),grants:await visibleGrants(ctx)};});}
export async function POST(r:Request){return handle(r,async ctx=>{requireRole(ctx,'admin');const b=await body(r);if(b.action==='policy')return savePermissionPolicy(ctx,b);if(b.action==='grant'||b.action==='revoke'){const v=z.object({resource:z.string().refine(k=>Boolean(resources[k])&&!isRetiredResource(k)),record_id:z.uuid(),user_id:z.string().min(1),can_edit:z.boolean().default(false)}).parse(b);await assertAccess(ctx,v.resource,v.record_id);if(!(await query('SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status=\'active\'',[ctx.workspaceId,v.user_id])).length)throw new DomainError(400,'INVALID_MEMBER');if(b.action==='revoke'){await query('DELETE FROM record_grants WHERE workspace_id=$1 AND resource=$2 AND record_id=$3 AND user_id=$4',[ctx.workspaceId,v.resource,v.record_id,v.user_id]);await query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,'record_grants',$3,'revoke',$4)",[ctx.workspaceId,ctx.userId,v.record_id,JSON.stringify(v)]);return{revoked:true};}const grant=(await query('INSERT INTO record_grants(workspace_id,resource,record_id,user_id,can_edit) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,resource,record_id,user_id) DO UPDATE SET can_edit=$5 RETURNING *',[ctx.workspaceId,v.resource,v.record_id,v.user_id,v.can_edit]))[0];await query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,'record_grants',$3,'grant',$4)",[ctx.workspaceId,ctx.userId,v.record_id,JSON.stringify(v)]);return grant;}throw new DomainError(400,'INVALID_ACTION');});}

async function visibleGrants(ctx:Context){
 const grants=await query('SELECT * FROM record_grants WHERE workspace_id=$1 ORDER BY resource',[ctx.workspaceId]);
 const visible=new Set<string>();
 for(const resource of new Set(grants.map(grant=>String(grant.resource)))){
  if(!resources[resource]||isRetiredResource(resource))continue;const access=scope(ctx,resource);const ids=grants.filter(grant=>grant.resource===resource).map(grant=>grant.record_id);
  for(const row of await query(`SELECT r.id FROM ${resource} r WHERE ${access.sql} AND r.id=ANY($4::uuid[])`,[...access.values,ids]))visible.add(`${resource}:${row.id}`);
 }
 return grants.filter(grant=>visible.has(`${grant.resource}:${grant.record_id}`));
}