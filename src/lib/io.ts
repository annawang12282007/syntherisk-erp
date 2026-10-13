import {richTextPlain} from './rich-text';
import {parse} from 'csv-parse/sync';
import {stringify} from 'csv-stringify/sync';
import {z} from 'zod';
import {query} from './db';
import {DomainError,hasRole,type Context} from './context';
import {resources} from '../domain/registry';
import {list} from '../domain/service';
import {operationAccess,permissionScope,scope} from '../domain/core';
import {spreadsheet} from './xlsx';
import {calendarFile,contactCards} from './contact-calendar-export';
export function csvSafe(value:unknown){const text=typeof value==='object'&&value!==null?JSON.stringify(value):richTextPlain(value);return /^[\s]*[=+\-@\t\r]/.test(text)?"'"+text:text;}
export async function assertRecordExport(ctx:Context,resource:string,id:string){
 if(!operationAccess(ctx,resource,'export'))throw new DomainError(403,'EXPORT_FORBIDDEN');
 const rule=permissionScope(ctx,resource,'export');if(!rule)return;
 const access=scope({...ctx,permissions:[...(ctx.permissions??[]).filter(item=>item.operation!=='read'),{resource,operation:'read',scope:rule}]},resource);
 if(!(await query(`SELECT r.id FROM ${resources[resource].key} r WHERE ${access.sql} AND r.id=$4`,[...access.values,id])).length)throw new DomainError(403,'EXPORT_FORBIDDEN');
}
export function exportColumns(resource:string,requested?:string){
 const definition=resources[resource];if(!definition)throw new DomainError(404,'NOT_FOUND');
 const allowed=[...new Set(['id',...definition.fields.map(field=>field.key),...(definition.states?['status']:[]),'version','created_at','updated_at'])];
 const selected=requested===undefined?allowed:[...new Set(requested.split(',').filter(Boolean))];
 if(!selected.length||selected.some(key=>!allowed.includes(key)))throw new DomainError(400,'INVALID_EXPORT_COLUMNS');
 const columns=[...selected];for(const key of selected){const field=definition.fields.find(field=>field.key===key);if(key==='owner_id'){columns.push('responsible_user_ids','responsible_names');}else if(field?.type==='reference'){columns.push(key.replace(/_id$/,'')+'_name');}}
 if(selected.some(key=>definition.fields.some(field=>field.key===key&&field.type==='money')))columns.push('currency','currency_minor_digits');
 for(const key of selected)if(['currency','base_currency','source_currency'].includes(key))columns.push(key+'_minor_digits');
 return [...new Set(columns)];
}
export async function collectExportRecords(ctx:Context,resource:string,filters:Record<string,string>){
 if(!operationAccess(ctx,resource,'export'))throw new DomainError(403,'EXPORT_FORBIDDEN');
 const definition=resources[resource];if(!definition)throw new DomainError(404,'NOT_FOUND');
 if(definition.module==='finance'&&!hasRole(ctx,'finance','admin')&&!permissionScope(ctx,resource,'export'))throw new DomainError(403,'EXPORT_FORBIDDEN');
 const rule=permissionScope(ctx,resource,'export'),exportCtx:Context={...ctx,permissions:rule?[...(ctx.permissions??[]).filter(item=>item.operation!=='read'),{resource,operation:'read',scope:rule}]:ctx.permissions};
 const records:Record<string,unknown>[]=[];let scanned=0;
 for(let page=1;;page++){
  const result=await list(ctx,resource,{...filters,page,pageSize:200});let rows=result.rows;
  if(rule&&rows.length){const access=scope(exportCtx,resource);const allowed=await query<{id:string}>(`SELECT r.id FROM ${definition.key} r WHERE ${access.sql} AND r.id=ANY($4::uuid[])`,[...access.values,rows.map(row=>row.id)]);const ids=new Set(allowed.map(row=>row.id));rows=rows.filter(row=>ids.has(String(row.id)));}
  records.push(...rows);scanned+=result.rows.length;if(scanned>100000)throw new DomainError(413,'EXPORT_TOO_LARGE');if(scanned>=result.total||!result.rows.length)break;
 }
 return records;
}
export async function exportRecords(ctx:Context,resource:string,filters:Record<string,string>,format='csv'):Promise<{content:string;bytes?:Uint8Array;mime:string;extension:string}>{
 if(!['csv','xlsx','json','vcf','ics'].includes(format)||(format==='vcf'&&resource!=='contacts')||(format==='ics'&&resource!=='events'))throw new DomainError(400,'EXPORT_FORMAT_UNAVAILABLE');
 const columns=exportColumns(resource,filters.columns),records=await collectExportRecords(ctx,resource,format==='ics'?{...filters,expand:'',start_date:'',end_date:''}:filters);
 const selected=records.map(row=>Object.fromEntries(columns.map(key=>[key,key==='responsible_names'&&Array.isArray(row.responsible_users)?row.responsible_users.map((user:{id:string;name?:string})=>user.name??user.id):row[key]??null])));
 let result:{content:string;bytes?:Uint8Array;mime:string;extension:string};
 if(format==='vcf')result={content:contactCards(records),mime:'text/vcard; charset=utf-8',extension:'vcf'};
 else if(format==='ics')result={content:calendarFile(records,filters.calendar_from,filters.calendar_to,new Date(),filters.calendar_timezone||'UTC').content,mime:'text/calendar; charset=utf-8',extension:'ics'};
 else if(format==='json')result={content:JSON.stringify({resource,columns,exported_at:new Date().toISOString(),records:selected},null,2),mime:'application/json; charset=utf-8',extension:'json'};
 else if(format==='xlsx')result={content:'',bytes:new Uint8Array(spreadsheet(columns,selected,resource)),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',extension:'xlsx'};
 else result={content:'\uFEFF'+stringify(selected.map(row=>Object.fromEntries(columns.map(key=>[key,csvSafe(row[key])]))),{header:true,columns}),mime:'text/csv; charset=utf-8',extension:'csv'};
 await query('INSERT INTO export_jobs(workspace_id,user_id,resource,row_count,filters) VALUES($1,$2,$3,$4,$5)',[ctx.workspaceId,ctx.userId,resource,records.length,JSON.stringify({...filters,format,columns})]);
 return result;
}
export async function previewImport(ctx:Context,input:Record<string,unknown>){
 const v=z.object({resource:z.string(),csv:z.string().min(1).max(2_000_000),mapping:z.record(z.string(),z.string()).optional(),duplicate_strategy:z.enum(['skip','reject','create']).default('skip')}).parse(input);const def=resources[v.resource];if(!def||def.readonly)throw new DomainError(400,'IMPORT_UNAVAILABLE');if(ctx.roles.every(r=>r==='external'))throw new DomainError(403,'FORBIDDEN');
 let raw:Record<string,string>[];try{raw=parse(v.csv,{columns:true,bom:true,skip_empty_lines:true,trim:true,max_record_size:100_000}) as Record<string,string>[];}catch{throw new DomainError(400,'CSV_INVALID');}if(raw.length>5000)throw new DomainError(413,'IMPORT_TOO_LARGE');
 const errors:{row:number;field:string;code:string}[]=[];const duplicates:{row:number;id:string}[]=[];const rows:Record<string,unknown>[]=[];const seen=new Set<string>();
 for(let i=0;i<raw.length;i++){const row:Record<string,unknown>={};for(const[key,value]of Object.entries(raw[i])){const mapped=v.mapping?.[key]??key;const field=def.fields.find(f=>f.key===mapped);if(!field||field.readonly){if(value&&mapped)errors.push({row:i+2,field:mapped,code:'UNKNOWN_FIELD'});continue;}if(!value){if(field.required)errors.push({row:i+2,field:mapped,code:'REQUIRED'});continue;}row[mapped]=field.type==='boolean'?value==='true':field.type==='number'?Number(value):value;if(field.type==='boolean'&&!['true','false'].includes(value))errors.push({row:i+2,field:mapped,code:'INVALID_BOOLEAN'});if(field.type==='number'&&!Number.isFinite(Number(value)))errors.push({row:i+2,field:mapped,code:'INVALID_NUMBER'});if(field.type==='money'&&!(v.resource==='bank_transactions'&&mapped==='amount_minor'?/^-?\d+$/:/^\d+$/).test(value))errors.push({row:i+2,field:mapped,code:'INVALID_MONEY'});if(field.type==='email'&&!z.email().safeParse(value).success)errors.push({row:i+2,field:mapped,code:'INVALID_EMAIL'});if(field.options&&!field.options.includes(value))errors.push({row:i+2,field:mapped,code:'INVALID_OPTION'});}
 for(const field of def.fields)if(field.required&&!row[field.key])errors.push({row:i+2,field:field.key,code:'REQUIRED'});
 const key=String(row.email??row[def.titleField]??'').toLowerCase();if(key){let found:string|undefined;if(seen.has(key))found='within_file';else if(v.resource==='contacts'||v.resource==='organizations'){const column=v.resource==='contacts'&&row.email?'email':def.titleField;const existing=await list(ctx,v.resource,{q:String(row[column]),pageSize:200});found=String(existing.rows.find(x=>String(x[column]).toLowerCase()===key)?.id??'')||undefined;}if(found){duplicates.push({row:i+2,id:found});if(v.duplicate_strategy==='reject')errors.push({row:i+2,field:def.titleField,code:'DUPLICATE'});if(v.duplicate_strategy==='skip')row._skip=true;}seen.add(key);}rows.push(row);}
 const [job]=await query<{id:string}>('INSERT INTO import_jobs(workspace_id,user_id,resource,status,row_count,errors,payload) VALUES($1,$2,$3,\'preview\',$4,$5,$6) RETURNING id',[ctx.workspaceId,ctx.userId,v.resource,rows.length,JSON.stringify(errors),JSON.stringify(rows)]);return{preview_id:job.id,rows:rows.slice(0,100),errors,duplicates,total:rows.length,valid:errors.length===0};
}
