import {createHash} from 'node:crypto';
import {query,transaction} from '../lib/db';
import {type Context,DomainError} from '../lib/context';
import {canUseGoogle} from './access';
import {GoogleAdapter,googleConfig,ProviderError,type Provider,type Tokens} from './adapters';
import {connection,authorizedTokens,type Connection} from './service';
import {get,assertAccess} from '../domain/service';
import {assertRecordExport} from '../lib/io';
export type Data=Record<string,unknown>;
function canonical(value:unknown):unknown{
 if(value instanceof Date)return value.toJSON();
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)]));
 return value;
}
export const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function text(value:unknown,max=1000){if(typeof value!=='string'||!value.trim()||value.length>max)throw new DomainError(422,'INVALID_FIELD');return value.trim();}
export function optional(value:unknown,max=1000){return value===undefined||value===null||value===''?'':text(value,max);}
export function remoteId(value:unknown){const id=text(value);if(!/^[a-zA-Z0-9_@.\-]+$/.test(id))throw new DomainError(422,'INVALID_EXTERNAL_ID');return id;}
export function uuid(value:unknown){const id=text(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new DomainError(422,'INVALID_ID');return id;}
export function strings(value:unknown,max=100){if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'))throw new DomainError(422,'INVALID_FIELD');return [...new Set(value as string[])];}
export const enc=encodeURIComponent;
export interface Session {ctx:Context;row:Connection;adapter:GoogleAdapter;tokens:Tokens}
export async function liveContext(row:Pick<Connection,'workspace_id'|'user_id'>,companyId?:string):Promise<Context>{
 const [member]=await query<{roles:string[];company_id:string}>(`SELECT m.roles,c.id company_id FROM memberships m JOIN companies c ON c.workspace_id=m.workspace_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND ($3::uuid IS NULL OR c.id=$3) ORDER BY c.created_at LIMIT 1`,[row.workspace_id,row.user_id,companyId??null]);
 if(!member)throw new ProviderError('sender_permission_revoked',403);
 const permissions=member.roles.includes('admin')?[]:await query<{resource:string;operation:string;scope:string}>('SELECT resource,operation,scope FROM effective_permissions($1,$3,$2::text[])',[row.workspace_id,member.roles,row.user_id]);
 const ctx={workspaceId:row.workspace_id,userId:row.user_id,companyId:member.company_id,roles:member.roles,permissions};
 if(!canUseGoogle(ctx))throw new ProviderError('sender_permission_revoked',403);return ctx;
}
export async function session(ctx:Context,id:unknown,provider?:Provider,adapter=new GoogleAdapter(googleConfig())):Promise<Session>{
 const row=await connection(ctx,uuid(id));if(provider&&row.provider!==provider)throw new DomainError(422,'INVALID_PROVIDER');
 const current=await liveContext(row,ctx.companyId),tokens=await authorizedTokens(row,adapter,true);
 return {ctx:current,row,adapter,tokens};
}
export function requireScope(s:Session,...alternatives:string[]){if(!alternatives.some(scope=>s.tokens.scope.split(' ').includes('https://www.googleapis.com/auth/'+scope)))throw new ProviderError('scope_missing',403);}
export async function pages<T>(s:Session,path:string,key:string,max=10000):Promise<T[]>{
 const rows:T[]=[];let pageToken='';const seen=new Set<string>();
 do{const response=await s.adapter.request<Record<string,unknown>>(s.tokens,path+(pageToken?(path.includes('?')?'&':'?')+'pageToken='+enc(pageToken):''));rows.push(...(response[key] as T[]??[]));if(rows.length>max)throw new ProviderError('selection_too_large',413);pageToken=String(response.nextPageToken??'');if(pageToken&&seen.has(pageToken))throw new ProviderError('invalid_page_cursor',502);seen.add(pageToken);}while(pageToken);return rows;
}
export async function record(s:Session,input:Data,exporting=false){
 const resource=text(input.resource),id=uuid(input.record_id);const row=await get(s.ctx,resource,id);
 if(exporting)await assertRecordExport(s.ctx,resource,id);return {resource,id,row};
}
export async function linkItem(s:Session,itemId:unknown,resource:unknown,recordId:unknown){
 const target=text(resource),id=uuid(recordId);await assertAccess(s.ctx,target,id,'write');
 return transaction(async c=>{const [item]=(await c.query('UPDATE integration_items SET resource=$1,record_id=$2,state=\'linked\',updated_at=now() WHERE workspace_id=$3 AND user_id=$4 AND connection_id=$5 AND id=$6 RETURNING id',[target,id,s.ctx.workspaceId,s.ctx.userId,s.row.id,uuid(itemId)])).rows;
 if(!item)throw new DomainError(404,'NOT_FOUND');await c.query("INSERT INTO integration_item_links(item_id,workspace_id,resource,record_id,origin) VALUES($1,$2,$3,$4,'link') ON CONFLICT DO NOTHING",[item.id,s.ctx.workspaceId,target,id]);return item;});
}
export async function stage(s:Session,kind:string,externalId:string,data:Data){
 return transaction(async c=>{
  const [item]=(await c.query(`INSERT INTO integration_items(workspace_id,connection_id,user_id,kind,external_id,fingerprint,data) VALUES($1,$2,$3,$4,$5,$6,$7)
   ON CONFLICT(connection_id,kind,external_id) DO UPDATE SET data=excluded.data||CASE WHEN integration_items.data->'source' IS NOT NULL THEN jsonb_build_object('source',integration_items.data->'source') ELSE '{}'::jsonb END,fingerprint=excluded.fingerprint,updated_at=now(),state=CASE WHEN integration_items.fingerprint=excluded.fingerprint THEN integration_items.state ELSE 'changed' END RETURNING *`,[s.ctx.workspaceId,s.row.id,s.ctx.userId,kind,externalId,hash(data),JSON.stringify(data)])).rows;
  const source=data.source as Data|undefined;
  if(source?.resource&&source.id)await c.query("INSERT INTO integration_item_links(item_id,workspace_id,resource,record_id,origin) VALUES($1,$2,$3,$4,'link') ON CONFLICT DO NOTHING",[item.id,s.ctx.workspaceId,text(source.resource),uuid(source.id)]);
  return item;
 });
}
export interface Sharing {id:string;isAppAuthorized?:boolean;name:string;mimeType:string;modifiedTime?:string;version?:string;trashed?:boolean;parents?:string[];driveId?:string;capabilities?:{canShare?:boolean;canReadRevisions?:boolean;canDownload?:boolean;canEdit?:boolean;canCopy?:boolean;canAddChildren?:boolean};permissions?:{id:string;type:string;role:string;emailAddress?:string;domain?:string;allowFileDiscovery?:boolean;permissionDetails?:unknown[]}[]}
export async function sharing(s:Session,id:string){
 const result=await s.adapter.request<Sharing>(s.tokens,`/drive/v3/files/${enc(id)}?supportsAllDrives=true&fields=id,name,isAppAuthorized,mimeType,modifiedTime,version,trashed,parents,driveId,capabilities,permissions(id,type,role,emailAddress,domain,allowFileDiscovery,permissionDetails)`);
 if(result.trashed)throw new ProviderError('provider_resource_deleted',410);
 // Shared Drive permission membership may be opaque (groups/domain). Never call this a complete membership proof.
 return {...result,visibility:result.permissions?.length?result.permissions.map(p=>({type:p.type,role:p.role,identity:p.emailAddress??p.domain??p.type})):[],audience_verified:false};
}
export function assertDestination(input:Data){if(input.acknowledge_external_visibility!==true)throw new DomainError(409,'EXTERNAL_VISIBILITY_CONFIRMATION_REQUIRED');}
export async function externalError(s:Session,error:unknown){
 if(error instanceof ProviderError)await query('UPDATE integration_connections SET last_error=$1,status=$2 WHERE id=$3 AND workspace_id=$4 AND status<>\'disconnected\'',[error.code,error.code==='authorization_expired'?'expired':'failed',s.row.id,s.ctx.workspaceId]);
}
