import {googleIdentityMatches} from '../lib/google-workspace';
import {notificationMailConfigured} from './notification-mail';
import {publicOrigin} from '../lib/public-origin';
import {readJson} from '../lib/request-body';
import { createHash } from 'node:crypto';
import { query, transaction } from '../lib/db';
import { Context, DomainError, hasRole } from '../lib/context';
import { authorization, GoogleAdapter, googleConfig, ProviderError, SCOPES, seal, unseal, type Provider, type Tokens } from './adapters';
import { mailConfig, renderTemplate } from './mail';
import {scope,permissionScope} from '../domain/core';
import {resources} from '../domain/registry';
import {canUseGoogle} from './access';
import {autoSyncEventPredicate} from './privacy';

export interface Connection extends Record<string, unknown> { id: string; workspace_id: string; user_id: string; provider: Provider; status: string; tokens_encrypted: string | null; calendar_id: string | null; sync_direction: string; drive_id: string | null; folder_id: string | null; sync_token: string | null }
function required(value: unknown, key: string, max = 500): string { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new DomainError(422, 'INVALID_FIELD', key); return value.trim(); }
function identifier(value: unknown): string { const id = required(value, 'id'); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new DomainError(422, 'INVALID_ID'); return id; }
function operators(ctx: Context) { if (!hasRole(ctx, 'admin', 'operations')) throw new DomainError(403, 'FORBIDDEN'); }
async function audit(ctx: Context, action: string, id: string, details: Record<string, unknown> = {}) { await query('INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,$3,$4,$5,$6)', [ctx.workspaceId, ctx.userId, 'integrations', id, action, JSON.stringify(details)]); }
export async function connection(ctx: Context, id: string): Promise<Connection> {
  const [row] = await query<Connection>('SELECT * FROM integration_connections WHERE workspace_id=$1 AND id=$2 AND user_id=$3', [ctx.workspaceId, id, ctx.userId]);
  if (!row) throw new DomainError(404, 'NOT_FOUND'); return row;
}
export async function authorizedTokens(row: Connection, adapter = new GoogleAdapter(googleConfig()), allowPaused = false): Promise<Tokens> {
  if (!row.tokens_encrypted || ['disconnected', 'expired', 'pending'].includes(row.status)) throw new ProviderError('authorization_expired', 401);
  return transaction(async client => {
    const current = (await client.query<Connection>('SELECT * FROM integration_connections WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [row.workspace_id, row.id])).rows[0];
    if(current?.paused&&!allowPaused)throw new ProviderError('integration_paused',409);
    if(!(await client.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'",[row.workspace_id,row.user_id])).rowCount)throw new ProviderError('authorization_expired',401);
    if (!current?.tokens_encrypted || current.status === 'disconnected' || current.status === 'expired') throw new ProviderError('authorization_expired', 401);
    if(current.google_email){const user=(await client.query('SELECT email FROM "user" WHERE id=$1',[current.user_id])).rows[0];if(!user||String(user.email).toLowerCase()!==String(current.google_email).toLowerCase())throw new ProviderError('authorization_expired',401);}
    const aad = `${row.workspace_id}:${row.user_id}:${row.provider}`;
    let tokens = unseal<Tokens>(current.tokens_encrypted, adapter.config.encryptionKey, aad);
    if (tokens.expires_at <= Date.now() + 60_000) {
      tokens = await adapter.refresh(tokens);
      await client.query('UPDATE integration_connections SET tokens_encrypted=$1,updated_at=now() WHERE id=$2 AND workspace_id=$3', [seal(tokens, adapter.config.encryptionKey, aad), row.id, row.workspace_id]);
    }
    return tokens;
  }).catch(async error => {
    if (error instanceof ProviderError && error.code === 'authorization_expired') await query("UPDATE integration_connections SET status='expired',last_error=$1 WHERE id=$2 AND workspace_id=$3 AND status<>'disconnected'", [error.code, row.id, row.workspace_id]);
    throw error;
  });
}
export async function enqueue(workspaceId: string, kind: string, payload: Record<string, unknown>, dedupeKey: string) {
  return (await query('INSERT INTO outbox(workspace_id,kind,payload,dedupe_key) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,dedupe_key) DO UPDATE SET dedupe_key=excluded.dedupe_key RETURNING id,status', [workspaceId, kind, JSON.stringify(payload), dedupeKey]))[0];
}
async function status(ctx: Context) {
  let google = false, mail = false, senderAccounts: string[] = [];
  try { googleConfig(); google = true; } catch { /* Deliberately unconfigured. */ }
  try { senderAccounts = [mailConfig().from]; mail = true; } catch { /* No false connected state. */ }
  const connections = await query('SELECT id,provider,status,calendar_id,sync_direction,drive_id,folder_id,last_success_at,last_error,version,google_email,last_access_verified_at,granted_scopes,paused,settings FROM integration_connections WHERE workspace_id=$1 AND user_id=$2 ORDER BY provider', [ctx.workspaceId, ctx.userId]);
  const notifications = await visibleNotifications(ctx);
  const memberConnections=hasRole(ctx,'admin')?await query(`SELECT u.name,u.email,c.provider,c.status,c.google_email,c.last_access_verified_at FROM memberships m JOIN "user" u ON u.id=m.user_id LEFT JOIN integration_connections c ON c.workspace_id=m.workspace_id AND c.user_id=m.user_id WHERE m.workspace_id=$1 AND m.status='active' AND NOT(m.roles <@ ARRAY['external']::text[]) AND (m.user_id IS DISTINCT FROM (SELECT initial_admin_user_id FROM workspaces WHERE id=$1) OR m.user_id=$2) ORDER BY u.name,c.provider`,[ctx.workspaceId,ctx.userId]):undefined;
  return { configured: { google, mail, senderAccounts }, connections, notifications,can_connect:canUseGoogle(ctx),member_connections:memberConnections };
}
export async function visibleNotifications(ctx:Context){
 type Candidate=Record<string,unknown>&{id:string;resource:string;record_id:string;cursor_created_at:string};
 const result:Record<string,unknown>[]=[],batchSize=200;let cursor:{time:string;id:string}|undefined;
 // Narrow expensive privacy graphs to the resources actually present in this inbox.
 // Continue past hidden subjects so the limit applies to authorized notifications.
 while(result.length<100){
  const candidates=await query<Candidate>(`SELECT n.*,n.created_at::text AS cursor_created_at FROM notifications n WHERE n.workspace_id=$1 AND n.user_id=$2${cursor?' AND (n.created_at,n.id)<($3::timestamptz,$4::uuid)':''} ORDER BY n.created_at DESC,n.id DESC LIMIT ${batchSize}`,[ctx.workspaceId,ctx.userId,...(cursor?[cursor.time,cursor.id]:[])]);if(!candidates.length)break;
  const groups=new Map<string,Set<string>>();for(const item of candidates){if(item.resource!=='announcements'&&!Object.hasOwn(resources,item.resource))continue;const ids=groups.get(item.resource)??new Set<string>();ids.add(item.record_id);groups.set(item.resource,ids);}
  const authorized=new Set<string>();await Promise.all([...groups].map(async([resource,ids])=>{if(resource==='announcements'){if(permissionScope(ctx,'announcements','read')!=='none'){const rows=await query<{id:string}>("SELECT a.id FROM announcements a JOIN announcement_recipients r ON r.announcement_id=a.id WHERE a.workspace_id=$1 AND a.company_id=$2 AND r.user_id=$3 AND a.id=ANY($4::uuid[]) AND a.status='published' AND NOT a.archived AND (a.expires_at IS NULL OR a.expires_at>now())",[ctx.workspaceId,ctx.companyId,ctx.userId,[...ids]]);for(const row of rows)authorized.add(`${resource}:${row.id}`);}return;}const access=scope(ctx,resource,'subject'),rows=await query<{id:string}>(`SELECT subject.id FROM ${resource} subject WHERE ${access.sql} AND subject.id=ANY($4::uuid[])`,[...access.values,[...ids]]);for(const row of rows)authorized.add(`${resource}:${row.id}`);}));
  for(const item of candidates){if(!authorized.has(`${item.resource}:${item.record_id}`))continue;const visible:Record<string,unknown>={...item};delete visible.cursor_created_at;result.push(visible);if(result.length===100)break;}
  if(candidates.length<batchSize)break;const last=candidates[candidates.length-1];cursor={time:last.cursor_created_at,id:last.id};
 }
 return result;
}
async function callback(ctx: Context, url: URL) {
  if(!canUseGoogle(ctx))throw new DomainError(403,'FORBIDDEN');
  const origin = publicOrigin();
  const state = required(url.searchParams.get('state'), 'state'), hash = createHash('sha256').update(state).digest('hex');
  const [pending] = await query<{ provider: Provider; verifier_encrypted: string; requested_scopes:string[] }>('DELETE FROM oauth_states WHERE state_hash=$1 AND workspace_id=$2 AND user_id=$3 AND expires_at>now() RETURNING provider,verifier_encrypted,requested_scopes', [hash, ctx.workspaceId, ctx.userId]);
  if (!pending) throw new DomainError(400, 'OAUTH_STATE_INVALID');
  if (url.searchParams.has('error')) { await query("UPDATE integration_connections SET status='failed',last_error='authorization_denied' WHERE workspace_id=$1 AND user_id=$2 AND provider=$3", [ctx.workspaceId, ctx.userId, pending.provider]); return Response.redirect(new URL('/settings?section=integrations&integration=denied', origin)); }
  const config = googleConfig(), adapter = new GoogleAdapter(config), aad = `${ctx.workspaceId}:${ctx.userId}:${pending.provider}`;
  const verifier = unseal<string>(pending.verifier_encrypted, config.encryptionKey, hash);
  const tokens = await adapter.exchange(required(url.searchParams.get('code'), 'code', 4000), verifier);
  if (!(pending.requested_scopes.length?pending.requested_scopes:SCOPES[pending.provider]).every(scope => tokens.scope.split(' ').includes(scope))) throw new DomainError(403, 'OAUTH_SCOPE_MISSING');
  const identity=await adapter.identity(tokens),expected=(await query<{email:string}>('SELECT email FROM \"user\" WHERE id=$1',[ctx.userId]))[0]?.email.toLowerCase();
  if(!googleIdentityMatches(identity,expected))throw new DomainError(403,'GOOGLE_ACCOUNT_MISMATCH');
  if(!tokens.refresh_token)throw new DomainError(403,'GOOGLE_OFFLINE_ACCESS_REQUIRED');
  await query("UPDATE integration_connections SET granted_scopes=$7,paused=false,google_email=$5,google_subject=$6,last_access_verified_at=NULL,tokens_encrypted=$1,status='connected',last_error=NULL,updated_at=now(),version=version+1 WHERE workspace_id=$2 AND user_id=$3 AND provider=$4", [seal(tokens, config.encryptionKey, aad), ctx.workspaceId, ctx.userId, pending.provider,identity.email,identity.subject,tokens.scope.split(' ')]);
  await audit(ctx, 'oauth_connected', pending.provider);
  return Response.redirect(new URL('/settings?section=integrations&integration=connected', origin));
}
interface Contact extends Record<string, unknown> { id: string; name: string; email: string | null; do_not_contact: boolean; contact_preference: string | null }
const stoppedContact=(recipient:Contact)=>recipient.do_not_contact||recipient.contact_preference==='none';
async function contact(ctx: Context, id: string) { const domain=await import('../domain/service');await domain.get(ctx,'contacts',id);const [row] = await query<Contact>('SELECT id,name,email,do_not_contact,contact_preference FROM contacts WHERE workspace_id=$1 AND id=$2 AND archived=false', [ctx.workspaceId, id]); if (!row) throw new DomainError(404, 'NOT_FOUND'); return row; }
interface Message extends Record<string, unknown> { id: string; version: number; contact_id: string; subject: string; body: string; status: string; sender_account: string; to_address: string }
async function message(ctx: Context, id: string,write=false) { const domain=await import('../domain/service');await domain.assertAccess(ctx,'messages',id,write?'write':'read');const [row] = await query<Message>('SELECT * FROM messages WHERE workspace_id=$1 AND id=$2 AND archived=false', [ctx.workspaceId, id]); if (!row) throw new DomainError(404, 'NOT_FOUND'); return row; }
function preview(row: Message, recipient: Contact) {
  const values = { name: recipient.name, first_name: recipient.name.split(' ')[0], email: recipient.email ?? '' };
  return { subject: renderTemplate(row.subject, values), body: renderTemplate(row.body, values), to_address: recipient.email, sender_account: row.sender_account, do_not_contact: stoppedContact(recipient), version: row.version };
}
export async function handleIntegration(ctx: Context, request: Request): Promise<Response> {
  let usedConnectionId:string|undefined;
  try {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.searchParams.has('state')) return await callback(ctx, url);
    if (request.method === 'GET') return Response.json({ data: await status(ctx) });
    const data = await readJson(request,7_000_000) as Record<string, unknown>;
    const action = required(data.action, 'action');
    if(action==='notification_status')return Response.json({data:{email_configured:notificationMailConfigured()}});
    if (action === 'notifications') return Response.json({ data: await visibleNotifications(ctx) });
    if (action === 'read_notification') { await query('UPDATE notifications SET read_at=now() WHERE workspace_id=$1 AND user_id=$2 AND id=$3', [ctx.workspaceId, ctx.userId, identifier(data.id)]); return Response.json({ data: { saved: true } }); }
    if (action === 'notification_preference') { const kind = required(data.kind, 'kind'); if (!['due','assigned','handoff','request','review','renewal','integration','signature_requested','completion_requested','task_completed','announcement','email'].includes(kind) || typeof data.enabled !== 'boolean') throw new DomainError(422,'INVALID_FIELD'); await query('INSERT INTO notification_preferences(workspace_id,user_id,kind,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,user_id,kind) DO UPDATE SET enabled=excluded.enabled', [ctx.workspaceId, ctx.userId, kind, data.enabled]); return Response.json({ data: { saved: true } }); }
    const googleActions=['connect','disconnect','revoke_grant','pause','resume','sync','sync_status','sync_jobs','sync_conflicts','resolve_conflict','calendars','configure','drive_drives','drive_files','drive_file','drive_upload','link_drive_file','verify_connection'];
    if(googleActions.includes(action)){if(!canUseGoogle(ctx))throw new DomainError(403,'FORBIDDEN');}else operators(ctx);
    if (action === 'connect') {
      const provider = required(data.provider, 'provider') as Provider;
      if (!(provider in SCOPES)) throw new DomainError(422, 'INVALID_PROVIDER');
      const config = googleConfig(), auth = authorization(config, provider,typeof data.capability==='string'?data.capability:undefined), hash = createHash('sha256').update(auth.state).digest('hex');
      await transaction(async client => {
        await client.query('DELETE FROM oauth_states WHERE expires_at<now() OR (workspace_id=$1 AND user_id=$2 AND provider=$3)', [ctx.workspaceId, ctx.userId, provider]);
        await client.query('INSERT INTO oauth_states(state_hash,workspace_id,user_id,provider,verifier_encrypted,expires_at,requested_scopes) VALUES($1,$2,$3,$4,$5,now()+interval \'10 minutes\',$6)', [hash, ctx.workspaceId, ctx.userId, provider, seal(auth.verifier, config.encryptionKey, hash),auth.scopes]);
        await client.query("INSERT INTO integration_connections(workspace_id,user_id,provider) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id,provider) DO UPDATE SET last_error=NULL,updated_at=now()", [ctx.workspaceId, ctx.userId, provider]);
      });
      return Response.json({ data: { authorizationUrl: auth.url } });
    }
    if (action === 'messages') {const domain=await import('../domain/service'),result=await domain.list(ctx,'messages',{page:data.page??1,pageSize:data.pageSize??100,sort:'created_at'});const receipts=await query('SELECT message_id,provider_message_id,error_code FROM deliveries WHERE workspace_id=$1 AND message_id=ANY($2::uuid[])',[ctx.workspaceId,result.rows.map(row=>row.id)]);return Response.json({data:{...result,rows:result.rows.map(row=>({...row,...receipts.find(r=>r.message_id===row.id)}))}});}
    if(action==='preview_campaign'||action==='prepare_campaign'){
      const domain=await import('../domain/service'),campaignId=identifier(data.campaign_id);await domain.get(ctx,'campaigns',campaignId);
      const [campaign]=await query<{id:string;template_id:string;group_id:string;status:string}>('SELECT id,template_id,group_id,status FROM campaigns WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,campaignId]);
      if(!campaign?.template_id||!campaign.group_id)throw new DomainError(422,'CAMPAIGN_TEMPLATE_AND_GROUP_REQUIRED');
      await domain.get(ctx,'communication_templates',campaign.template_id);await domain.get(ctx,'audience_groups',campaign.group_id);
      const [template]=await query<{subject:string;body:string}>('SELECT subject,body FROM communication_templates WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,campaign.template_id]);
      const recipients=await query<Contact>('SELECT DISTINCT c.id,c.name,c.email,c.do_not_contact,c.contact_preference FROM contacts c JOIN audience_members a ON a.contact_id=c.id AND a.workspace_id=c.workspace_id WHERE a.group_id=$1 AND c.workspace_id=$2 AND c.archived=false AND a.archived=false ORDER BY c.name',[campaign.group_id,ctx.workspaceId]);
      for(const recipient of recipients)await domain.get(ctx,'contacts',recipient.id);
      const previews=recipients.map(recipient=>({contact_id:recipient.id,name:recipient.name,to_address:recipient.email,eligible:!!recipient.email&&!stoppedContact(recipient),reason:stoppedContact(recipient)?'do_not_contact':!recipient.email?'contact_email_required':null,subject:renderTemplate(template.subject,{name:recipient.name,first_name:recipient.name.split(' ')[0],email:recipient.email??''}),body:renderTemplate(template.body,{name:recipient.name,first_name:recipient.name.split(' ')[0],email:recipient.email??''})}));
      if(action==='preview_campaign')return Response.json({data:{recipients:previews,total:previews.length,eligible:previews.filter(x=>x.eligible).length}});
      const core=await import('../domain/core');if(!core.operationAccess(ctx,'messages','create'))throw new DomainError(403,'FORBIDDEN');
      if(campaign.status==='closed')throw new DomainError(409,'CAMPAIGN_CLOSED');
      const sender=required(data.sender_account,'sender_account');if(/[\r\n]/.test(sender))throw new DomainError(422,'INVALID_SENDER');
      const ids=await transaction(async client=>{
        const results:string[]=[];
        for(const recipient of previews.filter(x=>x.eligible)){
          const inserted=(await client.query<{id:string}>("INSERT INTO messages(workspace_id,company_id,created_by,updated_by,owner_id,contact_id,to_address,subject,body,sender_account,campaign_id,template_id) VALUES($1,$2,$3,$3,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(workspace_id,campaign_id,contact_id) WHERE campaign_id IS NOT NULL DO NOTHING RETURNING id",[ctx.workspaceId,ctx.companyId,ctx.userId,recipient.contact_id,recipient.to_address,recipient.subject,recipient.body,sender,campaignId,campaign.template_id])).rows[0];if(inserted)results.push(inserted.id);
        }return results;
      });await audit(ctx,'campaign_drafts_prepared',campaignId,{count:ids.length});return Response.json({data:{created:ids.length,message_ids:ids,excluded:previews.filter(x=>!x.eligible)}});
    }
    if (action === 'save_message') {
      const core=await import('../domain/core');if(!core.operationAccess(ctx,'messages',data.id?'edit':'create'))throw new DomainError(403,'FORBIDDEN');
      let templateId:string|null=null,sourceSubject=data.subject,sourceBody=data.body;
      if(data.template_id){templateId=identifier(data.template_id);const domain=await import('../domain/service');await domain.get(ctx,'communication_templates',templateId);const [template]=await query<{subject:string;body:string}>('SELECT subject,body FROM communication_templates WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,templateId]);sourceSubject=sourceSubject||template.subject;sourceBody=sourceBody||template.body;}
      const recipient = await contact(ctx, identifier(data.contact_id)), subject = required(sourceSubject, 'subject', 998), body = required(sourceBody, 'body', 100_000), sender = required(data.sender_account, 'sender_account');
      if (!recipient.email) throw new DomainError(422, 'CONTACT_EMAIL_REQUIRED');
      if (stoppedContact(recipient)) throw new DomainError(409, 'DO_NOT_CONTACT');
      if (/[\r\n]/.test(subject + sender)) throw new DomainError(422,'INVALID_FIELD');
      const fields = { name: recipient.name, first_name: recipient.name.split(' ')[0], email: recipient.email }; renderTemplate(subject, fields); renderTemplate(body, fields);
      let rows;
      if (data.id) {await message(ctx,identifier(data.id),true);rows = await query("UPDATE messages SET subject=$1,body=$2,sender_account=$3,to_address=$4,contact_id=$5,status='draft',reviewed_by=NULL,reviewed_at=NULL,version=version+1,updated_by=$6,updated_at=now() WHERE workspace_id=$7 AND id=$8 AND version=$9 AND status IN ('draft','reviewed','failed') RETURNING *", [subject, body, sender, recipient.email, recipient.id, ctx.userId, ctx.workspaceId, identifier(data.id), data.version]);}
      else rows = await query('INSERT INTO messages(workspace_id,company_id,created_by,updated_by,owner_id,contact_id,to_address,subject,body,sender_account,template_id) VALUES($1,$2,$3,$3,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [ctx.workspaceId,ctx.companyId,ctx.userId,recipient.id,recipient.email,subject,body,sender,templateId]);
      if (!rows[0]) throw new DomainError(409,'VERSION_CONFLICT'); await audit(ctx,'message_saved',String(rows[0].id)); return Response.json({ data: rows[0] });
    }
    if (['preview_message','review_message','send_message','cancel_message'].includes(action)) {
      const row = await message(ctx,identifier(data.id),action!=='preview_message'), recipient = await contact(ctx,row.contact_id), rendered = preview(row,recipient);
      if (action === 'preview_message') return Response.json({data:rendered});
      if (row.version !== data.version) throw new DomainError(409,'VERSION_CONFLICT');
      if (action === 'review_message') {
        const rows = await query("UPDATE messages SET status='reviewed',reviewed_by=$1,reviewed_at=now(),version=version+1,updated_at=now() WHERE workspace_id=$2 AND id=$3 AND version=$4 AND status IN ('draft','failed') RETURNING *", [ctx.userId,ctx.workspaceId,row.id,row.version]);
        if (!rows[0]) throw new DomainError(409,'INVALID_TRANSITION'); await audit(ctx,'message_reviewed',row.id); return Response.json({data:rows[0]});
      }
      if (action === 'cancel_message') {
        const rows=await query("UPDATE messages SET status='cancelled',version=version+1 WHERE workspace_id=$1 AND id=$2 AND version=$3 AND status IN ('draft','reviewed','queued','failed') AND NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.message_id=messages.id AND d.status IN ('sending','sent','uncertain')) RETURNING *",[ctx.workspaceId,row.id,row.version]);
        if(!rows[0])throw new DomainError(409,'INVALID_TRANSITION');return Response.json({data:rows[0]});
      }
      if(data.confirm!==true)throw new DomainError(422,'SEND_CONFIRMATION_REQUIRED');
      if(stoppedContact(recipient))throw new DomainError(409,'DO_NOT_CONTACT');
      const config=mailConfig();
      if(row.sender_account!==config.from)throw new DomainError(422,'INVALID_SENDER');
      if(row.status!=='reviewed')throw new DomainError(409,'REVIEW_REQUIRED');
      if(row.to_address!==recipient.email)throw new DomainError(409,'RECIPIENT_CHANGED');
      const result=await transaction(async client=>{
        const saved=(await client.query("UPDATE messages SET status='queued',subject=$1,body=$2,confirmed_by=$3,confirmed_at=now(),version=version+1,updated_at=now() WHERE workspace_id=$4 AND id=$5 AND version=$6 AND status='reviewed' RETURNING *",[rendered.subject,rendered.body,ctx.userId,ctx.workspaceId,row.id,row.version])).rows[0];
        if(!saved)throw new DomainError(409,'VERSION_CONFLICT');
        await client.query("INSERT INTO deliveries(workspace_id,message_id,company_id,created_by,updated_by,owner_id,provider,status) VALUES($1,$2,$3,$4,$4,$4,'smtp','pending') ON CONFLICT(message_id) DO UPDATE SET status='pending',error_code=NULL WHERE deliveries.status='failed'",[ctx.workspaceId,row.id,ctx.companyId,ctx.userId]);
        await client.query("INSERT INTO outbox(workspace_id,kind,payload,dedupe_key) VALUES($1,'mail',$2,$3) ON CONFLICT(workspace_id,dedupe_key) DO UPDATE SET status='pending',available_at=now(),last_error=NULL WHERE outbox.status='failed'",[ctx.workspaceId,JSON.stringify({message_id:row.id}),`mail:${row.id}`]);
        await client.query('INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action) VALUES($1,$2,\'messages\',$3,\'send_confirmed\')',[ctx.workspaceId,ctx.userId,row.id]);return saved;
      });return Response.json({data:result});
    }
    const row=await connection(ctx,identifier(data.connection_id));
    usedConnectionId=row.id;
    if(action==='pause'||action==='resume'){
      await query('UPDATE integration_connections SET paused=$1 WHERE workspace_id=$2 AND id=$3',[action==='pause',ctx.workspaceId,row.id]);return Response.json({data:{paused:action==='pause'}});
    }
    if(action==='disconnect'){
      await query("UPDATE integration_connections SET tokens_encrypted=NULL,status='disconnected',paused=true,last_error=NULL,version=version+1 WHERE workspace_id=$1 AND id=$2",[ctx.workspaceId,row.id]);
      await audit(ctx,'local_disconnected',row.id);return Response.json({data:{status:'disconnected',revocation:'local_only'}});
    }
    if(action==='revoke_grant'){
      if(data.confirm_all_services!==true)throw new DomainError(409,'ALL_SERVICES_CONFIRMATION_REQUIRED');
      if(row.tokens_encrypted){const config=googleConfig();await new GoogleAdapter(config).revoke(unseal<Tokens>(row.tokens_encrypted,config.encryptionKey,`${row.workspace_id}:${row.user_id}:${row.provider}`));}
      // Google revocation may invalidate all grants for this user/client, across ERP workspaces.
      await query("UPDATE integration_connections SET tokens_encrypted=NULL,status='disconnected',paused=true,last_error='google_grant_revoked',version=version+1 WHERE user_id=$1",[ctx.userId]);
      await audit(ctx,'google_grant_revoked',row.id);return Response.json({data:{status:'disconnected',revocation:'all_google_services'}});
    }
    if(action==='sync'){
      if(row.provider!=='calendar'||!row.calendar_id)throw new DomainError(422,'CALENDAR_REQUIRED');
      if(row.paused||row.status==='disconnected'||row.status==='expired')throw new DomainError(409,'RECONNECT_REQUIRED');
      const existing=await query("SELECT id,status FROM outbox WHERE workspace_id=$1 AND kind='calendar' AND payload->>'connection_id'=$2 AND status IN ('pending','running')",[ctx.workspaceId,row.id]);
      return Response.json({data:existing[0]??await enqueue(ctx.workspaceId,'calendar',{connection_id:row.id},`calendar:${row.id}:${Date.now()}`)});
    }
    if(action==='sync_status'){const [job]=await query("SELECT status,last_error FROM outbox WHERE id=$1 AND workspace_id=$2 AND kind='calendar' AND payload->>'connection_id'=$3",[identifier(data.job_id),ctx.workspaceId,row.id]);if(!job)throw new DomainError(404,'NOT_FOUND');return Response.json({data:job});}
    if(action==='sync_jobs')return Response.json({data:await query('SELECT * FROM sync_jobs WHERE workspace_id=$1 AND connection_id=$2 ORDER BY started_at DESC LIMIT 50',[ctx.workspaceId,row.id])});
    if(action==='sync_conflicts'){const access=scope(ctx,'events','event');return Response.json({data:await query(`SELECT mapping.id,event_id,external_id,etag,local_version,external_snapshot FROM external_event_mappings mapping JOIN events event ON event.id=mapping.event_id AND event.workspace_id=mapping.workspace_id WHERE ${access.sql} AND ${autoSyncEventPredicate('event')} AND mapping.connection_id=$4 AND mapping.status='conflict'`,[...access.values,row.id])});}
    if(action==='resolve_conflict'){
      const strategy=required(data.strategy,'strategy');if(!['local','remote'].includes(strategy))throw new DomainError(422,'INVALID_FIELD');
      const calendar=await import('./calendar');const resolution=await calendar.resolveCalendarConflict(row,identifier(data.mapping_id),strategy as 'local'|'remote');
      await audit(ctx,'sync_conflict_resolved',row.id,{strategy});return Response.json({data:{saved:true,...resolution}});
    }
    const adapter=new GoogleAdapter(googleConfig()),tokens=await authorizedTokens(row,adapter,['calendars','verify_connection','drive_drives','drive_files','drive_file','configure','link_drive_file'].includes(action));
    if(action==='calendars'){if(row.provider!=='calendar')throw new DomainError(422,'INVALID_PROVIDER');return Response.json({data:await adapter.calendars(tokens)});}
    if(action==='verify_connection'){
      const identity=await adapter.identity(tokens),owner=(await query<{email:string}>('SELECT email FROM "user" WHERE id=$1',[ctx.userId]))[0];
      if(!googleIdentityMatches(identity,owner?.email))throw new DomainError(403,'GOOGLE_ACCOUNT_MISMATCH');
      if(row.provider==='calendar'){const selected=(await adapter.calendars(tokens)).items.find(item=>item.id===row.calendar_id);if(!selected||!['owner','writer','reader'].includes(selected.accessRole)||row.sync_direction!=='pull'&&!['writer','owner'].includes(selected.accessRole))throw new DomainError(403,'CALENDAR_ACCESS_DENIED');}
      else if(row.provider==='drive'){if(!row.folder_id)throw new DomainError(409,'FOLDER_REQUIRED');await adapter.driveFile(tokens,row.folder_id);}
      await query('UPDATE integration_connections SET last_access_verified_at=now(),google_email=$3 WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,row.id,identity.email]);return Response.json({data:{verified:true}});
    }
    if(action==='configure'){
      if(row.provider==='calendar'){
        const calendar=required(data.calendar_id,'calendar_id'),direction=required(data.sync_direction,'sync_direction');
        if(!['push','pull','both'].includes(direction))throw new DomainError(422,'INVALID_FIELD');
        const calendars=await adapter.calendars(tokens),selected=calendars.items.find(c=>c.id===calendar);
        if(!selected||!['owner','writer','reader'].includes(selected.accessRole)|| (direction!=='pull'&&!['writer','owner'].includes(selected.accessRole)))throw new DomainError(403,'CALENDAR_ACCESS_DENIED');
        const mapped=await query('SELECT id FROM external_event_mappings WHERE connection_id=$1 LIMIT 1',[row.id]);
        if(mapped.length&&row.calendar_id!==calendar)throw new DomainError(409,'CALENDAR_HAS_MAPPINGS');
        await query('UPDATE integration_connections SET calendar_id=$1,sync_direction=$2,sync_token=NULL,version=version+1 WHERE id=$3 AND workspace_id=$4',[calendar,direction,row.id,ctx.workspaceId]);
      }else{
        const folder=required(data.folder_id,'folder_id'),selected=await adapter.driveFile(tokens,folder);
        if(selected.mimeType!=='application/vnd.google-apps.folder')throw new DomainError(422,'FOLDER_REQUIRED');
        await query('UPDATE integration_connections SET folder_id=$1,drive_id=$2,version=version+1 WHERE id=$3 AND workspace_id=$4',[folder,selected.driveId??null,row.id,ctx.workspaceId]);
      }return Response.json({data:{saved:true}});
    }
    if(row.provider==='drive'){
      if(action==='drive_drives')return Response.json({data:await adapter.drives(tokens)});
      if(action==='drive_files')return Response.json({data:await adapter.driveFiles(tokens,typeof data.drive_id==='string'?data.drive_id:row.drive_id??undefined,typeof data.folder_id==='string'?data.folder_id:row.folder_id??undefined,typeof data.page_token==='string'?data.page_token:undefined)});
      if(action==='drive_file'||action==='link_drive_file'){
        const file=await adapter.driveFile(tokens,required(data.file_id,'file_id'));
        if(action==='link_drive_file'){
          const doc=identifier(data.document_id),domain=await import('../domain/service');await domain.assertAccess(ctx,'documents',doc,'write');
          await query('INSERT INTO drive_file_links(workspace_id,connection_id,document_id,file_id,name,mime_type,web_view_link,modified_time,can_download,can_edit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(connection_id,file_id) DO UPDATE SET document_id=excluded.document_id,name=excluded.name,can_download=excluded.can_download,can_edit=excluded.can_edit,checked_at=now()',[ctx.workspaceId,row.id,doc,file.id,file.name,file.mimeType,file.webViewLink??null,file.modifiedTime??null,file.capabilities?.canDownload??false,file.capabilities?.canEdit??false]);
          await audit(ctx,'drive_file_linked',doc,{file_id:file.id});
        }return Response.json({data:file});
      }
      if(action==='drive_upload'){
        const folder=row.folder_id;if(!folder)throw new DomainError(422,'FOLDER_REQUIRED');
        const name=required(data.filename,'filename',255),mime=required(data.mime_type,'mime_type',100),base64=required(data.content_base64,'content_base64',7_000_000);
        if(!/^[\w.+-]+\/[\w.+-]+$/.test(mime))throw new DomainError(422,'INVALID_MIME');
        const bytes=Buffer.from(base64,'base64');if(bytes.length>5_000_000)throw new DomainError(413,'FILE_TOO_LARGE');
        throw new DomainError(409,'DESTINATION_REVIEW_REQUIRED');
      }
    }
    throw new DomainError(404,'ACTION_NOT_FOUND');
  } catch(error){
    if(error instanceof ProviderError){if(error.code==='authorization_expired'&&usedConnectionId)await query("UPDATE integration_connections SET status='expired',last_error='authorization_expired' WHERE workspace_id=$1 AND id=$2 AND user_id=$3 AND status<>'disconnected'",[ctx.workspaceId,usedConnectionId,ctx.userId]);return Response.json({error:{code:error.code,message:error.code}},{status:error.status>=400&&error.status<600?error.status:502});}
    if(error instanceof DomainError)return Response.json({error:{code:error.code,message:error.message}},{status:error.status});
    throw error;
  }
}
