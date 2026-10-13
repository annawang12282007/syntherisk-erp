import {initialAdministrator} from './company-information';
import {z} from 'zod';
import {query,transaction} from './db';
import {DomainError,requireRole,type Context} from './context';
import {validateRoles} from './roles';
import {normalizeScopes,permittedOperations} from '../domain/permission-options';

export function canEditRolePolicy(role:string,root:boolean){return role!=='admin'&&(role!=='operations'||root);}
export async function permissionPolicyCatalog(ctx:Context){
 requireRole(ctx,'admin');const root=await initialAdministrator(ctx);
 return (await query<{id:string;role_code:string;resource:string;operation:string;scope:string}>('SELECT * FROM permissions WHERE workspace_id=$1 ORDER BY role_code,resource,operation',[ctx.workspaceId])).filter(p=>permittedOperations(p.resource).includes(p.operation)).map(p=>({...p,can_edit:canEditRolePolicy(p.role_code,root)}));
}
export async function savePermissionPolicy(ctx:Context,input:Record<string,unknown>){
 requireRole(ctx,'admin');
 const v=z.object({role_code:z.string().min(1),resource:z.string().min(1),operations:z.array(z.string()).min(1).max(100),scopes:z.array(z.string()).min(1).max(7)}).parse({...input,operations:input.operations??[input.operation],scopes:input.scopes??String(input.scope??'').split(',')});
 await validateRoles(ctx.workspaceId,[v.role_code]);
 if(v.operations.some(operation=>!permittedOperations(v.resource).includes(operation)))throw new DomainError(400,'INVALID_POLICY_OPERATION');
 if(['analytics','team_boards'].includes(v.resource)&&v.scopes.some(scope=>!['all','none'].includes(scope)))throw new DomainError(400,'INVALID_POLICY_SCOPE');
 if(['team_directory','team_private','announcements','google_integrations'].includes(v.resource)&&v.scopes.some(scope=>!['all','own','created','none'].includes(scope)))throw new DomainError(400,'INVALID_POLICY_SCOPE');
 let selected:string;try{selected=normalizeScopes(v.scopes);}catch{throw new DomainError(400,'INVALID_POLICY_SCOPE');}
 if(v.role_code==='operations'&&!await initialAdministrator(ctx))throw new DomainError(403,'INITIAL_ADMIN_REQUIRED');
 if(v.role_code==='admin')throw new DomainError(400,'ADMIN_POLICY_FIXED');
 return transaction(async client=>{
  const saved=[];
  for(const operation of new Set(v.operations))saved.push((await client.query('INSERT INTO permissions(workspace_id,role_code,resource,operation,scope) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,role_code,resource,operation) DO UPDATE SET scope=$5 RETURNING *',[ctx.workspaceId,v.role_code,v.resource,operation,selected])).rows[0]);
  await client.query("INSERT INTO audit_log(workspace_id,actor_id,resource,action,after_data) VALUES($1,$2,'permissions','configure',$3)",[ctx.workspaceId,ctx.userId,JSON.stringify({...v,scope:selected})]);
  return saved;
 });
}
