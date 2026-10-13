import {createHash} from 'node:crypto';
import {query} from '../lib/db';
import {DomainError} from '../lib/context';
import {collectExportRecords,exportColumns} from '../lib/io';
import {exportAnalytics,reportSheets} from '../lib/analytics-export';
import {getFile} from '../lib/storage';
import {type Session,type Data,type Sharing,text,optional,remoteId,record,sharing,assertDestination,requireScope,enc,hash,stage} from './workspace-core';
import {attachment} from './gmail';
import {ProviderError} from './adapters';
export function privateDestination(source:Data,dest:Sharing,email:string){
 if(source.is_private!==true)return;
 if(!dest.permissions?.length||dest.permissions.some(p=>p.type!=='user'||p.emailAddress?.toLowerCase()!==email.toLowerCase()))throw new DomainError(403,'PRIVATE_DESTINATION_REQUIRED');
}
const value=(v:unknown):string|number|boolean=>v===null||v===undefined?'':typeof v==='string'||typeof v==='number'||typeof v==='boolean'?v:JSON.stringify(v);
export function sheetWriteRange(input:string,height:number,width:number){
 const match=/^((?:'[^']+'|[\p{L}\p{N}_ -]+))!([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/u.exec(input);
 if(!match||height<1||width<1)throw new DomainError(422,'EXPLICIT_SHEET_RANGE_REQUIRED');
 const number=(s:string)=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
 const column=(n:number):string=>n>0?column(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):'';
 const startColumn=number(match[2]),startRow=Number(match[3]),endColumn=startColumn+width-1,endRow=startRow+height-1;
 if(endColumn>18278||endRow>10000000||(match[4]&&(endColumn>number(match[4])||endRow>Number(match[5]))))throw new DomainError(422,'SHEET_RANGE_TOO_SMALL');
 return `${match[1]}!${match[2]}${startRow}:${column(endColumn)}${endRow}`;
}
export async function sheetsPlan(s:Session,input:Data){
 if(s.row.provider!=='sheets')throw new DomainError(422,'INVALID_PROVIDER');requireScope(s,'spreadsheets');assertDestination(input);
 const id=remoteId(input.spreadsheet_id),destination=await sharing(s,id);if(!destination.capabilities?.canEdit)throw new ProviderError('provider_permission_denied',403);
 const range=text(input.range,500);if(!/^(?:'[^']+'|[\p{L}\p{N}_ -]+)![A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/u.test(range))throw new DomainError(422,'EXPLICIT_SHEET_RANGE_REQUIRED');
 let rows:Data[],columns:string[];
 if(input.resource==='analytics'){
  const response=await exportAnalytics(s.ctx,{...(input.filters as Record<string,string>??{}),format:'json'}),data=await response.json();
  const tables=reportSheets(data,{},''),selected=tables.find(t=>t.name===input.report_name);if(!selected)throw new DomainError(422,'REPORT_SELECTION_REQUIRED');rows=selected.rows;columns=selected.columns;
  // Reports aggregate private data. Require a private destination unless the report is explicitly shared elsewhere.
  privateDestination({is_private:true},destination,String(s.row.google_email));
 }else{const resource=text(input.resource);rows=await collectExportRecords(s.ctx,resource,input.filters as Record<string,string>??{});columns=exportColumns(resource,optional(input.columns)||undefined);for(const row of rows)privateDestination(row,destination,String(s.row.google_email));}
 if(rows.length>5000||rows.length*columns.length>100000)throw new DomainError(413,'EXPORT_TOO_LARGE');
 const values=[columns,...rows.map(row=>columns.map(key=>value(row[key])))];
 const writeRange=sheetWriteRange(range,values.length,columns.length);
 const current=await s.adapter.request<Data>(s.tokens,`/sheets/v4/spreadsheets/${enc(id)}/values/${enc(writeRange)}?valueRenderOption=FORMULA`);
 return {spreadsheet_id:id,range:writeRange,destination,rows:rows.length,columns,values,current_values:current.values??[],mode:'RAW',direction:'ERP → Google Sheets',concurrency_notice:'The full destination range is rechecked immediately before writing. Google Sheets does not offer an atomic conditional values update; avoid concurrent editors during this operation.'};
}
export async function writeSheet(s:Session,preview:Data){
 const result=await s.adapter.request<Data>(s.tokens,`/sheets/v4/spreadsheets/${enc(String(preview.spreadsheet_id))}/values/${enc(String(preview.range))}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({majorDimension:'ROWS',values:preview.values})});
 return {...result,url:`https://docs.google.com/spreadsheets/d/${preview.spreadsheet_id}/edit`};
}
export async function docsPlan(s:Session,input:Data){
 if(s.row.provider!=='docs')throw new DomainError(422,'INVALID_PROVIDER');requireScope(s,'documents');requireScope(s,'drive.file');assertDestination(input);
 const source=await record(s,input,true),templateId=remoteId(input.template_id),folderId=remoteId(input.folder_id),template=await sharing(s,templateId),destination=await sharing(s,folderId);
 if(template.mimeType!=='application/vnd.google-apps.document'||template.capabilities?.canCopy===false||!destination.capabilities?.canAddChildren)throw new ProviderError('provider_permission_denied',403);
 privateDestination(source.row,destination,String(s.row.google_email));
 const document=await s.adapter.request<Data>(s.tokens,`/docs/v1/documents/${enc(templateId)}?includeTabsContent=true`),mapping=input.mapping as Record<string,string>??{title:'title',content:'content'},allowed=exportColumns(source.resource);
 if(Object.keys(mapping).length>100)throw new DomainError(422,'INVALID_MAPPING');
 const replacements:Record<string,string>={};for(const [placeholder,key] of Object.entries(mapping)){if(!/^[\p{L}\p{N}_. -]{1,80}$/u.test(placeholder)||!allowed.includes(key))throw new DomainError(422,'INVALID_MAPPING');replacements[placeholder]=String(value(source.row[key]));}
 return {source:{resource:source.resource,id:source.id,version:source.row.version},template:{id:templateId,name:template.name,version:template.version,revision:document.revisionId,content_hash:hash(document.tabs??document.body)},destination,folder_id:folderId,title:text(input.title,255),replacements,immutable_signature:false};
}
export async function writeDoc(s:Session,operationId:string,preview:Data){
 const template=preview.template as Data,source=preview.source as Data;
 // Copy is intrinsically non-idempotent. The operation stops as uncertain if its response is lost.
 // appProperties provides an exact reconciliation marker without making a public link.
 const copy=await s.adapter.request<{id:string;webViewLink?:string}>(s.tokens,`/drive/v3/files/${enc(String(template.id))}/copy?supportsAllDrives=true&fields=id,webViewLink`,{method:'POST',body:JSON.stringify({name:preview.title,parents:[preview.folder_id],appProperties:{syntherisk_operation:operationId,syntherisk_source:String(source.id)}})});
 await query('UPDATE integration_operations SET result=$1 WHERE id=$2',[JSON.stringify({document_id:copy.id,phase:'copied'}),operationId]);
 const doc=await s.adapter.request<{revisionId:string}>(s.tokens,`/docs/v1/documents/${enc(copy.id)}`);
 const result=await s.adapter.request<Data>(s.tokens,`/docs/v1/documents/${enc(copy.id)}:batchUpdate`,{method:'POST',body:JSON.stringify({writeControl:{requiredRevisionId:doc.revisionId},requests:Object.entries(preview.replacements as Record<string,string>).map(([key,replaceText])=>({replaceAllText:{containsText:{text:`{{${key}}}`,matchCase:true},replaceText}}))})});
 await stage(s,'generated_doc',copy.id,{source,template,operation_id:operationId,result,document_url:copy.webViewLink??`https://docs.google.com/document/d/${copy.id}/edit`});
 return {document_id:copy.id,url:copy.webViewLink??`https://docs.google.com/document/d/${copy.id}/edit`,source,template,signature_snapshot:false};
}
export async function drivePlan(s:Session,input:Data){
 if(s.row.provider!=='drive')throw new DomainError(422,'INVALID_PROVIDER');requireScope(s,'drive.file');assertDestination(input);
 const folder=remoteId(input.folder_id||s.row.folder_id),destination=await sharing(s,folder);if(destination.mimeType!=='application/vnd.google-apps.folder'||!destination.capabilities?.canAddChildren)throw new ProviderError('provider_permission_denied',403);
 if(input.attachment_id){const file=await attachment(s,text(input.attachment_id));const source=await record(s,{resource:file.resource,record_id:file.record_id},true);privateDestination(source.row,destination,String(s.row.google_email));return {folder_id:folder,destination,file:{id:file.id,name:file.filename,mime:file.mime_type,bytes:file.byte_size,sha256:file.sha256},source:{resource:file.resource,id:file.record_id,version:source.row.version}};}
 let source:Data|undefined;
 if(input.resource&&input.record_id){const selected=await record(s,input,true);privateDestination(selected.row,destination,String(s.row.google_email));source={resource:selected.resource,id:selected.id,version:selected.row.version};}
 const bytes=Buffer.from(text(input.content_base64,7_000_000),'base64'),mime=text(input.mime_type,100);if(bytes.length>5_000_000||!bytes.length)throw new DomainError(413,'FILE_TOO_LARGE');if(!/^[\w.+-]+\/[\w.+-]+$/.test(mime))throw new DomainError(422,'INVALID_MIME');
 return {folder_id:folder,destination,source,file:{name:text(input.filename,255),mime,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
}
export async function writeDrive(s:Session,input:Data,preview:Data){
 const file=preview.file as Data;let bytes:Buffer;
 if(input.attachment_id){const stored=await attachment(s,text(input.attachment_id));bytes=await getFile(stored.storage_key);}else bytes=Buffer.from(String(input.content_base64),'base64');
 if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new DomainError(409,'ATTACHMENT_CHANGED');
 const result=await s.adapter.upload(s.tokens,String(preview.folder_id),String(file.name),String(file.mime),bytes);
 const item=await stage(s,'drive_file',result.id,{...result,source:preview.source??null,sha256:file.sha256});await query('INSERT INTO cloud_file_library(item_id) VALUES($1) ON CONFLICT DO NOTHING',[item.id]);return result;
}
