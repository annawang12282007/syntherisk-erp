import {z} from 'zod';
import {pool,query,transaction} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {resources} from './registry';
import {assertAccess,assertOperation,audit,checkVersion,elevated,fail,find,isExternal,scope,str,type Client,type Row} from './core';

export function organizationSupported(resource:string):boolean {
 const definition=resources[resource];return Boolean(definition&&!definition.readonly&&!definition.parent&&!definition.hidden&&definition.module!=='settings');
}
function supported(resource:string){if(!organizationSupported(resource))fail('organization_resource_unsupported',400);}
function canManage(ctx:Context,row:Row){return !row.builtin_key&&!isExternal(ctx)&&(row.created_by===ctx.userId||elevated(ctx));}
const categoryName=z.string().trim().min(1).max(100).refine(value=>!/[\u0000-\u001f\u007f]/.test(value));
const recordInput=z.object({resource:z.string(),id:z.uuid(),version:z.number().int().positive(),category_ids:z.array(z.uuid()).max(100),project_ids:z.array(z.uuid()).max(100)});
const sorted=(ids:unknown[])=>[...new Set(ids.map(str))].sort();

/** Immutable relationship identity only; project names follow their own record permissions. */
export async function recordOrganizationSnapshot(client:Client,ctx:Context,resource:string,id:string){
 const categories=await client.query('SELECT category_id FROM record_category_links WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4 ORDER BY category_id',[ctx.workspaceId,ctx.companyId,resource,id]);
 const projects=await client.query('SELECT project_id FROM record_project_links WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4 ORDER BY project_id',[ctx.workspaceId,ctx.companyId,resource,id]);
 return {category_ids:categories.rows.map(row=>str(row.category_id)),project_ids:projects.rows.map(row=>str(row.project_id))};
}
type CategoryRow={id:string;name:string;builtin_key:string|null;created_by:string|null;version:number;archived:boolean};
async function catalog(ctx:Context){return(await query<CategoryRow>('SELECT id,name,builtin_key,created_by,version,archived FROM record_categories WHERE workspace_id=$1 AND NOT archived ORDER BY builtin_key NULLS LAST,lower(name),id',[ctx.workspaceId])).map(row=>({...row,can_manage:canManage(ctx,row)}));}
async function readableProjects(client:Client,ctx:Context,ids:string[]){
 if(!ids.length)return[];const access=scope(ctx,'projects','p');
 return(await client.query(`SELECT p.id,p.name,p.archived FROM projects p WHERE ${access.sql} AND p.id=ANY($4::uuid[]) ORDER BY lower(p.name),p.id`,[...access.values,ids])).rows as Row[];
}
const reader:Client=pool;
export async function getRecordOrganization(ctx:Context,resource?:string,id?:string){
 if(!resource&&!id)return {categories:await catalog(ctx)};
 if(!resource||!id)fail('organization_record_required',400);supported(resource);
 const row=await assertAccess(ctx,resource,id,'read');const state=await recordOrganizationSnapshot(reader,ctx,resource,id);
 const selected=await query('SELECT id,name,builtin_key,archived FROM record_categories WHERE workspace_id=$1 AND id=ANY($2::uuid[]) ORDER BY builtin_key NULLS LAST,lower(name),id',[ctx.workspaceId,state.category_ids]);
 const primaryId=row.project_id?str(row.project_id):null;
 const projects=await readableProjects(reader,ctx,[...state.project_ids,...(primaryId?[primaryId]:[])]),visible=new Set(projects.map(project=>str(project.id)));
 let canEdit=true;try{await assertAccess(ctx,resource,id,'write');await assertOperation(reader,ctx,resource,'edit',row);}catch(error){if(error instanceof DomainError)canEdit=false;else throw error;}
 return {categories:await catalog(ctx),resource,record_id:id,version:row.version,category_ids:state.category_ids,selected_categories:selected,projects:projects.filter(project=>state.project_ids.includes(str(project.id))&&project.id!==primaryId),project_ids:state.project_ids.filter(id=>visible.has(id)&&id!==primaryId),primary_project:projects.find(project=>project.id===primaryId)??null,primary_project_protected:Boolean(primaryId&&!visible.has(primaryId)),protected_project_count:[...new Set([...state.project_ids,...(primaryId?[primaryId]:[])])].filter(id=>!visible.has(id)).length,can_edit:canEdit};
}

