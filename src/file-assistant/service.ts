import {analyzeWorkspace,workspaceDetail,confirmWorkspace} from '../workspace-assistant/service';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {pool,query,transaction} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {putFile,getFile,removeFile} from '../lib/storage';
import {assertRecordExport} from '../lib/io';
import {assertOperation,find,operationAccess,isExternal,audit,str,type Client,type Row} from '../domain/core';
import {createInTransaction,updateInTransaction,list} from '../domain/service';
import {modeSchema,noteResources,validatePlan,type Mode,type Plan,type Source,type Target,type Preview} from './schema';
import {expandUploads,fileContent,type Upload,MAX_BYTES} from './files';
import {configuration,countInput,generate,AssistantProviderError} from './provider';
import {budgetStatus,beginUsage,settle} from './budget';
import {buildPreview,fingerprint,receiptFingerprint} from './preview';

type Run={id:string;workspace_id:string;company_id:string;user_id:string;mode:Mode;instruction:string;supplement:string;targets:Target[];status:string;attempt:number;version:number;plan:Plan|null;preview:Preview|null;fingerprint:string|null;result:unknown;error_code:string|null;deleted_at:unknown};
const targetInput=z.array(z.object({resource:z.enum(noteResources),id:z.string().uuid()}).strict()).max(30);
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function guard(ctx:Context){if(!ctx.roles.length||isExternal(ctx))throw new DomainError(403,'FORBIDDEN');}
export function allowedModes(ctx:Context):Mode[]{
 if(!ctx.roles.length||isExternal(ctx))return[];
 const modes:Mode[]=['workspace','personal'];
 if(operationAccess(ctx,'contacts','create'))modes.push('contacts');
 if(['vendor_bills','bill_lines','suppliers','documents'].every(r=>operationAccess(ctx,r,'create')))modes.push('receipts');
 if(noteResources.some(r=>operationAccess(ctx,r,'edit')&&operationAccess(ctx,r,'export')))modes.push('notes');return modes;
}
function requireMode(ctx:Context,mode:Mode){guard(ctx);if(!allowedModes(ctx).includes(mode))throw new DomainError(403,'FORBIDDEN');}
async function owned(c:Client,ctx:Context,id:string,lock=false){guard(ctx);const row=(await c.query('SELECT * FROM file_assistant_runs WHERE id=$1 AND workspace_id=$2 AND company_id=$3 AND user_id=$4 AND deleted_at IS NULL'+(lock?' FOR UPDATE':''),[z.uuid().parse(id),ctx.workspaceId,ctx.companyId,ctx.userId])).rows[0] as Run|undefined;if(!row)throw new DomainError(404,'NOT_FOUND');return row;}
async function sources(c:Client,run:string):Promise<Source[]>{return(await c.query('SELECT * FROM file_assistant_files WHERE run_id=$1 AND deleted_at IS NULL ORDER BY id',[run])).rows;}
async function currentContext(run:Run,c:Client=pool):Promise<Context>{
 const member=(await c.query("SELECT roles FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'",[run.workspace_id,run.user_id])).rows[0];if(!member)throw new DomainError(403,'FORBIDDEN');
 const permissions=member.roles.includes('admin')?[]:(await c.query('SELECT resource,operation,scope FROM effective_permissions($1,$2,$3::text[])',[run.workspace_id,run.user_id,member.roles])).rows;
 return{userId:run.user_id,workspaceId:run.workspace_id,companyId:run.company_id,roles:member.roles,permissions};
}
async function selectedTargets(ctx:Context,input:unknown,c:Client=pool):Promise<Target[]>{
 const targets=targetInput.parse(input),seen=new Set<string>(),result:Target[]=[];
 for(const target of targets){if(seen.has(target.id))throw new DomainError(422,'ASSISTANT_INVALID_TARGETS');seen.add(target.id);
  const row=await find(c,ctx,target.resource,target.id,true);await assertOperation(c,ctx,target.resource,'edit',row);await assertRecordExport(ctx,target.resource,target.id);
  if(row.archived||target.resource==='vendor_bills'&&!['draft','returned'].includes(str(row.status)))throw new DomainError(409,'ASSISTANT_RECORD_LOCKED');
  if(str(row.notes).length>20_000)throw new DomainError(422,'ASSISTANT_INPUT_TOO_LARGE');
  result.push({...target,version:Number(row.version),title:str(row.title||row.name||row.id),notes:str(row.notes)});
 }return result;
}
export async function targetChoices(ctx:Context,resource:unknown,q:string){
 requireMode(ctx,'notes');const key=z.enum(noteResources).parse(resource);
 if(!operationAccess(ctx,key,'edit')||!operationAccess(ctx,key,'export'))throw new DomainError(403,'FORBIDDEN');
 const page=await list(ctx,key,{q:q.slice(0,120),pageSize:'100'}),out:Target[]=[];
 for(const row of page.rows){try{out.push(...await selectedTargets(ctx,[{resource:key,id:row.id}]));}catch{/* Hide records the user cannot edit and export. */}}
 return out.slice(0,50);
}
export async function overview(ctx:Context){guard(ctx);return{budget:await budgetStatus(ctx),modes:allowedModes(ctx).filter(m=>m!=='notes'),note_resources:noteResources.filter(r=>operationAccess(ctx,r,'edit')&&operationAccess(ctx,r,'export')),runs:await query('SELECT id,mode,instruction,status,attempt,created_at,updated_at,error_code FROM file_assistant_runs WHERE workspace_id=$1 AND company_id=$2 AND user_id=$3 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50',[ctx.workspaceId,ctx.companyId,ctx.userId])};}
export async function detail(ctx:Context,id:string){const run=await owned(pool,ctx,id);requireMode(ctx,run.mode);if(['workspace','personal'].includes(run.mode))return workspaceDetail(ctx,id);if(run.mode==='notes')for(const target of run.targets){await find(pool,ctx,target.resource,target.id);await assertRecordExport(ctx,target.resource,target.id);}const files=await sources(pool,id);return{...run,files:files.map(file=>({id:file.id,filename:file.filename,mime_type:file.mime_type,byte_size:file.byte_size,sha256:file.sha256})),usage:await query('SELECT model,attempt,actual_microusd,reserved_microusd,state FROM file_assistant_usage WHERE run_id=$1 ORDER BY attempt',[id])};}
export async function sourceDownload(ctx:Context,id:string,fileId:string){await owned(pool,ctx,id);const file=(await sources(pool,id)).find(f=>f.id===fileId);if(!file)throw new DomainError(404,'NOT_FOUND');const bytes=await getFile(file.storage_key);if(hash(bytes)!==file.sha256)throw new DomainError(500,'ASSISTANT_SOURCE_CHANGED');return new Response(new Uint8Array(bytes),{headers:{'Content-Type':file.mime_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});}
export async function upload(ctx:Context,input:Record<string,unknown>,raw:Upload[]){
 const mode=modeSchema.parse(input.mode);requireMode(ctx,mode);if(!configuration().configured)throw new DomainError(503,'ASSISTANT_NOT_CONFIGURED');
 const instruction=z.string().trim().min(2).max(6000).parse(input.instruction),targets=mode==='notes'?await selectedTargets(ctx,input.targets??[]):[];
 if(mode==='notes'&&!targets.length)throw new DomainError(422,'ASSISTANT_INVALID_TARGETS');
 const files=expandUploads(raw);if(['contacts','receipts'].includes(mode)&&!files.length)throw new DomainError(422,'ASSISTANT_FILES_REQUIRED');
 const written:string[]=[];try{return await transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['file-assistant-upload:'+ctx.workspaceId+':'+ctx.userId]);
  const active=(await c.query("SELECT count(*)::int count FROM file_assistant_runs WHERE workspace_id=$1 AND user_id=$2 AND deleted_at IS NULL AND (status IN ('queued','analyzing') OR created_at>now()-interval '1 minute')",[ctx.workspaceId,ctx.userId])).rows[0].count;
  if(active>0)throw new DomainError(429,'ASSISTANT_BUSY');
  const used=Number((await c.query('SELECT COALESCE(sum(f.byte_size),0)::text bytes FROM file_assistant_files f JOIN file_assistant_runs r ON r.id=f.run_id WHERE r.workspace_id=$1 AND r.user_id=$2 AND f.deleted_at IS NULL',[ctx.workspaceId,ctx.userId])).rows[0].bytes);
  if(used+files.reduce((n,f)=>n+f.bytes.length,0)>MAX_BYTES*5)throw new DomainError(413,'ASSISTANT_STORAGE_LIMIT');
  const id=randomUUID();await c.query('INSERT INTO file_assistant_runs(id,workspace_id,company_id,user_id,mode,instruction,targets) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,ctx.workspaceId,ctx.companyId,ctx.userId,mode,instruction,JSON.stringify(targets)]);
  for(const file of files){const fileId=randomUUID(),key=ctx.workspaceId+'/'+randomUUID();await putFile(key,file.bytes,file.mime);written.push(key);await c.query('INSERT INTO file_assistant_files(id,run_id,workspace_id,filename,mime_type,byte_size,sha256,storage_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[fileId,id,ctx.workspaceId,file.filename,file.mime,file.bytes.length,hash(file.bytes),key]);}
  await audit(c,ctx,'file_assistant',id,'upload',null,{mode,files:files.length,targets:targets.length});await c.query('UPDATE file_assistant_runs SET locale=$2 WHERE id=$1',[id,z.enum(['zh-CN','zh-TW','en']).parse(input.locale??'zh-CN')]);return{id};
 });}catch(error){await Promise.allSettled(written.map(removeFile));throw error;}
}
export async function enqueue(ctx:Context,id:string,supplement:unknown){
 const extra=z.string().trim().max(6000).parse(supplement??'');
 return transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['file-assistant-upload:'+ctx.workspaceId+':'+ctx.userId]);
  const run=await owned(c,ctx,id,true);requireMode(ctx,run.mode);
  if(!['uploaded','needs_input','review','failed'].includes(run.status))throw new DomainError(409,'ASSISTANT_INVALID_STATE');
  if((await c.query("SELECT 1 FROM assistant_operation_results WHERE run_id=$1 AND status='completed'",[id])).rowCount)throw new DomainError(409,'ASSISTANT_PARTIAL_EXECUTION');
  if(run.attempt>=10)throw new DomainError(429,'ASSISTANT_ATTEMPT_LIMIT');
  if((await c.query("SELECT 1 FROM file_assistant_runs WHERE workspace_id=$1 AND user_id=$2 AND id<>$3 AND status IN ('queued','analyzing') AND deleted_at IS NULL",[ctx.workspaceId,ctx.userId,id])).rowCount)throw new DomainError(429,'ASSISTANT_BUSY');
  if((await budgetStatus(ctx)).exhausted)throw new DomainError(429,'ASSISTANT_BUDGET_EXCEEDED');
  const targets=run.mode==='notes'?await selectedTargets(ctx,run.targets.map(t=>({id:t.id,resource:t.resource})),c):[];
  const attempt=run.attempt+1;
  await c.query("UPDATE file_assistant_runs SET status='queued',attempt=$2,supplement=$3,targets=$4,plan=NULL,preview=NULL,fingerprint=NULL,error_code=NULL,version=version+1,updated_at=now() WHERE id=$1",[id,attempt,extra,JSON.stringify(targets)]);
  await c.query("INSERT INTO outbox(workspace_id,kind,payload,dedupe_key) VALUES($1,'file_assistant_analysis',$2,$3)",[ctx.workspaceId,JSON.stringify({run_id:id,attempt}),'file-assistant:'+id+':'+attempt]);
  return{id,status:'queued'};
 });
}
export async function executeAnalysis(workspaceId:string,id:string,attempt:number){
 const type=(await query('SELECT mode FROM file_assistant_runs WHERE id=$1 AND workspace_id=$2',[id,workspaceId]))[0];if(type&&['workspace','personal'].includes(String(type.mode)))return analyzeWorkspace(workspaceId,id,attempt);
 const run=(await query<Run>("UPDATE file_assistant_runs SET status='analyzing',updated_at=now() WHERE id=$1 AND workspace_id=$2 AND attempt=$3 AND status='queued' AND deleted_at IS NULL RETURNING *",[id,workspaceId,attempt]))[0];
 if(!run){
  // A reclaimed job never repeats an uncertain paid request.
  await transaction(async c=>{const stale=await c.query("UPDATE file_assistant_runs SET status='failed',error_code='ASSISTANT_PROVIDER_UNCERTAIN',updated_at=now() WHERE id=$1 AND workspace_id=$2 AND attempt=$3 AND status='analyzing' AND updated_at<now()-interval '9 minutes' RETURNING id",[id,workspaceId,attempt]);if(stale.rowCount)await c.query("UPDATE file_assistant_usage SET state='uncertain' WHERE run_id=$1 AND attempt=$2 AND state='pending'",[id,attempt]);});return;
 }
 await query("UPDATE outbox SET locked_until=now()+interval '10 minutes' WHERE workspace_id=$1 AND dedupe_key=$2 AND status='running'",[workspaceId,'file-assistant:'+id+':'+attempt]);
 let usageId:string|undefined,paidStarted=false,settled=false;
 try{
  const ctx=await currentContext(run);requireMode(ctx,run.mode);
  const targets=run.mode==='notes'?await selectedTargets(ctx,run.targets.map(t=>({resource:t.resource,id:t.id}))):[];
  if(targets.some(t=>run.targets.find(old=>old.id===t.id)?.version!==t.version))throw new DomainError(409,'ASSISTANT_RECORD_CHANGED');
  const files=await sources(pool,id),currencies=await query('SELECT code,minor_digits FROM currencies WHERE workspace_id=$1 AND company_id=$2 AND NOT archived',[ctx.workspaceId,ctx.companyId]);
  const content:Record<string,unknown>[]=[{type:'text',text:JSON.stringify({mode:run.mode,instruction:run.instruction,supplement:run.supplement,currencies,selected_records:targets})}];
  for(const file of files){const bytes=await getFile(file.storage_key);if(hash(bytes)!==file.sha256)throw new DomainError(409,'ASSISTANT_SOURCE_CHANGED');content.push(...await fileContent({bytes,filename:file.filename,mime:file.mime_type},file.id));}
  await countInput(content);usageId=await beginUsage(id,workspaceId,attempt);paidStarted=true;
  const generated=await generate(content);await settle(usageId,generated);settled=true;
  const plan=validatePlan(generated.value,run.mode,files,targets),current=await currentContext(run);requireMode(current,run.mode);
  const preview=await buildPreview(pool,current,plan,files,targets);
  await query("UPDATE file_assistant_runs SET status=$2,plan=$3,preview=$4,fingerprint=$5,updated_at=now(),version=version+1 WHERE id=$1 AND status='analyzing' AND attempt=$6",[id,preview.questions.length?'needs_input':'review',JSON.stringify(plan),JSON.stringify(preview),fingerprint(preview),attempt]);
 }catch(error){
  if(usageId&&!settled)await settle(usageId,null,error instanceof AssistantProviderError?error.uncertain:paidStarted);
  const code=error instanceof DomainError?error.code:error instanceof z.ZodError?'ASSISTANT_INVALID_PLAN':'ASSISTANT_ANALYSIS_FAILED';
  await query("UPDATE file_assistant_runs SET status='failed',error_code=$2,updated_at=now(),version=version+1 WHERE id=$1 AND attempt=$3 AND status='analyzing'",[id,code,attempt]);
 }
}
export async function confirm(ctx:Context,id:string,request:Record<string,unknown>){
 const type=await owned(pool,ctx,id);if(['workspace','personal'].includes(type.mode))return confirmWorkspace(ctx,id,request);
 const selected=z.array(z.string().max(50)).min(1).max(50).parse(request.selected),expected=z.string().length(64).parse(request.fingerprint),written:string[]=[];
 try{return await transaction(async c=>{
  const run=await owned(c,ctx,id,true);
  const current=await currentContext(run,c);requireMode(current,run.mode);
  if(run.status==='completed')return run.result;
  if(run.status!=='review'||!run.plan||!run.preview||run.fingerprint!==expected||run.preview.questions.length)throw new DomainError(409,'ASSISTANT_PREVIEW_CHANGED');
  if(new Set(selected).size!==selected.length)throw new DomainError(422,'ASSISTANT_INVALID_SELECTION');
  // Serialize duplicate checks with other assistant confirmations in this company.
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['file-assistant-commit:'+ctx.workspaceId+':'+ctx.companyId]);
  const files=await sources(c,id),plan=validatePlan(run.plan,run.mode,files,run.targets),fresh=await buildPreview(c,current,plan,files,run.targets);
  const ready=selected.map(key=>fresh.items.find(item=>item.key===key));
  if(ready.some(item=>!item||item.status!=='ready')||selected.some(key=>fingerprint(fresh.items.find(item=>item.key===key))!==fingerprint(run.preview!.items.find(item=>item.key===key))))throw new DomainError(409,'ASSISTANT_PREVIEW_CHANGED');
  const records:{resource:string;id:string;title:string}[]=[];
  for(const item of ready){
   if(!item)continue;const index=Number(item.key.split(':')[1]);let resource:string,row:Row;
   if(item.kind==='contacts'){
    resource='contacts';await assertOperation(c,current,resource,'create');row=await createInTransaction(c,current,resource,item.detail);
   }else if(item.kind==='receipts'){
    for(const r of ['suppliers','vendor_bills','bill_lines','documents'])await assertOperation(c,current,r,'create');
    const data=item.detail,p=plan.receipts[index];let supplierId=data.supplier_id;
    if(!supplierId)supplierId=(await createInTransaction(c,current,'suppliers',{name:p.supplier})).id;
    row=await createInTransaction(c,current,'vendor_bills',{title:p.title,supplier_id:supplierId,currency:p.currency,notes:data.notes});resource='vendor_bills';
    for(const line of p.lines)await createInTransaction(c,current,'bill_lines',{...line,bill_id:row.id});
    const total=(await c.query('SELECT total_minor::text total FROM vendor_bills WHERE id=$1',[row.id])).rows[0].total;if(total!==p.total_minor)throw new DomainError(409,'ASSISTANT_TOTAL_MISMATCH');
    const doc=await createInTransaction(c,current,'documents',{title:p.title,category:'收据 / Receipt',related_resource:'vendor_bills',related_id:row.id,notes:data.notes,content:JSON.stringify({supplier:p.supplier,reference:p.reference,date:p.date,currency:p.currency,total_minor:p.total_minor,payment_evidence:p.payment_evidence},null,2)});
    const source=files.find(f=>f.id===p.source_file)!,bytes=await getFile(source.storage_key);if(hash(bytes)!==source.sha256)throw new DomainError(409,'ASSISTANT_SOURCE_CHANGED');
    const key=ctx.workspaceId+'/'+randomUUID();await putFile(key,bytes,source.mime_type);written.push(key);
    await c.query('INSERT INTO attachments(workspace_id,company_id,resource,record_id,filename,mime_type,byte_size,sha256,storage_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[ctx.workspaceId,ctx.companyId,'documents',doc.id,source.filename,source.mime_type,source.byte_size,source.sha256,key,ctx.userId]);
    await c.query('INSERT INTO file_assistant_origins(workspace_id,company_id,fingerprint,run_id,resource,record_id) VALUES($1,$2,$3,$4,$5,$6)',[ctx.workspaceId,ctx.companyId,receiptFingerprint(p,source),run.id,resource,row.id]);
   }else{
    const target=run.targets.find(t=>t.id===item.detail.target_id)!;resource=target.resource;const before=await find(c,current,resource,target.id,true,true);await assertOperation(c,current,resource,'edit',before);await assertRecordExport(current,resource,target.id);
    row=await updateInTransaction(c,current,resource,target.id,{version:target.version,notes:item.after});
   }
   records.push({resource,id:str(row.id),title:item.title});
  }
  const result={records,count:records.length};await c.query("UPDATE file_assistant_runs SET status='completed',result=$2,updated_at=now(),version=version+1 WHERE id=$1",[id,JSON.stringify(result)]);
  await audit(c,current,'file_assistant',id,'confirm',null,{count:records.length,preview_fingerprint:run.fingerprint,mode:run.mode,records:records.map(r=>({resource:r.resource,id:r.id}))});return result;
 });}catch(error){await Promise.allSettled(written.map(removeFile));throw error;}
}
export async function discard(ctx:Context,id:string){
 const files=await transaction(async c=>{const run=await owned(c,ctx,id,true);if(run.status==='analyzing')throw new DomainError(409,'ASSISTANT_BUSY');const files=await sources(c,id);
  await c.query("UPDATE file_assistant_runs SET deleted_at=now(),instruction='',supplement='',targets='[]',plan=NULL,preview=NULL,updated_at=now(),status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE id=$1",[id]);
  await c.query('UPDATE file_assistant_files SET deleted_at=now() WHERE run_id=$1',[id]);await audit(c,ctx,'file_assistant',id,'delete',null,{files:files.length});return files;
 });await purgeFiles(files);return{deleted:true};
}
async function purgeFiles(files:Source[]){for(const file of files){try{await removeFile(file.storage_key);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')continue;}await query('UPDATE file_assistant_files SET purged_at=now() WHERE id=$1 AND deleted_at IS NOT NULL',[file.id]);}}
export async function maintainAssistant(){
 await purgeFiles(await query<Source>('SELECT * FROM file_assistant_files WHERE deleted_at IS NOT NULL AND purged_at IS NULL LIMIT 20'));
 // Recover a process crash before it could persist the provider result. Never retry
 // a paid request automatically, even if the process died before recording usage.
 await transaction(async c=>{const stale=(await c.query("UPDATE file_assistant_runs SET status='failed',error_code='ASSISTANT_PROVIDER_UNCERTAIN',updated_at=now() WHERE status='analyzing' AND updated_at<now()-interval '11 minutes' RETURNING id,attempt")).rows;for(const run of stale)await c.query("UPDATE file_assistant_usage SET state='uncertain' WHERE run_id=$1 AND state='pending'",[run.id]);});
}
