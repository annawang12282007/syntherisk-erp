import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {Pool} from 'pg';
import {beforeAll,afterAll,it,expect} from 'vitest';
import type {Context} from '../src/lib/context';
import type {Session,Data} from '../src/integrations/workspace-core';
import type {Connection} from '../src/integrations/service';
const original=process.env.DATABASE_URL,name='syntherisk_mail_test_'+randomUUID().replaceAll('-','');
const actor:Context={workspaceId:randomUUID(),companyId:randomUUID(),userId:randomUUID(),roles:['member']},other={...actor,userId:randomUUID()},admin={...actor,userId:randomUUID(),roles:['admin']};
let root:Pool,db:typeof import('../src/lib/db'),domain:typeof import('../src/domain/service'),mail:typeof import('../src/integrations/mail-workflows'),gmail:typeof import('../src/integrations/gmail'),reads:typeof import('../src/integrations/workspace-reads'),core:typeof import('../src/integrations/workspace-core'),conn:Connection;
beforeAll(async()=>{
 root=new Pool({connectionString:original});await root.query('CREATE DATABASE "'+name+'"');const url=new URL(original!);url.pathname='/'+name;process.env.DATABASE_URL=url.toString();
 db=await import('../src/lib/db');domain=await import('../src/domain/service');mail=await import('../src/integrations/mail-workflows');gmail=await import('../src/integrations/gmail');reads=await import('../src/integrations/workspace-reads');core=await import('../src/integrations/workspace-core');
 for(const entry of (await readdir('prisma/migrations')).sort())if(/^\d/.test(entry))await db.query(await readFile('prisma/migrations/'+entry+'/migration.sql','utf8'));
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[actor.workspaceId,'Mail workflow isolated']);await db.query('INSERT INTO companies(id,workspace_id) VALUES($1,$2)',[actor.companyId,actor.workspaceId]);
 for(const user of [actor,other,admin]){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[user.userId,user.roles[0],user.userId+'@example.invalid']);await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[actor.workspaceId,user.userId,user.roles]);}
 conn=(await db.query<Connection>("INSERT INTO integration_connections(workspace_id,user_id,provider,status,google_email) VALUES($1,$2,'gmail','disconnected','member@example.invalid') RETURNING *",[actor.workspaceId,actor.userId]))[0];
},120000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=original;if(root){await root.query('DROP DATABASE IF EXISTS "'+name+'" WITH (FORCE)');await root.end();}});
function session(request:Session['adapter']['request']=async()=>{throw new Error('No external requests expected');}):Session{return {ctx:actor,row:conn,tokens:{scope:'https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly'} as Session['tokens'],adapter:{request} as Session['adapter']};}
it('saves and edits a private draft without Google tokens while its connection is disconnected',async()=>{
 const saved=await gmail.saveDraft({ctx:actor,row:conn},{to:'private@example.invalid',subject:'Offline draft',body:'Private text',body_format:'plain',mail_style:{}});
 const updated=await gmail.saveDraft({ctx:actor,row:conn},{id:saved.id,version:saved.version,to:'private@example.invalid',subject:'Offline updated',body:'Updated text',body_format:'plain',mail_style:{}});
 expect(updated.version).toBe(Number(saved.version)+1);expect(updated.subject).toBe('Offline updated');
 expect(saved.from_name).toBe('member');
 await db.query('UPDATE "user" SET name=$2 WHERE id=$1',[actor.userId,'Updated account name']);
 const retained=await gmail.saveDraft({ctx:actor,row:conn},{id:updated.id,version:updated.version,to:'private@example.invalid',subject:'Keep original sender',body:'Text'});
 expect(retained.from_name).toBe('member');
 const fresh=await gmail.saveDraft({ctx:actor,row:conn},{to:'private@example.invalid',subject:'New account sender',body:'Text',identity_id:randomUUID()});
 expect(fresh.from_name).toBe('Updated account name');expect(fresh.identity_id).toBeNull();
 await expect(gmail.saveDraft({ctx:other,row:conn},{id:saved.id,version:updated.version,body:'Cross owner'})).rejects.toMatchObject({status:404});
});
it('keeps selected mail links personal, deduplicates, supports unlink, and rejects mixed ownership atomically',async()=>{
 const s=session(),item=await core.stage(s,'gmail_message','controlled-selected',{subject:'Synthetic private mail',text:'Private content',labels:['SENT'],internal_date:'1'});
 const target=await domain.create(actor,'tasks',{title:'Follow-up',is_private:true});
 const action={connection_id:conn.id,item_ids:[item.id],resource:'tasks',record_id:target.id};
 await mail.localMailAction(actor,'gmail_link_items',action);await mail.localMailAction(actor,'gmail_link_items',action);
 expect(await db.query('SELECT * FROM integration_item_links WHERE item_id=$1',[item.id])).toHaveLength(1);
 expect(await db.query('SELECT * FROM shared_external_items')).toHaveLength(0);
 await expect(mail.localMailAction(other,'gmail_item_links',action)).rejects.toMatchObject({status:404});
 await expect(mail.localMailAction(actor,'gmail_link_items',{...action,item_ids:[item.id,randomUUID()]})).rejects.toMatchObject({status:404});
 const result=await mail.localMailAction(actor,'gmail_item_links',action) as Data;expect(result.links).toHaveLength(1);
 await mail.localMailAction(actor,'gmail_unlink_items',action);expect(await db.query('SELECT * FROM integration_item_links WHERE item_id=$1',[item.id])).toHaveLength(0);
 const saved=await mail.localMailAction(actor,'gmail_sent_saved',{connection_id:conn.id}) as Data;expect(saved.messages).toHaveLength(1);
});
it('filters contact groups by visibility, contact preferences and duplicate addresses',async()=>{
 const group=await domain.create(actor,'audience_groups',{name:'Controlled group'});
 for(const [ctx,name,email,dnc,priv] of [[actor,'One','allowed@example.invalid',false,false],[actor,'Duplicate','allowed@example.invalid',false,false],[actor,'Refused','refused@example.invalid',true,false],[other,'Private','private@example.invalid',false,true]] as const){
  const contact=await domain.create(ctx,'contacts',{name,email,do_not_contact:dnc,is_private:priv});
  // Fixture membership includes a now-inaccessible contact to exercise server revalidation.
  await db.query('INSERT INTO audience_members(workspace_id,company_id,group_id,contact_id,created_by,updated_by,owner_id) VALUES($1,$2,$3,$4,$5,$5,$5)',[actor.workspaceId,actor.companyId,group.id,contact.id,actor.userId]);
 }
 const result=await mail.groupRecipients(actor,group.id);expect(result.recipients.map(r=>r.email)).toEqual(['allowed@example.invalid']);expect(result.excluded).toBe(3);
});

