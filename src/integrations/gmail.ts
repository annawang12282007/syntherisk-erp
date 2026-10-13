import {richString} from '../lib/rich-text-schema';
import {templateVariables} from '../lib/mail-variables';
import {scope} from '../domain/core';
import {normalizeMailStyle,renderMail,mailImageIds,type MailStyle} from '../lib/mail-format';
import {query} from '../lib/db';
import {createHash} from 'node:crypto';
import {DomainError} from '../lib/context';
import {getFile} from '../lib/storage';
import {assertRecordExport} from '../lib/io';
import {get} from '../domain/service';
import {type Data,type Session,session,text,optional,uuid,strings,requireScope,enc,hash} from './workspace-core';
import {addresses} from './meeting-workspace';
import {getMail} from './workspace-reads';
import {ProviderError} from './adapters';
interface Draft extends Data {id:string;version:number;status:string;from_address:string;to_addresses:string[];cc_addresses:string[];subject:string;body:string;body_format:string;mail_style:MailStyle;bcc_addresses:string[];attachments:string[];remote_draft_id:string|null}
export async function attachment(s:Pick<Session,'ctx'|'row'>,id:string){
 const [file]=await query<{id:string;resource:string;record_id:string;filename:string;mime_type:string;byte_size:number;sha256:string;storage_key:string}>('SELECT * FROM attachments WHERE workspace_id=$1 AND id=$2',[s.ctx.workspaceId,uuid(id)]);
 if(!file)throw new DomainError(404,'NOT_FOUND');await assertRecordExport(s.ctx,file.resource,file.record_id);
 if(Number(file.byte_size)>5_000_000)throw new DomainError(413,'FILE_TOO_LARGE');return file;
}
export async function saveDraft(s:Pick<Session,'ctx'|'row'>,data:Data){
 if(s.row.provider!=='gmail')throw new DomainError(422,'INVALID_PROVIDER');
 const to=addresses(data.to),cc=addresses(data.cc),bcc=addresses(data.bcc),subject=optional(data.subject,998),body=richString(50000).parse(data.body??''),attachments=data.attachments?strings(data.attachments,10):[];
 const format=data.body_format??'plain';if(!['plain','formatted'].includes(String(format)))throw new DomainError(422,'INVALID_FIELD');let style:MailStyle;try{style=normalizeMailStyle(data.mail_style);}catch{throw new DomainError(422,'INVALID_FIELD');}
 const images=mailImageIds([body,style.header,style.footer,style.signature].join('\n'));if(images.length>10)throw new DomainError(413,'FILE_TOO_LARGE');let imageBytes=0;
 for(const id of images){const [image]=await query('SELECT octet_length(content) size FROM mail_images WHERE workspace_id=$1 AND id=$2',[s.ctx.workspaceId,id]);if(!image)throw new DomainError(404,'NOT_FOUND');imageBytes+=Number(image.size);}if(imageBytes>5_000_000)throw new DomainError(413,'FILE_TOO_LARGE');
 if(/[\r\n]/.test(subject))throw new DomainError(422,'INVALID_SUBJECT');for(const id of attachments)await attachment(s,id);
 const reply=data.reply_to?await getMail('tokens' in s?s as Session:await session(s.ctx,s.row.id),text(data.reply_to,500)):null;
 const replyRfc=reply?.message_id??null;if(replyRfc&&(/[\r\n]/.test(replyRfc)||!/^<[^<>\s]+>$/.test(replyRfc)))throw new DomainError(422,'INVALID_MESSAGE');
 const from=String(s.row.google_email);if(data.from&&data.from!==from)throw new DomainError(403,'INVALID_SENDER');
 if(data.id&&data.reply_to)throw new DomainError(422,'REPLY_TARGET_IMMUTABLE');
 const prior=data.id?await draft(s,data.id):null;
 // Existing drafts keep their frozen sender; new drafts use the account name.
 const identityId=prior?.identity_id??null;
 const fromName=prior?String(prior.from_name??''):String((await query('SELECT name FROM "user" WHERE id=$1',[s.ctx.userId]))[0]?.name??'').replace(/[\x00-\x1f\x7f<>]/g,'').slice(0,120);

 const replySource=reply??(prior?.reply_message_id?{subject:prior.subject}:null);
 if(replySource&&subject.replace(/^(?:re:\s*)+/i,'').trim()!==String(replySource.subject).replace(/^(?:re:\s*)+/i,'').trim())throw new DomainError(422,'REPLY_SUBJECT_IMMUTABLE');
 if(data.id){const [saved]=await query("UPDATE google_mail_drafts SET to_addresses=$1,cc_addresses=$2,subject=$3,body=$4,attachments=$5,body_format=$11,mail_style=$12,bcc_addresses=$13,from_name=$14,identity_id=$15,version=version+1,status='draft',updated_at=now() WHERE workspace_id=$6 AND user_id=$7 AND connection_id=$8 AND id=$9 AND version=$10 AND status NOT IN ('sending','sent','uncertain') RETURNING *",[to,cc,subject,body,JSON.stringify(attachments),s.ctx.workspaceId,s.ctx.userId,s.row.id,uuid(data.id),Number(data.version),format,JSON.stringify(style),bcc,fromName,identityId||null]);if(!saved)throw new DomainError(409,'VERSION_CONFLICT');return saved;}
 return (await query('INSERT INTO google_mail_drafts(workspace_id,user_id,connection_id,from_address,to_addresses,cc_addresses,subject,body,attachments,reply_message_id,reply_thread_id,reply_rfc_id,body_format,mail_style,bcc_addresses,from_name,identity_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *',[s.ctx.workspaceId,s.ctx.userId,s.row.id,from,to,cc,subject,body,JSON.stringify(attachments),reply?.id??null,reply?.thread_id??null,replyRfc,format,JSON.stringify(style),bcc,fromName,identityId||null]))[0];
}
async function draft(s:Pick<Session,'ctx'|'row'>,id:unknown){const [row]=await query<Draft>('SELECT * FROM google_mail_drafts WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND connection_id=$4',[uuid(id),s.ctx.workspaceId,s.ctx.userId,s.row.id]);if(!row)throw new DomainError(404,'NOT_FOUND');return row;}
export async function mailPlan(s:Session,kind:string,input:Data){
 if(s.row.provider!=='gmail')throw new DomainError(422,'INVALID_PROVIDER');
 if(kind==='gmail_send')requireScope(s,'gmail.send','gmail.compose');else requireScope(s,'gmail.compose');
 const row=await draft(s,input.draft_id);if(['sent','sending','uncertain'].includes(row.status))throw new DomainError(409,'MAIL_DELIVERY_UNCERTAIN');
 if(row.from_address!==s.row.google_email)throw new DomainError(403,'INVALID_SENDER');
 if(templateVariables([row.subject,row.body,row.mail_style.preheader,row.mail_style.header,row.mail_style.footer,row.mail_style.signature].join('\n')).length)throw new DomainError(422,'MAIL_TEMPLATE_VALUES_REQUIRED');
 if(kind==='gmail_send'&&!row.to_addresses.length&&!row.cc_addresses.length&&!row.bcc_addresses.length)throw new DomainError(422,'RECIPIENT_REQUIRED');
 if(input.resource&&input.record_id){const target=await get(s.ctx,text(input.resource),uuid(input.record_id));if(input.resource==='contacts'&&(target.do_not_contact||target.contact_preference==='none'))throw new DomainError(409,'DO_NOT_CONTACT');}
 const allRecipients=[...new Set([...row.to_addresses,...row.cc_addresses,...row.bcc_addresses])];
 if(allRecipients.length>100)throw new DomainError(422,'TOO_MANY_RECIPIENTS');
 const access=scope(s.ctx,'contacts');
 const prohibited=await query('SELECT 1 FROM contacts r WHERE '+access.sql+' AND NOT r.archived AND lower(r.email)=ANY($'+(access.values.length+1)+'::text[]) AND (r.do_not_contact OR r.contact_preference=\'none\') LIMIT 1',[...access.values,allRecipients]);
 if(prohibited.length)throw new DomainError(409,'DO_NOT_CONTACT');
 const files=[];let bytes=0;for(const id of row.attachments){const f=await attachment(s,id);bytes+=Number(f.byte_size);files.push({id:f.id,filename:f.filename,mime:f.mime_type,bytes:f.byte_size,sha256:f.sha256});}if(bytes>10_000_000)throw new DomainError(413,'FILE_TOO_LARGE');
 const remote=row.remote_draft_id?await s.adapter.request<Data>(s.tokens,`/gmail/v1/users/me/drafts/${enc(row.remote_draft_id)}?format=raw`):null;
 if(row.remote_draft_id)requireScope(s,'gmail.compose');
 return {id:row.id,version:row.version,from:row.from_address,from_name:row.from_name,to:row.to_addresses,cc:row.cc_addresses,bcc:row.bcc_addresses,body_format:row.body_format,mail_style:row.mail_style,subject:row.subject,body:row.body,attachments:files,reply_thread_id:row.reply_thread_id,reply_rfc_id:row.reply_rfc_id,remote_draft_id:row.remote_draft_id,remote_version:remote?hash(remote):null,kind};
}
export function messageId(id:string,from?:string){return `<${id}@${from?.split('@')[1]||new URL(process.env.APP_URL||'http://localhost:3000').hostname}>`;}
export function mimeMessage(row:{id:string;from_address:string;from_name?:string;to_addresses:string[];cc_addresses:string[];subject:string;body:string;body_format?:string;mail_style?:MailStyle;bcc_addresses?:string[];reply_rfc_id?:unknown},files:{filename:string;mime_type:string;bytes:Buffer;cid?:string}[]){
 if(/[\r\n]/.test(row.from_address+(row.from_name??'')+row.subject+row.to_addresses.join('')+row.cc_addresses.join('')+(row.bcc_addresses??[]).join('')))throw new DomainError(422,'INVALID_MESSAGE');
 const boundary='syntherisk_'+row.id.replaceAll('-',''),encode=(value:string)=>`=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`,fold=(bytes:Buffer)=>bytes.toString('base64').match(/.{1,76}/g)?.join('\r\n')??'';
 const rendered=renderMail(row.body,row.body_format??'plain',row.mail_style??{}),alt=boundary+'_alternative';
 const inlineFiles:{filename:string;mime_type:string;bytes:Buffer;cid:string}[]=[];
 rendered.html=rendered.html.replace(/src="data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})"/g,(_,type:string,encoded:string)=>{const bytes=Buffer.from(encoded,'base64'),cid=createHash('sha256').update(bytes).digest('hex')+'@syntherisk-inline';if(!inlineFiles.some(f=>f.cid===cid))inlineFiles.push({filename:'image.'+type,mime_type:'image/'+type,bytes,cid});return 'src="cid:'+cid+'"';});
 rendered.html=rendered.html.replace(/\/api\/mail-images\?id=([0-9a-f-]{36})/gi,(_,id:string)=>'cid:'+id+'@syntherisk-mail');
 const parts=[`From: ${row.from_name?encode(row.from_name)+' <'+row.from_address+'>':row.from_address}`,`To: ${row.to_addresses.join(', ')}`,`Cc: ${row.cc_addresses.join(', ')}`,`Bcc: ${(row.bcc_addresses??[]).join(', ')}`,`Subject: ${encode(row.subject)}`,`Message-ID: ${messageId(row.id,row.from_address)}`,`X-Syntherisk-Draft-ID: ${row.id}`,...(typeof row.reply_rfc_id==='string'&&!/[\r\n]/.test(row.reply_rfc_id)?[`In-Reply-To: ${row.reply_rfc_id}`,`References: ${row.reply_rfc_id}`]:[]),'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,`Content-Type: multipart/alternative; boundary="${alt}"`,'',`--${alt}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',fold(Buffer.from(rendered.plain)),`--${alt}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',fold(Buffer.from(rendered.html)),`--${alt}--`];
 for(const file of [...files,...inlineFiles]){if(!/^[\w.+-]+\/[\w.+-]+$/.test(file.mime_type))throw new DomainError(422,'INVALID_MIME');parts.push(`--${boundary}`,`Content-Type: ${file.mime_type}`,`Content-Disposition: ${file.cid?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,...(file.cid?[`Content-ID: <${file.cid}>`]:[]),'Content-Transfer-Encoding: base64','',fold(file.bytes));}parts.push(`--${boundary}--`,'');return Buffer.from(parts.join('\r\n')).toString('base64url');
}
export async function sendOrSave(s:Session,kind:string,input:Data,preview:Data){
 const row=await draft(s,input.draft_id),files=[];
 for(const id of row.attachments){const f=await attachment(s,id),bytes=await getFile(f.storage_key);if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw new DomainError(409,'ATTACHMENT_CHANGED');files.push({filename:f.filename,mime_type:f.mime_type,bytes});}
 for(const id of mailImageIds([row.body,row.mail_style.header,row.mail_style.footer,row.mail_style.signature].join('\n'))){const [file]=await query('SELECT filename,mime_type,content FROM mail_images WHERE workspace_id=$1 AND id=$2',[s.ctx.workspaceId,id]);if(!file)throw new DomainError(404,'NOT_FOUND');files.push({filename:String(file.filename),mime_type:String(file.mime_type),bytes:file.content as Buffer,cid:id+'@syntherisk-mail'});}
 const raw=mimeMessage(row,files);
 const [claimed]=await query("UPDATE google_mail_drafts SET status='sending' WHERE id=$1 AND version=$2 AND status NOT IN ('sending','sent','uncertain') RETURNING id",[row.id,preview.version]);if(!claimed)throw new DomainError(409,'VERSION_CONFLICT');
 try{
  if(kind==='gmail_remote_draft'){
   const saved=await s.adapter.request<{id:string;message:{id:string}}>(s.tokens,`/gmail/v1/users/me/drafts${row.remote_draft_id?'/'+enc(row.remote_draft_id):''}`,{method:row.remote_draft_id?'PUT':'POST',body:JSON.stringify({...(row.remote_draft_id?{id:row.remote_draft_id}:{}),message:{raw,...(row.reply_thread_id?{threadId:row.reply_thread_id}:{})}})});
   await query("UPDATE google_mail_drafts SET remote_draft_id=$1,remote_message_id=$2,status='draft',updated_at=now() WHERE id=$3",[saved.id,saved.message.id,row.id]);return {draft_id:row.id,remote_draft_id:saved.id};
  }
  // A stable RFC Message-ID supports reconciliation after a lost HTTP acknowledgement.
  const result=await s.adapter.request<{id:string;threadId:string}>(s.tokens,row.remote_draft_id?'/gmail/v1/users/me/drafts/send':'/gmail/v1/users/me/messages/send',{method:'POST',body:JSON.stringify(row.remote_draft_id?{id:row.remote_draft_id,message:{raw,...(row.reply_thread_id?{threadId:row.reply_thread_id}:{})}}:{raw,...(row.reply_thread_id?{threadId:row.reply_thread_id}:{})})});
  await query("UPDATE google_mail_drafts SET status='sent',remote_message_id=$1,updated_at=now() WHERE id=$2",[result.id,row.id]);return {...result,draft_id:row.id};
 }catch(error){const uncertain=!(error instanceof ProviderError)||error.retryable;await query('UPDATE google_mail_drafts SET status=$1,updated_at=now() WHERE id=$2',[uncertain?'uncertain':'draft',row.id]);throw error;}
}
export async function reconcileMail(s:Session,id:unknown){
 requireScope(s,'gmail.readonly','gmail.compose');const row=await draft(s,id);
 let known:Awaited<ReturnType<typeof getMail>>|null=null;
 try{known=row.remote_message_id?await getMail(s,String(row.remote_message_id)):null;}catch(error){if(!(error instanceof ProviderError&&error.status===404))throw error;}
 if(known?.labels?.includes('SENT')&&(known.from.match(/<([^<>]+)>/)?.[1]??known.from).trim().toLowerCase()===row.from_address.toLowerCase()){
  await query("UPDATE google_mail_drafts SET status='sent' WHERE id=$1",[row.id]);
  await query("UPDATE integration_operations SET status='succeeded',result=$1,last_error=NULL WHERE connection_id=$2 AND input->>'draft_id'=$3 AND kind='gmail_send' AND status IN ('running','uncertain','failed')",[JSON.stringify({reconciled:true,message_id:known.id}),s.row.id,row.id]);
  return {status:'sent',messages:[known.id],verified_by:'provider_message_id'};
 }
 const q=`in:sent rfc822msgid:${messageId(row.id,row.from_address).slice(1,-1)}`;
 const found=await s.adapter.request<{messages?:{id:string}[]}>(s.tokens,`/gmail/v1/users/me/messages?q=${enc(q)}&maxResults=10`);
 const exact=[];for(const item of found.messages??[]){const mail=await getMail(s,item.id);if(mail.message_id===messageId(row.id,row.from_address))exact.push(mail);}
 if(exact.length){await query("UPDATE google_mail_drafts SET status='sent',remote_message_id=$1 WHERE id=$2",[exact[0].id,row.id]);await query("UPDATE integration_operations SET status='succeeded',result=$1,last_error=NULL WHERE connection_id=$2 AND input->>'draft_id'=$3 AND kind='gmail_send' AND status IN ('running','uncertain','failed')",[JSON.stringify({reconciled:true,message_id:exact[0].id}),s.row.id,row.id]);return {status:'sent',messages:exact.map(m=>m.id)};}
 const [pendingDraft]=await query("SELECT id FROM integration_operations WHERE connection_id=$1 AND input->>'draft_id'=$2 AND kind='gmail_remote_draft' AND status IN ('running','uncertain') ORDER BY created_at DESC LIMIT 1",[s.row.id,row.id]);
 if(pendingDraft){
  const found=await s.adapter.request<{drafts?:{id:string;message:{id:string}}[]}>(s.tokens,`/gmail/v1/users/me/drafts?q=${enc('rfc822msgid:'+messageId(row.id,row.from_address).slice(1,-1))}&maxResults=10`);
  if(found.drafts?.length===1){const candidate=found.drafts[0],mail=await getMail(s,candidate.message.id);if(mail.message_id===messageId(row.id,row.from_address)){
   await query("UPDATE google_mail_drafts SET status='draft',remote_draft_id=$1,remote_message_id=$2 WHERE id=$3",[candidate.id,candidate.message.id,row.id]);
   await query("UPDATE integration_operations SET status='succeeded',result=$1,last_error=NULL WHERE id=$2",[JSON.stringify({reconciled:true,remote_draft_id:candidate.id}),pendingDraft.id]);return {status:'draft',remote_draft_id:candidate.id};
  }}
 }
 return {status:'uncertain',retry_allowed:false,reason:'No sent copy found; indexing can be delayed. Check Gmail Sent before any new message.'};
}
