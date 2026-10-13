import {richTextPlain} from '../lib/rich-text';
import {canUseGoogle} from './access';
import { randomUUID } from 'node:crypto';
import { pool, query, transaction } from '../lib/db';
import { GoogleAdapter, googleConfig, eventExternalId, ProviderError, type GoogleEvent } from './adapters';
import { authorizedTokens, type Connection } from './service';
import type {Context} from '../lib/context';
import {assertAccess,find,operationAccess,scope} from '../domain/core';
import {autoSyncEventPredicate} from './privacy';

async function syncContext(row:Connection):Promise<Context>{
  const [member]=await query<{roles:string[];company_id:string}>("SELECT m.roles,c.id company_id FROM memberships m JOIN companies c ON c.workspace_id=m.workspace_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' ORDER BY c.created_at LIMIT 1",[row.workspace_id,row.user_id]);
  if(!member)throw new ProviderError('sender_permission_revoked',403);
  const permissions=member.roles.includes('admin')?[]:await query<{resource:string;operation:string;scope:string}>('SELECT resource,operation,scope FROM effective_permissions($1,$3,$2::text[])',[row.workspace_id,member.roles,row.user_id]);
  const ctx={workspaceId:row.workspace_id,companyId:member.company_id,userId:row.user_id,roles:member.roles,permissions};if(!canUseGoogle(ctx))throw new ProviderError('sender_permission_revoked',403);return ctx;
}

