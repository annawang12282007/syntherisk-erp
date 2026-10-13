import {accountAuthority,assertRoleAssignment,assertAccountTarget} from './account-authority';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {auth} from './auth';
import {query,transaction} from './db';
import {DomainError,requireRole,type Context} from './context';
import {validateRoles} from './roles';
export async function createManagedAccount(ctx:Context,input:unknown){
 requireRole(ctx,'admin');const value=z.object({email:z.email().max(254),name:z.string().trim().min(1).max(120),roles:z.array(z.string()).min(1).max(30),onboarding_jobs:z.array(z.uuid()).max(30).default([])}).parse(input);
 await validateRoles(ctx.workspaceId,value.roles);assertRoleAssignment(await accountAuthority(ctx),value.roles);
 if((await query('SELECT 1 FROM "user" WHERE lower(email)=$1',[value.email.toLowerCase()])).length)throw new DomainError(409,'ACCOUNT_ALREADY_EXISTS');
 const password=randomBytes(24).toString('base64url');
 const created=await auth.api.signUpEmail({body:{email:value.email.toLowerCase(),name:value.name,password}});
 try{
  await transaction(async client=>{
   assertRoleAssignment(await accountAuthority(ctx,client,true),value.roles);
   await client.query('INSERT INTO memberships(workspace_id,user_id,roles,onboarding_jobs) VALUES($1,$2,$3,$4)',[ctx.workspaceId,created.user.id,value.roles,value.onboarding_jobs]);
   await client.query('INSERT INTO account_security(user_id,must_change_password,provisioned_by) VALUES($1,true,$2)',[created.user.id,ctx.userId]);
   await client.query("INSERT INTO audit_log(workspace_id,actor_id,resource,action,after_data) VALUES($1,$2,'memberships','create_account',$3)",[ctx.workspaceId,ctx.userId,JSON.stringify({user_id:created.user.id,email:value.email,roles:value.roles,must_change_password:true})]);
  });
 }catch(error){await query('DELETE FROM "user" WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM memberships WHERE user_id=$1)',[created.user.id]);throw error;}
 return {user_id:created.user.id,email:created.user.email,name:created.user.name,initial_password:password,must_change_password:true};
}
export async function invitationList(ctx:Context){
 requireRole(ctx,'admin');const actor=await accountAuthority(ctx);if(!actor.roles.includes('admin'))throw new DomainError(403,'FORBIDDEN');
 return query(`SELECT id,email,roles,expires_at,accepted_at,created_at FROM invitations WHERE workspace_id=$1 AND ($2 OR lower(email) IS DISTINCT FROM (SELECT lower(email) FROM "user" WHERE id=$3)) ORDER BY created_at DESC LIMIT 200`,[ctx.workspaceId,actor.root,actor.rootId]);
}
export async function revokeInvitation(ctx:Context,id:string){
 requireRole(ctx,'admin');z.uuid().parse(id);return transaction(async client=>{
  const actor=await accountAuthority(ctx,client,true);
  const row=(await client.query('SELECT email,roles FROM invitations WHERE workspace_id=$1 AND id=$2 AND accepted_at IS NULL FOR UPDATE',[ctx.workspaceId,id])).rows[0];if(!row)throw new DomainError(404,'NOT_FOUND');
  const target=(await client.query('SELECT m.user_id,m.roles FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND lower(u.email)=lower($2)',[ctx.workspaceId,row.email])).rows[0];
  if(target)assertAccountTarget(actor,target.user_id,target.roles);assertRoleAssignment(actor,row.roles);
  await client.query('UPDATE invitations SET expires_at=LEAST(expires_at,now()) WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,id]);
  await client.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action) VALUES($1,$2,'invitations',$3,'revoke')",[ctx.workspaceId,ctx.userId,id]);return {revoked:true};
 });
}
