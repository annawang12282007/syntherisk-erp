import type {Context} from '../lib/context';
import type {QueryResultRow} from 'pg';
import {transaction} from '../lib/db';
import {resources} from './registry';
import {scope,operationAccess} from './core';
/** Shared projection for authorized record history and administrator audit views. */
const safeSnapshot=(column:'before_data'|'after_data')=>`CASE WHEN jsonb_typeof(a.${column})='object' THEN a.${column}-ARRAY['submitted_snapshot','target_snapshot','snapshot']::text[] ELSE NULL END`;
export const auditHistoryProjection = `a.id,a.resource,a.record_id,a.action,
  ${safeSnapshot('before_data')} AS before_data,
  ${safeSnapshot('after_data')} AS after_data,
  ${safeSnapshot('after_data')} AS details,a.created_at,
  a.actor_id,u.name AS actor_name,u.name AS actor,
  COALESCE(a.actor_roles,to_jsonb(m.roles),'[]'::jsonb) AS actor_roles,
  CASE WHEN a.actor_id IS NULL THEN 'system'
       WHEN a.actor_roles IS NOT NULL THEN 'event'
       WHEN m.roles IS NOT NULL THEN 'current'
       ELSE 'unknown' END AS actor_role_basis`;
export const auditHistoryJoins = `LEFT JOIN "user" u ON u.id=a.actor_id
  LEFT JOIN memberships m ON m.workspace_id=a.workspace_id AND m.user_id=a.actor_id`;

/** Administrative history does not bypass the current visibility of a business subject. */
export async function visibleAuditHistory(ctx:Context,resource:string|null,page=1){
 return transaction(async client=>{
 // Authorization and returned snapshots must describe the same database state.
 await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
 await client.query('SET LOCAL jit = off');
 const query=async<T extends QueryResultRow=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<T[]> => (await client.query<T>(sql,values)).rows;
 const integrationRecords:Record<string,string>={campaign_drafts_prepared:'campaigns',message_saved:'messages',message_reviewed:'messages',drive_file_linked:'documents'};
 type Candidate={id:string;resource:string;record_id:string|null;action:string;grant_resource:string|null;cursor_created_at:string};
 const batchSize=200,visibleIds:string[]=[];
 let skip=(Math.max(1,Number.isSafeInteger(page)?page:1)-1)*100,cursor:{time:string;id:string}|undefined;
 const subjectOf=(row:Candidate):string|null=>{
  if(row.resource==='team_board_posts')return row.resource;
  if(Object.hasOwn(resources,row.resource))return row.resource;
  if(row.resource==='record_grants')return row.grant_resource&&Object.hasOwn(resources,row.grant_resource)?row.grant_resource:'__unknown__';
  if(row.resource==='integrations'&&Object.hasOwn(integrationRecords,row.action))return integrationRecords[row.action];
  return null;
 };
 // Expand the privacy graph only for resource types actually present in a small
 // candidate batch. Combining every registry scope into one OR statement made
 // PostgreSQL allocate gigabytes while planning/compiling an audit-page read.
 // Apply the page limit after authorization, preserving hidden-record behavior.
 while(visibleIds.length<100){
  const candidates=await query<Candidate>(`SELECT a.id,a.resource,a.record_id,a.action,
    COALESCE(a.after_data->>'resource',a.before_data->>'resource') AS grant_resource,
    a.created_at::text AS cursor_created_at FROM audit_log a
    WHERE a.workspace_id=$1 AND ($2::text IS NULL OR a.resource=$2)
    ${cursor?'AND (a.created_at,a.id)<($3::timestamptz,$4::uuid)':''}
    ORDER BY a.created_at DESC,a.id DESC LIMIT ${batchSize}`,[ctx.workspaceId,resource,...(cursor?[cursor.time,cursor.id]:[])]);
  if(!candidates.length)break;
  const groups=new Map<string,Set<string>>(),authorized=new Set<string>();
  for(const row of candidates){const name=subjectOf(row);if(name&&name!=='__unknown__'&&row.record_id&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.record_id)){if(!groups.has(name))groups.set(name,new Set());groups.get(name)!.add(row.record_id);}}
  // Sequential queries also bound peak planner memory on small production hosts.
  for(const [name,ids]of groups){if(name==='team_board_posts'){if(!operationAccess(ctx,'team_boards','read'))continue;const rows=await query<{id:string}>("SELECT p.id FROM team_board_posts p JOIN company_team_members m ON m.team_id=p.team_id AND m.workspace_id=p.workspace_id JOIN memberships active ON active.workspace_id=m.workspace_id AND active.user_id=m.user_id WHERE p.workspace_id=$1 AND m.user_id=$2 AND active.status='active' AND NOT(active.roles <@ ARRAY['external']::text[]) AND p.id=ANY($3::uuid[])",[ctx.workspaceId,ctx.userId,[...ids]]);for(const row of rows)authorized.add(`${name}:${row.id}`);continue;}const access=scope(ctx,name,'subject'),rows=await query<{id:string}>(`SELECT subject.id FROM ${name} subject WHERE ${access.sql} AND subject.id=ANY($4::uuid[])`,[...access.values,[...ids]]);for(const row of rows)authorized.add(`${name}:${row.id}`);}
  for(const row of candidates){const name=subjectOf(row);if(name&&!authorized.has(`${name}:${row.record_id}`))continue;if(skip>0){skip--;continue;}visibleIds.push(row.id);if(visibleIds.length===100)break;}
  if(candidates.length<batchSize)break;
  const last=candidates[candidates.length-1];cursor={time:last.cursor_created_at,id:last.id};
 }
 if(!visibleIds.length)return [];
 return query(`SELECT ${auditHistoryProjection} FROM audit_log a ${auditHistoryJoins} WHERE a.workspace_id=$1 AND a.id=ANY($2::uuid[]) ORDER BY a.created_at DESC,a.id DESC`,[ctx.workspaceId,visibleIds]);
 });
}
