import {scheduleNotificationMail,deliverNotificationMail} from './notification-mail';
import { randomUUID } from 'node:crypto';
import { query, transaction } from '../lib/db';
import { ProviderError } from './adapters';
import { SmtpTransport, type MailTransport } from './mail';
import { synchronizeCalendar } from './calendar';
import { type Connection } from './service';
import {assertAccess,assertOperation,str} from '../domain/core';
import {expandEvents} from '../domain/calendar';
import {executeOperation} from './operations';
import {scheduleChat,deliverChat} from './chat';
import {executeAnalysis,maintainAssistant} from '../file-assistant/service';
import {schedulePersonalReports} from '../workspace-assistant/personal';
import {liveContext,session} from './workspace-core';
import {pollForms} from './workspace-reads';

interface Job extends Record<string, unknown> { id: string; workspace_id: string; kind: string; payload: Record<string, unknown>; lease_token: string; attempts: number }
export async function scheduleDueNotifications() {
  await query(`INSERT INTO notifications(workspace_id,user_id,kind,title_key,resource,record_id,dedupe_key)
    SELECT t.workspace_id,recipient.user_id,'due','notification.due','tasks',t.id,'task-due:'||t.id::text||':'||t.due_date::text
    FROM tasks t JOIN LATERAL (SELECT t.owner_id AS user_id UNION SELECT rr.user_id FROM record_responsibles rr WHERE rr.workspace_id=t.workspace_id AND rr.company_id=t.company_id AND rr.resource='tasks' AND rr.record_id=t.id) recipient ON true
    JOIN memberships m ON m.workspace_id=t.workspace_id AND m.user_id=recipient.user_id AND m.status='active'
    JOIN companies c ON c.id=t.company_id AND c.workspace_id=t.workspace_id
    WHERE t.archived=false AND t.status NOT IN ('done','cancelled') AND t.due_date<=(now() AT TIME ZONE c.time_zone)::date
    AND NOT EXISTS(SELECT 1 FROM notification_preferences p WHERE p.workspace_id=t.workspace_id AND p.user_id=recipient.user_id AND p.kind='due' AND p.enabled=false)
    ON CONFLICT(workspace_id,user_id,dedupe_key) DO NOTHING`);
  await query(`INSERT INTO notifications(workspace_id,user_id,kind,title_key,resource,record_id,dedupe_key)
    SELECT s.workspace_id,recipient.user_id,'renewal','notification.renewal','subscriptions',s.id,'subscription-renewal:'||s.id::text||':'||COALESCE(s.cancel_by,s.due_date)::text
    FROM subscriptions s JOIN LATERAL (SELECT s.owner_id AS user_id UNION SELECT rr.user_id FROM record_responsibles rr WHERE rr.workspace_id=s.workspace_id AND rr.company_id=s.company_id AND rr.resource='subscriptions' AND rr.record_id=s.id) recipient ON true
    JOIN memberships m ON m.workspace_id=s.workspace_id AND m.user_id=recipient.user_id AND m.status='active'
    JOIN companies c ON c.id=s.company_id AND c.workspace_id=s.workspace_id
    WHERE s.archived=false AND s.status='active' AND COALESCE(s.cancel_by,s.due_date)<=(now() AT TIME ZONE c.time_zone)::date+COALESCE(s.reminder_days,14)
    AND NOT EXISTS(SELECT 1 FROM notification_preferences p WHERE p.workspace_id=s.workspace_id AND p.user_id=recipient.user_id AND p.kind='renewal' AND p.enabled=false)
    ON CONFLICT(workspace_id,user_id,dedupe_key) DO NOTHING`);
  await scheduleEventNotifications();
  // Job scheduling is persistent and independent of page views or open browsers.
  await query(`INSERT INTO outbox(workspace_id,kind,payload,dedupe_key)
    SELECT c.workspace_id,'calendar',jsonb_build_object('connection_id',c.id),'calendar-periodic:'||c.id::text||':'||floor(extract(epoch from now())/300)::text
    FROM integration_connections c JOIN memberships m ON m.workspace_id=c.workspace_id AND m.user_id=c.user_id AND m.status='active'
    WHERE c.provider='calendar' AND c.status='connected' AND NOT c.paused AND c.calendar_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM outbox o WHERE o.workspace_id=c.workspace_id AND o.kind='calendar' AND o.payload->>'connection_id'=c.id::text AND o.status IN ('pending','running'))
    ON CONFLICT(workspace_id,dedupe_key) DO NOTHING`);
  await query(`INSERT INTO outbox(workspace_id,kind,payload,dedupe_key)
    SELECT c.workspace_id,'forms_poll',jsonb_build_object('connection_id',c.id),'forms-poll:'||c.id::text||':'||floor(extract(epoch from now())/300)::text
    FROM integration_connections c JOIN memberships m ON m.workspace_id=c.workspace_id AND m.user_id=c.user_id AND m.status='active'
    WHERE c.provider='forms' AND c.status='connected' AND NOT c.paused AND c.settings->>'poll_enabled'='true'
    AND NOT EXISTS(SELECT 1 FROM outbox o WHERE o.kind='forms_poll' AND o.payload->>'connection_id'=c.id::text AND o.status IN ('pending','running'))
    ON CONFLICT(workspace_id,dedupe_key) DO NOTHING`);
  await scheduleChat();
}
/** Expand the same wall-clock recurrence and exceptions used by the calendar UI. */
export async function scheduleEventNotifications() {
  const clock=(await query<{from_date:string;to_date:string}>("SELECT (now() AT TIME ZONE 'UTC')::date-2 AS from_date,(now() AT TIME ZONE 'UTC')::date+9 AS to_date"))[0];
  const rows=await query(`SELECT * FROM events WHERE NOT archived AND (recurrence_rule IS NOT NULL OR recurrence_parent_id IS NOT NULL
    OR (all_day AND start_date BETWEEN $1::date AND $2::date) OR (NOT all_day AND start_at BETWEEN $1::date-interval '1 day' AND $2::date+interval '1 day'))`,[clock.from_date,clock.to_date]);
  const occurrences=expandEvents(rows,clock.from_date,clock.to_date).map(row=>({workspace_id:row.workspace_id,event_id:row.id,parent_id:row.recurrence_parent_id??null,owner_id:row.owner_id,start_at:row.start_at??null,start_date:row.start_date??null,time_zone:row.time_zone,all_day:row.all_day,reminder_minutes:Math.max(0,Math.min(10080,Number(row.reminder_minutes??15))),occurrence_key:str(row.occurrence_id??row.id)}));
  if(!occurrences.length)return;
  await query(`WITH occurrences AS (
    SELECT o.*,CASE WHEN all_day THEN start_date::timestamp AT TIME ZONE time_zone ELSE start_at END AS starts
    FROM jsonb_to_recordset($1::jsonb) AS o(workspace_id uuid,event_id uuid,parent_id uuid,owner_id text,start_at timestamptz,start_date date,time_zone text,all_day boolean,reminder_minutes integer,occurrence_key text)
  ),due AS (SELECT * FROM occurrences WHERE starts<=now()+make_interval(mins=>reminder_minutes)
    AND starts>now()-CASE WHEN all_day THEN interval '1 day' ELSE interval '1 hour' END),recipients AS (
    SELECT d.*,d.owner_id AS recipient FROM due d
    UNION ALL SELECT d.*,rr.user_id AS recipient FROM due d
      JOIN record_responsibles rr ON rr.workspace_id=d.workspace_id AND rr.resource='events' AND rr.record_id IN (d.event_id,d.parent_id)
    UNION ALL SELECT d.*,p.user_id AS recipient FROM due d
      JOIN LATERAL (SELECT DISTINCT ON (user_id) user_id,response FROM event_participants
        WHERE workspace_id=d.workspace_id AND event_id IN (d.event_id,d.parent_id) AND NOT archived AND user_id IS NOT NULL
        ORDER BY user_id,(event_id=d.event_id) DESC) p ON p.response IS DISTINCT FROM 'declined'
  ) INSERT INTO notifications(workspace_id,user_id,kind,title_key,resource,record_id,dedupe_key)
    SELECT r.workspace_id,r.recipient,'due','notification.event','events',r.event_id,'event-reminder:'||r.occurrence_key
    FROM recipients r JOIN memberships m ON m.workspace_id=r.workspace_id AND m.user_id=r.recipient AND m.status='active'
    WHERE NOT EXISTS(SELECT 1 FROM notification_preferences p WHERE p.workspace_id=r.workspace_id AND p.user_id=r.recipient AND p.kind='due' AND p.enabled=false)
    ON CONFLICT(workspace_id,user_id,dedupe_key) DO NOTHING`,[JSON.stringify(occurrences)]);
}
export async function claimJob(): Promise<Job | undefined> {
  return transaction(async client => {
    // A process crash while SMTP is sending cannot be retried safely without provider reconciliation.
    const expired=(await client.query<Job>("UPDATE outbox SET status='uncertain',last_error='mail_delivery_uncertain',locked_until=NULL WHERE status='running' AND kind IN ('mail','notification_mail') AND locked_until<now() RETURNING *")).rows;
    for(const job of expired){
      if(job.kind==='notification_mail'){await client.query("UPDATE notifications SET email_status='uncertain',email_error='mail_delivery_uncertain' WHERE workspace_id=$1 AND id=$2 AND email_status='sending'",[job.workspace_id,job.payload.notification_id]);continue;}
      await client.query("UPDATE messages SET status='uncertain',version=version+1 WHERE workspace_id=$1 AND id=$2 AND status='queued'",[job.workspace_id,job.payload.message_id]);
      await client.query("UPDATE deliveries SET status='uncertain',error_code='mail_delivery_uncertain' WHERE workspace_id=$1 AND message_id=$2 AND status='sending'",[job.workspace_id,job.payload.message_id]);
    }
    const lease=randomUUID();
    return (await client.query<Job>(`WITH candidate AS (
      SELECT id FROM outbox WHERE (status='pending' AND available_at<=now()) OR (status='running' AND kind NOT IN ('mail','notification_mail') AND locked_until<now())
      ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE outbox o SET status='running',attempts=o.attempts+1,locked_until=now()+CASE WHEN o.kind='file_assistant_analysis' THEN interval '10 minutes' ELSE interval '5 minutes' END,lease_token=$1
      FROM candidate c WHERE o.id=c.id RETURNING o.*`,[lease])).rows[0];
  });
}
export async function deliverMessage(workspaceId: string, messageId: string, transport?: MailTransport) {
  const mail=await transaction(async client=>{
    const row=(await client.query<{id:string;company_id:string;contact_id:string;confirmed_by:string;owner_id:string;created_by:string;to_address:string;subject:string;body:string;sender_account:string;status:string;message_archived:boolean;contact_archived:boolean;contact_preference:string|null;do_not_contact:boolean;current_email:string;member_status:string;member_roles:string[]}>(`SELECT m.id,m.company_id,m.contact_id,m.confirmed_by,m.owner_id,m.created_by,m.to_address,m.subject,m.body,m.sender_account,m.status,m.archived AS message_archived,c.archived AS contact_archived,c.contact_preference,c.do_not_contact,c.email AS current_email,ms.status AS member_status,ms.roles AS member_roles
      FROM messages m JOIN contacts c ON c.workspace_id=m.workspace_id AND c.id=m.contact_id
      LEFT JOIN memberships ms ON ms.workspace_id=m.workspace_id AND ms.user_id=m.confirmed_by
      WHERE m.workspace_id=$1 AND m.id=$2 FOR UPDATE OF m,c`,[workspaceId,messageId])).rows[0];
    if(!row)throw new ProviderError('message_not_found',404);
    if(row.status==='sent'||row.status==='cancelled')return null;
    if(row.status!=='queued')throw new ProviderError('message_not_queued',409);
    if(row.message_archived)throw new ProviderError('message_archived',409);
    if(row.contact_archived)throw new ProviderError('contact_archived',409);
    if(row.member_status!=='active'||!row.member_roles.some(role=>['admin','operations'].includes(role)))throw new ProviderError('sender_permission_revoked',403);
    const permissions=(await client.query<{resource:string;operation:string;scope:string}>('SELECT resource,operation,scope FROM effective_permissions($1,$3,$2::text[])',[workspaceId,row.member_roles,row.confirmed_by])).rows;
    const ctx={workspaceId,companyId:row.company_id,userId:row.confirmed_by,roles:row.member_roles,permissions};
    await assertAccess(ctx,'contacts',row.contact_id,'read');await assertOperation(client,ctx,'messages','edit',row);
    if(row.do_not_contact||row.contact_preference==='none')throw new ProviderError('do_not_contact',409);
    if(row.current_email!==row.to_address)throw new ProviderError('recipient_changed',409);
    const delivery=(await client.query<{status:string}>('SELECT status FROM deliveries WHERE workspace_id=$1 AND message_id=$2 FOR UPDATE',[workspaceId,messageId])).rows[0];
    if(!delivery||delivery.status==='uncertain'||delivery.status==='sending')throw new ProviderError('mail_delivery_uncertain',409);
    if(delivery.status==='sent')return null;
    await client.query("UPDATE deliveries SET status='sending',attempt_count=attempt_count+1,started_at=now() WHERE workspace_id=$1 AND message_id=$2",[workspaceId,messageId]);
    return {id:row.id,recipient:row.to_address,subject:row.subject,text:row.body,sender:row.sender_account};
  });
  if(!mail)return;
  try{
    const receipt=await (transport??new SmtpTransport()).send(mail);
    await transaction(async client=>{
      await client.query("UPDATE deliveries SET status='sent',provider_message_id=$1,error_code=NULL,delivered_at=now(),version=version+1 WHERE workspace_id=$2 AND message_id=$3",[receipt.messageId,workspaceId,messageId]);
      await client.query("UPDATE messages SET status='sent',sent_at=now(),version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2",[workspaceId,messageId]);
      await client.query("INSERT INTO audit_log(workspace_id,resource,record_id,action,after_data) VALUES($1,'messages',$2,'provider_accepted',$3)",[workspaceId,messageId,JSON.stringify({provider:'smtp',provider_message_id:receipt.messageId})]);
    });
  }catch(error){
    const code=error instanceof ProviderError?error.code:'mail_delivery_uncertain',uncertain=code==='mail_delivery_uncertain';
    await query('UPDATE deliveries SET status=$1,error_code=$2 WHERE workspace_id=$3 AND message_id=$4',[uncertain?'uncertain':'failed',code,workspaceId,messageId]);
    if(uncertain||!(error instanceof ProviderError&&error.retryable))await query('UPDATE messages SET status=$1,version=version+1 WHERE workspace_id=$2 AND id=$3',[uncertain?'uncertain':'failed',workspaceId,messageId]);
    throw error;
  }
}
export async function executeJob(job:Job, transport?:MailTransport) {
  try{
    if(job.kind==='notification_mail')await deliverNotificationMail(job.workspace_id,String(job.payload.notification_id),transport);
    else if(job.kind==='mail')await deliverMessage(job.workspace_id,String(job.payload.message_id),transport);
    else if(job.kind==='file_assistant_analysis')await executeAnalysis(job.workspace_id,String(job.payload.run_id),Number(job.payload.attempt));
    else if(job.kind==='workspace_operation')await executeOperation(job.workspace_id,String(job.payload.operation_id));
    else if(job.kind==='chat')await deliverChat(job.workspace_id,job.payload);
    else if(job.kind==='forms_poll'){
      const [row]=await query<Connection>('SELECT * FROM integration_connections WHERE workspace_id=$1 AND id=$2',[job.workspace_id,job.payload.connection_id]);
      if(!row)throw new ProviderError('connection_not_found',404);if(row.paused)throw new ProviderError('integration_paused',409);await pollForms(await session(await liveContext(row),row.id,'forms'));
    }
    else if(job.kind==='calendar'){
      const row=(await query<Connection>(`SELECT c.* FROM integration_connections c JOIN memberships m ON m.workspace_id=c.workspace_id AND m.user_id=c.user_id AND m.status='active' WHERE c.workspace_id=$1 AND c.id=$2`,[job.workspace_id,job.payload.connection_id]))[0];
      if(!row)throw new ProviderError('connection_not_found',404);
      await synchronizeCalendar(row);
    }else throw new ProviderError('unknown_job_type',422);
    await query("UPDATE outbox SET status='completed',completed_at=now(),locked_until=NULL WHERE id=$1 AND lease_token=$2 AND status='running'",[job.id,job.lease_token]);
  }catch(error){
    const code=error instanceof ProviderError?error.code:'job_failed',retry=error instanceof ProviderError&&error.retryable&&job.attempts<5;
    const next=['mail_delivery_uncertain','external_result_uncertain'].includes(code)?'uncertain':retry?'pending':'failed';
    await query('UPDATE outbox SET status=$1,last_error=$2,available_at=now()+make_interval(secs=>$3),locked_until=NULL WHERE id=$4 AND lease_token=$5 AND status=\'running\'',[next,code,Math.min(3600,30*2**job.attempts),job.id,job.lease_token]);
    if(job.kind==='notification_mail'&&!retry&&next==='failed')await query("UPDATE notifications SET email_status='failed',email_error=$3 WHERE workspace_id=$1 AND id=$2 AND email_status NOT IN ('sent','skipped','uncertain')",[job.workspace_id,job.payload.notification_id,code]);
    if(job.kind==='mail'&&!retry&&next==='failed')await query("UPDATE messages SET status='failed',version=version+1 WHERE workspace_id=$1 AND id=$2 AND status='queued'",[job.workspace_id,job.payload.message_id]);
  }
}
export async function workerTick(limit=10, transport?:MailTransport) {
  await maintainAssistant();await schedulePersonalReports();await scheduleDueNotifications();await scheduleNotificationMail();let count=0;
  while(count<limit){const job=await claimJob();if(!job)break;await executeJob(job,transport);count++;}
  return count;
}
