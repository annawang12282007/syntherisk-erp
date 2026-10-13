import {pool} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {teamMembership,boardPostInput} from '../lib/team-boards';
import {operationAccess,str,type Client,type Row} from '../domain/core';
export function isTeamResource(resource:string){return resource==='company_teams'||resource==='team_board_posts';}
export async function readAssistantTeam(ctx:Context,resource:string,id:string,c:Client=pool,write=false,lock=false):Promise<Row>{
 if(!operationAccess(ctx,'team_boards','read')||!operationAccess(ctx,'team_boards','export'))throw new DomainError(403,'FORBIDDEN');
 const row=(await c.query(`SELECT * FROM ${resource==='company_teams'?'company_teams':'team_board_posts'} WHERE workspace_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[ctx.workspaceId,id])).rows[0];if(!row||resource==='team_board_posts'&&row.deleted_at)throw new DomainError(404,'NOT_FOUND');
 const member=await teamMembership(ctx,resource==='company_teams'?id:row.team_id,c);
 if(write&&(resource==='company_teams'||!operationAccess(ctx,'team_boards','edit')||member.role!=='manager'&&(!member.can_post||row.author_id!==ctx.userId)))throw new DomainError(403,'FORBIDDEN');
 return {...row,can_post:member.can_post,team_role:member.role};
}
export async function listAssistantTeams(ctx:Context,resource:string,filter:Row){
 if(!operationAccess(ctx,'team_boards','read')||!operationAccess(ctx,'team_boards','export'))throw new DomainError(403,'FORBIDDEN');
 const teams=(await pool.query("SELECT t.id FROM company_teams t JOIN company_team_members tm ON tm.team_id=t.id AND tm.workspace_id=t.workspace_id JOIN memberships m ON m.workspace_id=tm.workspace_id AND m.user_id=tm.user_id WHERE t.workspace_id=$1 AND tm.user_id=$2 AND m.status='active' AND NOT(m.roles <@ ARRAY['external']::text[]) AND ($3::uuid IS NULL OR t.id=$3)",[ctx.workspaceId,ctx.userId,filter.team_id||null])).rows;
 const rows:Row[]=[];for(const team of teams){if(resource==='company_teams')rows.push(await readAssistantTeam(ctx,resource,team.id));else rows.push(...(await pool.query('SELECT * FROM team_board_posts WHERE workspace_id=$1 AND team_id=$2 AND deleted_at IS NULL AND (title ILIKE $3 OR body ILIKE $3) ORDER BY updated_at DESC LIMIT 31',[ctx.workspaceId,team.id,`%${str(filter.q)}%`])).rows);}
 const matches=resource==='company_teams'?rows.filter(row=>str(row.name).toLowerCase().includes(str(filter.q).toLowerCase())):rows;
 return {rows:matches.slice(0,30),total:matches.length};
}
export async function validateTeamPost(ctx:Context,data:Row,c:Client=pool,old?:Row){
 const base=old?Object.fromEntries(['id','version','team_id','title','body','pinned'].map(key=>[key,old[key]])):{};const clean=boardPostInput.parse({...base,...data});
 await readAssistantTeam(ctx,'company_teams',clean.team_id,c);
 const member=await teamMembership(ctx,clean.team_id,c);
 if(!operationAccess(ctx,'team_boards',old?'edit':'create')||!member.can_post&&member.role!=='manager'||clean.pinned!==undefined&&clean.pinned!==Boolean(old?.pinned)&&member.role!=='manager')throw new DomainError(403,'TEAM_POST_FORBIDDEN');
 if(old&&old.team_id!==clean.team_id)throw new DomainError(422,'ASSISTANT_INVALID_PLAN');
 return clean;
}
