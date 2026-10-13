import {richString} from './rich-text-schema';
import {withoutMailLayout} from '../domain/retired-features';
import {z} from 'zod';
import {initialAdministrator} from './company-information';
import {query,transaction} from './db';
import {DomainError,type Context} from './context';
import {isExternal,permissionScope} from '../domain/core';
import type {PoolClient} from 'pg';
export function canCreateTeam(ctx:Context){const permission=permissionScope(ctx,'team_boards','create');return !isExternal(ctx)&&(permission?permission!=='none':ctx.roles.some(r=>['admin','operations'].includes(r)));}
export async function teamMembership(ctx:Context,id:string,client?:Pick<PoolClient,'query'>){
 const sql="SELECT tm.role,tm.can_post,t.version FROM company_team_members tm JOIN company_teams t ON t.id=tm.team_id JOIN memberships m ON m.workspace_id=tm.workspace_id AND m.user_id=tm.user_id WHERE tm.workspace_id=$1 AND tm.team_id=$2 AND tm.user_id=$3 AND m.status='active'";
 const rows=client?(await client.query(sql,[ctx.workspaceId,id,ctx.userId])).rows:await query(sql,[ctx.workspaceId,id,ctx.userId]);
 if(isExternal(ctx)||!rows.length)throw new DomainError(404,'NOT_FOUND');return rows[0];
}
export async function listBoards(ctx:Context){
 if(isExternal(ctx))throw new DomainError(403,'FORBIDDEN');
 return {can_create:canCreateTeam(ctx),teams:(await query("SELECT t.*,m.role,m.can_post FROM company_teams t JOIN company_team_members m ON m.team_id=t.id WHERE t.workspace_id=$1 AND m.user_id=$2 ORDER BY t.name",[ctx.workspaceId,ctx.userId])).map(withoutMailLayout)};
}
export async function readBoard(ctx:Context,id:string){
 const member=await teamMembership(ctx,z.uuid().parse(id));
 const [team]=await query('SELECT * FROM company_teams WHERE id=$1 AND workspace_id=$2',[id,ctx.workspaceId]);
 const members=await query("SELECT tm.user_id,u.name,tm.role,tm.can_post FROM company_team_members tm JOIN \"user\" u ON u.id=tm.user_id JOIN memberships m ON m.workspace_id=tm.workspace_id AND m.user_id=tm.user_id WHERE tm.team_id=$1 AND tm.workspace_id=$2 AND m.status='active' ORDER BY u.name",[id,ctx.workspaceId]);
 const posts=await query('SELECT p.*,u.name author_name FROM team_board_posts p JOIN "user" u ON u.id=p.author_id WHERE p.team_id=$1 AND p.workspace_id=$2 AND p.deleted_at IS NULL ORDER BY p.pinned DESC,p.updated_at DESC LIMIT 200',[id,ctx.workspaceId]);
 const deleted_posts=await query('SELECT p.*,u.name author_name FROM team_board_posts p JOIN "user" u ON u.id=p.author_id WHERE p.team_id=$1 AND p.workspace_id=$2 AND p.deleted_at IS NOT NULL AND ($3 OR p.author_id=$4) ORDER BY p.deleted_at DESC LIMIT 200',[id,ctx.workspaceId,member.role==='manager',ctx.userId]);
 return {...withoutMailLayout(team),...member,members,posts,deleted_posts};
}
const memberInput=z.object({user_id:z.string().min(1).max(200),role:z.enum(['manager','member']),can_post:z.boolean()}).strict();
export async function saveBoard(ctx:Context,input:unknown){
 const d=z.object({id:z.uuid().optional(),version:z.number().int().min(1).optional(),name:z.string().trim().min(1).max(120),description:richString(4000).default(''),members:z.array(memberInput).min(1).max(200)}).strict().parse(input&&typeof input==='object'?withoutMailLayout(input as Record<string,unknown>):input);
 if(!d.id&&!canCreateTeam(ctx))throw new DomainError(403,'FORBIDDEN');
 const root=await initialAdministrator(ctx);
 if(new Set(d.members.map(m=>m.user_id)).size!==d.members.length||!d.members.some(m=>m.role==='manager'&&(root&&!d.id||m.user_id===ctx.userId)))throw new DomainError(422,'TEAM_MANAGER_REQUIRED');
 const id=await transaction(async c=>{
  if(d.id){await teamMembership(ctx,d.id,c);const locked=(await c.query('SELECT version FROM company_teams WHERE id=$1 FOR UPDATE',[d.id])).rows[0];const existing=await teamMembership(ctx,d.id,c);if(existing.role!=='manager')throw new DomainError(403,'FORBIDDEN');if(locked.version!==d.version)throw new DomainError(409,'VERSION_CONFLICT');}
  const ids=d.members.map(m=>m.user_id);const valid=await c.query("SELECT m.user_id FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.user_id=ANY($2::text[]) AND m.status='active' AND NOT(m.roles <@ ARRAY['external']::text[]) AND m.user_id IS DISTINCT FROM w.initial_admin_user_id FOR SHARE OF m",[ctx.workspaceId,ids]);
  const validIds=new Set(valid.rows.map(r=>r.user_id));if(ids.some(id=>!validIds.has(id)))throw new DomainError(422,'invalid_member');
  let id=d.id;if(id)await c.query('UPDATE company_teams SET name=$2,description=$3,version=version+1,updated_at=now() WHERE id=$1',[id,d.name,d.description]);else id=(await c.query('INSERT INTO company_teams(workspace_id,name,description,created_by) VALUES($1,$2,$3,$4) RETURNING id',[ctx.workspaceId,d.name,d.description,ctx.userId])).rows[0].id as string;
  await c.query('DELETE FROM company_team_members WHERE team_id=$1',[id]);for(const m of d.members)await c.query('INSERT INTO company_team_members(workspace_id,team_id,user_id,role,can_post) VALUES($1,$2,$3,$4,$5)',[ctx.workspaceId,id,m.user_id,m.role,m.can_post]);
  await c.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,'team_boards',$3,'membership_update',$4)",[ctx.workspaceId,ctx.userId,id,JSON.stringify({member_count:ids.length})]);return id;
 });if(root&&!d.members.some(m=>m.user_id===ctx.userId))return {id,provisioned:true};return readBoard(ctx,id);
}
export const boardPostInput=z.object({team_id:z.uuid(),id:z.uuid().optional(),version:z.number().int().min(1).optional(),title:z.string().trim().min(1).max(200),body:richString(20000,1),pinned:z.boolean().optional()}).strict();
export async function saveBoardPostInTransaction(c:Pick<PoolClient,'query'>,ctx:Context,input:unknown){
 const d=boardPostInput.parse(input);
  await c.query('SELECT id FROM company_teams WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[d.team_id,ctx.workspaceId]);
  const member=await teamMembership(ctx,d.team_id,c);if(!member.can_post&&member.role!=='manager')throw new DomainError(403,'TEAM_POST_FORBIDDEN');
  let row,before=null;if(d.id){const old=(await c.query('SELECT * FROM team_board_posts WHERE id=$1 AND team_id=$2 AND workspace_id=$3 FOR UPDATE',[d.id,d.team_id,ctx.workspaceId])).rows[0];if(!old||old.deleted_at)throw new DomainError(404,'NOT_FOUND');if(old.author_id!==ctx.userId&&member.role!=='manager')throw new DomainError(403,'FORBIDDEN');if(old.version!==d.version)throw new DomainError(409,'VERSION_CONFLICT');before={title:old.title,body:old.body,team_id:old.team_id};if(d.pinned!==undefined&&d.pinned!==old.pinned&&member.role!=='manager')throw new DomainError(403,'FORBIDDEN');row=(await c.query('UPDATE team_board_posts SET title=$2,body=$3,pinned=COALESCE($4,pinned),version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[d.id,d.title,d.body,d.pinned??null])).rows[0];}
  else {if(d.pinned&&member.role!=='manager')throw new DomainError(403,'FORBIDDEN');row=(await c.query('INSERT INTO team_board_posts(workspace_id,team_id,author_id,title,body,pinned) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[ctx.workspaceId,d.team_id,ctx.userId,d.title,d.body,d.pinned??false])).rows[0];}
  await c.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,before_data,after_data) VALUES($1,$2,'team_board_posts',$3,$4,$5,$6)",[ctx.workspaceId,ctx.userId,row.id,d.id?'update':'create',before?JSON.stringify(before):null,JSON.stringify({title:row.title,body:row.body,team_id:row.team_id})]);
  await c.query('INSERT INTO team_board_versions(post_id,version,actor_id,snapshot) VALUES($1,$2,$3,$4)',[row.id,row.version,ctx.userId,JSON.stringify(row)]);
 return row;
}
export async function saveBoardPost(ctx:Context,input:unknown){const d=boardPostInput.parse(input);await transaction(c=>saveBoardPostInTransaction(c,ctx,d));return readBoard(ctx,d.team_id);}
export async function changeBoardPostDeletion(ctx:Context,input:unknown,restore=false){
 const d=z.object({team_id:z.uuid(),id:z.uuid(),version:z.number().int().positive()}).strict().parse(input);
 await transaction(async c=>{
  await c.query('SELECT id FROM company_teams WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[d.team_id,ctx.workspaceId]);
  const member=await teamMembership(ctx,d.team_id,c);
  const old=(await c.query('SELECT * FROM team_board_posts WHERE id=$1 AND team_id=$2 AND workspace_id=$3 FOR UPDATE',[d.id,d.team_id,ctx.workspaceId])).rows[0];
  if(!old)throw new DomainError(404,'NOT_FOUND');
  if(member.role!=='manager'&&old.author_id!==ctx.userId)throw new DomainError(403,'FORBIDDEN');
  if(old.version!==d.version||Boolean(old.deleted_at)!==restore)throw new DomainError(409,'VERSION_CONFLICT');
  const row=(await c.query('UPDATE team_board_posts SET deleted_at=$2,pinned=CASE WHEN $2::timestamptz IS NULL THEN pinned ELSE false END,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[d.id,restore?null:new Date()])).rows[0];
  const action=restore?'restore':'delete';
  await c.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,before_data,after_data) VALUES($1,$2,'team_board_posts',$3,$4,$5,$6)",[ctx.workspaceId,ctx.userId,row.id,action,JSON.stringify({team_id:old.team_id,title:old.title,deleted_at:old.deleted_at}),JSON.stringify({team_id:row.team_id,title:row.title,deleted_at:row.deleted_at})]);
  await c.query('INSERT INTO team_board_versions(post_id,version,actor_id,snapshot) VALUES($1,$2,$3,$4)',[row.id,row.version,ctx.userId,JSON.stringify(row)]);
 });
 return readBoard(ctx,d.team_id);
}
export async function boardHistory(ctx:Context,teamId:string,postId:string){await teamMembership(ctx,z.uuid().parse(teamId));return query('SELECT v.version,v.snapshot,v.created_at,u.name actor_name FROM team_board_versions v JOIN team_board_posts p ON p.id=v.post_id JOIN "user" u ON u.id=v.actor_id WHERE p.workspace_id=$1 AND p.team_id=$2 AND p.id=$3 ORDER BY v.version DESC',[ctx.workspaceId,teamId,z.uuid().parse(postId)]);}

export async function readBoardForPost(ctx:Context,postId:string){
 const [post]=await query('SELECT p.*,u.name author_name FROM team_board_posts p JOIN "user" u ON u.id=p.author_id WHERE p.id=$1 AND p.workspace_id=$2 AND p.deleted_at IS NULL',[z.uuid().parse(postId),ctx.workspaceId]);
 if(!post)throw new DomainError(404,'NOT_FOUND');const board=await readBoard(ctx,String(post.team_id));
 if(!board.posts.some((p:{id:unknown})=>p.id===post.id))board.posts.push(post);return board;
}
