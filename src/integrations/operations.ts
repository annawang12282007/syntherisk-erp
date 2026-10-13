import {query,transaction} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {ProviderError} from './adapters';
import {type Data,type Session,hash,session,uuid,liveContext,externalError} from './workspace-core';
import {planOperation,performOperation} from './workspace-writes';
type Operation=Data&{id:string;workspace_id:string;company_id:string;user_id:string;connection_id:string;kind:string;input:Data;preview:Data;fingerprint:string;status:string;expires_at:Date;result:Data};
export function operationView(op:Data){
 if(op.kind!=='cloud_export')return op;
 const p=op.preview as Data,file=p.file as Data;
 return {...op,preview:{...p,file:{name:file.name,mime:file.mime},tables:undefined}};
}
export async function previewOperation(ctx:Context,data:Data){
 const s=await session(ctx,data.connection_id),kind=String(data.kind),input=(data.input??{}) as Data;
 if(s.row.paused)throw new DomainError(409,'integration_paused');
 if(kind==='cloud_export')input.snapshot_at=new Date().toISOString();
 const preview=await planOperation(s,kind,input),fingerprint=hash(preview);
 const [op]=await query('INSERT INTO integration_operations(workspace_id,company_id,user_id,connection_id,kind,input,preview,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,kind,preview,status,expires_at',[ctx.workspaceId,ctx.companyId,ctx.userId,s.row.id,kind,JSON.stringify(input),JSON.stringify(preview),fingerprint]);return operationView(op);
}
export async function confirmOperation(ctx:Context,id:unknown){
 return transaction(async client=>{
  const [op]=(await client.query<Operation>('SELECT * FROM integration_operations WHERE id=$1 AND workspace_id=$2 AND user_id=$3 FOR UPDATE',[uuid(id),ctx.workspaceId,ctx.userId])).rows;
  if(!op)throw new DomainError(404,'NOT_FOUND');if(op.status!=='preview')return {id:op.id,status:op.status};
  if(new Date(op.expires_at).getTime()<Date.now())throw new DomainError(409,'PREVIEW_EXPIRED');
  await client.query("UPDATE integration_operations SET status='queued',updated_at=now() WHERE id=$1",[op.id]);
  await client.query("INSERT INTO outbox(workspace_id,kind,payload,dedupe_key) VALUES($1,'workspace_operation',$2,$3) ON CONFLICT(workspace_id,dedupe_key) DO NOTHING",[ctx.workspaceId,JSON.stringify({operation_id:op.id}),`operation:${op.id}`]);
  await client.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,'integrations',$3,'external_write_confirmed',$4)",[ctx.workspaceId,ctx.userId,op.id,JSON.stringify({kind:op.kind,fingerprint:op.fingerprint})]);return {id:op.id,status:'queued'};
 });
}
export async function executeOperation(workspaceId:string,id:string){
 const [op]=await query<Operation>('SELECT * FROM integration_operations WHERE workspace_id=$1 AND id=$2',[workspaceId,id]);
 if(!op||['succeeded','cancelled'].includes(op.status))return;
 // A crashed write is uncertain. Never resend mail, invitations, copies or webhooks blindly.
 if(op.status==='running'||op.status==='uncertain'){
  await query("UPDATE integration_operations SET status='uncertain',last_error='external_result_uncertain' WHERE id=$1",[id]);throw new ProviderError('external_result_uncertain',409);
 }
 if(op.status!=='queued')throw new ProviderError('operation_not_queued',409);
 let writing=false,s:Session|undefined;
 try{
  const ctx=await liveContext({workspace_id:workspaceId,user_id:op.user_id},op.company_id);s=await session(ctx,op.connection_id);
  if(s.row.paused)throw new ProviderError('integration_paused',409);
  const preview=await planOperation(s,op.kind,op.input);
  if(hash(preview)!==op.fingerprint)throw new ProviderError('preview_changed',409);
  const claimed=await query("UPDATE integration_operations SET status='running',updated_at=now() WHERE id=$1 AND status='queued' RETURNING id",[id]);if(!claimed.length)return;
  writing=true;const result=await performOperation(s,op.kind,op.input,op.id,op.preview);
  await query("UPDATE integration_operations SET status='succeeded',result=$1,last_error=NULL,updated_at=now() WHERE id=$2",[JSON.stringify(result),id]);
  await query("UPDATE integration_connections SET status='connected',last_success_at=now(),last_error=NULL WHERE id=$1 AND status<>'disconnected'",[s.row.id]);
 }catch(error){
  const code=error instanceof ProviderError?error.code:error instanceof DomainError?error.code:'integration_failed';
  const [partial]=await query('SELECT result FROM integration_operations WHERE id=$1',[id]);
  const uncertain=writing&&(Boolean(partial?.result)||!(error instanceof ProviderError)||error.retryable||code==='external_result_uncertain');
  const retryable=!writing&&error instanceof ProviderError&&error.retryable;
  await query('UPDATE integration_operations SET status=$1,last_error=$2,updated_at=now() WHERE id=$3',[uncertain?'uncertain':retryable?'queued':'failed',code,id]);if(s)await externalError(s,error);
  throw new ProviderError(uncertain?'external_result_uncertain':code,error instanceof ProviderError?error.status:409,retryable);
 }
}
