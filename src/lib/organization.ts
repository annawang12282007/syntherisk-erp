import {richString} from './rich-text-schema';
import {removeDepartment} from './organization-lifecycle';
import {isRetiredResource,activePermissionRules} from '../domain/retired-features';
import {z} from 'zod';
import {accountAuthority,assertAccountTarget,canManageAccount} from './account-authority';
import {query,transaction} from './db';
import {type Context,DomainError} from './context';
import {initialAdministrator} from './company-information';
import {isExternal} from '../domain/core';
import {resources} from '../domain/registry';
import {permittedOperations,normalizeScopes} from '../domain/permission-options';
const prefix=z.string().regex(/^[A-Z]{1,4}$/),name=z.string().trim().min(1).max(120);
const policy=z.array(z.object({resource:z.string(),operation:z.string(),scope:z.string()})).max(300);
const jobs=z.array(z.uuid()).max(30).refine(v=>new Set(v).size===v.length);
export function validateDepartmentPolicies(input:unknown){const p=activePermissionRules(policy.parse(input));for(const rule of p){const options=rule.resource==='finance_management'?['operate']:permittedOperations(rule.resource);if(!options.includes(rule.operation))throw new DomainError(422,'INVALID_POLICY_OPERATION');try{normalizeScopes(rule.scope.split(','));}catch{throw new DomainError(422,'INVALID_POLICY_SCOPE');}}return p;}
export async function organization(ctx:Context){
 if(isExternal(ctx))throw new DomainError(403,'FORBIDDEN');const root=await initialAdministrator(ctx),manage=root||ctx.roles.includes('operations');
 const authority=await accountAuthority(ctx);
 const departments=await query(`SELECT * FROM departments WHERE workspace_id=$1 AND deleted_at IS NULL AND ($2 OR active) ORDER BY name`,[ctx.workspaceId,manage]);
 const positions=await query(`SELECT j.* FROM department_jobs j JOIN departments d ON d.id=j.department_id WHERE d.workspace_id=$1 AND d.deleted_at IS NULL AND j.deleted_at IS NULL AND ($2 OR (d.active AND j.active)) ORDER BY j.name`,[ctx.workspaceId,manage]);
 const assignments=await query(`SELECT a.user_id,a.job_id FROM employee_assignments a JOIN memberships m ON m.user_id=a.user_id AND m.workspace_id=a.workspace_id WHERE a.workspace_id=$1 AND m.status='active' AND m.user_id IS DISTINCT FROM (SELECT initial_admin_user_id FROM workspaces WHERE id=$1)`,[ctx.workspaceId]);
 const members=await query(`SELECT u.id user_id,u.name,e.employee_number,e.version,m.roles,m.status FROM memberships m JOIN "user" u ON u.id=m.user_id LEFT JOIN employee_numbers e ON e.user_id=m.user_id AND e.workspace_id=m.workspace_id WHERE m.workspace_id=$1 AND m.user_id IS DISTINCT FROM (SELECT initial_admin_user_id FROM workspaces WHERE id=$1) AND NOT(m.roles <@ ARRAY['external']::text[]) AND ($2 OR m.status='active') ORDER BY u.name`,[ctx.workspaceId,manage]);
 const [operator]=await query(`SELECT * FROM operator_configuration WHERE workspace_id=$1`,[ctx.workspaceId]);
 return {can_manage:manage,is_initial_admin:root,departments:departments.map(d=>manage?{...d,permissions:activePermissionRules(policy.parse(d.permissions))}:{id:d.id,name:d.name,name_zh:d.name_zh,name_en:d.name_en,description_zh:d.description_zh,description_en:d.description_en,description:d.description}),jobs:positions.map(j=>manage?{...j,permissions:activePermissionRules(policy.parse(j.permissions))}:{id:j.id,department_id:j.department_id,name:j.name,name_zh:j.name_zh,name_en:j.name_en}),assignments,members:members.map(m=>manage?{...m,can_manage:canManageAccount(authority,String(m.user_id),m.roles as string[])}:{user_id:m.user_id,name:m.name,employee_number:m.employee_number}),operator:root&&operator?{...operator,permissions:activePermissionRules(policy.parse(operator.permissions))}:{name:operator?.name,name_zh:operator?.name_zh,name_en:operator?.name_en},policy_resources:manage?Object.fromEntries([...Object.keys(resources),'*','team_directory','team_private','team_boards','google_integrations','announcements','analytics','finance_management','workforce'].filter(k=>!isRetiredResource(k)).map(k=>[k,{label:resources[k]?.label??(k==='workforce'?['人力與薪勤','人力与薪勤','Workforce']:[k,k,k]),operations:k==='finance_management'?['operate']:permittedOperations(k)}])):{}};
}
export async function saveOrganization(ctx:Context,input:Record<string,unknown>){
 if(input.action==='department_delete')return removeDepartment(ctx,input);
 const root=await initialAdministrator(ctx);if(!root&&!ctx.roles.includes('operations'))throw new DomainError(403,'FORBIDDEN');
 return transaction(async c=>{
 await c.query(`SELECT id FROM workspaces WHERE id=$1 FOR UPDATE`,[ctx.workspaceId]);
 const [actor]=(await c.query(`SELECT roles FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active' FOR SHARE`,[ctx.workspaceId,ctx.userId])).rows;if(!actor||!root&&!actor.roles.includes('operations'))throw new DomainError(403,'FORBIDDEN');
 const action=input.action;let result:unknown;
 const bilingual=z.object({name_zh:name,name_en:z.string().trim().max(120),description_zh:richString(4000).default(''),description_en:richString(4000).default('')}).parse({name_zh:input.name_zh??input.name??'unused',name_en:input.name_en??'',description_zh:input.description_zh??input.description??'',description_en:input.description_en??''});
 if(['department','job','operator'].includes(String(action)))input={...input,name:bilingual.name_zh,description:bilingual.description_zh};
 if(action==='department'){
 const d=z.object({id:z.uuid().optional(),name,prefix,description:richString(4000).default(''),permissions:policy,active:z.boolean(),version:z.number().int().min(0)}).parse(input);d.permissions=validateDepartmentPolicies(d.permissions);
 result=d.id?(await c.query(`UPDATE departments SET name=$3,prefix=$4,description=$5,permissions=$6,active=$7,version=version+1 WHERE workspace_id=$1 AND id=$2 AND version=$8 AND deleted_at IS NULL RETURNING *`,[ctx.workspaceId,d.id,d.name,d.prefix,d.description,JSON.stringify(d.permissions),d.active,d.version])).rows[0]:(await c.query(`INSERT INTO departments(workspace_id,name,prefix,description,permissions,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[ctx.workspaceId,d.name,d.prefix,d.description,JSON.stringify(d.permissions),d.active])).rows[0];
 }else if(action==='job'){
 const d=z.object({id:z.uuid().optional(),department_id:z.uuid(),name,prefix,permissions:policy,active:z.boolean(),version:z.number().int().min(0)}).parse(input);d.permissions=validateDepartmentPolicies(d.permissions);
 if(!(await c.query(`SELECT id FROM departments WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL`,[ctx.workspaceId,d.department_id])).rowCount)throw new DomainError(404,'NOT_FOUND');
 result=d.id?(await c.query(`UPDATE department_jobs SET name=$3,prefix=$4,permissions=$5,active=$6,version=version+1 WHERE department_id=$1 AND id=$2 AND version=$7 AND deleted_at IS NULL RETURNING *`,[d.department_id,d.id,d.name,d.prefix,JSON.stringify(d.permissions),d.active,d.version])).rows[0]:(await c.query(`INSERT INTO department_jobs(department_id,name,prefix,permissions,active) VALUES($1,$2,$3,$4,$5) RETURNING *`,[d.department_id,d.name,d.prefix,JSON.stringify(d.permissions),d.active])).rows[0];
 }else if(action==='assign'){
 const d=z.object({user_id:z.string(),job_ids:jobs,version:z.number().int().positive()}).parse(input);
 const [m]=(await c.query(`SELECT m.roles,e.version FROM memberships m JOIN employee_numbers e ON e.workspace_id=m.workspace_id AND e.user_id=m.user_id JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.user_id IS DISTINCT FROM w.initial_admin_user_id AND m.status='active' AND NOT(m.roles <@ ARRAY['external']::text[]) FOR UPDATE OF m,e`,[ctx.workspaceId,d.user_id])).rows;
 if(!m)throw new DomainError(404,'NOT_FOUND');assertAccountTarget(await accountAuthority(ctx,c),d.user_id,m.roles);if(m.version!==d.version)throw new DomainError(409,'VERSION_CONFLICT');if(m.roles.includes('operations'))throw new DomainError(422,'OPERATOR_HAS_NO_DEPARTMENT');
 const valid=await c.query(`SELECT j.id FROM department_jobs j JOIN departments p ON p.id=j.department_id WHERE p.workspace_id=$1 AND j.id=ANY($2::uuid[]) AND p.active AND j.active`,[ctx.workspaceId,d.job_ids]);if(valid.rowCount!==d.job_ids.length)throw new DomainError(422,'INVALID_REFERENCE');
 await c.query(`DELETE FROM employee_assignments WHERE workspace_id=$1 AND user_id=$2`,[ctx.workspaceId,d.user_id]);for(const id of d.job_ids)await c.query(`INSERT INTO employee_assignments VALUES($1,$2,$3)`,[ctx.workspaceId,d.user_id,id]);await c.query(`UPDATE employee_numbers SET version=version+1 WHERE workspace_id=$1 AND user_id=$2`,[ctx.workspaceId,d.user_id]);result={saved:true};
 }else if(action==='employee_number'){
 if(!root)throw new DomainError(403,'INITIAL_ADMIN_REQUIRED');const d=z.object({user_id:z.string(),employee_number:z.string().regex(/^[A-Z]{1,4}[0-9]{4}$/),version:z.number().int().positive(),reason:richString(1000,3)}).parse(input);
 const [current]=(await c.query(`SELECT * FROM employee_numbers WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE`,[ctx.workspaceId,d.user_id])).rows;if(!current)throw new DomainError(404,'NOT_FOUND');if(current.version!==d.version)throw new DomainError(409,'VERSION_CONFLICT');
 if(current.employee_number===d.employee_number)return {saved:true};
 await c.query(`INSERT INTO employee_number_history(workspace_id,user_id,employee_number,actor_id,reason) VALUES($1,$2,$3,$4,$5)`,[ctx.workspaceId,d.user_id,d.employee_number,ctx.userId,d.reason]);
 result=(await c.query(`UPDATE employee_numbers SET employee_number=$3,version=version+1 WHERE workspace_id=$1 AND user_id=$2 RETURNING *`,[ctx.workspaceId,d.user_id,d.employee_number])).rows[0];
 }else if(action==='operator'){
 if(!root)throw new DomainError(403,'INITIAL_ADMIN_REQUIRED');const d=z.object({name,permissions:policy,version:z.number().int().positive()}).parse(input);d.permissions=validateDepartmentPolicies(d.permissions);
 result=(await c.query(`UPDATE operator_configuration SET name=$2,permissions=$3,version=version+1 WHERE workspace_id=$1 AND version=$4 RETURNING *`,[ctx.workspaceId,d.name,JSON.stringify(d.permissions),d.version])).rows[0];
 }else throw new DomainError(422,'INVALID_ACTION');
 if(!result)throw new DomainError(409,'VERSION_CONFLICT');
 if(action==='department')await c.query('UPDATE departments SET name_zh=$2,name_en=$3,description_zh=$4,description_en=$5 WHERE id=$1',[(result as {id:string}).id,bilingual.name_zh,bilingual.name_en,bilingual.description_zh,bilingual.description_en]);
 if(action==='job')await c.query('UPDATE department_jobs SET name_zh=$2,name_en=$3 WHERE id=$1',[(result as {id:string}).id,bilingual.name_zh,bilingual.name_en]);
 if(action==='operator')await c.query('UPDATE operator_configuration SET name_zh=$2,name_en=$3 WHERE workspace_id=$1',[ctx.workspaceId,bilingual.name_zh,bilingual.name_en]);
 await c.query(`UPDATE workspaces SET access_revision=access_revision+1 WHERE id=$1`,[ctx.workspaceId]);
 await c.query(`INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,'organization',$3,$4,$5)`,[ctx.workspaceId,ctx.userId,String(input.id??input.user_id??ctx.workspaceId),String(action),JSON.stringify(input)]);return result;
 });
}
