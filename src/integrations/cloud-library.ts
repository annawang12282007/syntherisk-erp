import {richString} from '../lib/rich-text-schema';
import {z} from 'zod';
import {query,transaction} from '../lib/db';
import {DomainError} from '../lib/context';
import {type Session,type Data,sharing,stage,remoteId,enc,requireScope,text} from './workspace-core';
import {ProviderError} from './adapters';

export async function rememberFile(s:Session,id:string){
 const file=await sharing(s,id),data={id:file.id,name:file.name,mimeType:file.mimeType,version:file.version,modifiedTime:file.modifiedTime,url:`https://drive.google.com/open?id=${file.id}`};
 const [previous]=await query("SELECT id,data FROM integration_items WHERE connection_id=$1 AND user_id=$2 AND kind='drive_file' AND external_id=$3",[s.row.id,s.ctx.userId,id]);
 const item=await stage(s,'drive_file',id,data);
 await transaction(async c=>{await c.query('INSERT INTO cloud_file_library(item_id) VALUES($1) ON CONFLICT(item_id) DO UPDATE SET version=cloud_file_library.version+CASE WHEN cloud_file_library.removed_at IS NOT NULL THEN 1 ELSE 0 END,removed_at=NULL,updated_at=now()',[item.id]);if(!previous||String((previous.data as Data).version)!==String(data.version)||String((previous.data as Data).name)!==String(data.name))await c.query('INSERT INTO cloud_file_history(item_id,actor_id,action,data) VALUES($1,$2,$3,$4)',[item.id,s.ctx.userId,previous?'observed_change':'added',JSON.stringify(data)]);});
 return {file,item};
}
export async function libraryAction(s:Pick<Session,'ctx'|'row'>,action:string,data:Data){
 if(s.row.provider!=='drive')throw new DomainError(422,'INVALID_PROVIDER');
 if(action==='cloud_library')return query(`SELECT i.id,i.external_id,i.data,i.resource,i.record_id,i.updated_at,l.notes,l.version,l.removed_at FROM integration_items i JOIN cloud_file_library l ON l.item_id=i.id WHERE i.workspace_id=$1 AND i.user_id=$2 AND i.connection_id=$3 AND (l.removed_at IS NOT NULL)=$4 ORDER BY l.updated_at DESC LIMIT 200`,[s.ctx.workspaceId,s.ctx.userId,s.row.id,data.removed===true]);
 const id=z.uuid().parse(data.item_id),[item]=await query('SELECT * FROM integration_items WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND connection_id=$4',[id,s.ctx.workspaceId,s.ctx.userId,s.row.id]);if(!item)throw new DomainError(404,'NOT_FOUND');
 if(action==='cloud_history')return {history:await query('SELECT action,data,created_at FROM cloud_file_history WHERE item_id=$1 ORDER BY created_at DESC LIMIT 100',[id]),links:await query('SELECT resource,record_id,created_at FROM integration_item_links WHERE item_id=$1',[id])};
 if(action==='cloud_remove'||action==='cloud_restore'){
  const version=z.number().int().positive().parse(data.version);
  return transaction(async c=>{const row=(await c.query('UPDATE cloud_file_library SET removed_at=CASE WHEN $4 THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE item_id=$1 AND version=$2 AND (removed_at IS NULL)=$3 RETURNING *',[id,version,action==='cloud_remove',action==='cloud_remove'])).rows[0];if(!row)throw new DomainError(409,'VERSION_CONFLICT');await c.query('INSERT INTO cloud_file_history(item_id,actor_id,action,data) VALUES($1,$2,$3,$4)',[id,s.ctx.userId,action,JSON.stringify({version:row.version,google_file_changed:false})]);return row;});
 }
 if(action==='cloud_notes'){
  const d=z.object({notes:richString(20000),version:z.number().int().min(1)}).parse(data);
  return transaction(async c=>{const [row]=(await c.query('UPDATE cloud_file_library SET notes=$1,version=version+1,updated_at=now() WHERE item_id=$2 AND version=$3 AND removed_at IS NULL RETURNING *',[d.notes,id,d.version])).rows;if(!row)throw new DomainError(409,'VERSION_CONFLICT');await c.query("INSERT INTO cloud_file_history(item_id,actor_id,action,data) VALUES($1,$2,'notes_updated',$3)",[id,s.ctx.userId,JSON.stringify({notes:d.notes,version:row.version})]);return row;});
 }
 throw new DomainError(404,'ACTION_NOT_FOUND');
}
export async function cloudManagePlan(s:Session,input:Data){
 if(s.row.provider!=='drive')throw new DomainError(422,'INVALID_PROVIDER');requireScope(s,'drive.file','drive');
 const action=z.enum(['rename','create']).parse(input.action),name=text(input.name,200);
 if(action==='rename'){
  const file=await sharing(s,remoteId(input.file_id));if(!file.capabilities?.canEdit)throw new ProviderError('provider_permission_denied',403);
  return {action,name,file_id:file.id,old_name:file.name,version:file.version,visibility:file.visibility};
 }
 const type=z.enum(['document','spreadsheet','form','folder']).parse(input.type),folder=await sharing(s,remoteId(input.folder_id));if(!folder.capabilities?.canAddChildren||folder.mimeType!=='application/vnd.google-apps.folder')throw new ProviderError('provider_permission_denied',403);
 if(input.acknowledge_external_visibility!==true)throw new DomainError(422,'DESTINATION_REVIEW_REQUIRED');
 return {action,type,name,folder_id:folder.id,destination:{id:folder.id,name:folder.name,permissions:folder.permissions},unpublished:type==='form'};
}
export async function writeCloudManage(s:Session,operationId:string,p:Data){
 let id=String(p.file_id||'');
 if(p.action==='rename')await s.adapter.request(s.tokens,`/drive/v3/files/${enc(id)}?supportsAllDrives=true`,{method:'PATCH',body:JSON.stringify({name:p.name})});
 else if(p.type==='form'){
  const form=await s.adapter.request<{formId:string}>(s.tokens,'/forms/v1/forms?unpublished=true',{method:'POST',body:JSON.stringify({info:{title:p.name,documentTitle:p.name}})});id=form.formId;
  await query('UPDATE integration_operations SET result=$2 WHERE id=$1',[operationId,JSON.stringify({file_id:id,phase:'created'})]);
  await s.adapter.request(s.tokens,`/drive/v3/files/${enc(id)}?addParents=${enc(String(p.folder_id))}&supportsAllDrives=true`,{method:'PATCH',body:JSON.stringify({appProperties:{syntherisk_operation:operationId}})});
 }else{
  const file=await s.adapter.request<{id:string}>(s.tokens,'/drive/v3/files?supportsAllDrives=true&fields=id',{method:'POST',body:JSON.stringify({name:p.name,mimeType:`application/vnd.google-apps.${p.type}`,parents:[p.folder_id],appProperties:{syntherisk_operation:operationId}})});id=file.id;
 }
 await query('UPDATE integration_operations SET result=$2 WHERE id=$1',[operationId,JSON.stringify({file_id:id,phase:'created'})]);
 const {item}=await rememberFile(s,id);await query('INSERT INTO cloud_file_history(item_id,actor_id,action,data) VALUES($1,$2,$3,$4)',[item.id,s.ctx.userId,String(p.action),JSON.stringify({operation_id:operationId,name:p.name})]);
 return {file_id:id,item_id:item.id,url:`https://drive.google.com/open?id=${id}`};
}
