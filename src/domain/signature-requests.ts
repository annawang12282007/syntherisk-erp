import {richString} from '../lib/rich-text-schema';
import {signatureAppearance} from '../lib/signature-profile';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {transaction} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {getFile} from '../lib/storage';
import {type Client,type Row,find,str,fail,checkVersion,assertOperation,audit,isExternal,operationAccess,lockCurrencyConfiguration} from './core';
import {lockDelegatedAccess} from './delegations';
import {canonicalJson,signatureHash,recordSnapshot,assertSnapshotExport} from './signatures';
import {signatureRequestResources} from './signature-request-support';
import {parseConfirmationNote} from './task-completion';
import {isRichText} from '../lib/rich-text';
export {signatureRequestResources} from './signature-request-support';

export const requestConsentVersion='optional-record-signature-v1';
const supported=(resource:string)=>signatureRequestResources.includes(resource as typeof signatureRequestResources[number]);
const name=z.string().trim().min(1).max(120).refine(value=>!/[\u0000-\u001f\u007f]/.test(value));
const partySchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('internal'),user_id:z.string().min(1).max(256),label:name}),z.object({kind:z.literal('external'),external_name:name,label:name})]);
type Party=z.infer<typeof partySchema>;
type Snapshot=Awaited<ReturnType<typeof recordSnapshot>>;
type RequestRow=Row&{id:string;resource:string;record_id:string;batch_id:string;kind:'internal'|'external';user_id:string|null;status:string;content_hash:string;canonical_snapshot:string;record_version:number;configuration_version:number};
const locator=z.object({resource:z.string(),record_id:z.uuid()});
const recordInput=locator.extend({version:z.number().int().positive(),configuration_version:z.number().int().min(0)});
function requireSupported(resource:string){if(!supported(resource))fail('signature_request_unsupported',400);}
function caughtAccess(error:unknown){return error instanceof DomainError&&[403,404].includes(error.status);}
async function liveContext(c:Client,ctx:Context,userId=ctx.userId,lock=false):Promise<Context>{
 const member=(await c.query(`SELECT u.name,m.roles,m.status FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2${lock?' FOR SHARE OF m,u':''}`,[ctx.workspaceId,userId])).rows[0];
 if(!member||member.status!=='active'||(member.roles as string[]).every(role=>role==='external'))fail('signature_request_internal_member_required',403);
 const permissions=(await c.query('SELECT resource,operation,scope FROM effective_permissions($1,$3,$2::text[])',[ctx.workspaceId,member.roles,userId])).rows as NonNullable<Context['permissions']>;
 return {...ctx,userId,roles:member.roles,permissions:member.roles.includes('admin')?[]:permissions};
}
async function authority(c:Client,ctx:Context,resource:string,id:string,write:boolean){
 await c.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE',[ctx.workspaceId]);const live=await liveContext(c,ctx,ctx.userId,true);
 if(write)await lockDelegatedAccess(c,live,resource,id);
 await lockCurrencyConfiguration(c,live,resource);const row=await find(c,live,resource,id,write,true);if(row.archived)fail('record_archived',409);if(write)await assertOperation(c,live,resource,'edit',row);return {live,row};
}
async function configuration(c:Client,ctx:Context,resource:string,id:string,lock=false){return(await c.query(`SELECT * FROM signature_request_configurations WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4${lock?' FOR UPDATE':''}`,[ctx.workspaceId,ctx.companyId,resource,id])).rows[0] as Row|undefined;}
async function candidates(c:Client,ctx:Context,resource:string,id?:string){
 const members=(await c.query("SELECT u.id,u.name FROM memberships m JOIN \"user\" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status='active' AND NOT(m.roles <@ ARRAY['external']::text[]) ORDER BY u.name,u.id",[ctx.workspaceId])).rows as {id:string;name:string}[];
 if(!id)return members;
 const result:{id:string;name:string}[]=[];for(const member of members){try{const recipient=await liveContext(c,ctx,member.id);await find(c,recipient,resource,id);result.push(member);}catch(error){if(!caughtAccess(error))throw error;}}return result;
}
async function request(c:Client,ctx:Context,id:string){const row=(await c.query('SELECT q.*,b.resource,b.record_id,b.record_version,b.configuration_version,b.requested_by,b.requested_at,b.content_hash,b.canonical_snapshot FROM signature_requests q JOIN signature_request_batches b ON b.id=q.batch_id WHERE q.workspace_id=$1 AND q.company_id=$2 AND q.id=$3',[ctx.workspaceId,ctx.companyId,id])).rows[0] as RequestRow|undefined;if(!row)fail('signature_request_not_found',404);requireSupported(row.resource);return row;}
async function lockedRequest(c:Client,ctx:Context,id:string,write=false){const initial=await request(c,ctx,id),{live,row}=await authority(c,ctx,initial.resource,initial.record_id,write);await c.query('SELECT id FROM signature_requests WHERE id=$1 FOR UPDATE',[id]);return {item:await request(c,live,id),live,row};}
function storedSnapshot(item:RequestRow):Snapshot {if(signatureHash(item.canonical_snapshot)!==item.content_hash)fail('signature_integrity_failed',409);return JSON.parse(item.canonical_snapshot);}
async function exactSnapshot(c:Client,ctx:Context,item:RequestRow){storedSnapshot(item);const current=await recordSnapshot(c,ctx,item.resource,item.record_id,true);if(signatureHash(canonicalJson(current))!==item.content_hash)fail('signature_request_stale',409);return current;}
function pending(item:RequestRow){if(item.status!=='pending')fail('signature_request_not_pending',409);}
async function activeConfiguration(c:Client,ctx:Context,item:RequestRow){const config=await configuration(c,ctx,item.resource,item.record_id);if(!config?.enabled||config.version!==item.configuration_version)fail('signature_request_stale',409);}
function reviewed(item:RequestRow,snapshot:Snapshot){return {schema:'syntherisk-optional-signature-review-v1',request_id:item.id,batch_id:item.batch_id,resource:item.resource,record_id:item.record_id,record_version:item.record_version,party:{kind:item.kind,user_id:item.user_id,label:item.label},consent_version:requestConsentVersion,snapshot};}
async function canConfigure(c:Client,ctx:Context,resource:string,id:string){try{const row=await find(c,ctx,resource,id,true);await assertOperation(c,ctx,resource,'edit',row);return !row.archived;}catch(error){if(caughtAccess(error))return false;throw error;}}
async function canReadReceiptNote(c:Client,ctx:Context,receipt:Row,access:Map<string,boolean>){
 const snapshots=[receipt.snapshot,receipt.requested_snapshot,(receipt.reviewed as Row|undefined)?.snapshot].filter(Boolean) as Snapshot[];
 for(const snapshot of snapshots){
  const records=[{resource:snapshot.resource,record:snapshot.record},...snapshot.related,...snapshot.children.flatMap(group=>group.rows.map(record=>({resource:group.resource,record})))];
  const refs=[...records.map(item=>({resource:item.resource,id:item.record.id})),...(snapshot.organization??[]).flatMap(group=>group.project_ids.map(id=>({resource:'projects',id})))];
  for(const ref of refs){
   const key=`${ref.resource}:${ref.id}`;
   if(!access.has(key)){try{await find(c,ctx,ref.resource,ref.id);access.set(key,true);}catch(error){if(!caughtAccess(error))throw error;access.set(key,false);}}
   if(!access.get(key))return false;
  }
 }
 return true;
}

