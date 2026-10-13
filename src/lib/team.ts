import {richString} from './rich-text-schema';
import {z} from 'zod';
import {accountAuthority,accountRank,assertAccountTarget,type AccountAuthority} from './account-authority';
import {query,transaction} from './db';
import {DomainError,type Context} from './context';
import {isExternal,permissionScope} from '../domain/core';
const sharedKeys=['work_email','personal_email','work_phone','mobile','job_title','contact_notes'] as const;
const privateKeys=['legal_name','address','birthday','emergency_contact','private_notes'] as const;
type TeamRow=Record<string,unknown>;
function permitted(ctx:Context,resource:'team_directory'|'team_private',operation:'read'|'edit',userId:string){
 if(isExternal(ctx))return false;
 if(ctx.userId===userId)return true;
 const custom=permissionScope(ctx,resource,operation);
 if(custom)return custom==='all'||custom.split(',').some(scope=>['own','created'].includes(scope))&&ctx.userId===userId;
 return resource==='team_directory'&&operation==='read'||ctx.userId===userId||ctx.roles.some(role=>['admin','operations'].includes(role));
}
function project(ctx:Context,row:TeamRow,actor:AccountAuthority){
 const userId=String(row.user_id),mutable=userId===ctx.userId||actor.rank>accountRank(row.roles as string[]),canView=permitted(ctx,'team_private','read',userId),canEdit=mutable&&permitted(ctx,'team_directory','edit',userId),canEditPrivate=mutable&&canView&&permitted(ctx,'team_private','edit',userId);
 const contactKeys=canView?sharedKeys:sharedKeys.filter(k=>['work_email','work_phone','job_title'].includes(k));
 return {employee_number:row.employee_number,departments:row.departments??[],user_id:userId,name:row.name,roles:row.roles,status:row.status,profile_version:row.version??0,...Object.fromEntries(contactKeys.map(key=>[key,key==='work_email'?(row[key]??row.email):row[key]??null])),can_edit:canEdit,can_view_private:canView,can_edit_private:canEditPrivate,...(canView?Object.fromEntries(privateKeys.map(key=>[key,row[key]??null])):{})};
}
export async function teamDirectory(ctx:Context){
 if(isExternal(ctx)||permissionScope(ctx,'team_directory','read')==='none')throw new DomainError(403,'TEAM_ACCESS_FORBIDDEN');
 const actor=await accountAuthority(ctx);
 const rows=await query<TeamRow>(`SELECT p.*,m.user_id,m.roles,m.status,u.name,u.email,e.employee_number,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'name_zh',d.name_zh,'name_en',d.name_en,'job',j.name,'job_zh',j.name_zh,'job_en',j.name_en)) FROM employee_assignments a JOIN department_jobs j ON j.id=a.job_id JOIN departments d ON d.id=j.department_id WHERE a.workspace_id=m.workspace_id AND a.user_id=m.user_id AND d.active AND j.active),'[]'::jsonb) departments FROM memberships m JOIN "user" u ON u.id=m.user_id LEFT JOIN employee_numbers e ON e.workspace_id=m.workspace_id AND e.user_id=m.user_id LEFT JOIN team_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id WHERE m.workspace_id=$1 AND m.user_id IS DISTINCT FROM (SELECT initial_admin_user_id FROM workspaces WHERE id=$1) AND m.status=\'active\' AND NOT(m.roles <@ ARRAY[\'external\']::text[]) ORDER BY u.name`,[ctx.workspaceId]);
 return {members:rows.filter(row=>permitted(ctx,'team_directory','read',String(row.user_id))).map(row=>project(ctx,row,actor)),can_manage_private:permitted(ctx,'team_private','read','other-member')};
}
const text=(max:number)=>z.string().trim().max(max).nullable().optional();
const email=z.union([z.email(),z.literal(''),z.null()]).optional();
const schema=z.object({user_id:z.string().min(1).max(200),version:z.number().int().min(0),work_email:email,personal_email:email,work_phone:text(100),mobile:text(100),job_title:text(200),contact_notes:richString(2000).nullable().optional(),legal_name:text(200),address:richString(2000).nullable().optional(),birthday:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(value+'T00:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;}).nullable().optional(),emergency_contact:richString(1000).nullable().optional(),private_notes:richString(4000).nullable().optional()}).strict();
export async function updateTeamProfile(ctx:Context,input:unknown){
 const data=schema.parse(input);if(isExternal(ctx))throw new DomainError(403,'TEAM_ACCESS_FORBIDDEN');
 const changes=Object.fromEntries([...sharedKeys,...privateKeys].filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]===''?null:data[key]]));
 if(!Object.keys(changes).length)throw new DomainError(400,'INVALID_ACTION');
 if(!permitted(ctx,'team_directory','read',data.user_id)||sharedKeys.some(key=>Object.hasOwn(changes,key))&&!permitted(ctx,'team_directory','edit',data.user_id)||[...privateKeys,'personal_email','mobile','contact_notes'].some(key=>Object.hasOwn(changes,key))&&(!permitted(ctx,'team_private','read',data.user_id)||!permitted(ctx,'team_private','edit',data.user_id)))throw new DomainError(403,'TEAM_EDIT_FORBIDDEN');
 return transaction(async client=>{
  const actor=await accountAuthority(ctx,client,true);
  const member=(await client.query('SELECT m.user_id,m.roles,m.status,u.name,u.email FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status=\'active\' AND NOT(m.roles <@ ARRAY[\'external\']::text[]) FOR SHARE OF m',[ctx.workspaceId,data.user_id])).rows[0];if(!member)throw new DomainError(404,'TEAM_MEMBER_NOT_FOUND');assertAccountTarget(actor,data.user_id,member.roles,true);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`team:${ctx.workspaceId}:${data.user_id}`]);
  const existing=(await client.query('SELECT * FROM team_profiles WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE',[ctx.workspaceId,data.user_id])).rows[0];if(Number(existing?.version??0)!==data.version)throw new DomainError(409,'VERSION_CONFLICT');
  const keys=Object.keys(changes),values=Object.values(changes);let saved:TeamRow;
  if(existing){saved=(await client.query(`UPDATE team_profiles SET ${keys.map((key,index)=>`${key}=$${index+4}`).join(',')}${keys.length?',':''}version=version+1,updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND user_id=$2 RETURNING *`,[ctx.workspaceId,data.user_id,ctx.userId,...values])).rows[0];}
  else saved=(await client.query(`INSERT INTO team_profiles(workspace_id,user_id,updated_by${keys.length?','+keys.join(','):''}) VALUES($1,$2,$3${keys.map((_,index)=>`,$${index+4}`).join('')}) RETURNING *`,[ctx.workspaceId,data.user_id,ctx.userId,...values])).rows[0];
  // Audit the fact and field names of a change, never personal data in the general history feed.
  await client.query('INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,\'team_profiles\',$3,\'update\',$4)',[ctx.workspaceId,ctx.userId,data.user_id,JSON.stringify({changed_fields:keys,version:saved.version})]);
  return project(ctx,{...member,...saved},actor);
 });
}
export async function updateAccountName(ctx:Context,input:unknown){
 const {name}=z.object({name:z.string().trim().min(1).max(120)}).parse(input);
 return transaction(async client=>{
  const user=(await client.query('UPDATE "user" SET name=$2,"updatedAt"=now() WHERE id=$1 RETURNING id,name,email',[ctx.userId,name])).rows[0];if(!user)throw new DomainError(404,'NOT_FOUND');
  await client.query('INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,\'account_profile\',$2,\'update\',$3)',[ctx.workspaceId,ctx.userId,JSON.stringify({changed_fields:['name']})]);return {user};
 });
}
