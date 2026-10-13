import {richTextHtml} from '../lib/rich-text';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {stringify} from 'csv-stringify/sync';
import {query,transaction} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {collectExportRecords,exportColumns,csvSafe,assertRecordExport} from '../lib/io';
import {exportAnalytics,reportSheets} from '../lib/analytics-export';
import {workbook,type Sheet} from '../lib/xlsx';
import {contactCards,calendarFile} from '../lib/contact-calendar-export';
import {escapeHtml} from '../lib/record-print';
import {readPreferences} from '../lib/preferences';
import {localeIndex,translate,type Locale} from '../locales';
import {resources} from '../domain/registry';
import {operationAccess} from '../domain/core';
import {get,createInTransaction} from '../domain/service';
import {privacyGraphPredicate} from '../domain/privacy-scope';
import {privateDestination} from './files-workspace';
import {ProviderError} from './adapters';
import {type Session,type Data,type Sharing,requireScope,sharing,pages,enc,hash,stage,session,liveContext} from './workspace-core';

export const cloudFormats=['google_docs','google_sheets','google_forms','pdf','xlsx','csv','json','vcf','ics'] as const;
const schema=z.object({resource:z.string().min(1),record_id:z.uuid().optional(),columns:z.string().optional(),filters:z.record(z.string(),z.string()).default({}),format:z.enum(cloudFormats),folder_id:z.string().regex(/^[A-Za-z0-9_-]+$/),title:z.string().trim().min(1).max(200),snapshot_at:z.iso.datetime(),acknowledge_external_visibility:z.literal(true)});
type Source={resource:string;id:string;version:number};
type Preview=Data&{resource:string;format:string;title:string;folder_id:string;destination:Sharing;sources:Source[];tables:Sheet[];file:{name:string;mime:string;content_base64:string};private_source:boolean;snapshot_at:string;questions?:{title:string;paragraph:boolean}[]};
const formats:Record<string,string>={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',json:'application/json',vcf:'text/vcard',ics:'text/calendar'};
const native:Record<string,string>={google_docs:'application/vnd.google-apps.document',google_sheets:'application/vnd.google-apps.spreadsheet'};
function display(value:unknown):string{return value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);}
function html(title:string,tables:Sheet[]){return `<!doctype html><html><head><meta charset="utf-8"><style>img{max-width:100%;height:auto}body{font-family:Arial,sans-serif;color:#173341}h1{font-size:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccdada;padding:6px;white-space:pre-wrap}th{background:#eef5f4}</style></head><body><h1>${escapeHtml(title)}</h1>${tables.map(t=>`<h2>${escapeHtml(t.name)}</h2><table><tr>${t.columns.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr>${t.rows.map(r=>`<tr>${t.columns.map(c=>`<td>${richTextHtml(display(r[c]))}</td>`).join('')}</tr>`).join('')}</table>`).join('')}</body></html>`;}
async function publicSources(ctx:Context,resource:string,ids:string[]){
 if(!ids.length)return true;
 const anonymous={...ctx,userId:'__google_destination__',roles:['member'],permissions:[]};
 const predicate=privacyGraphPredicate(anonymous,`'${resource}'`,'r.id',false,false);
 const [result]=await query(`SELECT bool_and(${predicate}) AS public FROM unnest($4::uuid[]) r(id)`,[ctx.workspaceId,ctx.companyId,anonymous.userId,ids]);return result.public===true;
}
export async function cloudExportPlan(s:Session,input:Data):Promise<Preview>{
 if(s.row.provider!=='drive')throw new DomainError(422,'INVALID_PROVIDER');requireScope(s,'drive.file','drive');
 const d=schema.parse(input);if(!operationAccess(s.ctx,'documents','create'))throw new DomainError(403,'forbidden');
 const folder=await sharing(s,d.folder_id);if(folder.mimeType!=='application/vnd.google-apps.folder'||!folder.capabilities?.canAddChildren)throw new ProviderError('provider_permission_denied',403);
 const permissions=await pages<NonNullable<Sharing['permissions']>[number]>(s,`/drive/v3/files/${enc(d.folder_id)}/permissions?supportsAllDrives=true&pageSize=100&fields=permissions(id,type,role,emailAddress,domain,permissionDetails),nextPageToken`,'permissions');
 // Ignore volatile folder modifiedTime/version: creating an unrelated sibling is not a conflict.
 const destination:Sharing={id:folder.id,name:folder.name,mimeType:folder.mimeType,driveId:folder.driveId,permissions,capabilities:{canAddChildren:true}};
 const prefs=await readPreferences(s.ctx),locale=(prefs.locale??'zh-TW') as Locale,language=localeIndex(locale);
 let tables:Sheet[],records:Data[]=[],sources:Source[]=[],privateSource=true;
 if(d.resource==='analytics'){
  if(['google_forms','csv','vcf','ics'].includes(d.format))throw new DomainError(422,'EXPORT_FORMAT_UNAVAILABLE');
  const response=await exportAnalytics(s.ctx,{...d.filters,format:'json'}),data=await response.json();tables=reportSheets(data,d.filters,d.snapshot_at);
 }else{
  const definition=resources[d.resource];if(!definition)throw new DomainError(404,'NOT_FOUND');
  const columns=exportColumns(d.resource,d.columns);
  if(d.record_id){const r=await get(s.ctx,d.resource,d.record_id);await assertRecordExport(s.ctx,d.resource,d.record_id);records=[r];}
  else records=await collectExportRecords(s.ctx,d.resource,d.format==='ics'?{...d.filters,expand:'',start_date:'',end_date:''}:d.filters);
  if(records.length>2000)throw new DomainError(413,'EXPORT_TOO_LARGE');
  sources=records.map(r=>({resource:d.resource,id:String(r.id),version:Number(r.version)}));
  privateSource=!(await publicSources(s.ctx,d.resource,sources.map(r=>r.id)));
  const labels=columns.map(c=>definition.fields.find(f=>f.key===c)?.label[language]??translate(locale,c));
  const unique=labels.map((v,i)=>labels.indexOf(v)===i?v:`${v} (${columns[i]})`);
  tables=[{name:definition.label[language],columns:unique,rows:records.map(row=>Object.fromEntries(columns.map((c,i)=>[unique[i],c==='responsible_names'&&Array.isArray(row.responsible_users)?row.responsible_users.map((u:Data)=>u.name).join('、'):row[c]??''])))}];
 }
 privateDestination({is_private:privateSource},destination,String(s.row.google_email));
 if(d.format==='vcf'&&d.resource!=='contacts'||d.format==='ics'&&d.resource!=='events')throw new DomainError(422,'EXPORT_FORMAT_UNAVAILABLE');
 const generatedHtml=html(d.title,tables);let bytes:Buffer,mime:string;
 if(['google_docs','pdf'].includes(d.format)){bytes=Buffer.from(generatedHtml);mime='text/html';}
 else if(['google_sheets','xlsx'].includes(d.format)){bytes=workbook(tables,new Date(d.snapshot_at));mime=formats.xlsx;}
 else if(d.format==='csv'){bytes=Buffer.from('\uFEFF'+stringify(tables[0].rows.map(row=>Object.fromEntries(tables[0].columns.map(c=>[c,csvSafe(row[c])]))),{header:true,columns:tables[0].columns}));mime=formats.csv;}
 else if(d.format==='vcf'){bytes=Buffer.from(contactCards(records));mime=formats.vcf;}
 else if(d.format==='ics'){bytes=Buffer.from(calendarFile(records,d.filters.calendar_from,d.filters.calendar_to,new Date(d.snapshot_at),d.filters.calendar_timezone||'UTC').content);mime=formats.ics;}
 else {bytes=Buffer.from(JSON.stringify({title:d.title,exported_at:d.snapshot_at,tables},null,2));mime=formats.json;}
 if(bytes.length>5_000_000)throw new DomainError(413,'FILE_TOO_LARGE');
 const questions=d.format==='google_forms'?tables[0].columns.map(title=>({title,paragraph:true})):undefined;
 if(questions&&questions.length>100)throw new DomainError(413,'EXPORT_TOO_LARGE');
 return {resource:d.resource,format:d.format,title:d.title,folder_id:d.folder_id,destination,sources,tables:d.format==='google_forms'?[]:tables,private_source:privateSource,snapshot_at:d.snapshot_at,questions,file:{name:d.title+(['google_docs','google_sheets','google_forms'].includes(d.format)?'':'.'+d.format),mime,content_base64:d.format==='google_forms'?'':bytes.toString('base64')},row_count:d.format==='google_forms'?0:tables.reduce((n,t)=>n+t.rows.length,0),erp_document_private:true,forms_unpublished:d.format==='google_forms',fingerprint:hash({sources,tables})};
}
async function upload(s:Session,metadata:Data,mime:string,bytes:Buffer){
 const boundary='syntherisk_'+randomBytes(16).toString('hex');
 const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--`)]);
 return s.adapter.request<{id:string;webViewLink?:string}>(s.tokens,'/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
}
async function checkpoint(id:string,data:Data){await query('UPDATE integration_operations SET result=$1,updated_at=now() WHERE id=$2',[JSON.stringify(data),id]);}
export async function linkCloudExport(s:Session,operationId:string,p:Preview,file:{id:string;url:string}){
 for(const source of p.sources){await get(s.ctx,source.resource,source.id);await assertRecordExport(s.ctx,source.resource,source.id);}
 const item=await stage(s,'drive_file',file.id,{name:p.title,url:file.url,format:p.format,operation_id:operationId});
 return transaction(async c=>{
  await c.query('SELECT id FROM integration_operations WHERE id=$1 FOR UPDATE',[operationId]);
  const [existing]=(await c.query('SELECT document_id FROM cloud_exports WHERE operation_id=$1',[operationId])).rows;if(existing)return {file_id:file.id,url:file.url,document_id:existing.document_id};
  const document=await createInTransaction(c,s.ctx,'documents',{title:p.title,url:file.url,drive_file_id:file.id,is_private:true,content:`${p.title}\n${p.format}\n${p.snapshot_at}`,...(p.sources.length===1?{related_resource:p.sources[0].resource,related_id:p.sources[0].id}:{})});
  await c.query('INSERT INTO cloud_file_library(item_id) VALUES($1) ON CONFLICT DO NOTHING',[item.id]);
  await c.query('INSERT INTO cloud_exports(operation_id,document_id,workspace_id,user_id,file_id,format) VALUES($1,$2,$3,$4,$5,$6)',[operationId,document.id,s.ctx.workspaceId,s.ctx.userId,file.id,p.format]);
  for(const src of p.sources){await c.query('INSERT INTO cloud_export_sources(document_id,resource,record_id,version) VALUES($1,$2,$3,$4)',[document.id,src.resource,src.id,src.version]);await c.query("INSERT INTO integration_item_links(item_id,workspace_id,resource,record_id,origin) VALUES($1,$2,$3,$4,'link') ON CONFLICT DO NOTHING",[item.id,s.ctx.workspaceId,src.resource,src.id]);}
  await c.query("INSERT INTO integration_item_links(item_id,workspace_id,resource,record_id,origin) VALUES($1,$2,'documents',$3,'import') ON CONFLICT DO NOTHING",[item.id,s.ctx.workspaceId,document.id]);
  await c.query("UPDATE integration_items SET resource='documents',record_id=$2,state='linked' WHERE id=$1",[item.id,document.id]);
  return {file_id:file.id,url:file.url,document_id:document.id};
 });
}
export async function writeCloudExport(s:Session,operationId:string,p:Preview){
 let file:{id:string;webViewLink?:string};const properties={syntherisk_operation:operationId};
 if(p.format==='google_forms'){
  const form=await s.adapter.request<{formId:string}>(s.tokens,'/forms/v1/forms?unpublished=true',{method:'POST',body:JSON.stringify({info:{title:p.title,documentTitle:p.title}})});file={id:form.formId};
  await checkpoint(operationId,{file_id:file.id,phase:'created',format:p.format});
  await s.adapter.request(s.tokens,`/forms/v1/forms/${enc(file.id)}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:p.questions?.map((q,index)=>({createItem:{item:{title:q.title,questionItem:{question:{required:false,textQuestion:{paragraph:q.paragraph}}}},location:{index}}}))})});
  await s.adapter.request(s.tokens,`/drive/v3/files/${enc(file.id)}?addParents=${enc(p.folder_id)}&supportsAllDrives=true`,{method:'PATCH',body:JSON.stringify({appProperties:properties})});
 }else{
  const metadata={name:p.title+(p.format==='pdf'?' (PDF source)':p.format in native?'':'.'+p.format),parents:[p.folder_id],appProperties:properties,...(p.format in native||p.format==='pdf'?{mimeType:native[p.format]??native.google_docs}:{})};
  file=await upload(s,metadata,p.file.mime,Buffer.from(p.file.content_base64,'base64'));await checkpoint(operationId,{file_id:file.id,phase:'created',format:p.format});
  if(p.format==='pdf'){
   const original=file.id,pdf=await s.adapter.download(s.tokens,original,'application/pdf');if(!pdf.bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new ProviderError('invalid_pdf_response',502);
   file=await upload(s,{name:p.title+'.pdf',parents:[p.folder_id],appProperties:properties},'application/pdf',pdf.bytes);
   await checkpoint(operationId,{file_id:file.id,phase:'exported',format:p.format,temporary_document_id:original});
   // Recoverable trash only for the temporary document created by this operation.
   await s.adapter.request(s.tokens,`/drive/v3/files/${enc(original)}?supportsAllDrives=true`,{method:'PATCH',body:JSON.stringify({trashed:true})});
  }
 }
 const url=file.webViewLink??`https://drive.google.com/file/d/${file.id}/view`;
 await checkpoint(operationId,{file_id:file.id,url,phase:'exported',format:p.format});
 return linkCloudExport(s,operationId,p,{id:file.id,url});
}
export async function recoverCloudLink(ctx:Context,id:string){
 const [op]=await query('SELECT * FROM integration_operations WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND kind=\'cloud_export\'',[z.uuid().parse(id),ctx.workspaceId,ctx.userId]);
 if(!op||!['succeeded','uncertain'].includes(String(op.status)))throw new DomainError(409,'EXPORT_RECOVERY_UNAVAILABLE');
 const result=op.result as Data;if(!result?.file_id||result.phase!=='exported'&&op.status!=='succeeded')throw new DomainError(409,'EXPORT_RECOVERY_UNAVAILABLE');
 const s=await session(await liveContext({workspace_id:ctx.workspaceId,user_id:ctx.userId},ctx.companyId),op.connection_id),file=await sharing(s,String(result.file_id));
 file.permissions=await pages(s,`/drive/v3/files/${enc(file.id)}/permissions?supportsAllDrives=true&pageSize=100&fields=permissions(id,type,role,emailAddress,domain,permissionDetails),nextPageToken`,'permissions');
 const preview=op.preview as Preview;let restricted=preview.private_source;for(const src of preview.sources){if(!await publicSources(s.ctx,src.resource,[src.id]))restricted=true;}
 privateDestination({is_private:restricted},file,String(s.row.google_email));
 const linked=await linkCloudExport(s,String(op.id),op.preview as Preview,{id:file.id,url:String(result.url??`https://drive.google.com/file/d/${file.id}/view`)});
 await query("UPDATE integration_operations SET status='succeeded',result=$2,last_error=NULL WHERE id=$1",[op.id,JSON.stringify(linked)]);return linked;
}
