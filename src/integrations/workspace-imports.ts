import {query,transaction} from '../lib/db';
import {DomainError} from '../lib/context';
import {resources} from '../domain/registry';
import {validate,operationAccess,scope} from '../domain/core';
import {createInTransaction,get,updateInTransaction} from '../domain/service';
import {type Data,type Session,text,strings,uuid,stage,requireScope,enc} from './workspace-core';
import {googleResourceName} from './workspace-reads';
const importable=new Set(['contacts','engagements','work_requests','meetings','handoffs','tasks','decisions','documents','projects']);
const forbidden=new Set(['status','owner_id','responsible_user_ids','is_private','visibility','viewer_user_ids','viewer_team_ids','created_by','updated_by','signed_at','signed_by','approved_by','approved_at']);
type Item=Data&{id:string;kind:string;external_id:string;fingerprint:string;data:Data;resource:string|null;record_id:string|null};
export function flattened(item:Item):Data{
 if(item.kind==='person'){const p=item.data;return {name:(p.names as Data[]??[])[0]?.displayName??'',email:(p.emailAddresses as Data[]??[])[0]?.value??'',phone:(p.phoneNumbers as Data[]??[])[0]?.value??'',job_title:(p.organizations as Data[]??[])[0]?.title??''};}
 if(item.kind==='form_response'){const response=item.data.response as Data,answers=response.answers as Record<string,Data>??{},fields:Data={respondent_email:response.respondentEmail??'',submitted_at:response.lastSubmittedTime??response.createTime};for(const [id,answer] of Object.entries(answers))fields[id]=((answer.textAnswers as Data)?.answers as Data[]??[]).map(a=>a.value).join('\n');return fields;}
 if(item.kind==='meet_conference'){const conference=item.data.conference as Data;return {title:'Meeting '+String(conference.startTime??''),minutes:JSON.stringify(item.data,null,2),content:'',participants:(item.data.participants as Data[]??[]).map(p=>(p.signedinUser as Data)?.displayName??(p.anonymousUser as Data)?.displayName??p.name).join(', ')};}
 if(item.kind==='gmail_message')return {title:item.data.subject,content:item.data.text,notes:item.data.text};
 return item.data;
}
export async function stageSheetRows(s:Session,data:Data){
 if(s.row.provider!=='sheets')throw new DomainError(422,'INVALID_PROVIDER');const id=text(data.spreadsheet_id),range=text(data.range),key=text(data.key_column);
 const result=await s.adapter.request<{values?:unknown[][]}>(s.tokens,`/sheets/v4/spreadsheets/${enc(id)}/values/${enc(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);
 const [rawHeader,...rawRows]=result.values??[],headers=(rawHeader??[]).map(String);if(!headers.includes(key)||new Set(headers).size!==headers.length||headers.some(h=>!h))throw new DomainError(422,'UNIQUE_COLUMN_HEADERS_REQUIRED');
 const selected=strings(data.selected_keys,500),items=[],seen=new Set<string>();
 for(const raw of rawRows){const record=Object.fromEntries(headers.map((h,i)=>[h,raw[i]??''])),externalKey=String(record[key]);if(!selected.includes(externalKey))continue;if(!externalKey||seen.has(externalKey))throw new DomainError(409,'DUPLICATE_IMPORT_KEY');seen.add(externalKey);items.push(await stage(s,'sheet_row',`${id}:${range}:${externalKey}`,record));}
 return items;
}
export async function importPlan(s:Session,input:Data){
 const resource=text(input.resource);if(!importable.has(resource)||!operationAccess(s.ctx,resource,'create'))throw new DomainError(403,'IMPORT_UNAVAILABLE');
 const ids=strings(input.item_ids,500).map(uuid),mapping=input.mapping as Record<string,string>??{},defaults=input.defaults as Data??{};
 const definition=resources[resource],allowed=definition.fields.filter(f=>!f.readonly&&!forbidden.has(f.key)).map(f=>f.key);
 for(const key of [...Object.values(mapping),...Object.keys(defaults)])if(!allowed.includes(key))throw new DomainError(422,'INVALID_MAPPING');
 const rows=[];
 for(const id of ids){const [item]=await query<Item>('SELECT * FROM integration_items WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND connection_id=$4',[id,s.ctx.workspaceId,s.ctx.userId,s.row.id]);if(!item)throw new DomainError(404,'NOT_FOUND');
  if(!['person','form_response','sheet_row','meet_conference','gmail_message'].includes(item.kind))throw new DomainError(422,'IMPORT_UNAVAILABLE');
  if(item.kind==='form_response'&&input.schema_hash!==item.data.schema_hash)throw new DomainError(409,'FORM_SCHEMA_REVIEW_REQUIRED');
  const source=flattened(item),values:Data={...defaults};for(const [column,field] of Object.entries(mapping)){if(!Object.hasOwn(source,column))throw new DomainError(422,'SOURCE_COLUMN_MISSING');values[field]=source[column];}
  values.is_private=true;let error:string|null=null;
  try{await transaction(c=>validate(c,s.ctx,resource,values));}catch(e){error=e instanceof DomainError?e.code:'INVALID_IMPORT_ROW';}
  const mergeId=(input.merge_ids as Record<string,string>??{})[id];let merge:Data|null=null;
  if(mergeId){if(resource!=='contacts')throw new DomainError(422,'MERGE_CONTACTS_ONLY');const target=await get(s.ctx,'contacts',uuid(mergeId));if(!target.is_private)throw new DomainError(403,'PRIVATE_MERGE_TARGET_REQUIRED');merge={id:mergeId,version:target.version};}
  let duplicates:Data[]=[];if(resource==='contacts'&&values.email){const access=scope(s.ctx,'contacts','r');duplicates=await query(`SELECT r.id,r.name FROM contacts r WHERE ${access.sql} AND NOT r.archived AND lower(r.email)=$4 LIMIT 100`,[...access.values,String(values.email).toLowerCase()]);}
  const imported=await query("SELECT record_id FROM integration_item_links WHERE item_id=$1 AND resource=$2 AND origin='import'",[id,resource]);
  rows.push({item_id:id,external_id:item.external_id,fingerprint:item.fingerprint,values,merge,duplicates,skip:imported.length>0||(!merge&&duplicates.length>0),error});
 }
 return {resource,rows,private:true,automatic_approval:false,errors:rows.filter(r=>r.error).length};
}
export async function commitWorkspaceImport(s:Session,preview:Data){
 if(preview.errors)throw new DomainError(422,'IMPORT_VALIDATION_FAILED');const resource=String(preview.resource),results=[];
 for(const item of preview.rows as Data[]){
  if(item.skip){results.push({item_id:item.item_id,skipped:true});continue;}

  const saved=await transaction(async c=>{
   const [current]=(await c.query<Item>('SELECT * FROM integration_items WHERE id=$1 AND workspace_id=$2 AND user_id=$3 FOR UPDATE',[item.item_id,s.ctx.workspaceId,s.ctx.userId])).rows;
   if(!current)throw new DomainError(404,'NOT_FOUND');
   const [existing]=(await c.query("SELECT record_id FROM integration_item_links WHERE item_id=$1 AND resource=$2 AND origin='import'",[current.id,resource])).rows;
   if(existing)return {id:existing.record_id,skipped:true};if(current.fingerprint!==item.fingerprint)throw new DomainError(409,'PREVIEW_CHANGED');
   const merge=item.merge as Data|undefined,record=merge?await updateInTransaction(c,s.ctx,'contacts',String(merge.id),{...(item.values as Data),version:merge.version}):await createInTransaction(c,s.ctx,resource,item.values as Data);
   await c.query("INSERT INTO integration_item_links(item_id,workspace_id,resource,record_id,origin) VALUES($1,$2,$3,$4,'import')",[current.id,s.ctx.workspaceId,resource,record.id]);
   await c.query("UPDATE integration_items SET resource=$1,record_id=$2,state='imported' WHERE id=$3",[resource,record.id,current.id]);return {id:record.id,merged:Boolean(merge)};
  });results.push(saved);
 }
 return {resource,results};
}
export async function peopleWritePlan(s:Session,input:Data){
 if(s.row.provider!=='people'||(s.row.settings as Data)?.writeback_enabled!==true)throw new DomainError(403,'CONTACT_WRITEBACK_DISABLED');requireScope(s,'contacts');
 const personName=googleResourceName(input.person_name,/^people\/[\w-]+$/),contact=await get(s.ctx,'contacts',uuid(input.record_id));
 const {assertRecordExport}=await import('../lib/io');await assertRecordExport(s.ctx,'contacts',String(contact.id));
 const current=await s.adapter.request<Data>(s.tokens,`/people/v1/${personName}?personFields=names,emailAddresses,phoneNumbers,metadata`);
 return {person_name:personName,current,source:{id:contact.id,version:contact.version},values:{names:[{unstructuredName:contact.name}],emailAddresses:contact.email?[{value:contact.email}]:[],phoneNumbers:contact.phone?[{value:contact.phone}]:[]}};
}
export async function writePerson(s:Session,preview:Data){
 const current=preview.current as Data;
 return s.adapter.request(s.tokens,`/people/v1/${preview.person_name}:updateContact?updatePersonFields=names,emailAddresses,phoneNumbers`,{method:'PATCH',body:JSON.stringify({resourceName:preview.person_name,etag:current.etag,metadata:current.metadata,...preview.values as Data})});
}
