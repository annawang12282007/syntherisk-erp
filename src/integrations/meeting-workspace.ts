import {query,transaction} from '../lib/db';
import {DomainError} from '../lib/context';
import {get,createInTransaction,update,assertAccess,action} from '../domain/service';
import {ProviderError,eventExternalId,type GoogleEvent} from './adapters';
import {type Session,type Data,text,optional,enc,record,assertDestination,hash,stage} from './workspace-core';
import {toGoogleEvent} from './calendar';
type EventPayload=GoogleEvent&{attendees?:{email:string}[];conferenceData?:{conferenceId?:string;createRequest?:{requestId:string;conferenceSolutionKey?:{type:string};status?:{statusCode:string}};entryPoints?:{entryPointType:string;uri:string}[]};hangoutLink?:string};
export function addresses(value:unknown):string[]{const source=Array.isArray(value)?value:typeof value==='string'?value.split(/[;,\n]/):[];if(source.length>100)throw new DomainError(422,'TOO_MANY_RECIPIENTS');const result=source.map(v=>String(v).trim().toLowerCase()).filter(Boolean);if(result.some(v=>v.length>254||!/^([^\s<>@,]+)@([^\s<>@,]+)\.[^\s<>@,]+$/.test(v)))throw new DomainError(422,'INVALID_EMAIL');return [...new Set(result)];}
export async function meetingPlan(s:Session,input:Data){
 if(s.row.provider!=='calendar')throw new DomainError(422,'INVALID_PROVIDER');assertDestination(input);
 const source=await record(s,input,true);if(!['meetings','events'].includes(source.resource))throw new DomainError(422,'INVALID_RESOURCE');await assertAccess(s.ctx,source.resource,source.id,'write');
 const calendarId=text(input.calendar_id||s.row.calendar_id),calendar=(await s.adapter.calendars(s.tokens)).items.find(c=>c.id===calendarId);
 if(calendarId!==s.row.calendar_id)throw new DomainError(409,'SELECT_SYNC_CALENDAR_FIRST');
 if(!calendar||!['writer','owner'].includes(calendar.accessRole))throw new ProviderError('calendar_read_only',403);
 const eventId=source.resource==='events'?source.id:source.row.event_id as string|undefined;
 let event:Data;if(eventId){event=await get(s.ctx,'events',eventId);await assertAccess(s.ctx,'events',eventId,'write');}else{
  if(input.action==='cancel')throw new DomainError(409,'EVENT_REQUIRED');
  const start=text(input.start_at),end=text(input.end_at),zone=text(input.time_zone);
  try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{throw new DomainError(422,'INVALID_TIME_ZONE');}
  if(!Number.isFinite(Date.parse(start))||Date.parse(end)<=Date.parse(start))throw new DomainError(422,'INVALID_DATE_RANGE');
  event={title:source.row.title,start_at:start,end_at:end,time_zone:zone,all_day:false,notes:optional(input.description,20000),location:optional(input.location),status:'scheduled'};
 }
 if(source.resource==='meetings')event={...event,title:source.row.title};
 const [mapping]=eventId?await query<{external_id:string;etag:string;local_version:number}>('SELECT external_id,etag,local_version FROM external_event_mappings WHERE workspace_id=$1 AND connection_id=$2 AND event_id=$3',[s.ctx.workspaceId,s.row.id,eventId]):[];
 const externalId=mapping?.external_id??eventExternalId(s.ctx.workspaceId,eventId??source.id);
 let remote:EventPayload|undefined;
 try{remote=await s.adapter.getEvent(s.tokens,calendarId,externalId) as EventPayload;}catch(error){if(!(error instanceof ProviderError&&error.status===404))throw error;}
 if(mapping&&remote?.etag!==mapping.etag)throw new ProviderError('sync_conflict',409);
 const needsConference=!remote?.conferenceData||remote.conferenceData.createRequest?.status?.statusCode==='failure';
 if(input.create_meet===true&&needsConference&&calendar.conferenceProperties?.allowedConferenceSolutionTypes&&!calendar.conferenceProperties.allowedConferenceSolutionTypes.includes('hangoutsMeet'))throw new ProviderError('meet_not_supported_for_calendar',409);
 const attendees=input.attendees===undefined?remote?.attendees??[]:addresses(input.attendees).map(email=>({email}));
 const updates=input.send_updates??'none';if(!['none','all','externalOnly'].includes(String(updates)))throw new DomainError(422,'INVALID_FIELD');
 const payload=toGoogleEvent({...event,id:eventId??source.id,workspace_id:s.ctx.workspaceId} as Parameters<typeof toGoogleEvent>[0],externalId) as EventPayload;
 payload.attendees=attendees;if(remote&&!payload.recurrence)payload.recurrence=[];
 return {source:{resource:source.resource,id:source.id,version:source.row.version},event_id:eventId??null,event_version:event.version??null,calendar:{id:calendarId,name:calendar.summary,role:calendar.accessRole,sharing:'Uses the selected Google calendar sharing rules; verify its members in Google Calendar.'},external_id:externalId,etag:remote?.etag??null,action:input.action==='cancel'?'cancel':'save',payload,recipients:attendees.map(a=>a.email),send_updates:updates,create_meet:input.create_meet===true&&needsConference,conference:remote?.conferenceData??null,external_visibility_acknowledged:true};
}
export async function writeMeeting(s:Session,input:Data,operationId:string,preview:Data){
 const calendar=(preview.calendar as Data).id as string,source=preview.source as Data;let eventId=preview.event_id as string|null;
 // Persist the local event before the external request, making interrupted creations recoverable.
 if(!eventId){
  eventId=await transaction(async c=>{
   const [old]=(await c.query('SELECT record_id FROM integration_items WHERE connection_id=$1 AND kind=\'meeting_event\' AND external_id=$2 FOR UPDATE',[s.row.id,source.id])).rows;if(old)return String(old.record_id);
   const payload=preview.payload as EventPayload;
   const event=await createInTransaction(c,s.ctx,'events',{title:payload.summary,start_at:payload.start?.dateTime,end_at:payload.end?.dateTime,time_zone:payload.start?.timeZone,all_day:false,location:payload.location,notes:payload.description,is_private:true});
   await c.query("INSERT INTO integration_items(workspace_id,user_id,connection_id,kind,external_id,fingerprint,data,resource,record_id,state) VALUES($1,$2,$3,'meeting_event',$4,$5,'{}','events',$6,'linked')",[s.ctx.workspaceId,s.ctx.userId,s.row.id,source.id,hash(preview),event.id]);return String(event.id);
  });
  await update(s.ctx,'meetings',String(source.id),{version:source.version,event_id:eventId});
 }
 const payload={...(preview.payload as EventPayload),extendedProperties:{private:{syntherisk_workspace:s.ctx.workspaceId,syntherisk_id:eventId}}},etag=preview.etag as string|null;
 const base=`/calendar/v3/calendars/${enc(calendar)}/events`,qs=new URLSearchParams({conferenceDataVersion:'1',sendUpdates:String(preview.send_updates)});
 if(preview.action==='cancel'){
  if(etag)await s.adapter.request(s.tokens,`${base}/${enc(payload.id)}?${qs}`,{method:'DELETE',headers:{'If-Match':etag}});
  const event=await get(s.ctx,'events',eventId);if(event.status!=='cancelled')await action(s.ctx,'events',eventId,'cancel',{version:event.version,idempotency_key:operationId});
  await query("UPDATE external_event_mappings SET status='cancelled',local_version=(SELECT version FROM events WHERE id=$2) WHERE connection_id=$1 AND event_id=$2",[s.row.id,eventId]);return {cancelled:true,event_id:eventId};
 }
 if(preview.create_meet)payload.conferenceData={createRequest:{requestId:operationId,conferenceSolutionKey:{type:'hangoutsMeet'}}};
 const written=await s.adapter.request<EventPayload>(s.tokens,`${base}${etag?'/'+enc(payload.id):''}?${qs}`,{method:etag?'PATCH':'POST',headers:etag?{'If-Match':etag}:{},body:JSON.stringify(payload)});
 await query("INSERT INTO external_event_mappings(workspace_id,connection_id,event_id,external_id,etag,local_version,status,external_snapshot,last_synced_at) VALUES($1,$2,$3,$4,$5,(SELECT version FROM events WHERE id=$3),'synced',$6,now()) ON CONFLICT(connection_id,event_id) DO UPDATE SET etag=excluded.etag,local_version=excluded.local_version,status='synced',external_snapshot=excluded.external_snapshot,last_synced_at=now()",[s.ctx.workspaceId,s.row.id,eventId,written.id,written.etag??null,JSON.stringify(written)]);
 const meet=written.conferenceData?.entryPoints?.find(p=>p.entryPointType==='video')?.uri??written.hangoutLink;
 if(meet||source.resource==='meetings'){const event=await get(s.ctx,'events',eventId);await update(s.ctx,'events',eventId,{version:event.version,...(meet?{video_url:meet}:{}),...(source.resource==='meetings'?{title:payload.summary}:{})});await query('UPDATE external_event_mappings SET local_version=(SELECT version FROM events WHERE id=$2) WHERE connection_id=$1 AND event_id=$2',[s.row.id,eventId]);}
 await stage(s,'meet_link',written.id,{event_id:eventId,calendar_id:calendar,conference:written.conferenceData??null,meet_url:meet??null,request_id:operationId});
 return {event_id:eventId,external_id:written.id,meet_url:meet??null,conference_status:written.conferenceData?.createRequest?.status?.statusCode??(meet?'success':'not_requested')};
}
