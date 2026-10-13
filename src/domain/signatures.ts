import {signatureAppearance,type SignatureAppearance} from '../lib/signature-profile';
import {createHash,randomUUID} from 'node:crypto';
import {transaction} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {type Client,type Row,find,scope,str,fail,def,checkVersion,assertOperation,lockCurrencyConfiguration} from './core';
import {signatureActions} from './registry';
import {recordOrganizationSnapshot} from './record-organization';
import {recordResponsibleSnapshot} from './responsibilities';

export const signatureConsentVersion='internal-confirmation-v1';
export const requiresSignature=(resource:string,operation:string)=>signatureActions[resource]?.includes(operation)??false;
export function canonicalJson(value:unknown):string{
 if(value===null||value===undefined)return 'null';
 if(value instanceof Date)return JSON.stringify(value.toISOString());
 if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='bigint')return JSON.stringify(value.toString());
 if(typeof value==='number'){if(!Number.isFinite(value))fail('invalid_signature_payload');return JSON.stringify(value);}
 if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
 if(typeof value==='object')return `{${Object.entries(value as Row).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
 fail('invalid_signature_payload');
}
export const signatureHash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
const inputs=(data:Row)=>Object.fromEntries(Object.entries(data).filter(([key])=>!['signature','version','idempotency_key'].includes(key)));
type Snapshot={resource:string;record_id:string;record:Row;children:{resource:string;parent_id:string;rows:Row[]}[];related:{resource:string;record:Row}[];attachments:Row[];organization:{resource:string;record_id:string;category_ids:string[];project_ids:string[]}[];responsibilities:{resource:string;record_id:string;user_ids:string[]}[];currency_units:Record<string,number>};
const children:Record<string,[string,string][]>= {budgets:[['budget_lines','budget_id']],customer_quotes:[['quote_lines','quote_id']],purchase_orders:[['purchase_order_lines','order_id']],engagements:[['engagement_collaborators','engagement_id']],expense_claims:[['expense_lines','claim_id']],customer_invoices:[['invoice_lines','invoice_id']],vendor_bills:[['bill_lines','bill_id']],payments:[['payment_allocations','payment_id']],journal_entries:[['journal_lines','entry_id']],documents:[['document_versions','document_id']],tasks:[['task_checklist','task_id'],['task_dependencies','task_id']]};
const related:Record<string,[string,string][]>={contracts:[['documents','document_id']],handoffs:[['tasks','task_id']],work_requests:[['tasks','task_id']],reviews:[['tasks','task_id'],['documents','document_id']],expense_claims:[['journal_entries','journal_entry_id']],customer_invoices:[['journal_entries','journal_entry_id']],vendor_bills:[['journal_entries','journal_entry_id']],payments:[['journal_entries','journal_entry_id']]};

export async function recordSnapshot(c:Client,ctx:Context,resource:string,id:string,lock=false):Promise<Snapshot>{
 const record=await find(c,ctx,resource,id,false,lock),result:Snapshot={resource,record_id:id,record,children:[],related:[],attachments:[],organization:[],responsibilities:[],currency_units:{}},seen=new Set<string>(),currencies=new Set<string>();
 async function collect(table:string,row:Row){
  const key=`${table}:${row.id}`;if(seen.has(key))return;seen.add(key);
  const organization=await recordOrganizationSnapshot(c,ctx,table,str(row.id));for(const projectId of organization.project_ids)await find(c,ctx,'projects',projectId);result.organization.push({resource:table,record_id:str(row.id),...organization});
  result.responsibilities.push({resource:table,record_id:str(row.id),user_ids:await recordResponsibleSnapshot(c,ctx,table,str(row.id))});
  for(const [field,value] of Object.entries(row))if((field==='currency'||field.endsWith('_currency'))&&typeof value==='string'&&/^[A-Z]{3}$/.test(value))currencies.add(value);
  const files=(await c.query('SELECT id,resource,record_id,filename,mime_type,byte_size,sha256 FROM attachments WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4 ORDER BY id',[ctx.workspaceId,ctx.companyId,table,row.id])).rows as Row[];result.attachments.push(...files);
  for(const [child,parent] of children[table]??[]){
   const all=(await c.query(`SELECT r.* FROM ${child} r WHERE workspace_id=$1 AND company_id=$2 AND ${parent}=$3 AND NOT archived ORDER BY id${lock?' FOR UPDATE OF r':''}`,[ctx.workspaceId,ctx.companyId,row.id])).rows as Row[];
   const visibleScope=scope(ctx,child),visible=(await c.query(`SELECT r.id FROM ${child} r WHERE ${visibleScope.sql} AND r.${parent}=$4 AND NOT r.archived`,[...visibleScope.values,row.id])).rows;
   if(all.length!==visible.length)fail('signature_incomplete_access',403);
   result.children.push({resource:child,parent_id:str(row.id),rows:all});
   for(const item of all)await collect(child,item);
  }
  const links:[string,string][]=[...(related[table]??[]),...(['delegations','handoffs','work_requests','reviews'].includes(table)&&row.target_resource&&row.target_id?[[str(row.target_resource),'target_id'] as [string,string]]:[])];
  for(const [target,foreignKey] of links){if(!row[foreignKey])continue;const relatedRow=await find(c,ctx,target,row[foreignKey],false,lock);if(!seen.has(`${target}:${relatedRow.id}`)){result.related.push({resource:target,record:relatedRow});await collect(target,relatedRow);}}
 }
 await collect(resource,record);
 for(const code of [...currencies].sort()){const configured=(await c.query('SELECT minor_digits FROM currencies WHERE workspace_id=$1 AND company_id=$2 AND code=$3 AND NOT archived',[ctx.workspaceId,ctx.companyId,code])).rows[0];result.currency_units[code]=configured?Number(configured.minor_digits):new Intl.NumberFormat('en',{style:'currency',currency:code}).resolvedOptions().maximumFractionDigits??2;}
 result.related.sort((a,b)=>`${a.resource}:${a.record.id}`.localeCompare(`${b.resource}:${b.record.id}`));result.children.sort((a,b)=>`${a.resource}:${a.parent_id}`.localeCompare(`${b.resource}:${b.parent_id}`));result.attachments.sort((a,b)=>str(a.id).localeCompare(str(b.id)));result.organization.sort((a,b)=>`${a.resource}:${a.record_id}`.localeCompare(`${b.resource}:${b.record_id}`));result.responsibilities.sort((a,b)=>`${a.resource}:${a.record_id}`.localeCompare(`${b.resource}:${b.record_id}`));return result;
}
function reviewedPayload(ctx:Context,resource:string,id:string,operation:string,data:Row,record:Snapshot,appearance:SignatureAppearance){return {signature_appearance:appearance,schema:'syntherisk-reviewed-confirmation-v1',workspace_id:ctx.workspaceId,company_id:ctx.companyId,resource,record_id:id,operation,record_version:record.record.version,consent_version:signatureConsentVersion,values:inputs(data),snapshot:record};}
export async function previewSignature(ctx:Context,resource:string,id:string,operation:string,data:Row){
 if(!requiresSignature(resource,operation))fail('signature_not_required');
 return transaction(async c=>{await lockCurrencyConfiguration(c,ctx,resource);const current=await recordSnapshot(c,ctx,resource,id,true);checkVersion(current.record,data);if(current.record.archived)fail('record_archived',409);const payload=reviewedPayload(ctx,resource,id,operation,data,current,await signatureAppearance(c,ctx.userId));return {required:true,signature_appearance:payload.signature_appearance,reviewed_hash:signatureHash(canonicalJson(payload)),snapshot:current,operation,values:inputs(data),consent_version:signatureConsentVersion};});
}
export interface PendingSignature {id:string;actor_name:string;actor_roles:string[];typed_name:string;reviewed:ReturnType<typeof reviewedPayload>;reviewed_hash:string;context:Context}
export async function validateSignature(c:Client,ctx:Context,resource:string,row:Row,operation:string,data:Row):Promise<PendingSignature|undefined>{
 if(!requiresSignature(resource,operation))return;
 const supplied=data.signature;if(!supplied||typeof supplied!=='object'||Array.isArray(supplied))fail('signature_required');const signature=supplied as Row;
 if(signature.consent!==true)fail('signature_consent_required');if(typeof signature.typed_name!=='string'||!signature.typed_name.trim())fail('signature_name_required');if(typeof signature.reviewed_hash!=='string'||!/^[a-f0-9]{64}$/.test(signature.reviewed_hash))fail('signature_preview_required');
 const actor=(await c.query('SELECT u.name,m.roles,m.status FROM "user" u JOIN memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.workspace_id=$2 FOR SHARE OF u,m',[ctx.userId,ctx.workspaceId])).rows[0];if(!actor||actor.status!=='active')fail('signature_membership_required',403);
 if(ctx.roles.some(role=>!(actor.roles as string[]).includes(role)))fail('signature_membership_changed',403);
 const typed=signature.typed_name.trim().normalize('NFC');if(typed!==str(actor.name).trim().normalize('NFC'))fail('signature_name_mismatch');
 const current=await recordSnapshot(c,ctx,resource,str(row.id),true),reviewed=reviewedPayload(ctx,resource,str(row.id),operation,data,current,await signatureAppearance(c,ctx.userId)),reviewed_hash=signatureHash(canonicalJson(reviewed));if(reviewed_hash!==signature.reviewed_hash)fail('signature_snapshot_changed',409);
 return {id:randomUUID(),actor_name:str(actor.name),actor_roles:[...(actor.roles as string[])].sort(),typed_name:typed,reviewed,reviewed_hash,context:ctx};
}
export async function recordSignature(c:Client,ctx:Context,resource:string,id:string,operation:string,result:Row,pending:PendingSignature):Promise<Row>{
 const after=await recordSnapshot(c,ctx,resource,id,true),signedAt=str((await c.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS signed_at")).rows[0].signed_at),effects:Snapshot[]=[];
 if(result.payment_id)effects.push(await recordSnapshot(c,ctx,'payments',str(result.payment_id),true));
 const payload={schema:'syntherisk-electronic-confirmation-v1',id:pending.id,workspace_id:ctx.workspaceId,company_id:ctx.companyId,resource,record_id:id,operation,record_version:pending.reviewed.record_version,result_version:after.record.version,signer:{actor_id:ctx.userId,actor_name:pending.actor_name,actor_roles:pending.actor_roles,typed_name:pending.typed_name,appearance:pending.reviewed.signature_appearance},consent:{accepted:true,version:signatureConsentVersion},signed_at:signedAt,reviewed_hash:pending.reviewed_hash,reviewed:pending.reviewed,result:{snapshot:after,operation_result:result,effects}};
 const canonical=canonicalJson(payload),sha256=signatureHash(canonical),contentHash=signatureHash(canonicalJson(after));
 await c.query('INSERT INTO electronic_signatures(id,workspace_id,company_id,resource,record_id,operation,actor_id,actor_name,actor_roles,typed_name,consent_version,signed_at,record_version,result_version,reviewed_hash,content_hash,sha256,canonical_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',[pending.id,ctx.workspaceId,ctx.companyId,resource,id,operation,ctx.userId,pending.actor_name,JSON.stringify(pending.actor_roles),pending.typed_name,signatureConsentVersion,signedAt,pending.reviewed.record_version,after.record.version,pending.reviewed_hash,contentHash,sha256,canonical]);
 await c.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,$3,$4,'electronic_signature',$5)",[ctx.workspaceId,ctx.userId,resource,id,JSON.stringify({signature_id:pending.id,operation,sha256,record_version:pending.reviewed.record_version,result_version:after.record.version})]);
 return {id:pending.id,sha256,reviewed_hash:pending.reviewed_hash,actor_name:pending.actor_name,actor_roles:pending.actor_roles,signed_at:signedAt,record_version:pending.reviewed.record_version,result_version:after.record.version};
}
export async function listSignatures(ctx:Context,resource:string,id:string){return transaction(async c=>{
 await find(c,ctx,resource,id);const rows=(await c.query('SELECT * FROM electronic_signatures WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4 ORDER BY signed_at DESC,id DESC LIMIT 100',[ctx.workspaceId,ctx.companyId,def(resource).key,id])).rows as Row[];
 let currentHash:string|null=null;if(rows.length){try{currentHash=signatureHash(canonicalJson(await recordSnapshot(c,ctx,resource,id)));}catch(error){if(!(error instanceof DomainError&&[403,404].includes(error.status)))throw error;}}
 return rows.map(row=>({id:row.id,resource,record_id:id,operation:row.operation,actor_id:row.actor_id,actor_name:row.actor_name,actor_roles:row.actor_roles,typed_name:row.typed_name,signed_at:row.signed_at,record_version:row.record_version,result_version:row.result_version,reviewed_hash:row.reviewed_hash,sha256:row.sha256,matches_current:currentHash===null?null:currentHash===row.content_hash,integrity_valid:signatureHash(str(row.canonical_payload))===row.sha256}));
});}
export async function assertSnapshotExport(c:Client,ctx:Context,content:Snapshot){
 for(const item of [{resource:content.resource,record:content.record},...content.related,...content.children.flatMap(group=>group.rows.map(record=>({resource:group.resource,record})))] ){const row=await find(c,ctx,item.resource,item.record.id);await assertOperation(c,ctx,item.resource,'export',row);}
 for(const group of content.organization??[])for(const id of group.project_ids){const row=await find(c,ctx,'projects',id);await assertOperation(c,ctx,'projects','export',row);}
}
export async function signatureReceipt(ctx:Context,id:string){return transaction(async c=>{
 const row=(await c.query('SELECT * FROM electronic_signatures WHERE workspace_id=$1 AND company_id=$2 AND id=$3',[ctx.workspaceId,ctx.companyId,id])).rows[0] as Row|undefined;if(!row)fail('signature_not_found',404);
 const canonical=str(row.canonical_payload);if(signatureHash(canonical)!==row.sha256)fail('signature_integrity_failed',409);
 const payload=JSON.parse(canonical);await assertSnapshotExport(c,ctx,payload.reviewed.snapshot);await assertSnapshotExport(c,ctx,payload.result.snapshot);for(const effect of payload.result.effects)await assertSnapshotExport(c,ctx,effect);
 return {canonical,sha256:str(row.sha256),filename:`Syntherisk-signature-${row.id}.json`};
});}
