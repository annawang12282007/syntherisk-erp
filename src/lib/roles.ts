import {richString} from './rich-text-schema';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {query,transaction} from './db';
import {DomainError,requireRole,type Context} from './context';
import {builtinRoles} from '../domain/permission-options';

export async function roleCatalog(ctx:Context){
 const [operator]=await query('SELECT name,name_zh,name_en FROM operator_configuration WHERE workspace_id=$1',[ctx.workspaceId]);
 const custom=await query<{code:string;name:string;description:string;active:boolean;version:number}>('SELECT code,name,description,active,version FROM workspace_roles WHERE workspace_id=$1 ORDER BY name',[ctx.workspaceId]);
 return [...builtinRoles.map(code=>({code,name:code==='operations'?String(operator?.name||'企业管理员'):code,name_zh:code==='operations'?String(operator?.name_zh||'企业管理员'):undefined,name_en:code==='operations'?String(operator?.name_en||'Organization Administrator'):undefined,description:'',active:true,version:0,builtin:true})),...custom.map(row=>({...row,builtin:false}))];
}
export async function validateRoles(workspaceId:string,roles:string[]){
 const custom=[...new Set(roles.filter(role=>!builtinRoles.includes(role)))];
 if(!roles.length||roles.length>30)throw new DomainError(400,'INVALID_ROLES');
 if(custom.length){const found=await query('SELECT code FROM workspace_roles WHERE workspace_id=$1 AND code=ANY($2::text[]) AND active',[workspaceId,custom]);if(found.length!==custom.length)throw new DomainError(400,'INVALID_ROLES');}
}
export async function saveRole(ctx:Context,input:unknown){
 requireRole(ctx,'admin');
 const value=z.object({code:z.string().regex(/^custom_[a-f0-9-]{36}$/).optional(),name:z.string().trim().min(1).max(100),description:richString(2000).default(''),active:z.boolean().default(true),version:z.number().int().nonnegative().default(0)}).parse(input);
 return transaction(async client=>{
  const code=value.code??`custom_${randomUUID()}`;
  if(value.code){
   const current=(await client.query('SELECT * FROM workspace_roles WHERE workspace_id=$1 AND code=$2 FOR UPDATE',[ctx.workspaceId,code])).rows[0];
   if(!current)throw new DomainError(404,'NOT_FOUND');if(current.version!==value.version)throw new DomainError(409,'VERSION_CONFLICT');
   if(!value.active&&(await client.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND status='active' AND $2=ANY(roles) UNION ALL SELECT 1 FROM invitations WHERE workspace_id=$1 AND accepted_at IS NULL AND expires_at>now() AND $2=ANY(roles) LIMIT 1",[ctx.workspaceId,code])).rowCount)throw new DomainError(409,'ROLE_IN_USE');
   await client.query('UPDATE workspace_roles SET name=$3,description=$4,active=$5,version=version+1,updated_by=$6,updated_at=now() WHERE workspace_id=$1 AND code=$2',[ctx.workspaceId,code,value.name,value.description,value.active,ctx.userId]);
  }else await client.query('INSERT INTO workspace_roles(workspace_id,code,name,description,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5)',[ctx.workspaceId,code,value.name,value.description,ctx.userId]);
  await client.query("INSERT INTO audit_log(workspace_id,actor_id,resource,action,after_data) VALUES($1,$2,'workspace_roles',$3,$4)",[ctx.workspaceId,ctx.userId,value.code?'update':'create',JSON.stringify({...value,code})]);
  return (await client.query('SELECT code,name,description,active,version FROM workspace_roles WHERE workspace_id=$1 AND code=$2',[ctx.workspaceId,code])).rows[0];
 });
}
