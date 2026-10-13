import {query,transaction} from '../lib/db';
import {find,permissionScope,type Row} from '../domain/core';
import type {Context} from '../lib/context';
import {resources} from '../domain/registry';
import {publicOrigin} from '../lib/public-origin';
import {SmtpTransport,mailConfig,type MailTransport} from './mail';
import {ProviderError} from './adapters';
import {translate,type Locale} from '../locales';

export function notificationMailConfigured(){try{mailConfig();return true;}catch{return false;}}
export async function scheduleNotificationMail(){
 if(!notificationMailConfigured())return;
 await query(`INSERT INTO outbox(workspace_id,kind,payload,dedupe_key)
  SELECT workspace_id,'notification_mail',jsonb_build_object('notification_id',id),'notification-mail:'||id::text
  FROM notifications WHERE email_status='pending' AND NOT EXISTS(SELECT 1 FROM outbox o WHERE o.workspace_id=notifications.workspace_id AND o.dedupe_key='notification-mail:'||notifications.id::text)
  ORDER BY created_at LIMIT 200 ON CONFLICT(workspace_id,dedupe_key) DO NOTHING`);
}
export async function deliverNotificationMail(workspaceId:string,id:string,transport?:MailTransport){
 const mail=await transaction(async c=>{
  const row=(await c.query(`SELECT n.*,u.email,COALESCE(p.settings->>'locale','zh-CN') AS locale FROM notifications n JOIN "user" u ON u.id=n.user_id LEFT JOIN user_preferences p ON p.workspace_id=n.workspace_id AND p.user_id=n.user_id WHERE n.workspace_id=$1 AND n.id=$2 FOR UPDATE OF n`,[workspaceId,id])).rows[0] as Row|undefined;
  if(!row||['sent','skipped','legacy'].includes(String(row.email_status)))return null;
  if(['sending','uncertain'].includes(String(row.email_status)))throw new ProviderError('mail_delivery_uncertain',409);
  let permitted=true;
  try{if(row.resource!=='announcements'&&!resources[String(row.resource)])throw Error('Unknown notification resource');const member=(await c.query('SELECT roles FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status=\'active\'',[workspaceId,row.user_id])).rows[0];if(!member)throw Error('Inactive recipient');const subjectMeta=(await c.query(`SELECT company_id FROM ${String(row.resource)} WHERE workspace_id=$1 AND id=$2`,[workspaceId,row.record_id])).rows[0];if(!subjectMeta)throw Error('Missing subject');const permissions=member.roles.includes('admin')?[]:(await c.query('SELECT resource,operation,scope FROM effective_permissions($1,$3,$2::text[])',[workspaceId,member.roles,row.user_id])).rows;const ctx:Context={workspaceId,companyId:subjectMeta.company_id,userId:String(row.user_id),roles:member.roles,permissions};if(row.resource==='announcements'){if(permissionScope(ctx,'announcements','read')==='none')permitted=false;else permitted=Boolean((await c.query("SELECT 1 FROM announcements a JOIN announcement_recipients r ON r.announcement_id=a.id WHERE a.workspace_id=$1 AND a.id=$2 AND r.user_id=$3 AND a.status='published' AND NOT a.archived AND (a.expires_at IS NULL OR a.expires_at>now())",[workspaceId,row.record_id,row.user_id])).rowCount);}else{const subject=await find(c,ctx,String(row.resource),row.record_id);if(subject.archived)permitted=false;}}catch{permitted=false;}
  const muted=(await c.query('SELECT 1 FROM notification_preferences WHERE workspace_id=$1 AND user_id=$2 AND kind IN ($3,\'email\') AND NOT enabled',[workspaceId,row.user_id,row.kind])).rowCount;
  if(!permitted||muted||row.read_at){await c.query("UPDATE notifications SET email_status='skipped',email_error=NULL WHERE id=$1",[id]);return null;}
  const locale:Locale=['en','zh-CN','zh-TW'].includes(String(row.locale))?row.locale as Locale:'zh-CN';
  const t=(key:string)=>translate(locale,key),title=t(String(row.title_key));
  const url=new URL(row.resource==='announcements'?`/notifications?announcement=${row.record_id}`:`/data/${encodeURIComponent(String(row.resource))}?record=${encodeURIComponent(String(row.record_id))}`,publicOrigin());
  const config=mailConfig();
  await c.query("UPDATE notifications SET email_status='sending',email_error=NULL WHERE id=$1",[id]);
  return {id,recipient:String(row.email),sender:config.from,subject:`Syntherisk · ${title}`,text:`${title}\n\n${t('details')}: ${url.toString()}\n\n${t('notificationEmailHint')}`};
 });
 if(!mail)return;
 try{await (transport??new SmtpTransport()).send(mail);await query("UPDATE notifications SET email_status='sent',emailed_at=now(),email_error=NULL WHERE workspace_id=$1 AND id=$2",[workspaceId,id]);}
 catch(error){const code=error instanceof ProviderError?error.code:'mail_delivery_uncertain';await query('UPDATE notifications SET email_status=$3,email_error=$4 WHERE workspace_id=$1 AND id=$2',[workspaceId,id,code==='mail_delivery_uncertain'?'uncertain':error instanceof ProviderError&&error.retryable?'pending':'failed',code]);throw error instanceof ProviderError?error:new ProviderError('mail_delivery_uncertain',409);}
}
