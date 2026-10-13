import {z} from 'zod';
import type {Context} from '../lib/context';
import {type Client,type Row,audit,def,fail,isExternal,notify,str} from './core';

const idsInput=z.array(z.string().min(1).max(200)).max(100);
const unique=(values:string[])=>[...new Set(values)];
export const hasResponsibilityField=(resource:string)=>def(resource).fields.some(field=>field.key==='owner_id');
export async function recordResponsibleSnapshot(client:Client,ctx:Context,resource:string,id:string):Promise<string[]>{
 if(!hasResponsibilityField(resource))return[];
 const primary=(await client.query(`SELECT owner_id FROM ${def(resource).key} WHERE workspace_id=$1 AND company_id=$2 AND id=$3`,[ctx.workspaceId,ctx.companyId,id])).rows[0];
 const extra=(await client.query('SELECT user_id FROM record_responsibles WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4',[ctx.workspaceId,ctx.companyId,resource,id])).rows;
 return unique([...(primary?.owner_id?[str(primary.owner_id)]:[]),...extra.map(row=>str(row.user_id))]).sort();
}
export async function isRecordResponsible(client:Client,ctx:Context,resource:string,id:string,userId:string){return(await recordResponsibleSnapshot(client,ctx,resource,id)).includes(userId);}

/** Validate the full selected set before parent writes. Legacy owner_id requests retain extras. */
export async function prepareResponsibilities(client:Client,ctx:Context,resource:string,data:Row,existing?:Row){
 const explicit=Object.hasOwn(data,'responsible_user_ids');const clean={...data};delete clean.responsible_user_ids;
 if(!explicit&&!Object.hasOwn(data,'owner_id'))return {data:clean,ids:undefined as string[]|undefined};
 if(!hasResponsibilityField(resource)||def(resource).readonly)fail('responsibility_not_supported',400);
 const previous=existing?await recordResponsibleSnapshot(client,ctx,resource,str(existing.id)):[];
 let ids=explicit?unique(idsInput.parse(data.responsible_user_ids)):undefined;
 if(ids){
  let primary:unknown;
  if(Object.hasOwn(data,'owner_id')){primary=data.owner_id;if(primary&&!ids.includes(str(primary)))fail('responsibility_primary_mismatch');if(!primary&&ids.length)primary=ids[0];}
  else primary=existing?.owner_id&&ids.includes(str(existing.owner_id))?existing.owner_id:ids[0]??null;
  if(resource==='expense_claims'){const claimant=existing?.owner_id??ctx.userId;if(!ids.includes(str(claimant))||Object.hasOwn(data,'owner_id')&&data.owner_id!==claimant)fail('immutable_claimant',409);primary=claimant;}
  clean.owner_id=primary??null;
 }else if(existing){
  if(resource==='expense_claims'&&data.owner_id!==existing.owner_id)fail('immutable_claimant',409);
  const rows=(await client.query('SELECT user_id FROM record_responsibles WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4',[ctx.workspaceId,ctx.companyId,resource,existing.id])).rows;
  ids=unique([...(data.owner_id?[str(data.owner_id)]:[]),...rows.map(row=>str(row.user_id))]);
 }
 if(isExternal(ctx)&&(!existing||clean.owner_id!==existing.owner_id||JSON.stringify([...(ids??previous)].sort())!==JSON.stringify(previous)))fail('responsibility_assignment_forbidden',403);
 const added=(ids??[]).filter(id=>!previous.includes(id));
 if(added.length){const active=(await client.query("SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::text[]) AND status='active' AND user_id IS DISTINCT FROM (SELECT initial_admin_user_id FROM workspaces WHERE id=$1) ORDER BY user_id FOR SHARE",[ctx.workspaceId,added])).rows;if(active.length!==added.length)fail('invalid_responsible_member');}
 return {data:clean,ids};
}
export async function saveResponsibilities(client:Client,ctx:Context,resource:string,row:Row,ids:string[]|undefined,before:string[]=[]) {
 if(ids===undefined)return;
 const all=unique([...(row.owner_id?[str(row.owner_id)]:[]),...ids]),extras=all.filter(id=>id!==row.owner_id);
 if(JSON.stringify([...before].sort())===JSON.stringify([...all].sort()))return;
 await client.query('DELETE FROM record_responsibles WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4',[ctx.workspaceId,ctx.companyId,resource,row.id]);
 if(extras.length)await client.query('INSERT INTO record_responsibles(workspace_id,company_id,resource,record_id,user_id,created_by) SELECT $1,$2,$3,$4,value,$6 FROM unnest($5::text[]) value',[ctx.workspaceId,ctx.companyId,resource,row.id,extras,ctx.userId]);
 if(JSON.stringify([...before].sort())!==JSON.stringify([...all].sort())){
  await audit(client,ctx,resource,str(row.id),'responsibility_update',{responsible_user_ids:before},{responsible_user_ids:all});
  if(resource==='tasks')for(const user of all)if(user!==ctx.userId&&!before.includes(user))await notify(client,ctx,user,'assigned',resource,row);
 }
}

/** One relationship query and one name query for the whole result page. No emails or roles. */
export async function enrichResponsibilities(client:Client,ctx:Context,resource:string,rows:Row[]):Promise<Row[]>{
 if(!rows.length||!hasResponsibilityField(resource))return rows;
 const extras=(await client.query('SELECT record_id,user_id FROM record_responsibles WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=ANY($4::uuid[]) ORDER BY user_id',[ctx.workspaceId,ctx.companyId,resource,unique(rows.map(row=>str(row.id)))])).rows;
 const byRecord=new Map<string,string[]>();for(const extra of extras){const id=str(extra.record_id);byRecord.set(id,[...(byRecord.get(id)??[]),str(extra.user_id)]);}
 const all=unique(rows.flatMap(row=>[...(row.owner_id?[str(row.owner_id)]:[]),...(byRecord.get(str(row.id))??[])]));
 const members=all.length?(await client.query('SELECT u.id,u.name,m.status FROM "user" u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=$1 AND u.id=ANY($2::text[])',[ctx.workspaceId,all])).rows:[];
 const names=new Map(members.map(row=>[str(row.id),row]));
 return rows.map(row=>{const ids=unique([...(row.owner_id?[str(row.owner_id)]:[]),...(byRecord.get(str(row.id))??[])]);return {...row,responsible_user_ids:ids,responsible_users:ids.map(id=>({id,name:names.get(id)?.name??null,active:names.get(id)?.status==='active'}))};});
}
