import {randomUUID} from 'node:crypto';
import {query,transaction} from '../lib/db';
import {DomainError,hasRole,type Context} from '../lib/context';
import {ProviderError,seal,unseal} from './adapters';
import {text,strings,uuid,type Data,liveContext,hash} from './workspace-core';
import {visibleNotifications} from './service';
function key(){const key=process.env.INTEGRATION_ENCRYPTION_KEY;if(!key||Buffer.from(key,'base64').length!==32)throw new DomainError(503,'INTEGRATION_NOT_CONFIGURED');return key;}
export function webhook(value:unknown){const url=new URL(text(value,4000));if(url.origin!=='https://chat.googleapis.com'||!/^\/v1\/spaces\/[\w-]+\/messages$/.test(url.pathname)||!url.searchParams.has('key')||!url.searchParams.has('token')||url.username||url.password||url.hash)throw new DomainError(422,'INVALID_CHAT_WEBHOOK');return url;}
const manager=(ctx:Context)=>{if(!hasRole(ctx,'admin','operations'))throw new DomainError(403,'FORBIDDEN');};
export async function chatAction(ctx:Context,action:string,data:Data){
 manager(ctx);
 if(action==='chat_list')return query('SELECT id,name,space_name,recipient_ids,kinds,enabled,last_success_at,last_error FROM chat_destinations WHERE workspace_id=$1 AND owner_id=$2 ORDER BY name',[ctx.workspaceId,ctx.userId]);
 if(action==='chat_save'){
  let id=data.id?uuid(data.id):randomUUID();
  const [stored]=data.id?await query('SELECT webhook_encrypted FROM chat_destinations WHERE id=$1 AND workspace_id=$2 AND owner_id=$3',[id,ctx.workspaceId,ctx.userId]):[];
  if(data.id&&!stored)throw new DomainError(404,'NOT_FOUND');
  const url=webhook(data.webhook|| (stored?unseal<string>(String(stored.webhook_encrypted),key(),`${ctx.workspaceId}:${id}:chat`):''));
  if(!data.id){const [same]=await query('SELECT id FROM chat_destinations WHERE workspace_id=$1 AND owner_id=$2 AND space_name=$3 ORDER BY created_at DESC LIMIT 1',[ctx.workspaceId,ctx.userId,url.pathname.split('/').slice(2,4).join('/')]);if(same)id=String(same.id);}
  const members=strings(data.recipient_ids),kinds=strings(data.kinds);if(!members.length||kinds.some(k=>!['assigned','review','handoff','due','announcement','signature_requested'].includes(k)))throw new DomainError(422,'INVALID_FIELD');
  const active=await query('SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::text[]) AND status=\'active\'',[ctx.workspaceId,members]);if(active.length!==members.length)throw new DomainError(422,'INVALID_MEMBER');
  const saved=await query('INSERT INTO chat_destinations(id,workspace_id,owner_id,name,space_name,webhook_encrypted,recipient_ids,kinds,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,webhook_encrypted=excluded.webhook_encrypted,space_name=excluded.space_name,recipient_ids=excluded.recipient_ids,kinds=excluded.kinds,enabled=excluded.enabled WHERE chat_destinations.workspace_id=$2 AND chat_destinations.owner_id=$3 RETURNING id,name,space_name,enabled',[id,ctx.workspaceId,ctx.userId,text(data.name,100),url.pathname.split('/').slice(2,4).join('/'),seal(url.toString(),key(),`${ctx.workspaceId}:${id}:chat`),members,kinds,data.enabled===true]);if(!saved.length)throw new DomainError(404,'NOT_FOUND');return saved[0];
 }
 const [destination]=await query('SELECT id,name,space_name,webhook_encrypted,recipient_ids,kinds FROM chat_destinations WHERE id=$1 AND workspace_id=$2 AND owner_id=$3',[uuid(data.id),ctx.workspaceId,ctx.userId]);if(!destination)throw new DomainError(404,'NOT_FOUND');
 if(action==='chat_disable'){await query('UPDATE chat_destinations SET enabled=false WHERE id=$1',[destination.id]);return {enabled:false};}
 if(action==='chat_test'){
  const fingerprint=hash({webhook:destination.webhook_encrypted,recipients:destination.recipient_ids});
  if(data.confirm!==true)return {destination:{id:destination.id,name:destination.name,space_name:destination.space_name,recipient_ids:destination.recipient_ids},fingerprint,text:'Syntherisk ERP TEST ONLY · 測試通知',confirmation_required:true};
  if(data.fingerprint!==fingerprint)throw new DomainError(409,'PREVIEW_CHANGED');
  const [delivery]=await query("INSERT INTO chat_deliveries(workspace_id,destination_id,dedupe_key) VALUES($1,$2,$3) RETURNING id",[ctx.workspaceId,destination.id,'test:'+randomUUID()]);
  await query("INSERT INTO outbox(workspace_id,kind,payload,dedupe_key) VALUES($1,'chat',$2,$3)",[ctx.workspaceId,JSON.stringify({delivery_id:delivery.id,test:true,destination_fingerprint:hash(destination.webhook_encrypted)}),'chat:'+delivery.id]);return {id:delivery.id,status:'queued'};
 }
 throw new DomainError(404,'ACTION_NOT_FOUND');
}
export async function scheduleChat(){
 const destinations=await query<{id:string;workspace_id:string;owner_id:string;recipient_ids:string[];kinds:string[];webhook_encrypted:string}>('SELECT * FROM chat_destinations WHERE enabled');
 for(const destination of destinations){
  try{manager(await liveContext({workspace_id:destination.workspace_id,user_id:destination.owner_id}));}catch{continue;}
  // Only generic notification text leaves ERP. The user's inbox enforces current record permissions.
  for(const userId of destination.recipient_ids){let ctx:Context;try{ctx=await liveContext({workspace_id:destination.workspace_id,user_id:userId});}catch{continue;}
   const notifications=await visibleNotifications(ctx);
   for(const n of notifications.filter(n=>destination.kinds.includes(String(n.kind))&&!n.read_at))await transaction(async c=>{
    const [delivery]=(await c.query("INSERT INTO chat_deliveries(workspace_id,destination_id,dedupe_key) VALUES($1,$2,$3) ON CONFLICT(destination_id,dedupe_key) DO NOTHING RETURNING id",[destination.workspace_id,destination.id,String(n.id)])).rows;
    if(delivery)await c.query("INSERT INTO outbox(workspace_id,kind,payload,dedupe_key) VALUES($1,'chat',$2,$3)",[destination.workspace_id,JSON.stringify({delivery_id:delivery.id,notification_id:n.id,user_id:userId,destination_fingerprint:hash(destination.webhook_encrypted)}),'chat:'+delivery.id]);
   });
  }
 }
}
export async function deliverChat(workspaceId:string,payload:Data,fetcher:typeof fetch=fetch){
 const [row]=await query<{id:string;status:string;destination_id:string;owner_id:string;webhook_encrypted:string;enabled:boolean;recipient_ids:string[]}>('SELECT d.id,d.status,d.destination_id,c.owner_id,c.webhook_encrypted,c.enabled,c.recipient_ids FROM chat_deliveries d JOIN chat_destinations c ON c.id=d.destination_id WHERE d.workspace_id=$1 AND d.id=$2',[workspaceId,uuid(payload.delivery_id)]);if(!row)throw new ProviderError('chat_not_found',404);if(row.status==='sent')return;if(['sending','uncertain'].includes(row.status))throw new ProviderError('external_result_uncertain',409);
 manager(await liveContext({workspace_id:workspaceId,user_id:row.owner_id}));
 if(!payload.test){if(!row.enabled||!row.recipient_ids.includes(String(payload.user_id)))throw new ProviderError('chat_disabled',409);const ctx=await liveContext({workspace_id:workspaceId,user_id:String(payload.user_id)});if(!(await visibleNotifications(ctx)).some(n=>n.id===payload.notification_id))throw new ProviderError('notification_no_longer_visible',403);}
 if(payload.destination_fingerprint!==hash(row.webhook_encrypted))throw new ProviderError('chat_destination_changed',409);
 const url=webhook(unseal<string>(row.webhook_encrypted,key(),`${workspaceId}:${row.destination_id}:chat`));
 const [claimed]=await query("UPDATE chat_deliveries SET status='sending' WHERE id=$1 AND status IN ('pending','failed') RETURNING id",[row.id]);
 if(!claimed)throw new ProviderError('external_result_uncertain',409);
 try{
  const response=await fetcher(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:payload.test?'Syntherisk ERP TEST ONLY · 測試通知':`Syntherisk 有新的工作通知。請登入工作台檢閱：${new URL('/',process.env.APP_URL).toString()}`}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new ProviderError(response.status===429?'chat_rate_limited':'chat_delivery_failed',response.status,response.status===429);
  const receipt=await response.json() as {name:string};await query("UPDATE chat_deliveries SET status='sent',message_name=$1 WHERE id=$2",[receipt.name,row.id]);await query('UPDATE chat_destinations SET last_success_at=now(),last_error=NULL WHERE id=$1',[row.destination_id]);
 }catch(error){
  const limited=error instanceof ProviderError&&error.status===429,definite=error instanceof ProviderError&&error.status>=400&&error.status<500;
  const code=limited?'chat_rate_limited':definite?'chat_delivery_failed':'external_result_uncertain';
  await query('UPDATE chat_deliveries SET status=$1,last_error=$2 WHERE id=$3',[limited?'pending':definite?'failed':'uncertain',code,row.id]);
  await query('UPDATE chat_destinations SET last_error=$1 WHERE id=$2',[code,row.destination_id]);
  throw new ProviderError(code,error instanceof ProviderError?error.status:409,limited);
 }
}
