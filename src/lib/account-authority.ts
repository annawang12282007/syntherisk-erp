import type {PoolClient} from 'pg';
import {pool} from './db';
import {DomainError,type Context} from './context';

// Role combinations never outrank the initial administrator. Peer accounts are
// read-only; profile self-service is handled separately from account management.
export function accountRank(roles:string[]){
 if(roles.includes('operations'))return 4;
 if(roles.includes('admin'))return 3;
 if(roles.some(role=>!['member','external'].includes(role)))return 2;
 return roles.includes('member')?1:0;
}
export type AccountAuthority={userId:string;rootId:string|null;root:boolean;roles:string[];rank:number};
export async function accountAuthority(ctx:Context,client:Pick<PoolClient,'query'>=pool,lock=false):Promise<AccountAuthority>{
 const [workspace]=(await client.query(`SELECT initial_admin_user_id FROM workspaces WHERE id=$1${lock?' FOR UPDATE':''}`,[ctx.workspaceId])).rows;
 const [actor]=(await client.query("SELECT roles FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'",[ctx.workspaceId,ctx.userId])).rows;
 if(!actor)throw new DomainError(403,'FORBIDDEN');
 const rootId=workspace?.initial_admin_user_id??null;
 return {userId:ctx.userId,rootId,root:rootId===ctx.userId,roles:actor.roles,rank:rootId===ctx.userId?5:accountRank(actor.roles)};
}
export function canManageAccount(actor:AccountAuthority,targetId:string,targetRoles:string[]){
 return targetId!==actor.rootId&&targetId!==actor.userId&&actor.rank>=3&&actor.rank>accountRank(targetRoles);
}
export function assertAccountTarget(actor:AccountAuthority,targetId:string,targetRoles:string[],profile=false){
 if(targetId===actor.rootId&&!actor.root)throw new DomainError(404,'NOT_FOUND');
 if(profile&&targetId===actor.userId)return;
 if(actor.root&&targetId!==actor.rootId)return;
 if(targetId===actor.userId||actor.rank<=accountRank(targetRoles))throw new DomainError(403,'ACCOUNT_HIERARCHY_FORBIDDEN');
}
export function assertRoleAssignment(actor:AccountAuthority,roles:string[]){
 if(!actor.roles.includes('admin'))throw new DomainError(403,'FORBIDDEN');
 if(!actor.root&&(roles.includes('operations')||accountRank(roles)>=actor.rank))throw new DomainError(403,'ACCOUNT_HIERARCHY_FORBIDDEN');
}
