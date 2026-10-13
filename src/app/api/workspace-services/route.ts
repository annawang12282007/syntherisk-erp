import {localMailAction,groupRecipients} from '@/integrations/mail-workflows';
import {libraryAction} from '@/integrations/cloud-library';
import {connection} from '@/integrations/service';
import {handle} from '@/lib/http';
import {readJson} from '@/lib/request-body';
import {query} from '@/lib/db';
import {DomainError} from '@/lib/context';
import {ProviderError} from '@/integrations/adapters';
import {session,liveContext,text,uuid,type Data} from '@/integrations/workspace-core';
import {readWorkspace} from '@/integrations/workspace-reads';
import {previewOperation,confirmOperation,operationView} from '@/integrations/operations';
import {saveDraft,reconcileMail} from '@/integrations/gmail';
import {stageSheetRows,flattened} from '@/integrations/workspace-imports';
import {chatAction} from '@/integrations/chat';
import {exportAnalytics,reportSheets} from '@/lib/analytics-export';
import {assertAccess} from '@/domain/service';
import {recoverCloudLink} from '@/integrations/cloud-export';
export async function POST(request:Request){return handle(request,async ctx=>{
 try{
  const data=await readJson(request,7_000_000) as Data,action=text(data.action);
  if(action.startsWith('chat_'))return await chatAction(ctx,action,data);
  if(action==='gmail_group_recipients')return await groupRecipients(ctx,data.group_id);
  if(['gmail_sent_saved','gmail_item_links','gmail_link_items','gmail_unlink_items'].includes(action))return await localMailAction(ctx,action,data);
  if(action==='preview')return await previewOperation(ctx,data);
  if(action==='confirm')return await confirmOperation(ctx,data.operation_id);
  if(action==='cloud_link_recover')return await recoverCloudLink(ctx,String(data.operation_id));
  if(action==='report_names'){const response=await exportAnalytics(ctx,{...(data.filters as Record<string,string>??{}),format:'json'});return reportSheets(await response.json(),{},'').map(sheet=>sheet.name);}
  if(action==='record_links'){const resource=text(data.resource),id=uuid(data.record_id);await assertAccess(ctx,resource,id,'read');return await query('SELECT i.id,i.kind,i.external_id,i.data,i.updated_at,c.provider,c.status FROM integration_items i JOIN integration_connections c ON c.id=i.connection_id WHERE i.workspace_id=$1 AND i.user_id=$2 AND ((i.resource=$3 AND i.record_id=$4) OR EXISTS(SELECT 1 FROM integration_item_links l WHERE l.item_id=i.id AND l.resource=$3 AND l.record_id=$4)) ORDER BY i.updated_at DESC',[ctx.workspaceId,ctx.userId,resource,id]);}
  if(action==='operations')return (await query('SELECT id,connection_id,kind,preview,status,result,last_error,expires_at,created_at FROM integration_operations WHERE workspace_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 50',[ctx.workspaceId,ctx.userId])).map(operationView);
  if(action==='cancel_operation'){await query("UPDATE integration_operations SET status='cancelled' WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND status IN ('preview','queued')",[uuid(data.operation_id),ctx.workspaceId,ctx.userId]);return {cancelled:true};}
  if(['cloud_library','cloud_history','cloud_notes','cloud_remove','cloud_restore'].includes(action))return await libraryAction({ctx,row:await connection(ctx,uuid(data.connection_id))},action,data);
  if(['gmail_save','gmail_drafts'].includes(action)){
   const row=await connection(ctx,uuid(data.connection_id));
   if(row.provider!=='gmail')throw new DomainError(422,'INVALID_PROVIDER');
   const current=await liveContext(row,ctx.companyId);
   if(action==='gmail_save')return await saveDraft({ctx:current,row},data);
   return await query('SELECT * FROM google_mail_drafts WHERE workspace_id=$1 AND user_id=$2 AND connection_id=$3 ORDER BY updated_at DESC LIMIT 100',[ctx.workspaceId,ctx.userId,row.id]);
  }
  const s=await session(ctx,data.connection_id);
  if(action==='gmail_reconcile')return await reconcileMail(s,data.draft_id);
  if(action==='sheet_select')return await stageSheetRows(s,data);
  if(action==='import_fields'){const [item]=await query('SELECT * FROM integration_items WHERE id=$1 AND user_id=$2 AND workspace_id=$3 AND connection_id=$4',[uuid(data.item_id),ctx.userId,ctx.workspaceId,s.row.id]);if(!item)throw new DomainError(404,'NOT_FOUND');return {fields:flattened(item as Parameters<typeof flattened>[0]),schema_hash:(item.data as Data).schema_hash};}
  return await readWorkspace(s,action,data);
 }catch(error){if(error instanceof ProviderError)throw new DomainError(error.status>=400&&error.status<600?error.status:502,error.code);throw error;}
});}
