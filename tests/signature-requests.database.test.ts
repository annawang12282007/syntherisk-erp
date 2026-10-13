import 'dotenv/config';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import type {Context} from '../src/lib/context';
import type {Row} from '../src/domain/core';
const originalUrl=process.env.DATABASE_URL,originalDir=process.env.ATTACHMENT_DIR,originalBucket=process.env.S3_BUCKET,databaseName=`syntherisk_signature_requests_${randomUUID().replaceAll('-','')}`;
const workspaceId=randomUUID(),companyId=randomUUID(),adminId=randomUUID(),memberId=randomUUID(),otherId=randomUUID(),disabledId=randomUUID(),foreignId=randomUUID();
const admin:Context={workspaceId,companyId,userId:adminId,roles:['admin','operations','finance']},member:Context={...admin,userId:memberId,roles:['member']},other:Context={...member,userId:otherId};
let root:Pool,db:typeof import('../src/lib/db'),api:typeof import('../src/domain/signature-requests'),service:typeof import('../src/domain/service'),storage:typeof import('../src/lib/storage'),scratch:string;
type State={configuration_version:number;record_version:number;enabled:boolean;parties:Row[];requests:Row[];eligible_members:{id:string;name:string}[]};
beforeAll(async()=>{
 if(!originalUrl)throw Error('DATABASE_URL required');root=new Pool({connectionString:originalUrl});await root.query(`CREATE DATABASE "${databaseName}"`);const url=new URL(originalUrl);url.pathname='/'+databaseName;process.env.DATABASE_URL=url.toString();scratch=await mkdtemp(join(tmpdir(),'syntherisk-signature-requests-'));process.env.ATTACHMENT_DIR=scratch;delete process.env.S3_BUCKET;
 db=await import('../src/lib/db');const migrations=join(process.cwd(),'prisma','migrations');for(const entry of(await readdir(migrations,{withFileTypes:true})).filter(item=>item.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join(migrations,entry.name,'migration.sql'),'utf8'));
 api=await import('../src/domain/signature-requests');service=await import('../src/domain/service');storage=await import('../src/lib/storage');
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'Signature request tests']);await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3)',[companyId,workspaceId,'Isolated signatures']);
 for(const[id,label,roles,status]of[[adminId,'Request administrator',['admin','operations','finance'],'active'],[memberId,'Invited signer',['member'],'active'],[otherId,'Other member',['member'],'active'],[disabledId,'Disabled member',['member'],'disabled']]as const){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[id,label,`${id}@example.invalid`]);await db.query('INSERT INTO memberships(workspace_id,user_id,roles,status) VALUES($1,$2,$3,$4)',[workspaceId,id,roles,status]);}
 await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[foreignId,'Outside member',`${foreignId}@example.invalid`]);
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=originalUrl;if(originalDir===undefined)delete process.env.ATTACHMENT_DIR;else process.env.ATTACHMENT_DIR=originalDir;if(originalBucket===undefined)delete process.env.S3_BUCKET;else process.env.S3_BUCKET=originalBucket;if(root){await root.query(`DROP DATABASE IF EXISTS "${databaseName}"`);await root.end();}if(scratch)await rm(scratch,{recursive:true,force:true});});
async function document(extra:Row={}){return service.create(admin,'documents',{title:`Signature document ${randomUUID()}`,content:'Reviewed content',...extra});}
async function configure(row:Row,parties:Row[]=[{kind:'internal',user_id:memberId,label:'Reviewer'}],configuration_version=0,enabled=true){return await api.mutateSignatureRequests(admin,{action:'configure',resource:'documents',record_id:row.id,version:row.version,configuration_version,enabled,parties}) as State;}
async function issue(row:Row,config=1){return await api.mutateSignatureRequests(admin,{action:'issue',resource:'documents',record_id:row.id,version:row.version,configuration_version:config}) as State;}
async function preview(id:unknown,ctx=member,extra:Row={}){return await api.mutateSignatureRequests(ctx,{action:'preview',request_id:id,...extra}) as {reviewed_hash:string;signer_name:string;confirmation_note:string|null};}
async function sign(id:unknown,hash:string,ctx=member,extra:Row={}){return await api.mutateSignatureRequests(ctx,{action:'sign',request_id:id,typed_name:'Invited signer',consent:true,reviewed_hash:hash,...extra}) as State&{receipt_id:string;sha256:string};}
async function attachment(row:Row,bytes=Buffer.from('External signed document bytes')){const id=randomUUID(),key=`${workspaceId}/${id}`;await storage.putFile(key,bytes,'application/pdf');await db.query("INSERT INTO attachments(id,workspace_id,company_id,resource,record_id,filename,mime_type,byte_size,sha256,storage_key,created_by) VALUES($1,$2,$3,'documents',$4,'signed-file.pdf','application/pdf',$5,$6,$7,$8)",[id,workspaceId,companyId,row.id,bytes.length,createHash('sha256').update(bytes).digest('hex'),key,adminId]);return{id,key,bytes};}
describe('optional signature request workflow',()=>{
 it('configures multiple capacities, issues once per unchanged batch, and notifies only eligible internal members',async()=>{
  const row=await document(),before=await api.getSignatureRequests(admin,'documents');expect(before.eligible_members.map(item=>item.id)).toContain(memberId);expect(before.eligible_members.map(item=>item.id)).not.toContain(disabledId);
  const state=await configure(row,[{kind:'internal',user_id:memberId,label:'Reviewer'},{kind:'internal',user_id:otherId,label:'Witness'},{kind:'external',external_name:'External representative',label:'Counterparty'}]);expect(state.enabled).toBe(true);expect((await service.get(admin,'documents',String(row.id))).version).toBe(row.version);
  const issued=await issue(row);expect(issued.requests).toHaveLength(3);expect((await issue(row)).requests).toHaveLength(3);const notifications=await db.query('SELECT user_id,title_key FROM notifications WHERE record_id=$1',[row.id]);expect(notifications).toHaveLength(2);expect(new Set(notifications.map(item=>item.user_id))).toEqual(new Set([memberId,otherId]));expect(notifications.every(item=>item.title_key==='notification.signature_requested')).toBe(true);
 });
 it('requires edit authority and rejects foreign, inactive or currently unreadable recipients',async()=>{
  const row=await document({is_private:true});for(const id of[memberId,disabledId,foreignId])await expect(configure(row,[{kind:'internal',user_id:id,label:'Signer'}])).rejects.toMatchObject({code:'signature_request_recipient_unavailable'});
  const publicRow=await document();await expect(api.mutateSignatureRequests(member,{action:'configure',resource:'documents',record_id:publicRow.id,version:1,configuration_version:0,enabled:true,parties:[{kind:'internal',user_id:memberId,label:'Signer'}]})).rejects.toMatchObject({status:403});
  await expect(api.getSignatureRequests({...admin,workspaceId:randomUUID()},'documents',String(row.id))).rejects.toMatchObject({status:403});
 });
 it('allows only the requested member with current consent/name/hash and retains an immutable receipt',async()=>{
  const row=await document();await configure(row);const requested=(await issue(row)).requests[0];await expect(preview(requested.id,other)).rejects.toMatchObject({code:'signature_request_signer_required'});const review=await preview(requested.id);
  await expect(api.mutateSignatureRequests(member,{action:'sign',request_id:requested.id,typed_name:'Invited signer',consent:false,reviewed_hash:review.reviewed_hash})).rejects.toMatchObject({code:'signature_consent_required'});
  await expect(api.mutateSignatureRequests(member,{action:'sign',request_id:requested.id,typed_name:'Someone else',consent:true,reviewed_hash:review.reviewed_hash})).rejects.toMatchObject({code:'signature_name_mismatch'});await expect(sign(requested.id,'0'.repeat(64))).rejects.toMatchObject({code:'signature_snapshot_changed'});
  const signed=await sign(requested.id,review.reviewed_hash),receipt=await api.signatureRequestReceipt(member,signed.receipt_id);expect(createHash('sha256').update(receipt.canonical).digest('hex')).toBe(receipt.sha256);const payload=JSON.parse(receipt.canonical);expect(payload.signer.user_id).toBe(memberId);expect(payload.signer.typed_name).toBe('Invited signer');expect(payload.label).toBe('Reviewer');expect((await service.get(admin,'documents',String(row.id))).version).toBe(1);
  await expect(db.query('UPDATE signature_request_receipts SET canonical_payload=$1 WHERE id=$2',['tampered',signed.receipt_id])).rejects.toMatchObject({code:'23514'});await expect(db.query('DELETE FROM signature_request_receipts WHERE id=$1',[signed.receipt_id])).rejects.toMatchObject({code:'23514'});await expect(sign(requested.id,review.reviewed_hash)).rejects.toMatchObject({code:'signature_request_not_pending'});
 });
 it('marks content/version changes stale and issues a fresh request without deleting the old batch',async()=>{
  const row=await document();await configure(row);const requested=(await issue(row)).requests[0],review=await preview(requested.id);const updated=await service.update(admin,'documents',String(row.id),{version:1,content:'Revised content'});
  expect((await api.getSignatureRequests(member,'documents',String(row.id))).requests[0].status).toBe('stale');await expect(sign(requested.id,review.reviewed_hash)).rejects.toMatchObject({code:'signature_request_stale'});const next=await issue(updated);expect(next.requests).toHaveLength(2);expect(next.requests.find(item=>item.id===requested.id)?.status).toBe('cancelled');expect(next.requests.filter(item=>item.status==='pending')).toHaveLength(1);
 });
 it('binds optional notes to reviewed signatures, validates them and preserves separate notes for each capacity',async()=>{
  const row=await document();await configure(row,[{kind:'internal',user_id:memberId,label:'Reviewer'},{kind:'internal',user_id:memberId,label:'Witness'}]);
  const requests=(await issue(row)).requests,first=requests.find(item=>item.label==='Reviewer')!,second=requests.find(item=>item.label==='Witness')!;
  for(const note of [null,true,1,{},[]])await expect(preview(first.id,member,{confirmation_note:note})).rejects.toMatchObject({code:'invalid_text'});
  await expect(preview(first.id,member,{confirmation_note:'x'.repeat(4001)})).rejects.toMatchObject({code:'confirmation_note_too_long'});
  await expect(preview(first.id,other,{confirmation_note:'Not my request'})).rejects.toMatchObject({code:'signature_request_signer_required'});
  const body='<!--syntherisk-rich:v1--><strong>Literal reviewer note</strong>\nSecond line';
  const review=await preview(first.id,member,{confirmation_note:`  ${body}  `});expect(review.confirmation_note).toBe(body);
  await expect(sign(first.id,review.reviewed_hash,member,{confirmation_note:'Changed after review'})).rejects.toMatchObject({code:'signature_snapshot_changed'});
  await expect(sign(first.id,review.reviewed_hash)).rejects.toMatchObject({code:'signature_snapshot_changed'});
  expect(await db.query('SELECT id FROM signature_request_receipts WHERE request_id=$1',[first.id])).toHaveLength(0);
  const result=await sign(first.id,review.reviewed_hash,member,{confirmation_note:body}),receipt=await api.signatureRequestReceipt(member,result.receipt_id);
  const payload=JSON.parse(receipt.canonical);expect(payload.reviewed.confirmation_note).toBe(body);expect(payload.signer.user_id).toBe(memberId);expect(createHash('sha256').update(receipt.canonical).digest('hex')).toBe(receipt.sha256);
  const boundary='x'.repeat(4000),secondReview=await preview(second.id,member,{confirmation_note:boundary});await sign(second.id,secondReview.reviewed_hash,member,{confirmation_note:boundary});
  const listed=(await api.getSignatureRequests(admin,'documents',String(row.id))).requests;
  expect(listed.find(item=>item.id===first.id)).toMatchObject({status:'signed',confirmation_note:body,confirmation_note_format:'plain'});
  expect(listed.find(item=>item.id===second.id)).toMatchObject({status:'signed',confirmation_note:boundary,confirmation_note_format:'plain'});
  await expect(sign(first.id,review.reviewed_hash,member,{confirmation_note:'Attempted replacement'})).rejects.toMatchObject({code:'signature_request_not_pending'});
  expect((await api.signatureRequestReceipt(member,result.receipt_id)).canonical).toBe(receipt.canonical);
  await service.update(admin,'documents',String(row.id),{version:row.version,is_private:true});await expect(api.getSignatureRequests(member,'documents',String(row.id))).rejects.toMatchObject({status:404});
 });
 it('keeps blank notes optional and canonical review hashes compatible with clients omitting the field',async()=>{
  const row=await document();await configure(row);const request=(await issue(row)).requests[0];
  const omitted=await preview(request.id),blank=await preview(request.id,member,{confirmation_note:' \n\t '});expect(blank.reviewed_hash).toBe(omitted.reviewed_hash);expect(blank.confirmation_note).toBeNull();
  const signed=await sign(request.id,blank.reviewed_hash),payload=JSON.parse((await api.signatureRequestReceipt(member,signed.receipt_id)).canonical);
  expect(payload.reviewed).not.toHaveProperty('confirmation_note');expect(signed.requests[0]).toMatchObject({confirmation_note:null,confirmation_note_format:'plain'});
 });
 it('hides receipt notes when a historical linked record becomes private after being unlinked',async()=>{
  const linked=await document(),contract=await service.create(admin,'contracts',{title:'Contract with historical linked evidence',document_id:linked.id,kind:'contract'});
  await api.mutateSignatureRequests(admin,{action:'configure',resource:'contracts',record_id:contract.id,version:contract.version,configuration_version:0,enabled:true,parties:[{kind:'internal',user_id:memberId,label:'Reviewer'}]});
  const issued=await api.mutateSignatureRequests(admin,{action:'issue',resource:'contracts',record_id:contract.id,version:contract.version,configuration_version:1}) as State;
  const request=issued.requests[0],note='Note referring to the historical linked document',review=await preview(request.id,member,{confirmation_note:note});
  await sign(request.id,review.reviewed_hash,member,{confirmation_note:note});
  expect((await api.getSignatureRequests(member,'contracts',String(contract.id))).requests[0].confirmation_note).toBe(note);
  await service.update(admin,'contracts',String(contract.id),{version:contract.version,document_id:null});await service.update(admin,'documents',String(linked.id),{version:linked.version,is_private:true});
  expect((await service.get(member,'contracts',String(contract.id))).id).toBe(contract.id);
  expect((await api.getSignatureRequests(member,'contracts',String(contract.id))).requests[0].confirmation_note).toBeNull();
  expect((await api.getSignatureRequests(admin,'contracts',String(contract.id))).requests[0].confirmation_note).toBe(note);
 });
 it('cancels only unsigned requests when disabled and detects concurrent configuration revisions',async()=>{
  const row=await document();await configure(row,[{kind:'internal',user_id:memberId,label:'Signer'},{kind:'internal',user_id:otherId,label:'Witness'}]);const state=await issue(row),mine=state.requests.find(item=>item.user_id===memberId)!;const review=await preview(mine.id);const signed=await sign(mine.id,review.reviewed_hash);
  const changed=await configure(row,[],1,false);expect(changed.requests.find(item=>item.id===mine.id)?.status).toBe('signed');expect(changed.requests.filter(item=>item.status==='cancelled')).toHaveLength(1);expect((await api.signatureRequestReceipt(member,signed.receipt_id)).sha256).toBe(signed.sha256);
  await expect(configure(row,[],1,false)).rejects.toMatchObject({code:'signature_configuration_changed'});
  const fresh=await document(),results=await Promise.allSettled([configure(fresh),configure(fresh)]);expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
 });
 it('rechecks revoked visibility and active membership for preview, signing and receipt downloads',async()=>{
  const row=await document();await configure(row);const requested=(await issue(row)).requests[0],review=await preview(requested.id),signed=await sign(requested.id,review.reviewed_hash);await service.update(admin,'documents',String(row.id),{version:1,is_private:true});await expect(api.signatureRequestReceipt(member,signed.receipt_id)).rejects.toMatchObject({status:404});
  const pendingRow=await document();await configure(pendingRow);const pending=(await issue(pendingRow)).requests[0];await db.query("UPDATE memberships SET status='disabled' WHERE workspace_id=$1 AND user_id=$2",[workspaceId,memberId]);try{await expect(preview(pending.id)).rejects.toMatchObject({code:'signature_request_internal_member_required'});const disabled=await configure(pendingRow,[{kind:'internal',user_id:memberId,label:'Reviewer'}],1,false);expect(disabled.enabled).toBe(false);expect(disabled.requests[0].status).toBe('cancelled');}finally{await db.query("UPDATE memberships SET status='active' WHERE workspace_id=$1 AND user_id=$2",[workspaceId,memberId]);}
 });
 it('records external files with byte verification and archive identity, never impersonating the external signer',async()=>{
  const row=await document();await configure(row,[{kind:'external',external_name:'External person',label:'Counterparty'}]);const requested=(await issue(row)).requests[0],file=await attachment(row);
  await expect(api.mutateSignatureRequests(admin,{action:'sign',request_id:requested.id,typed_name:'External person',consent:true,reviewed_hash:'0'.repeat(64)})).rejects.toMatchObject({code:'signature_request_signer_required'});
  await writeFile(join(scratch,file.key),'tampered');await expect(api.mutateSignatureRequests(admin,{action:'external_record',request_id:requested.id,attachment_id:file.id})).rejects.toMatchObject({code:'signature_attachment_integrity_failed'});await writeFile(join(scratch,file.key),file.bytes);
  const note='<!--syntherisk-rich:v1--><strong>Received signed copy</strong>';
  const result=await api.mutateSignatureRequests(admin,{action:'external_record',request_id:requested.id,attachment_id:file.id,note}) as State&{receipt_id:string};const payload=JSON.parse((await api.signatureRequestReceipt(admin,result.receipt_id)).canonical);expect(payload.authentication).toBe('external_identity_not_authenticated');expect(payload.external_party.claimed_name).toBe('External person');expect(payload.recorded_by.user_id).toBe(adminId);expect(payload.attachment.uploaded_by.user_id).toBe(adminId);expect(payload).not.toHaveProperty('signer');expect(payload.attachment).not.toHaveProperty('storage_key');expect(result.requests[0].status).toBe('external_recorded');expect(result.requests[0].matches_current).toBe(true);expect(result.requests[0]).toMatchObject({confirmation_note:note,confirmation_note_format:'rich'});
 });
 it('rejects an unrelated file or content changes during external file collection',async()=>{
  const row=await document();await configure(row,[{kind:'external',external_name:'External person',label:'Signer'}]);const requested=(await issue(row)).requests[0],otherRow=await document(),foreignFile=await attachment(otherRow);
  await expect(api.mutateSignatureRequests(admin,{action:'external_record',request_id:requested.id,attachment_id:foreignFile.id})).rejects.toMatchObject({code:'signature_attachment_unavailable'});const file=await attachment(row);await service.update(admin,'documents',String(row.id),{version:1,title:'Changed title'});await expect(api.mutateSignatureRequests(admin,{action:'external_record',request_id:requested.id,attachment_id:file.id})).rejects.toMatchObject({code:'signature_request_stale'});
 });
 it('serializes concurrent signing and preserves the original mandatory-signature rule',async()=>{
  const row=await document();await configure(row);const requested=(await issue(row)).requests[0],review=await preview(requested.id),results=await Promise.allSettled([sign(requested.id,review.reviewed_hash),sign(requested.id,review.reviewed_hash)]);expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect((await db.query('SELECT id FROM signature_request_receipts WHERE request_id=$1',[requested.id]))).toHaveLength(1);
  const {requiresSignature}=await import('../src/domain/signatures');expect(requiresSignature('contracts','sign')).toBe(true);expect(requiresSignature('documents','archive')).toBe(false);
 });
 it('does not grant financial authority through an optional request and honors the in-app preference',async()=>{
  const claim=await service.create(member,'expense_claims',{title:'Optional signature claim',currency:'USD'});
  await api.mutateSignatureRequests(member,{action:'configure',resource:'expense_claims',record_id:claim.id,version:1,configuration_version:0,enabled:true,parties:[{kind:'internal',user_id:memberId,label:'Claimant acknowledgement'}]});
  const integrations=await import('../src/integrations/service');const response=await integrations.handleIntegration(member,new Request('http://localhost/api/integrations',{method:'POST',body:JSON.stringify({action:'notification_preference',kind:'signature_requested',enabled:false}),headers:{'Content-Type':'application/json'}}));expect(response.status).toBe(200);
  const issued=await api.mutateSignatureRequests(member,{action:'issue',resource:'expense_claims',record_id:claim.id,version:1,configuration_version:1}) as State;expect(await db.query('SELECT id FROM notifications WHERE record_id=$1',[claim.id])).toHaveLength(0);
  const request=issued.requests[0],review=await preview(request.id);await sign(request.id,review.reviewed_hash);const current=await service.get(member,'expense_claims',String(claim.id));expect(current.status).toBe('draft');expect(current.version).toBe(1);
  const {operationAccess}=await import('../src/domain/core');expect(operationAccess(member,'expense_claims','pay')).toBe(false);expect(operationAccess(member,'journal_entries','post')).toBe(false);
  await db.query("DELETE FROM notification_preferences WHERE workspace_id=$1 AND user_id=$2 AND kind='signature_requested'",[workspaceId,memberId]);
 });
 it('round-trips all request/configuration/batch/receipt tables and immutable receipt bytes through backup restore',async()=>{
  const backupModule=await import('../src/lib/backup'),destination=join(scratch,'backup'),manifest=await backupModule.backup(destination);for(const table of['signature_request_configurations','signature_request_batches','signature_requests','signature_request_receipts'])expect(manifest.counts[table]).toBeGreaterThan(0);
  const restoreName=`syntherisk_signature_restore_${randomUUID().replaceAll('-','')}`;await root.query(`CREATE DATABASE "${restoreName}"`);const targetUrl=new URL(originalUrl!);targetUrl.pathname='/'+restoreName;const target=new Pool({connectionString:targetUrl.toString()});
  try{const migrations=join(process.cwd(),'prisma','migrations');for(const entry of(await readdir(migrations,{withFileTypes:true})).filter(item=>item.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await target.query(await readFile(join(migrations,entry.name,'migration.sql'),'utf8'));
   await backupModule.restore(destination,targetUrl.toString(),join(scratch,'restored-files'));for(const table of['signature_request_configurations','signature_request_batches','signature_requests','signature_request_receipts'])expect((await target.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(manifest.counts[table]);
   expect((await target.query('SELECT id,sha256,canonical_payload FROM signature_request_receipts ORDER BY id')).rows).toEqual(await db.query('SELECT id,sha256,canonical_payload FROM signature_request_receipts ORDER BY id'));await expect(target.query('UPDATE signature_request_receipts SET canonical_payload=canonical_payload')).rejects.toMatchObject({code:'23514'});
  }finally{await target.end();await root.query(`DROP DATABASE IF EXISTS "${restoreName}"`);}
 },60000);
});