export async function getSignatureRequests(ctx:Context,resource:string,id?:string){
 if(!supported(resource))return {supported:false,can_configure:false,eligible_members:[],requests:[],parties:[],enabled:false,configuration_version:0,record_version:0};
 return transaction(async c=>{const live=await liveContext(c,ctx);
  if(!id){const allowed=!isExternal(live)&&operationAccess(live,resource,'create');return {supported:true,can_configure:allowed,eligible_members:allowed?await candidates(c,live,resource):[],requests:[],parties:[],enabled:false,configuration_version:0,record_version:0};}
  const row=await find(c,live,resource,id),config=await configuration(c,live,resource,id),can_configure=await canConfigure(c,live,resource,id);
  const items=(await c.query('SELECT q.*,b.resource,b.record_id,b.record_version,b.configuration_version,b.requested_by,b.requested_at,b.content_hash,b.canonical_snapshot,e.id AS receipt_id,e.sha256 AS receipt_sha256,e.canonical_payload AS receipt_payload,e.signed_at,e.attachment_id,e.actor_name AS recorded_by_name FROM signature_requests q JOIN signature_request_batches b ON b.id=q.batch_id LEFT JOIN signature_request_receipts e ON e.request_id=q.id WHERE q.workspace_id=$1 AND q.company_id=$2 AND b.resource=$3 AND b.record_id=$4 ORDER BY b.requested_at DESC,q.id LIMIT 200',[ctx.workspaceId,ctx.companyId,resource,id])).rows as RequestRow[];
  let currentHash:string|null=null;if(items.length){try{currentHash=signatureHash(canonicalJson(await recordSnapshot(c,live,resource,id)));}catch(error){if(!caughtAccess(error))throw error;}}
  const requests:Row[]=[],noteAccess=new Map<string,boolean>();for(const item of items){
   if(item.receipt_payload&&signatureHash(str(item.receipt_payload))!==item.receipt_sha256)fail('signature_integrity_failed',409);
   const receipt=item.receipt_payload?JSON.parse(str(item.receipt_payload)):null;
   const signedHash=receipt?signatureHash(canonicalJson(receipt.snapshot)):item.content_hash,matches=currentHash!==null&&signedHash===currentHash,stale=!matches||!config?.enabled||item.configuration_version!==config.version;
   const savedNote=item.kind==='internal'?receipt?.reviewed?.confirmation_note:receipt?.note;
   const confirmation_note=typeof savedNote==='string'&&savedNote.trim()&&await canReadReceiptNote(c,live,receipt,noteAccess)?savedNote:null;
   requests.push({id:item.id,batch_id:item.batch_id,kind:item.kind,user_id:item.user_id,signer_name:item.signer_name,external_name:item.external_name,label:item.label,status:item.status==='pending'&&stale?'stale':item.status,record_version:item.record_version,requested_at:item.requested_at,can_sign:item.status==='pending'&&!stale&&item.kind==='internal'&&item.user_id===ctx.userId,can_record_external:item.status==='pending'&&item.kind==='external'&&can_configure&&config?.enabled===true&&item.configuration_version===config.version&&item.record_version===row.version,can_cancel:item.status==='pending'&&can_configure,receipt_id:item.receipt_id,receipt_sha256:item.receipt_sha256,signed_at:item.signed_at,attachment_id:item.attachment_id,recorded_by_name:item.recorded_by_name,matches_current:currentHash===null?null:matches,confirmation_note,confirmation_note_format:item.kind==='external'&&isRichText(confirmation_note)?'rich':'plain'});
  }
  return {supported:true,record_version:row.version,configuration_version:config?.version??0,enabled:config?.enabled??false,parties:config?.parties??[],eligible_members:can_configure?await candidates(c,live,resource,id):[],can_configure,requests};
 });
}

