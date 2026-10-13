import {z} from 'zod';
import {pool,transaction} from './db';
import {DomainError,type Context} from './context';
import {accountAuthority,canManageAccount} from './account-authority';
import {audit,type Client} from '../domain/core';
export async function organizationManager(ctx:Context,c:Client=pool){const a=await accountAuthority(ctx,c);if(!a.root&&!a.roles.includes('operations'))throw new DomainError(403,'FORBIDDEN');return a;}
export async function departmentImpact(ctx:Context,id:string,c:Client=pool){
 const actor=await organizationManager(ctx,c);
 const department=(await c.query('SELECT * FROM departments WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL',[ctx.workspaceId,z.uuid().parse(id)])).rows[0];if(!department)throw new DomainError(404,'NOT_FOUND');
 const jobs=(await c.query('SELECT id,name,name_zh,name_en,version,permissions FROM department_jobs WHERE department_id=$1 AND deleted_at IS NULL',[id])).rows;
 const assignments=(await c.query('SELECT a.user_id,a.job_id,m.roles FROM employee_assignments a JOIN department_jobs j ON j.id=a.job_id JOIN memberships m ON m.workspace_id=a.workspace_id AND m.user_id=a.user_id WHERE a.workspace_id=$1 AND j.department_id=$2',[ctx.workspaceId,id])).rows;
 const invitations=(await c.query("SELECT count(*)::int count FROM invitations WHERE workspace_id=$1 AND accepted_at IS NULL AND expires_at>now() AND onboarding_jobs && $2::uuid[]",[ctx.workspaceId,jobs.map(j=>j.id)])).rows[0].count;
 return{department,jobs,member_count:new Set(assignments.map(a=>a.user_id)).size,assignment_count:assignments.length,invitation_count:invitations,can_transfer:assignments.every(a=>canManageAccount(actor,a.user_id,a.roles)),assignments};
}
export async function removeDepartment(ctx:Context,input:unknown){const v=z.object({id:z.uuid(),version:z.number().int().positive(),target_job_id:z.uuid().optional(),expected_assignments:z.number().int().nonnegative(),expected_invitations:z.number().int().nonnegative()}).parse(input);
 return transaction(async c=>{
  await c.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[ctx.workspaceId]);const impact=await departmentImpact(ctx,v.id,c);
  if(impact.department.version!==v.version||impact.assignment_count!==v.expected_assignments||impact.invitation_count!==v.expected_invitations)throw new DomainError(409,'VERSION_CONFLICT');
  if(!impact.can_transfer)throw new DomainError(403,'ACCOUNT_HIERARCHY_FORBIDDEN');
  if((impact.assignment_count||impact.invitation_count)&&!v.target_job_id)throw new DomainError(409,'DEPARTMENT_TRANSFER_REQUIRED');
  if(v.target_job_id){const target=(await c.query('SELECT j.id FROM department_jobs j JOIN departments d ON d.id=j.department_id WHERE d.workspace_id=$1 AND d.id<>$2 AND j.id=$3 AND j.active AND d.active AND d.deleted_at IS NULL AND j.deleted_at IS NULL',[ctx.workspaceId,v.id,v.target_job_id])).rows[0];if(!target)throw new DomainError(422,'INVALID_REFERENCE');
   await c.query('INSERT INTO employee_assignments(workspace_id,user_id,job_id) SELECT DISTINCT a.workspace_id,a.user_id,$3::uuid FROM employee_assignments a JOIN department_jobs j ON j.id=a.job_id WHERE a.workspace_id=$1 AND j.department_id=$2 ON CONFLICT DO NOTHING',[ctx.workspaceId,v.id,v.target_job_id]);
   await c.query('UPDATE employee_numbers SET version=version+1 WHERE workspace_id=$1 AND user_id=ANY($2::text[])',[ctx.workspaceId,[...new Set(impact.assignments.map(a=>a.user_id))]]);
   await c.query("UPDATE invitations SET onboarding_jobs=ARRAY(SELECT DISTINCT CASE WHEN j=ANY($2::uuid[]) THEN $3::uuid ELSE j END FROM unnest(onboarding_jobs) j) WHERE workspace_id=$1 AND accepted_at IS NULL AND expires_at>now() AND onboarding_jobs && $2::uuid[]",[ctx.workspaceId,impact.jobs.map(j=>j.id),v.target_job_id]);
  }
  await c.query('DELETE FROM employee_assignments WHERE workspace_id=$1 AND job_id IN(SELECT id FROM department_jobs WHERE department_id=$2)',[ctx.workspaceId,v.id]);
  await c.query('UPDATE department_jobs SET active=false,deleted_at=now(),version=version+1 WHERE department_id=$1 AND deleted_at IS NULL',[v.id]);
  await c.query('UPDATE departments SET active=false,deleted_at=now(),version=version+1 WHERE id=$1',[v.id]);
  await c.query('UPDATE workspaces SET access_revision=access_revision+1 WHERE id=$1',[ctx.workspaceId]);
  await audit(c,ctx,'departments',v.id,'remove',impact.department,{...v,member_count:impact.member_count,jobs:impact.jobs,assignments:impact.assignments.map(a=>({user_id:a.user_id,job_id:a.job_id}))});return{removed:true};
 });
}
export async function permissionSources(ctx:Context,user:string){
 const actor=await organizationManager(ctx);if(user===actor.rootId&&!actor.root)throw new DomainError(404,'NOT_FOUND');
 const member=(await pool.query("SELECT roles FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'",[ctx.workspaceId,user])).rows[0];if(!member)throw new DomainError(404,'NOT_FOUND');
 const roles=member.roles as string[];
 const rules=(await pool.query('SELECT role_code AS source,resource,operation,scope FROM permissions WHERE workspace_id=$1 AND role_code=ANY($2::text[])',[ctx.workspaceId,roles])).rows;
 const departments=(await pool.query("SELECT d.name_zh,d.name_en,j.name_zh job_zh,j.name_en job_en,j.permissions job_permissions,d.permissions department_permissions FROM department_jobs j JOIN departments d ON d.id=j.department_id WHERE d.workspace_id=$1 AND d.active AND j.active AND ($3 OR j.id IN(SELECT job_id FROM employee_assignments WHERE workspace_id=$1 AND user_id=$2))",[ctx.workspaceId,user,roles.includes('operations')])).rows;
 const operator=roles.includes('operations')?(await pool.query('SELECT permissions FROM operator_configuration WHERE workspace_id=$1',[ctx.workspaceId])).rows[0]?.permissions??[]:[];
 return{user_id:user,roles,unrestricted:roles.includes('admin'),rules:[...rules,...operator.map((r:Record<string,unknown>)=>({...r,source:'operations'}))],departments,record_restrictions_apply:true};
}
