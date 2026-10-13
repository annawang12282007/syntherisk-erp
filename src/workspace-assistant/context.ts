import {pool} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import type {Client} from '../domain/core';

// Internal work does not depend on a connected Google account or Google grants.
export async function liveContext(row:{workspace_id:string;user_id:string},companyId:string,c:Client=pool):Promise<Context>{
 const member=(await c.query("SELECT m.roles,c.id company_id FROM memberships m JOIN companies c ON c.workspace_id=m.workspace_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND c.id=$3",[row.workspace_id,row.user_id,companyId])).rows[0];
 if(!member?.roles.length||member.roles.every((r:string)=>r==='external'))throw new DomainError(403,'FORBIDDEN');
 const permissions=member.roles.includes('admin')?[]:(await c.query('SELECT resource,operation,scope FROM effective_permissions($1,$2,$3::text[])',[row.workspace_id,row.user_id,member.roles])).rows;
 return {workspaceId:row.workspace_id,userId:row.user_id,companyId:member.company_id,roles:member.roles,permissions};
}
