import {driveBrowseQuery} from './drive-browse';
import {googleIdentityMatches} from '../lib/google-workspace';
import {richString} from '../lib/rich-text-schema';
import {safeMailHtml} from '../lib/mail-content';
import {rememberFile,libraryAction} from './cloud-library';
import {z} from 'zod';
import {query} from '../lib/db';
import {DomainError} from '../lib/context';
import {ProviderError} from './adapters';
import {get,update} from '../domain/service';
import {type Session,type Data,text,optional,remoteId,enc,pages,stage,hash,sharing,linkItem,strings} from './workspace-core';

function provider(s:Session,name:string){if(s.row.provider!==name)throw new DomainError(422,'INVALID_PROVIDER');}
export function googleResourceName(value:unknown,pattern:RegExp){const name=text(value);if(!pattern.test(name))throw new DomainError(422,'INVALID_EXTERNAL_ID');return name;}
export function mailText(part:Data):string{
 const parts=Array.isArray(part.parts)?part.parts as Data[]:[];
 if(part.mimeType==='text/plain'){const body=part.body as Data|undefined;return body?.data?Buffer.from(String(body.data),'base64url').toString('utf8'):'';}
 if(part.mimeType==='text/html'){
  const body=part.body as Data|undefined,html=body?.data?Buffer.from(String(body.data),'base64url').toString('utf8'):'';
  // Render as escaped React text, never execute mail HTML or load tracking images.
  return html.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity:string)=>{const code=entity.toLowerCase();if(code.startsWith('#')){const point=code.startsWith('#x')?parseInt(code.slice(2),16):parseInt(code.slice(1),10);return point>0&&point<=0x10ffff?String.fromCodePoint(point):'';}return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[code];}).trim();
 }
 if(part.mimeType==='multipart/alternative'){const plain=parts.find(p=>p.mimeType==='text/plain');return plain?mailText(plain):parts.map(mailText).filter(Boolean).join('\n');}
 return parts.filter(p=>!p.filename).map(mailText).filter(Boolean).join('\n');
}
export function mailHtml(part:Data):string{
 if(part.filename)return '';
 if(part.mimeType==='text/html'){const body=part.body as Data;return body?.data?safeMailHtml(Buffer.from(String(body.data),'base64url').toString('utf8')):'';}
 return (part.parts as Data[]??[]).map(mailHtml).filter(Boolean).join('');
}
export async function mailAttachment(s:Session,messageId:string,key:string,legacy?:{name:unknown;size:unknown}){
 const message=await s.adapter.request<Data>(s.tokens,`/gmail/v1/users/me/messages/${enc(messageId)}?format=full`);let found:Data|undefined;const candidates:Data[]=[];
 const walk=(part:Data)=>{const body=part.body as Data??{};if(part.filename){candidates.push(part);if(body.attachmentId===key||'part:'+String(part.partId??'')===key)found=part;}for(const child of part.parts as Data[]??[])walk(child);};walk(message.payload as Data??{});
 if(!found&&legacy&&!key.startsWith('part:')){const matches=candidates.filter(p=>p.filename===legacy.name&&Number((p.body as Data)?.size)===Number(legacy.size));if(matches.length===1)found=matches[0];}
 if(!found)throw new DomainError(404,'NOT_FOUND');const selected=found as Data,body=selected.body as Data??{};
 if(Number(body.size)>5_000_000)throw new DomainError(413,'FILE_TOO_LARGE');
 const content=body.data?body:body.attachmentId?await s.adapter.request<Data>(s.tokens,`/gmail/v1/users/me/messages/${enc(messageId)}/attachments/${enc(String(body.attachmentId))}`):null;
 if(!content||typeof content.data!=='string')throw new DomainError(404,'ATTACHMENT_UNAVAILABLE');const bytes=Buffer.from(content.data,'base64url');
 if(bytes.length>5_000_000)throw new DomainError(413,'FILE_TOO_LARGE');
 return {filename:String(selected.filename).replace(/[\r\n\x00-\x1f\/\\]/g,'_'),mime:String(selected.mimeType||'application/octet-stream'),bytes};
}
export async function getMail(s:Session,id:string){
 const message=await s.adapter.request<Data>(s.tokens,`/gmail/v1/users/me/messages/${enc(id)}?format=full`),payload=message.payload as Data??{};
 const hydrate=async(part:Data):Promise<void>=>{const body=part.body as Data??{};if(!part.filename&&['text/plain','text/html'].includes(String(part.mimeType))&&!body.data&&body.attachmentId&&Number(body.size)<=1_000_000){const result=await s.adapter.request<Data>(s.tokens,`/gmail/v1/users/me/messages/${enc(id)}/attachments/${enc(String(body.attachmentId))}`);if(typeof result.data==='string'&&result.data.length<=1_400_000)part.body={...body,data:result.data};}for(const child of part.parts as Data[]??[])await hydrate(child);};await hydrate(payload);
 const headers=payload.headers as {name:string;value:string}[]??[],header=(name:string)=>headers.find(h=>h.name.toLowerCase()===name)?.value??'';
 const attachments:Data[]=[];function walk(part:Data){const body=part.body as Data??{};if(part.filename)attachments.push({name:part.filename,mime:part.mimeType,size:body.size,attachment_id:body.attachmentId||body.data?'part:'+String(part.partId??''):null});for(const child of part.parts as Data[]??[])walk(child);}walk(payload);
 return {id:message.id,internal_date:String(message.internalDate??0),labels:(message.labelIds??[]) as string[],draft_marker:header('x-syntherisk-draft-id'),thread_id:message.threadId,history_id:message.historyId,from:header('from'),to:header('to'),cc:header('cc'),subject:header('subject'),date:header('date'),message_id:header('message-id'),text:mailText(payload),html:mailHtml(payload),snippet:message.snippet,attachments};
}
export async function pollForms(s:Session){
 provider(s,'forms');const settings=s.row.settings as Data??{},formId=remoteId(settings.form_id);
 const form=await s.adapter.request<Data>(s.tokens,`/forms/v1/forms/${enc(formId)}`),schemaHash=hash(form.items??[]);
 // Full pagination deliberately catches edits to older replies. No cursor can silently skip an edited response.
 const responses=await pages<Data>(s,`/forms/v1/forms/${enc(formId)}/responses?pageSize=500`,'responses');
 for(const response of responses)await stage(s,'form_response',`${formId}:${response.responseId}`,{form_id:formId,schema_hash:schemaHash,schema:form.items??[],response});
 const changed=Boolean(settings.schema_hash&&settings.schema_hash!==schemaHash);
 await query('UPDATE integration_connections SET settings=settings||$1::jsonb,last_success_at=now(),last_error=$2 WHERE id=$3',[JSON.stringify({schema_hash:schemaHash,mapping_review_required:changed||settings.mapping_review_required===true}),changed?'form_schema_changed':null,s.row.id]);
 return {count:responses.length,schema_changed:changed};
}
export async function readWorkspace(s:Session,action:string,data:Data):Promise<unknown>{
 const {adapter:a,tokens:t,row}=s;
 if(['cloud_library','cloud_history','cloud_notes'].includes(action))return libraryAction(s,action,data);
 if(action==='drives'){provider(s,'drive');return a.drives(t);}
 if(action==='drive_browse'){
  provider(s,'drive');return a.request(t,'/drive/v3/files?'+driveBrowseQuery(data));
 }
 if(action==='verify'){
  const identity=await a.identity(t);if(!googleIdentityMatches(identity,String(row.google_email)))throw new ProviderError('google_account_mismatch',403);
  const probes:Record<string,string>={meet:'/meet/v2/conferenceRecords?pageSize=1',gmail:'/gmail/v1/users/me/profile',sheets:'/drive/v3/files?pageSize=1&fields=files(id)&q=mimeType%3D%27application%2Fvnd.google-apps.spreadsheet%27',docs:'/drive/v3/files?pageSize=1&fields=files(id)',forms:'',people:'/people/v1/people/me/connections?pageSize=1&personFields=names'};
  if(row.provider==='calendar')await a.calendars(t);else if(row.provider==='drive'){if(row.folder_id)await sharing(s,row.folder_id);else await a.request(t,'/drive/v3/files?pageSize=1&fields=files(id)');}else if(probes[row.provider])await a.request(t,probes[row.provider]);else if(row.provider==='forms'){const selected=(row.settings as Data)?.form_id;if(selected)await a.request(t,`/forms/v1/forms/${enc(remoteId(selected))}`);else return {identity_verified:true,resource_verified:false,requires:'form_id'};}
  await query("UPDATE integration_connections SET status='connected',last_access_verified_at=now(),last_error=NULL WHERE id=$1",[row.id]);return {identity_verified:true,resource_verified:true};
 }
 if(action==='items'){
  const page=Math.max(1,Math.min(10000,Number(data.page)||1));if(!Number.isInteger(page))throw new DomainError(422,'INVALID_PAGE');
  const items=await query('SELECT id,kind,external_id,data,state,resource,record_id,updated_at FROM integration_items WHERE workspace_id=$1 AND user_id=$2 AND connection_id=$3 ORDER BY updated_at DESC,id DESC LIMIT 101 OFFSET $4',[s.ctx.workspaceId,s.ctx.userId,row.id,(page-1)*100]);
  return {items:items.slice(0,100),next_page:items.length>100?page+1:null};
 }
 if(action==='link_item')return linkItem(s,data.item_id,data.resource,data.record_id);
 if(action==='files'){
  if(!['drive','docs','sheets'].includes(row.provider))throw new DomainError(422,'INVALID_PROVIDER');
  const type=row.provider==='docs'?'application/vnd.google-apps.document':row.provider==='sheets'?'application/vnd.google-apps.spreadsheet':undefined;
  if(type)return a.request(t,`/drive/v3/files?${new URLSearchParams({pageSize:'100',supportsAllDrives:'true',includeItemsFromAllDrives:'true',q:`trashed=false and mimeType='${type}'`,fields:'nextPageToken,files(id,name,webViewLink,driveId)',...(data.page_token?{pageToken:text(data.page_token)}:{})})}`);
  return a.driveFiles(t,optional(data.drive_id)||undefined,optional(data.folder_id)||row.folder_id||undefined,optional(data.page_token)||undefined);
 }
 if(action==='file'){if(!['drive','docs','sheets','meet'].includes(row.provider))throw new DomainError(422,'INVALID_PROVIDER');return sharing(s,remoteId(data.file_id));}
 if(action==='download'){
  if(!['drive','docs','meet'].includes(row.provider))throw new DomainError(422,'INVALID_PROVIDER');const file=await sharing(s,remoteId(data.file_id));
  if(file.capabilities?.canDownload===false)throw new ProviderError('provider_permission_denied',403);
  const result=await a.download(t,file.id,optional(data.export_mime)||undefined);return {filename:file.name,mime:result.mime,content_base64:result.bytes.toString('base64'),content_verified:true};
 }
 if(action==='calendar_events'){provider(s,'calendar');return a.listEvents(t,remoteId(data.calendar_id||row.calendar_id),undefined,optional(data.page_token)||undefined);}
 if(action==='meet_status'){
  provider(s,'calendar');const calendarId=text(data.calendar_id||row.calendar_id),externalId=remoteId(data.event_id),event=await a.getEvent(t,calendarId,externalId) as unknown as Data;
  const conference=event.conferenceData as Data|undefined,points=conference?.entryPoints as Data[]??[],meetUrl=points.find(p=>p.entryPointType==='video')?.uri??event.hangoutLink;
  const [mapping]=await query('SELECT event_id,local_version,etag,external_snapshot FROM external_event_mappings WHERE workspace_id=$1 AND connection_id=$2 AND external_id=$3',[s.ctx.workspaceId,row.id,externalId]);
  let syncedVersion=Number(mapping?.local_version);
  if(mapping&&meetUrl){const local=await get(s.ctx,'events',String(mapping.event_id));if(local.video_url!==meetUrl)try{const updated=await update(s.ctx,'events',String(mapping.event_id),{version:local.version,video_url:meetUrl});if(Number(local.version)===syncedVersion)syncedVersion=Number(updated.version);}catch(e){if(!(e instanceof DomainError&&[403,409].includes(e.status)))throw e;}}
  if(mapping){
   // Conference creation finishes asynchronously. Advance the ETag only when every
   // non-conference field is unchanged; external schedule/content edits remain conflicts.
   const comparable=(value:Data)=>Object.fromEntries(Object.entries(value).filter(([key])=>!['etag','updated','conferenceData','hangoutLink'].includes(key)));
   if(hash(comparable(mapping.external_snapshot as Data??{}))===hash(comparable(event)))await query('UPDATE external_event_mappings SET etag=$1,external_snapshot=$2,local_version=$3 WHERE connection_id=$4 AND external_id=$5 AND etag IS NOT DISTINCT FROM $6 AND local_version=$7',[event.etag??null,JSON.stringify(event),syncedVersion,row.id,externalId,mapping.etag,mapping.local_version]);
  }
  await stage(s,'meet_link',externalId,{event_id:mapping?.event_id??null,calendar_id:calendarId,conference:conference??null,meet_url:meetUrl??null});
  return {external_id:externalId,meet_url:meetUrl??null,conference_status:((conference?.createRequest as Data)?.status as Data)?.statusCode??(meetUrl?'success':'not_requested'),event};
 }
 if(action==='meet_records'){
  provider(s,'meet');const code=text(data.meeting_code);if(!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code))throw new DomainError(422,'INVALID_MEETING_CODE');
  const filter=`space.meeting_code = "${code}"`;
  return a.request(t,`/meet/v2/conferenceRecords?${new URLSearchParams({filter,pageSize:'100',...(data.page_token?{pageToken:text(data.page_token)}:{})})}`);
 }
 if(action==='meet_details'){
  provider(s,'meet');const name=googleResourceName(data.name,/^conferenceRecords\/[\w-]+$/),conference=await a.request<Data>(t,`/meet/v2/${name}`);
  const participants=await pages<Data>(s,`/meet/v2/${name}/participants?pageSize=100`,'participants');
  for(const participant of participants){const n=googleResourceName(participant.name,/^conferenceRecords\/[\w-]+\/participants\/[\w-]+$/);participant.sessions=await pages(s,`/meet/v2/${n}/participantSessions?pageSize=100`,'participantSessions');}
  const artifact=async(kind:string)=>{try{const rows=await pages<Data>(s,`/meet/v2/${name}/${kind}?pageSize=100`,kind);return {status:!rows.length?'not_produced':rows.some(r=>r.state!=='FILE_GENERATED')?'processing':'available',items:rows.map(r=>({...r,artifact_status:r.state==='FILE_GENERATED'?'available':'processing'}))};}catch(error){if(error instanceof ProviderError)return {status:error.code==='provider_permission_denied'?'permission_denied':'sync_error',code:error.code,items:[]};throw error;}};
  const details={conference,participants,recordings:await artifact('recordings'),transcripts:await artifact('transcripts')};
  return stage(s,'meet_conference',name,details);
 }
 if(action==='transcript'){
  provider(s,'meet');const name=googleResourceName(data.name,/^conferenceRecords\/[\w-]+\/transcripts\/[\w-]+$/);
  return {entries:await pages(s,`/meet/v2/${name}/entries?pageSize=100`,'transcriptEntries')};
 }
 if(action==='gmail_sent_sync'){
  provider(s,'gmail');
  const d=z.object({start:z.iso.date(),end:z.iso.date(),q:z.string().max(2000).default(''),page_token:z.string().max(2000).optional()}).parse(data);
  const start=Date.parse(d.start+'T00:00:00Z'),end=Date.parse(d.end+'T00:00:00Z')+86400000;
  if(start>=end||end-start>366*86400000)throw new DomainError(422,'INVALID_DATE_RANGE');
  const q='after:'+Math.floor(start/1000)+' before:'+Math.floor(end/1000)+(d.q?' ('+d.q+')':'');
  const params=new URLSearchParams({q,labelIds:'SENT',maxResults:'25',...(d.page_token?{pageToken:d.page_token}:{})});
  const result=await a.request<{messages?:{id:string}[];nextPageToken?:string}>(t,'/gmail/v1/users/me/messages?'+params);
  // Read the whole bounded page first. A failed fetch cannot leave half a page marked successful.
  const mail=[];for(const found of result.messages??[]){const message=await getMail(s,found.id);if(message.labels.includes('SENT'))mail.push(message);}
  const saved=[];for(const message of mail){const item=await stage(s,'gmail_message',String(message.id),message);saved.push({...message,item_id:item.id,saved_at:item.updated_at});}
  const at=new Date().toISOString();
  await query('UPDATE integration_connections SET settings=settings||$1::jsonb WHERE id=$2',[JSON.stringify({sent_last_success_at:at,sent_query:{start:d.start,end:d.end,q:d.q},sent_next_page:result.nextPageToken??null}),row.id]);
  const organization=await query('SELECT external_id,category,notes,pinned,version FROM personal_mail_organization WHERE connection_id=$1 AND user_id=$2 AND external_id=ANY($3::text[])',[row.id,s.ctx.userId,saved.map(m=>m.id)]);
  return {messages:saved.map(m=>({...m,organization:organization.find(o=>o.external_id===m.id)??{category:'',notes:'',pinned:false,version:0}})),nextPageToken:result.nextPageToken??null,last_synced_at:at};
 }
 if(action==='gmail_search'){
  provider(s,'gmail');const q=optional(data.q,2000),queryString=new URLSearchParams({q,maxResults:'25',...(data.page_token?{pageToken:text(data.page_token)}:{})});
  const result=await a.request<{messages?:{id:string}[];nextPageToken?:string;resultSizeEstimate?:number}>(t,`/gmail/v1/users/me/messages?${queryString}`);
  const messages=[];for(const item of result.messages??[])messages.push(await getMail(s,item.id));const organization=await query('SELECT external_id,category,notes,pinned,version FROM personal_mail_organization WHERE connection_id=$1 AND user_id=$2 AND external_id=ANY($3::text[])',[row.id,s.ctx.userId,messages.map(m=>m.id)]);return {...result,messages:messages.map(m=>({...m,organization:organization.find(o=>o.external_id===m.id)??{category:'',notes:'',pinned:false,version:0}}))};
 }
 if(action==='file_select'){if(!['drive','docs','sheets'].includes(String(row.provider)))throw new DomainError(422,'INVALID_PROVIDER');return (await rememberFile(s,remoteId(data.file_id))).item;}
 if(action==='gmail_organize'){provider(s,'gmail');const d=z.object({message_id:z.string().min(1).max(200),category:z.string().trim().max(100),notes:richString(10000),pinned:z.boolean(),version:z.number().int().min(0)}).parse(data);await getMail(s,d.message_id);const [saved]=await query(`INSERT INTO personal_mail_organization(connection_id,external_id,user_id,category,notes,pinned) SELECT $1,$2,$3,$4,$5,$6 WHERE $7=0 ON CONFLICT DO NOTHING RETURNING *`,[row.id,d.message_id,s.ctx.userId,d.category,d.notes,d.pinned,d.version]);if(saved)return saved;const [updated]=await query('UPDATE personal_mail_organization SET category=$1,notes=$2,pinned=$3,version=version+1,updated_at=now() WHERE connection_id=$4 AND external_id=$5 AND user_id=$6 AND version=$7 RETURNING *',[d.category,d.notes,d.pinned,row.id,d.message_id,s.ctx.userId,d.version]);if(!updated)throw new DomainError(409,'VERSION_CONFLICT');return updated;}
 if(action==='gmail_message'){provider(s,'gmail');return getMail(s,remoteId(data.message_id));}
 if(action==='gmail_attachment'){
  provider(s,'gmail');const content=await mailAttachment(s,remoteId(data.message_id),text(data.attachment_id,2000),{name:data.attachment_name,size:data.attachment_size});return {filename:content.filename,mime:content.mime,content_base64:content.bytes.toString('base64')};
 }
 if(action==='gmail_select'){provider(s,'gmail');const mail=await getMail(s,remoteId(data.message_id));return stage(s,'gmail_message',String(mail.id),mail);}
 if(action==='gmail_thread'){
  provider(s,'gmail');const thread=await a.request<{messages?:Data[]}>(t,`/gmail/v1/users/me/threads/${enc(remoteId(data.thread_id))}?format=minimal`);
  const messages=[];for(const item of thread.messages??[])messages.push(await getMail(s,String(item.id)));return {messages};
 }
 if(action==='gmail_drafts'){provider(s,'gmail');return query('SELECT * FROM google_mail_drafts WHERE workspace_id=$1 AND user_id=$2 AND connection_id=$3 ORDER BY updated_at DESC LIMIT 100',[s.ctx.workspaceId,s.ctx.userId,row.id]);}
 if(action==='sheet'){
  provider(s,'sheets');const id=remoteId(data.spreadsheet_id),range=optional(data.range)||'A1:Z200';
  const info=await a.request<Data>(t,`/sheets/v4/spreadsheets/${enc(id)}?fields=spreadsheetId,spreadsheetUrl,properties,sheets.properties`);
  const values=await a.request<Data>(t,`/sheets/v4/spreadsheets/${enc(id)}/values/${enc(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);return {info,...values};
 }
 if(action==='document'){provider(s,'docs');return a.request(t,`/docs/v1/documents/${enc(remoteId(data.document_id))}?includeTabsContent=true`);}
 if(action==='form'){provider(s,'forms');return a.request(t,`/forms/v1/forms/${enc(remoteId(data.form_id))}`);}
 if(action==='form_configure'){
  provider(s,'forms');const id=remoteId(data.form_id),form=await a.request<Data>(t,`/forms/v1/forms/${enc(id)}`);
  await query('UPDATE integration_connections SET settings=$1 WHERE id=$2',[JSON.stringify({form_id:id,poll_enabled:data.poll_enabled===true,schema_hash:hash(form.items??[])}),row.id]);return {configured:true};
 }
 if(action==='form_responses'){provider(s,'forms');return a.request(t,`/forms/v1/forms/${enc(remoteId(data.form_id))}/responses?${new URLSearchParams({pageSize:'100',...(data.page_token?{pageToken:text(data.page_token)}:{})})}`);}
 if(action==='form_poll')return pollForms(s);
 if(action==='people'){
  provider(s,'people');const q=new URLSearchParams({personFields:'names,emailAddresses,phoneNumbers,organizations,metadata',pageSize:'100',requestSyncToken:'true',...(data.page_token?{pageToken:text(data.page_token)}:{}),...(data.sync_token?{syncToken:text(data.sync_token)}:{})});return a.request(t,`/people/v1/people/me/connections?${q}`);
 }
 if(action==='people_select'){
  provider(s,'people');const selected=strings(data.names,100),items=[];
  for(const value of selected){const name=googleResourceName(value,/^people\/[\w-]+$/);const person=await a.request<Data>(t,`/people/v1/${name}?personFields=names,emailAddresses,phoneNumbers,organizations,metadata`);items.push(await stage(s,'person',name,person));}return items;
 }
 if(action==='people_writeback_enable'){provider(s,'people');await query("UPDATE integration_connections SET settings=settings||$1::jsonb WHERE id=$2",[JSON.stringify({writeback_enabled:data.enabled===true}),row.id]);return {enabled:data.enabled===true};}
 throw new DomainError(404,'ACTION_NOT_FOUND');
}