it('manages group membership atomically, preserves contacts, and returns eligibility without exposing private contacts',async()=>{
 const groups=await import('../src/lib/audience-groups');
 const group=await domain.create(actor,'audience_groups',{name:'Managed recipients'});
 const one=await domain.create(actor,'contacts',{name:'Group one',email:'group-one@example.invalid'});
 const missing=await domain.create(actor,'contacts',{name:'No email'});
 const privateContact=await domain.create(other,'contacts',{name:'Hidden person',email:'hidden-person@example.invalid',is_private:true});
 await expect(groups.changeAudienceMembers(actor,{group_id:group.id,version:group.version,add:[one.id,privateContact.id]})).rejects.toMatchObject({status:404});
 expect((await groups.readAudienceGroup(actor,String(group.id))).total).toBe(0);
 const added=await groups.changeAudienceMembers(actor,{group_id:group.id,version:group.version,add:[one.id,one.id,missing.id]});
 expect(added.total).toBe(2);expect(added.members.map(m=>m.status).sort()).toEqual(['missing_email','ready']);
 await expect(groups.changeAudienceMembers(other,{group_id:group.id,version:added.group.version,add:[]})).rejects.toMatchObject({status:404});
 await expect(groups.changeAudienceMembers(actor,{group_id:group.id,version:group.version,add:[]})).rejects.toMatchObject({status:409});
 const restricted={...actor,permissions:[{resource:'audience_groups',operation:'edit',scope:'none'}]};
 await expect(groups.changeAudienceMembers(restricted,{group_id:group.id,version:added.group.version,add:[one.id]})).rejects.toMatchObject({status:404});
 expect((await groups.readAudienceGroup(restricted,String(group.id))).can_edit).toBe(false);
 expect((await groups.readAudienceGroup(other,String(group.id))).can_edit).toBe(false);
 const row=added.members.find(m=>m.contact_id===one.id)!;
 const removed=await groups.changeAudienceMembers(actor,{group_id:group.id,version:added.group.version,remove:[{id:row.id,version:row.version}]});
 expect(removed.members.map(m=>m.contact_id)).toEqual([missing.id]);expect((await domain.get(actor,'contacts',String(one.id))).archived).toBe(false);
 const again=await groups.changeAudienceMembers(actor,{group_id:group.id,version:removed.group.version,add:[one.id]});expect(again.total).toBe(2);
 const review=await mail.groupRecipients(actor,group.id);expect(review.recipients.map(m=>m.email)).toEqual(['group-one@example.invalid']);expect(review.reasons).toEqual([{name:'No email',reason:'missing_email'}]);
});
it('saves styled drafts and Bcc independently, rechecks do-not-contact, and rejects stale writes',async()=>{
 const s=session(),saved=await gmail.saveDraft(s,{bcc:'allowed@example.invalid',subject:'Controlled',body:'Hello **there**',body_format:'formatted',mail_style:{header:'Syntherisk',signature:'Custom name',accent:'#123456'}});
 expect(saved.bcc_addresses).toEqual(['allowed@example.invalid']);expect((saved.mail_style as Data).signature).toBe('Custom name');
 const plan=await gmail.mailPlan(s,'gmail_send',{draft_id:saved.id});expect(plan.bcc).toEqual(['allowed@example.invalid']);expect(plan.body_format).toBe('formatted');
 await expect(gmail.saveDraft(s,{...saved,id:saved.id,version:0,to:'allowed@example.invalid'})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 await domain.create(actor,'contacts',{name:'Later refusal',email:'allowed@example.invalid',do_not_contact:true});
 await expect(gmail.mailPlan(s,'gmail_send',{draft_id:saved.id})).rejects.toMatchObject({code:'DO_NOT_CONTACT'});
 await expect(gmail.saveDraft(s,{to:'x@example.invalid',body:'X',mail_style:{accent:'url(evil)'}})).rejects.toMatchObject({code:'INVALID_FIELD'});
});
it('synchronizes only SENT messages in a bounded date range and retains stable item links across repeated pages',async()=>{
 const calls:string[]=[],request=(async(_t:unknown,path:string)=>{
  calls.push(path);if(path.includes('/messages?'))return {messages:[{id:'sent1'},{id:'incoming'}],nextPageToken:'page-two'};
  const sent=path.includes('sent1');return {id:sent?'sent1':'incoming',labelIds:sent?['SENT']:['INBOX'],internalDate:'1800000000000',payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'Controlled sent'},{name:'From',value:'member@example.invalid'}],body:{data:Buffer.from('Controlled body').toString('base64url')}}};
 }) as Session['adapter']['request'];
 const s=session(request),input={start:'2026-10-01',end:'2026-10-07',q:'subject:Controlled'};
 const first=await reads.readWorkspace(s,'gmail_sent_sync',input) as Data;expect(first.messages).toHaveLength(1);expect(first.nextPageToken).toBe('page-two');expect(calls[0]).toContain('labelIds=SENT');expect(calls[0]).toContain('maxResults=25');
 const item=(first.messages as Data[])[0],target=await domain.create(actor,'tasks',{title:'Sent follow-up'});
 await mail.localMailAction(actor,'gmail_link_items',{connection_id:conn.id,item_ids:[item.item_id],resource:'tasks',record_id:target.id});
 await reads.readWorkspace(s,'gmail_sent_sync',{...input,page_token:'page-two'});
 expect(await db.query("SELECT * FROM integration_items WHERE external_id='sent1'")).toHaveLength(1);
 expect(await db.query('SELECT * FROM integration_item_links WHERE item_id=$1',[item.item_id])).toHaveLength(1);
 expect(await db.query("SELECT * FROM integration_items WHERE external_id='incoming'")).toHaveLength(0);
 await expect(reads.readWorkspace(s,'gmail_sent_sync',{start:'2025-01-01',end:'2026-10-07'})).rejects.toMatchObject({code:'INVALID_DATE_RANGE'});
});