interface EventRow extends Record<string, unknown> { id: string; workspace_id: string; company_id: string; owner_id: string; title: string; notes: string | null; location: string | null; time_zone: string; all_day: boolean; start_at: Date | null; end_at: Date | null; start_date: Date | string | null; end_date: Date | string | null; recurrence_rule: string | null; recurrence_parent_id: string | null; recurrence_date: Date | string | null; status: string; version: number; source_resource: string | null }
interface Mapping extends Record<string, unknown> { id: string; event_id: string; external_id: string; etag: string | null; local_version: number; status: string; external_snapshot?:GoogleEvent }
function dateOnly(date: Date | string | null): string | undefined { return date ? (date instanceof Date ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : date.slice(0,10)) : undefined; }
export function toGoogleEvent(event: EventRow, externalId: string): GoogleEvent {
  return { id: externalId, summary: event.title, description: richTextPlain(event.notes), location: event.location ?? '', status: event.status === 'cancelled' ? 'cancelled' : 'confirmed', start: event.all_day ? { date: dateOnly(event.start_date) } : { dateTime: new Date(event.start_at!).toISOString(), timeZone: event.time_zone }, end: event.all_day ? { date: dateOnly(event.end_date) } : { dateTime: new Date(event.end_at!).toISOString(), timeZone: event.time_zone }, recurrence: event.recurrence_rule ? [event.recurrence_rule.startsWith('RRULE:') ? event.recurrence_rule : `RRULE:${event.recurrence_rule}`] : [], extendedProperties: { private: { syntherisk_id: event.id, syntherisk_workspace: event.workspace_id } } };
}
export function conflict(localVersion: number, lastSyncedVersion: number, storedEtag: string | null, remoteEtag: string | undefined) { return localVersion !== lastSyncedVersion && storedEtag !== (remoteEtag ?? null); }
export async function resolveCalendarConflict(row:Connection,mappingId:string,strategy:'local'|'remote'){
  const ctx=await syncContext(row);
  return transaction(async client=>{
    const mapping=(await client.query<Mapping&{external_snapshot:GoogleEvent}>("SELECT * FROM external_event_mappings WHERE id=$1 AND workspace_id=$2 AND connection_id=$3 AND status='conflict' FOR UPDATE",[mappingId,row.workspace_id,row.id])).rows[0];
    if(!mapping?.external_snapshot)throw new ProviderError('sync_conflict_not_found',404);
    await assertAccess(ctx,'events',mapping.event_id,'write');
    const requiresExplicitExport=strategy==='local'&&!(await client.query(`SELECT id FROM events event WHERE workspace_id=$1 AND id=$2 AND ${autoSyncEventPredicate()}`,[row.workspace_id,mapping.event_id])).rowCount;
    const remote=mapping.external_snapshot;
    if(strategy==='local'){
      await client.query("UPDATE external_event_mappings SET status='synced',etag=$1,local_version=-1 WHERE id=$2",[remote.etag??null,mapping.id]);
    }else{
      let version:number;
      if(remote.status==='cancelled')version=(await client.query<{version:number}>("UPDATE events SET status='cancelled',version=version+1,updated_by=$1,updated_at=now() WHERE id=$2 AND workspace_id=$3 RETURNING version",[row.user_id,mapping.event_id,row.workspace_id])).rows[0].version;
      else{
        if(!remote.start||!remote.end)throw new ProviderError('invalid_external_event',422);
        version=(await client.query<{version:number}>("UPDATE events SET title=$1,notes=$2,location=$3,time_zone=$4,all_day=$5,start_at=$6,end_at=$7,start_date=$8,end_date=$9,recurrence_rule=$10,updated_by=$11,status='scheduled',version=version+1,updated_at=now() WHERE id=$12 AND workspace_id=$13 RETURNING version",[remote.summary??'(Untitled)',remote.description??'',remote.location??'',remote.start.timeZone??'UTC',!!remote.start.date,remote.start.dateTime??null,remote.end.dateTime??null,remote.start.date??null,remote.end.date??null,remote.recurrence?.find(r=>r.startsWith('RRULE:'))?.replace(/^RRULE:/,'')??null,row.user_id,mapping.event_id,row.workspace_id])).rows[0].version;
      }
      await client.query("UPDATE external_event_mappings SET status='synced',etag=$1,local_version=$2,last_synced_at=now() WHERE id=$3",[remote.etag??null,version,mapping.id]);
    }
    await client.query("UPDATE integration_connections SET status='connected',last_error=NULL WHERE id=$1 AND workspace_id=$2 AND status<>'disconnected'",[row.id,row.workspace_id]);
    return {requires_explicit_export:requiresExplicitExport};
  });
}
export async function synchronizeCalendar(row: Connection, adapter = new GoogleAdapter(googleConfig())) {
  if (!row.calendar_id) throw new ProviderError('calendar_not_selected',422);
  const lock = await pool.connect();
  const acquired=(await lock.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[row.id])).rows[0].locked;
  if(!acquired){lock.release();return;}
  let jobId: string | undefined;
  try {
    const fresh=(await query<Connection>('SELECT * FROM integration_connections WHERE workspace_id=$1 AND id=$2',[row.workspace_id,row.id]))[0];
    if(!fresh||fresh.status==='disconnected'||fresh.status==='expired')throw new ProviderError('authorization_expired',401);
    if(fresh.paused)throw new ProviderError('integration_paused',409);
    row=fresh;
    const ctx=await syncContext(row);
    if(!operationAccess(ctx,'events','read'))throw new ProviderError('sender_permission_revoked',403);
    const tokens=await authorizedTokens(row,adapter);
    const [job]=await query<{id:string}>("INSERT INTO sync_jobs(workspace_id,connection_id,status) VALUES($1,$2,'running') RETURNING id",[row.workspace_id,row.id]);jobId=job.id;
    await query("UPDATE integration_connections SET status='syncing',last_error=NULL WHERE workspace_id=$1 AND id=$2",[row.workspace_id,row.id]);
    let processed=0,hadConflict=false;
    if(row.sync_direction!=='push'){
      let syncToken=row.sync_token??undefined,pageToken: string|undefined;
      const imported:GoogleEvent[]=[];
      while(true){
        let page;
        try{page=await adapter.listEvents(tokens,row.calendar_id!,syncToken,pageToken);}
        catch(error){if(error instanceof ProviderError&&error.code==='sync_token_expired'&&syncToken){syncToken=undefined;pageToken=undefined;imported.length=0;continue;}throw error;}
        imported.push(...page.items);pageToken=page.nextPageToken;if(page.nextSyncToken)syncToken=page.nextSyncToken;
        if(!pageToken)break;
      }
      // Parents precede recurrence exceptions; mapping retains provider IDs.
      imported.sort((a,b)=>Number(!!a.recurringEventId)-Number(!!b.recurringEventId));
      for(const remote of imported){
        await transaction(async client=>{
          const mapping=(await client.query<Mapping>('SELECT * FROM external_event_mappings WHERE connection_id=$1 AND external_id=$2 FOR UPDATE',[row.id,remote.id])).rows[0];
          if(mapping?.etag===remote.etag)return;
          // Recover a provider insert acknowledged just before a process crash without importing a duplicate.
          const privateIds=remote.extendedProperties?.private;
          if(!mapping&&privateIds?.syntherisk_workspace===row.workspace_id&&privateIds.syntherisk_id){
            const known=(await client.query('SELECT id FROM events WHERE workspace_id=$1 AND id::text=$2',[row.workspace_id,privateIds.syntherisk_id])).rows[0];
            if(known)return;
          }
          let local:EventRow|undefined;
          if(mapping)local=(await client.query<EventRow>('SELECT * FROM events WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[row.workspace_id,mapping.event_id])).rows[0];
          // Existing explicit mappings can receive updates; automatic outbound sync still excludes private records.
          if(local)await assertAccess(ctx,'events',local.id,'write');
          else if(remote.status!=='cancelled'&&!operationAccess(ctx,'events','create'))throw new ProviderError('sender_permission_revoked',403);
          if(local&&mapping&&conflict(local.version,mapping.local_version,mapping.etag,remote.etag)){
            await client.query("UPDATE external_event_mappings SET status='conflict',external_snapshot=$1 WHERE id=$2",[JSON.stringify(remote),mapping.id]);hadConflict=true;return;
          }
          const parent=remote.recurringEventId?(await client.query<Mapping>('SELECT * FROM external_event_mappings WHERE connection_id=$1 AND external_id=$2',[row.id,remote.recurringEventId])).rows[0]:undefined;
          if(parent)await find(client,ctx,'events',parent.event_id,true);
          if(remote.status==='cancelled'&&!local){
            if(!parent||!remote.originalStartTime)return;
            const original=(await client.query<EventRow>('SELECT * FROM events WHERE id=$1 AND workspace_id=$2',[parent.event_id,row.workspace_id])).rows[0];
            if(!original)return;
            remote.summary=original.title;
            if(remote.originalStartTime.date){const start=remote.originalStartTime.date,days=(new Date(dateOnly(original.end_date)!).getTime()-new Date(dateOnly(original.start_date)!).getTime())/86400000;remote.start={date:start};remote.end={date:new Date(new Date(start).getTime()+days*86400000).toISOString().slice(0,10)};}
            else if(remote.originalStartTime.dateTime){const start=remote.originalStartTime.dateTime,duration=new Date(original.end_at!).getTime()-new Date(original.start_at!).getTime();remote.start={dateTime:start,timeZone:original.time_zone};remote.end={dateTime:new Date(new Date(start).getTime()+duration).toISOString(),timeZone:original.time_zone};}
          }
          if(remote.status==='cancelled'&&local){
            await client.query("UPDATE events SET status='cancelled',version=version+1,updated_by=$1,updated_at=now() WHERE workspace_id=$2 AND id=$3",[row.user_id,row.workspace_id,local.id]);
          }else{
            if(!remote.start||!remote.end)return;
            const allDay=!!remote.start.date,title=remote.summary||'(Untitled)',zone=remote.start.timeZone||'UTC',rule=remote.recurrence?.find(r=>r.startsWith('RRULE:'))?.replace(/^RRULE:/,'')??null;
            const values=[title,remote.description??'',remote.location??'',zone,allDay,remote.start.dateTime??null,remote.end.dateTime??null,remote.start.date??null,remote.end.date??null,rule,parent?.event_id??null,remote.originalStartTime?.date??remote.originalStartTime?.dateTime?.slice(0,10)??null,row.user_id,row.workspace_id];
            if(local)await client.query("UPDATE events SET title=$1,notes=$2,location=$3,time_zone=$4,all_day=$5,start_at=$6,end_at=$7,start_date=$8,end_date=$9,recurrence_rule=$10,recurrence_parent_id=$11,recurrence_date=$12,updated_by=$13,status='scheduled',version=version+1,updated_at=now() WHERE workspace_id=$14 AND id=$15",[...values,local.id]);
            else{
              const company=(await client.query<{id:string}>('SELECT id FROM companies WHERE workspace_id=$1 ORDER BY created_at LIMIT 1',[row.workspace_id])).rows[0];
              const eventId=randomUUID();
              const workspace=(await client.query('SELECT initial_admin_user_id,operational_owner_user_id FROM workspaces WHERE id=$1',[row.workspace_id])).rows[0];
              const owner=row.user_id===workspace.initial_admin_user_id?workspace.operational_owner_user_id:row.user_id;
              await client.query("INSERT INTO events(title,notes,location,time_zone,all_day,start_at,end_at,start_date,end_date,recurrence_rule,recurrence_parent_id,recurrence_date,updated_by,workspace_id,id,company_id,created_by,owner_id,status,source_resource,is_private) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$13,$18,$17,'google_calendar',true)",[...values,eventId,company.id,remote.status==='cancelled'?'cancelled':'scheduled',owner]);
              local=(await client.query<EventRow>('SELECT * FROM events WHERE id=$1',[eventId])).rows[0];
            }
          }
          const current=(await client.query<{version:number}>('SELECT version FROM events WHERE id=$1 AND workspace_id=$2',[local!.id,row.workspace_id])).rows[0];
          await client.query("INSERT INTO external_event_mappings(workspace_id,connection_id,event_id,external_id,etag,local_version,status,last_synced_at,external_snapshot) VALUES($1,$2,$3,$4,$5,$6,'synced',now(),$7) ON CONFLICT(connection_id,event_id) DO UPDATE SET etag=excluded.etag,local_version=excluded.local_version,status='synced',external_snapshot=excluded.external_snapshot,last_synced_at=now()",[row.workspace_id,row.id,local!.id,remote.id,remote.etag??null,current.version,JSON.stringify(remote)]);
          processed++;
        });
      }
      await query('UPDATE integration_connections SET sync_token=$1 WHERE id=$2 AND workspace_id=$3',[syncToken??null,row.id,row.workspace_id]);
    }
    if(row.sync_direction!=='pull'){
      const access=scope(ctx,'events','e');
      const events=await query<EventRow>(`SELECT e.* FROM events e LEFT JOIN external_event_mappings m ON m.event_id=e.id AND m.connection_id=$4 WHERE ${access.sql} AND ${autoSyncEventPredicate('e')} AND e.archived=false AND (e.source_resource IS NULL OR e.source_resource='manual' OR (e.source_resource='google_calendar' AND m.id IS NOT NULL)) AND (m.id IS NULL OR m.local_version<>e.version) ORDER BY (e.recurrence_parent_id IS NOT NULL),e.created_at`,[...access.values,row.id]);
      for(const candidate of events){
       await transaction(async client=>{
        const query=async<T extends Record<string,unknown>=Record<string,unknown>>(sql:string,values:unknown[]=[]) => (await client.query<T>(sql,values)).rows;
        if(candidate.recurrence_parent_id)await client.query('SELECT id FROM events WHERE workspace_id=$1 AND id=$2 FOR SHARE',[row.workspace_id,candidate.recurrence_parent_id]);
        const [event]=await query<EventRow>(`SELECT e.* FROM events e WHERE ${access.sql} AND ${autoSyncEventPredicate('e')} AND e.id=$4 AND NOT e.archived FOR SHARE OF e`,[...access.values,candidate.id]);
        if(!event)return;

        const [mapping]=await query<Mapping>('SELECT * FROM external_event_mappings WHERE connection_id=$1 AND event_id=$2',[row.id,event.id]);
        if(mapping?.status==='conflict'){hadConflict=true;return;}
        let externalId=mapping?.external_id??eventExternalId(row.workspace_id,event.id),etag=mapping?.etag??undefined;
        const remote=toGoogleEvent(event,externalId);
        if(remote.recurrence)remote.recurrence.push(...(mapping?.external_snapshot?.recurrence?.filter(rule=>!rule.startsWith('RRULE:'))??[]));
        if(event.recurrence_parent_id&&!mapping){
          const [parent]=await query<Mapping>('SELECT * FROM external_event_mappings WHERE connection_id=$1 AND event_id=$2',[row.id,event.recurrence_parent_id]);
          if(!parent)throw new ProviderError('recurrence_parent_not_synced',409);
          // Google identifies an exception by the parent's ID and ORIGINAL occurrence.
          const original=dateOnly(event.recurrence_date);
          const start=new Date(`${original}T00:00:00Z`),end=new Date(start.getTime()+2*86400000);
          const instances=await adapter.request<{items:GoogleEvent[]}>(tokens,`/calendar/v3/calendars/${encodeURIComponent(row.calendar_id!)}/events/${encodeURIComponent(parent.external_id)}/instances?timeMin=${encodeURIComponent(new Date(start.getTime()-86400000).toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}`);
          const instance=instances.items.find(item=>item.originalStartTime?.date===original||item.originalStartTime?.dateTime?.slice(0,10)===original);
          if(!instance)throw new ProviderError('recurrence_instance_not_found',409);
          externalId=instance.id;etag=instance.etag;remote.id=externalId;
          remote.recurringEventId=parent.external_id;remote.originalStartTime=instance.originalStartTime;
        }
        try{
          if(event.status==='cancelled'){
            if(mapping||event.recurrence_parent_id)await adapter.cancelEvent(tokens,row.calendar_id!,externalId,etag);
            await query("INSERT INTO external_event_mappings(workspace_id,connection_id,event_id,external_id,local_version,status,last_synced_at) VALUES($1,$2,$3,$4,$5,'cancelled',now()) ON CONFLICT(connection_id,event_id) DO UPDATE SET local_version=excluded.local_version,status='cancelled',last_synced_at=now()",[row.workspace_id,row.id,event.id,externalId,event.version]);
          }else{
            const written=await adapter.putEvent(tokens,row.calendar_id!,remote,etag);
            if(written.extendedProperties?.private?.syntherisk_id!==event.id)throw new ProviderError('sync_conflict',409);
            await query("INSERT INTO external_event_mappings(workspace_id,connection_id,event_id,external_id,etag,local_version,status,last_synced_at,external_snapshot) VALUES($1,$2,$3,$4,$5,$6,'synced',now(),$7) ON CONFLICT(connection_id,event_id) DO UPDATE SET etag=excluded.etag,local_version=excluded.local_version,status='synced',external_snapshot=excluded.external_snapshot,last_synced_at=now()",[row.workspace_id,row.id,event.id,externalId,written.etag??null,event.version,JSON.stringify(written)]);
          }processed++;
        }catch(error){
          if(error instanceof ProviderError&&error.code==='sync_conflict'){
            const remoteState=await adapter.getEvent(tokens,row.calendar_id!,externalId);
            await query("INSERT INTO external_event_mappings(workspace_id,connection_id,event_id,external_id,etag,local_version,status,external_snapshot) VALUES($1,$2,$3,$4,$5,$6,'conflict',$7) ON CONFLICT(connection_id,event_id) DO UPDATE SET status='conflict',external_snapshot=excluded.external_snapshot",[row.workspace_id,row.id,event.id,externalId,etag??null,mapping?.local_version??0,JSON.stringify(remoteState)]);hadConflict=true;
          }else throw error;
        }
       });
      }
    }
    await query("UPDATE sync_jobs SET status=$1,records_processed=$2,finished_at=now(),error_code=$3 WHERE id=$4",[hadConflict?'conflict':'completed',processed,hadConflict?'sync_conflict':null,jobId]);
    await query("UPDATE integration_connections SET status=$1,last_success_at=CASE WHEN $2 THEN last_success_at ELSE now() END,last_error=$3,updated_at=now() WHERE id=$4 AND workspace_id=$5 AND status<>'disconnected'",[hadConflict?'failed':'connected',hadConflict,hadConflict?'sync_conflict':null,row.id,row.workspace_id]);
    return {processed,conflicts:hadConflict};
  }catch(error){
    const code=error instanceof ProviderError?error.code:'sync_failed';
    if(jobId)await query("UPDATE sync_jobs SET status='failed',error_code=$1,finished_at=now() WHERE id=$2",[code,jobId]);
    await query("UPDATE integration_connections SET status=$1,last_error=$2 WHERE id=$3 AND workspace_id=$4 AND status<>'disconnected'",[code==='authorization_expired'?'expired':'failed',code,row.id,row.workspace_id]);throw error;
  }finally{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[row.id]);lock.release();}
}
