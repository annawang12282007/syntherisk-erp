import type {Context} from '../lib/context';
import {type Client,type Row,elevated,find,fail,str} from './core';
import {recordResponsibleSnapshot} from './responsibilities';
import {responsiblePredicate} from './responsibility-scope';
import {supportsPrivacy} from './privacy-resources';
export function recordVisibilityPredicate(ctx:Context,resource:string,alias:string,grant:string){
 if(!supportsPrivacy(resource))return 'true';
 const relation=resource==='tasks'?['task_collaborators','task_id']:resource==='engagements'?['engagement_collaborators','engagement_id']:resource==='projects'?['project_members','project_id']:resource==='events'?['event_participants','event_id']:undefined;
 const collaborator=relation?` OR EXISTS(SELECT 1 FROM ${relation[0]} visible_collaborator WHERE visible_collaborator.workspace_id=${alias}.workspace_id AND visible_collaborator.company_id=${alias}.company_id AND visible_collaborator.${relation[1]}=${alias}.id AND visible_collaborator.user_id=$3 AND NOT visible_collaborator.archived)`:'';
 const selectedTeam=`(${alias}.visibility='selected_teams' AND EXISTS(SELECT 1 FROM company_team_members visible_team JOIN memberships active_member ON active_member.workspace_id=visible_team.workspace_id AND active_member.user_id=visible_team.user_id WHERE visible_team.workspace_id=${alias}.workspace_id AND visible_team.team_id=ANY(${alias}.viewer_team_ids) AND visible_team.user_id=$3 AND active_member.status='active' AND NOT(active_member.roles <@ ARRAY['external']::text[])))`;
 const managed=elevated(ctx)?'true':`(${alias}.visibility='team' OR ${selectedTeam}${resource==='tasks'?` OR (${alias}.completion_required AND $3=ANY(${alias}.completion_user_ids))`:''} OR ${responsiblePredicate(resource,alias)} OR (${alias}.visibility='restricted' AND $3=ANY(${alias}.viewer_user_ids))${collaborator} OR ${grant})`;
 return `(CASE WHEN ${alias}.is_private THEN ${alias}.created_by=$3 ELSE ${managed} END)`;
}
export async function prepareTaskVisibility(c:Client,ctx:Context,resource:string,data:Row,existing?:Row):Promise<Row>{
 if(!supportsPrivacy(resource))return data;const clean={...data},supplied=Object.hasOwn(data,'viewer_user_ids');delete clean.viewer_user_ids;let viewers:string[]|undefined;
 if(supplied){if(!Array.isArray(data.viewer_user_ids)||data.viewer_user_ids.length>200||data.viewer_user_ids.some(v=>typeof v!=='string'||!v))fail('invalid_record_viewers');viewers=[...new Set(data.viewer_user_ids as string[])].sort();}
 const prior=(existing?.viewer_user_ids as string[]|undefined)??[],visibility=Object.hasOwn(data,'visibility')?data.visibility:existing?.visibility??'team';
 if(!['team','restricted','selected_teams'].includes(str(visibility)))fail('invalid_record_visibility');
 const suppliedTeams=Object.hasOwn(data,'viewer_team_ids'),priorTeams=(existing?.viewer_team_ids as string[]|undefined)??[];let teams:string[]|undefined;delete clean.viewer_team_ids;
 if(suppliedTeams){if(!Array.isArray(data.viewer_team_ids)||data.viewer_team_ids.length>50||data.viewer_team_ids.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))fail('invalid_record_teams');teams=[...new Set((data.viewer_team_ids as string[]).map(id=>id.toLowerCase()))].sort();}
 if(!elevated(ctx)&&suppliedTeams&&JSON.stringify(teams)!==JSON.stringify([...priorTeams].sort()))fail('record_visibility_manager_required',403);
 if(!elevated(ctx)&&((existing?visibility!==existing.visibility:visibility!=='team')||supplied&&JSON.stringify(viewers)!==JSON.stringify([...prior].sort())))fail('record_visibility_manager_required',403);
 if(Object.hasOwn(data,'is_private')){if(typeof data.is_private!=='boolean')fail('invalid_boolean');if(existing&&data.is_private!==existing.is_private&&existing.created_by!==ctx.userId)fail('private_creator_required',403);}
 if(viewers){const added=viewers.filter(id=>!prior.includes(id));if(added.length){const members=(await c.query("SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::text[]) AND status='active' AND NOT(roles <@ ARRAY['external']::text[]) FOR SHARE",[ctx.workspaceId,added])).rows;if(members.length!==added.length)fail('invalid_record_viewers');}clean.viewer_user_ids=viewers;}
 if(teams){if(teams.length){const valid=(await c.query('SELECT id FROM company_teams WHERE workspace_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',[ctx.workspaceId,teams])).rows;if(valid.length!==teams.length)fail('invalid_record_teams');}clean.viewer_team_ids=teams;}
 if(visibility==='selected_teams'&&!(data.is_private??existing?.is_private??false)&&!(teams??priorTeams).length)fail('record_teams_required');
 if(!existing){clean.visibility=visibility;clean.is_private=data.is_private??false;}
 if(existing&&existing.visibility!=='team'&&!elevated(ctx)){
  if(Object.hasOwn(data,'owner_id')&&data.owner_id!==existing.owner_id)fail('record_audience_manager_required',403);
  if(Object.hasOwn(data,'responsible_user_ids')){const current=await recordResponsibleSnapshot(c,ctx,resource,str(existing.id));if(!Array.isArray(data.responsible_user_ids)||JSON.stringify([...new Set(data.responsible_user_ids)].sort())!==JSON.stringify(current))fail('record_audience_manager_required',403);}
 }
 return clean;
}
export async function enrichVisibility(c:Client,ctx:Context,resource:string,rows:Row[]){
 for(const row of rows){delete row.submitted_snapshot;delete row.target_snapshot;}
 if(!supportsPrivacy(resource))return rows;const ids=[...new Set(rows.flatMap(row=>(row.viewer_user_ids as string[]|undefined)??[]))];
 const members=ids.length?(await c.query('SELECT u.id,u.name,(m.status=\'active\') AS active FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND u.id=ANY($2::text[])',[ctx.workspaceId,ids])).rows:[];const byId=new Map(members.map(row=>[row.id,row]));
 const teamIds=[...new Set(rows.flatMap(row=>(row.viewer_team_ids as string[]|undefined)??[]))],teams=teamIds.length?(await c.query('SELECT id,name FROM company_teams WHERE workspace_id=$1 AND id=ANY($2::uuid[])',[ctx.workspaceId,teamIds])).rows:[],teamsById=new Map(teams.map(row=>[row.id,row]));
 for(const row of rows){row.can_manage_visibility=elevated(ctx);row.can_choose_private=row.created_by===ctx.userId;row.viewer_users=((row.viewer_user_ids as string[]|undefined)??[]).map(id=>byId.get(id)).filter(Boolean);row.viewer_teams=((row.viewer_team_ids as string[]|undefined)??[]).map(id=>teamsById.get(id)).filter(Boolean);}return rows;
}
export async function assertRecordAudienceChange(c:Client,ctx:Context,resource:string,recordId:unknown){if(!recordId||!supportsPrivacy(resource))return;const row=await find(c,ctx,resource,recordId);if(row.is_private)fail('private_record_not_shareable',403);if(row.visibility!=='team'&&!elevated(ctx))fail('record_audience_manager_required',403);}
export async function assertRecordRecipient(c:Client,ctx:Context,resource:string,recordId:unknown,userId:unknown,requireRead=false){
 if(!recordId||!userId||!supportsPrivacy(resource)&&!requireRead)return;const row=await find(c,ctx,resource,recordId);if(row.is_private)fail('private_record_not_shareable',403);if((!supportsPrivacy(resource)||row.visibility==='team')&&!requireRead)return;
 const member=(await c.query("SELECT roles FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'",[ctx.workspaceId,userId])).rows[0];if(!member)fail('invalid_member');const policies=(await c.query('SELECT resource,operation,scope FROM effective_permissions($1,$3,$2::text[])',[ctx.workspaceId,member.roles,userId])).rows;
 try{await find(c,{...ctx,userId:str(userId),roles:member.roles,permissions:policies as NonNullable<Context['permissions']>},resource,recordId);}catch{fail('record_recipient_access_required',403);}
}
export const assertTaskAudienceChange=(c:Client,ctx:Context,id:unknown)=>assertRecordAudienceChange(c,ctx,'tasks',id);
export const assertTaskRecipient=(c:Client,ctx:Context,id:unknown,user:unknown)=>assertRecordRecipient(c,ctx,'tasks',id,user);