it('preserves rich drafts and creates a safe inline-image MIME message without external requests',async()=>{
 const {richTextValue,richTextPlain}=await import('../src/lib/rich-text');
 const body=richTextValue('<p><b>正式说明</b> <u>English note</u></p><span style="font-size:24px;color:#123456">Purpose</span><img alt="Test image" width="160" src="data:image/png;base64,aGVsbG8=">');
 const saved=await gmail.saveDraft({ctx:actor,row:conn},{to:'rich@example.invalid',subject:'Rich private draft',body});
 expect(saved.body).toBe(body);
 const wire=Buffer.from(gmail.mimeMessage(saved as unknown as Parameters<typeof gmail.mimeMessage>[0],[]),'base64url').toString('utf8');
 expect(wire).toContain('Content-Disposition: inline');expect(wire).toContain('Content-ID: <');
 const sections=[...wire.matchAll(/Content-Type: text\/(plain|html); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)];
 expect(sections).toHaveLength(2);
 const plain=Buffer.from(sections.find(s=>s[1]==='plain')![2],'base64').toString('utf8'),html=Buffer.from(sections.find(s=>s[1]==='html')![2],'base64').toString('utf8');
 expect(plain).toBe(richTextPlain(body));expect(html).toContain('<b>正式说明</b>');expect(html).toContain('src="cid:');expect(html).not.toContain('src="data:');
 const contact=await domain.create(actor,'contacts',{name:'Private rich fixture',notes:body,is_private:true});
 expect(contact.notes).toBe(body);
 await expect(domain.get(other,'contacts',String(contact.id))).rejects.toMatchObject({status:404});
});