export async function updateRecordOrganization(ctx:Context,data:Row){
 if(data.action==='category_create'){
  if(isExternal(ctx))fail('forbidden',403);const name=categoryName.parse(data.name);
  return transaction(async client=>{const row=(await client.query('INSERT INTO record_categories(workspace_id,name,created_by,updated_by) VALUES($1,$2,$3,$3) RETURNING id,name,builtin_key,created_by,version,archived',[ctx.workspaceId,name,ctx.userId])).rows[0] as Row;await audit(client,ctx,'record_categories',str(row.id),'create',null,row);return {...row,can_manage:true};});
 }
 if(data.action==='category_rename'||data.action==='category_archive'){
  const input=z.object({id:z.uuid(),version:z.number().int().positive()}).parse(data);
  return transaction(async client=>{const before=(await client.query('SELECT id,name,builtin_key,created_by,version,archived FROM record_categories WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[ctx.workspaceId,input.id])).rows[0] as Row|undefined;if(!before)fail('category_not_found',404);if(before.builtin_key)fail('builtin_category_immutable',403);if(!canManage(ctx,before))fail('forbidden',403);checkVersion(before,input);
   const after=(await client.query('UPDATE record_categories SET name=$1,archived=$2,updated_by=$3,updated_at=now(),version=version+1 WHERE workspace_id=$4 AND id=$5 RETURNING id,name,created_by,version,archived',[data.action==='category_rename'?categoryName.parse(data.name):before.name,data.action==='category_archive'?true:before.archived,ctx.userId,ctx.workspaceId,input.id])).rows[0] as Row;await audit(client,ctx,'record_categories',input.id,data.action==='category_rename'?'update':'archive',before,after);return {...after,can_manage:true};
  });
 }
 if(data.action!=='replace')fail('invalid_action',400);
 const input=recordInput.parse(data);supported(input.resource);
 await transaction(async client=>{
  const row=await find(client,ctx,input.resource,input.id,true,true);await assertOperation(client,ctx,input.resource,'edit',row);checkVersion(row,input);
  const before=await recordOrganizationSnapshot(client,ctx,input.resource,input.id),categoryIds=sorted(input.category_ids),requestedProjects=sorted(input.project_ids),primaryId=row.project_id?str(row.project_id):null;
  const categories=(await client.query('SELECT id,archived FROM record_categories WHERE workspace_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE',[ctx.workspaceId,categoryIds])).rows as Row[];
  if(categories.length!==categoryIds.length||categories.some(category=>category.archived&&!before.category_ids.includes(str(category.id))))fail('category_unavailable',409);
  const visibleBefore=await readableProjects(client,ctx,before.project_ids),visibleIds=new Set(visibleBefore.map(project=>str(project.id))),protectedIds=before.project_ids.filter(id=>!visibleIds.has(id));
  for(const projectId of requestedProjects){const project=await find(client,ctx,'projects',projectId);if(project.archived&&!before.project_ids.includes(projectId))fail('project_unavailable',409);if(input.resource==='projects'&&projectId===input.id)fail('project_self_link',400);}
  const projectIds=sorted([...protectedIds,...requestedProjects]).filter(id=>id!==primaryId);
  if(JSON.stringify(before.category_ids)===JSON.stringify(categoryIds)&&JSON.stringify(before.project_ids)===JSON.stringify(projectIds))return;
  await client.query('DELETE FROM record_category_links WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4',[ctx.workspaceId,ctx.companyId,input.resource,input.id]);
  if(categoryIds.length)await client.query('INSERT INTO record_category_links(workspace_id,company_id,resource,record_id,category_id,created_by) SELECT $1,$2,$3,$4,id,$6 FROM unnest($5::uuid[]) AS id',[ctx.workspaceId,ctx.companyId,input.resource,input.id,categoryIds,ctx.userId]);
  await client.query('DELETE FROM record_project_links WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4',[ctx.workspaceId,ctx.companyId,input.resource,input.id]);
  if(projectIds.length)await client.query('INSERT INTO record_project_links(workspace_id,company_id,resource,record_id,project_id,created_by) SELECT $1,$2,$3,$4,id,$6 FROM unnest($5::uuid[]) AS id',[ctx.workspaceId,ctx.companyId,input.resource,input.id,projectIds,ctx.userId]);
  const after=(await client.query(`UPDATE ${input.resource} SET version=version+1,updated_by=$1,updated_at=now() WHERE workspace_id=$2 AND company_id=$3 AND id=$4 RETURNING version`,[ctx.userId,ctx.workspaceId,ctx.companyId,input.id])).rows[0] as Row;
  await audit(client,ctx,input.resource,input.id,'organization_links',{...before,version:row.version},{category_ids:categoryIds,project_ids:projectIds,version:after.version});
 });
 return getRecordOrganization(ctx,input.resource,input.id);
}