async function validateParties(c:Client,ctx:Context,resource:string,id:string,parties:Party[]){
 const unique=new Set<string>();for(const party of parties){const key=canonicalJson(party);if(unique.has(key))fail('signature_request_duplicate_party');unique.add(key);if(party.kind==='internal'){let recipient:Context;try{recipient=await liveContext(c,ctx,party.user_id,true);await find(c,recipient,resource,id);}catch(error){if(caughtAccess(error))fail('signature_request_recipient_unavailable',403);throw error;}}}
}
async function cancelPending(c:Client,ctx:Context,resource:string,id:string,reason:string){await c.query("UPDATE signature_requests q SET status='cancelled',cancelled_by=$1,cancelled_at=now(),cancellation_reason=$2 FROM signature_request_batches b WHERE q.batch_id=b.id AND q.workspace_id=$3 AND q.company_id=$4 AND b.resource=$5 AND b.record_id=$6 AND q.status='pending'",[ctx.userId,reason,ctx.workspaceId,ctx.companyId,resource,id]);}
export async function mutateSignatureRequests(ctx:Context,data:Row):Promise<unknown>{
 if(data.action==='configure'||data.action==='issue'){
  const input=recordInput.parse(data);requireSupported(input.resource);
  await transaction(async c=>{const {live,row}=await authority(c,ctx,input.resource,input.record_id,true);checkVersion(row,input);const config=await configuration(c,live,input.resource,input.record_id,true);if((config?.version??0)!==input.configuration_version)fail('signature_configuration_changed',409);
   if(data.action==='configure'){
    const enabled=z.boolean().parse(data.enabled),parties=z.array(partySchema).max(50).parse(data.parties);if(enabled&&!parties.length)fail('signature_request_parties_required');if(enabled)await validateParties(c,live,input.resource,input.record_id,parties);
    await c.query('INSERT INTO signature_request_configurations(workspace_id,company_id,resource,record_id,enabled,parties,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,company_id,resource,record_id) DO UPDATE SET enabled=EXCLUDED.enabled,parties=EXCLUDED.parties,updated_by=EXCLUDED.updated_by,updated_at=now(),version=signature_request_configurations.version+1',[ctx.workspaceId,ctx.companyId,input.resource,input.record_id,enabled,JSON.stringify(parties),ctx.userId]);
    await cancelPending(c,live,input.resource,input.record_id,enabled?'configuration_changed':'requirement_disabled');await audit(c,live,input.resource,input.record_id,'signature_request_configured',null,{enabled,party_count:parties.length,configuration_version:input.configuration_version+1});return;
   }
   if(!config?.enabled)fail('signature_requests_disabled',409);const parties=z.array(partySchema).min(1).parse(config.parties);await validateParties(c,live,input.resource,input.record_id,parties);
   const snapshot=await recordSnapshot(c,live,input.resource,input.record_id,true),canonical=canonicalJson(snapshot),contentHash=signatureHash(canonical);
   const existing=await c.query("SELECT 1 FROM signature_request_batches b JOIN signature_requests q ON q.batch_id=b.id WHERE b.workspace_id=$1 AND b.company_id=$2 AND b.resource=$3 AND b.record_id=$4 AND b.configuration_version=$5 AND b.content_hash=$6 AND q.status<>'cancelled' LIMIT 1",[ctx.workspaceId,ctx.companyId,input.resource,input.record_id,config.version,contentHash]);if(existing.rowCount)return;
   await cancelPending(c,live,input.resource,input.record_id,'superseded');const batchId=randomUUID();await c.query('INSERT INTO signature_request_batches(id,workspace_id,company_id,resource,record_id,configuration_version,record_version,requested_by,content_hash,canonical_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[batchId,ctx.workspaceId,ctx.companyId,input.resource,input.record_id,config.version,row.version,ctx.userId,contentHash,canonical]);
   for(const party of parties){const id=randomUUID(),signer=party.kind==='internal'?(await c.query('SELECT name FROM "user" WHERE id=$1',[party.user_id])).rows[0].name:null;await c.query('INSERT INTO signature_requests(id,workspace_id,company_id,batch_id,kind,user_id,signer_name,external_name,label) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,ctx.workspaceId,ctx.companyId,batchId,party.kind,party.kind==='internal'?party.user_id:null,signer,party.kind==='external'?party.external_name:null,party.label]);
    if(party.kind==='internal')await c.query("INSERT INTO notifications(workspace_id,user_id,kind,title_key,resource,record_id,dedupe_key) SELECT $1,$2,'signature_requested','notification.signature_requested',$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM notification_preferences WHERE workspace_id=$1 AND user_id=$2 AND kind='signature_requested' AND NOT enabled) ON CONFLICT DO NOTHING",[ctx.workspaceId,party.user_id,input.resource,input.record_id,`signature-request:${id}`]);
   }
   await audit(c,live,input.resource,input.record_id,'signature_requests_issued',null,{batch_id:batchId,record_version:row.version,content_hash:contentHash,party_count:parties.length});
  });return getSignatureRequests(ctx,input.resource,input.record_id);
 }
 const requestId=z.uuid().parse(data.request_id);let resource='',recordId='';
 const result=await transaction(async c=>{const write=data.action==='external_record'||data.action==='cancel',{item,live}=await lockedRequest(c,ctx,requestId,write);resource=item.resource;recordId=item.record_id;
  if(data.action==='cancel'){pending(item);await c.query("UPDATE signature_requests SET status='cancelled',cancelled_by=$1,cancelled_at=now(),cancellation_reason='cancelled_by_editor' WHERE id=$2",[ctx.userId,item.id]);await audit(c,live,resource,recordId,'signature_request_cancelled',null,{request_id:item.id});return null;}
  pending(item);await activeConfiguration(c,live,item);
  if(data.action==='preview'||data.action==='sign'){
   if(item.kind!=='internal'||item.user_id!==ctx.userId)fail('signature_request_signer_required',403);
   const confirmationNote=parseConfirmationNote(data.confirmation_note);
   // Omitted/blank notes retain the previous canonical shape for existing clients.
   const snapshot=await exactSnapshot(c,live,item),payload={...reviewed(item,snapshot),signature_appearance:await signatureAppearance(c,ctx.userId),...(confirmationNote?{confirmation_note:confirmationNote}:{})},reviewedHash=signatureHash(canonicalJson(payload));const actor=(await c.query('SELECT name FROM "user" WHERE id=$1',[ctx.userId])).rows[0];
   if(data.action==='preview')return {signature_appearance:payload.signature_appearance,reviewed_hash:reviewedHash,snapshot,consent_version:requestConsentVersion,signer_name:actor.name,confirmation_note:confirmationNote};
   if(data.consent!==true)fail('signature_consent_required');const typed=name.parse(data.typed_name).normalize('NFC');if(typed!==str(actor.name).trim().normalize('NFC'))fail('signature_name_mismatch');if(data.reviewed_hash!==reviewedHash)fail('signature_snapshot_changed',409);
   return saveReceipt(c,live,item,{schema:'syntherisk-optional-electronic-signature-v1',reviewed:payload,reviewed_hash:reviewedHash,signer:{user_id:ctx.userId,name:actor.name,roles:live.roles,typed_name:typed,appearance:payload.signature_appearance},consent:{accepted:true,version:requestConsentVersion}},snapshot);
  }
  if(data.action==='external_record'){
   if(item.kind!=='external')fail('signature_request_external_required');const attachmentId=z.uuid().parse(data.attachment_id),note=richString(4000).parse(data.note??'');const original=storedSnapshot(item),current=await recordSnapshot(c,live,resource,recordId,true);
   const file=(await c.query('SELECT * FROM attachments WHERE id=$1 AND workspace_id=$2 AND company_id=$3 AND resource=$4 AND record_id=$5 FOR SHARE',[attachmentId,ctx.workspaceId,ctx.companyId,resource,recordId])).rows[0];if(!file)fail('signature_attachment_unavailable',404);
   const comparison=original.attachments.some(file=>file.id===attachmentId)?current:{...current,attachments:current.attachments.filter(file=>file.id!==attachmentId)};if(signatureHash(canonicalJson(comparison))!==item.content_hash)fail('signature_request_stale',409);
   const bytes=await getFile(str(file.storage_key));if(createHash('sha256').update(bytes).digest('hex')!==file.sha256||BigInt(bytes.length)!==BigInt(str(file.byte_size)))fail('signature_attachment_integrity_failed',409);
   const actor=(await c.query('SELECT name FROM "user" WHERE id=$1',[ctx.userId])).rows[0],uploader=(await c.query('SELECT name FROM "user" WHERE id=$1',[file.created_by])).rows[0];
   return saveReceipt(c,live,item,{schema:'syntherisk-external-signed-document-archive-v1',authentication:'external_identity_not_authenticated',external_party:{claimed_name:item.external_name,label:item.label},recorded_by:{user_id:ctx.userId,name:actor.name},attachment:{id:file.id,filename:file.filename,mime_type:file.mime_type,byte_size:file.byte_size,sha256:file.sha256,uploaded_at:file.created_at,uploaded_by:{user_id:file.created_by,name:uploader?.name??null}},note,requested_snapshot:original},current,attachmentId);
  }
  fail('invalid_action',400);
 });
 if(data.action==='preview')return result;return {...await getSignatureRequests(ctx,resource,recordId),...(result??{})};
}
async function saveReceipt(c:Client,ctx:Context,item:RequestRow,details:Row,snapshot:Snapshot,attachmentId?:string){
 const id=randomUUID(),actor=(await c.query('SELECT name FROM "user" WHERE id=$1',[ctx.userId])).rows[0],signedAt=str((await c.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS value")).rows[0].value);
 const payload={...details,id,request_id:item.id,batch_id:item.batch_id,workspace_id:ctx.workspaceId,company_id:ctx.companyId,resource:item.resource,record_id:item.record_id,record_version:item.record_version,label:item.label,kind:item.kind,recorded_at:signedAt,snapshot},canonical=canonicalJson(payload),sha256=signatureHash(canonical);
 await c.query('INSERT INTO signature_request_receipts(id,workspace_id,company_id,request_id,kind,actor_id,actor_name,signed_at,attachment_id,sha256,canonical_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,ctx.workspaceId,ctx.companyId,item.id,item.kind,ctx.userId,actor.name,signedAt,attachmentId??null,sha256,canonical]);await c.query('UPDATE signature_requests SET status=$1 WHERE id=$2',[item.kind==='internal'?'signed':'external_recorded',item.id]);await audit(c,ctx,item.resource,item.record_id,item.kind==='internal'?'requested_signature_signed':'external_signed_document_recorded',null,{request_id:item.id,receipt_id:id,sha256,record_version:item.record_version,kind:item.kind});return {receipt_id:id,sha256};
}
export async function signatureRequestReceipt(ctx:Context,id:string){return transaction(async c=>{
 const live=await liveContext(c,ctx),row=(await c.query('SELECT * FROM signature_request_receipts WHERE workspace_id=$1 AND company_id=$2 AND id=$3',[ctx.workspaceId,ctx.companyId,id])).rows[0];if(!row)fail('signature_request_receipt_not_found',404);const canonical=str(row.canonical_payload);if(signatureHash(canonical)!==row.sha256)fail('signature_integrity_failed',409);const payload=JSON.parse(canonical);await assertSnapshotExport(c,live,payload.snapshot);if(payload.requested_snapshot)await assertSnapshotExport(c,live,payload.requested_snapshot);if(payload.reviewed?.snapshot)await assertSnapshotExport(c,live,payload.reviewed.snapshot);return {canonical,sha256:str(row.sha256),filename:`Syntherisk-signature-request-${row.id}.json`};
});}
