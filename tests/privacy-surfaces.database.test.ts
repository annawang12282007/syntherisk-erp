import 'dotenv/config';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Client,Pool} from 'pg';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import type {Context} from '../src/lib/context';
import {GoogleAdapter,seal,type GoogleConfig,type Tokens} from '../src/integrations/adapters';
import type {Connection} from '../src/integrations/service';

const originalUrl=process.env.DATABASE_URL,originalDir=process.env.ATTACHMENT_DIR,originalBucket=process.env.S3_BUCKET;
const databaseName=`syntherisk_privacy_surfaces_${randomUUID().replaceAll('-','')}`,workspaceId=randomUUID(),companyId=randomUUID(),creator=randomUUID(),administrator=randomUUID(),documentId=randomUUID(),publicId=randomUUID(),contactId=randomUUID(),attachmentId=randomUUID();
const ctx:Context={workspaceId,companyId,userId:administrator,roles:['admin','operations','finance']},owner:Context={...ctx,userId:creator};
let admin:Pool,db:typeof import('../src/lib/db'),io:typeof import('../src/lib/io'),printing:typeof import('../src/lib/print'),history:typeof import('../src/domain/audit-history'),service:typeof import('../src/domain/service'),integrations:typeof import('../src/integrations/service'),calendar:typeof import('../src/integrations/calendar'),download:typeof import('../src/lib/attachment-download'),scratch:string;
beforeAll(async()=>{
 if(!originalUrl)throw Error('DATABASE_URL required');admin=new Pool({connectionString:originalUrl});await admin.query(`CREATE DATABASE "${databaseName}"`);const url=new URL(originalUrl);url.pathname='/'+databaseName;process.env.DATABASE_URL=url.toString();scratch=await mkdtemp(join(tmpdir(),'syntherisk-privacy-'));process.env.ATTACHMENT_DIR=scratch;delete process.env.S3_BUCKET;
 db=await import('../src/lib/db');const root=join(process.cwd(),'prisma','migrations');for(const entry of(await readdir(root,{withFileTypes:true})).filter(item=>item.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join(root,entry.name,'migration.sql'),'utf8'));
 io=await import('../src/lib/io');printing=await import('../src/lib/print');history=await import('../src/domain/audit-history');service=await import('../src/domain/service');integrations=await import('../src/integrations/service');calendar=await import('../src/integrations/calendar');download=await import('../src/lib/attachment-download');
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'Private surfaces test']);await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3)',[companyId,workspaceId,'Private surfaces company']);
 for(const [id,name]of[[creator,'Private creator'],[administrator,'Other administrator']]){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[id,name,`${id}@example.invalid`]);await db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin','operations','finance'])",[workspaceId,id]);}
 await db.query("INSERT INTO documents(id,workspace_id,company_id,created_by,updated_by,owner_id,title,content,is_private) VALUES($1,$2,$3,$4,$4,$5,'Private report marker','PRIVATE_CONTENT_MARKER',true),($6,$2,$3,$5,$5,$5,'Public report marker','Public content',false)",[documentId,workspaceId,companyId,creator,administrator,publicId]);
 await db.query("INSERT INTO document_versions(workspace_id,company_id,created_by,updated_by,owner_id,document_id,version_number,content) VALUES($1,$2,$3,$3,$4,$5,1,'PRIVATE_VERSION_MARKER')",[workspaceId,companyId,creator,administrator,documentId]);
 await db.query("INSERT INTO contacts(id,workspace_id,company_id,created_by,updated_by,owner_id,name,email,is_private) VALUES($1,$2,$3,$4,$4,$5,'Private contact marker','private@example.invalid',true)",[contactId,workspaceId,companyId,creator,administrator]);
 for(const [resource,id]of[['documents',documentId],['contacts',contactId]])await db.query('INSERT INTO record_grants(workspace_id,resource,record_id,user_id,can_edit) VALUES($1,$2,$3,$4,true)',[workspaceId,resource,id,administrator]);
 const bytes=Buffer.from('PRIVATE_ATTACHMENT_MARKER'),storage=await import('../src/lib/storage'),key=`${workspaceId}/${attachmentId}`;await storage.putFile(key,bytes,'text/plain');await db.query("INSERT INTO attachments(id,workspace_id,company_id,resource,record_id,filename,mime_type,byte_size,sha256,storage_key,created_by) VALUES($1,$2,$3,'documents',$4,'private.txt','text/plain',$5,$6,$7,$8)",[attachmentId,workspaceId,companyId,documentId,bytes.length,createHash('sha256').update(bytes).digest('hex'),key,creator]);
 for(const [id,title]of[[documentId,'PRIVATE_AUDIT_MARKER'],[publicId,'Public audit marker'],[randomUUID(),'DELETED_PRIVATE_MARKER']])await db.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,'documents',$3,'create',$4)",[workspaceId,creator,id,JSON.stringify({title,submitted_snapshot:{secret:'OLD_EMBEDDED_PRIVATE_MARKER'}})]);
 await db.query("INSERT INTO audit_log(workspace_id,actor_id,resource,action,after_data) VALUES($1,$2,'permissions','configure',$3)",[workspaceId,administrator,JSON.stringify({changed_fields:['scope']})]);
 for(const id of[documentId,publicId])await db.query("INSERT INTO notifications(workspace_id,user_id,kind,title_key,resource,record_id,dedupe_key) VALUES($1,$2,'assigned','notification.assigned','documents',$3,$4)",[workspaceId,administrator,id,randomUUID()]);
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=originalUrl;if(originalDir===undefined)delete process.env.ATTACHMENT_DIR;else process.env.ATTACHMENT_DIR=originalDir;if(originalBucket===undefined)delete process.env.S3_BUCKET;else process.env.S3_BUCKET=originalBucket;if(admin){await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}if(scratch)await rm(scratch,{recursive:true,force:true});});
describe('creator-only privacy across secondary data surfaces',()=>{
 it('hides search, raw/formatted exports, print and child records from another administrator despite ownership and grants',async()=>{
  expect((await service.search(ctx,'Private')).results).toEqual([]);expect((await service.list(ctx,'document_versions')).rows).toEqual([]);
  await expect(service.get(ctx,'documents',documentId)).rejects.toMatchObject({status:404});await expect(printing.printRecord(ctx,'documents',documentId)).rejects.toMatchObject({status:404});
  const rows=JSON.parse((await io.exportRecords(ctx,'documents',{},'json')).content).records;expect(rows.map((row:{id:string})=>row.id)).toEqual([publicId]);expect((await io.exportRecords(ctx,'contacts',{},'vcf')).content).toBe('');
  expect((await printing.printRecord(owner,'documents',documentId)).status).toBe(200);
 });
 it('denies original and checksum attachment downloads before returning any private bytes',async()=>{
  for(const checksum of[false,true])await expect(download.attachmentDownload(ctx,attachmentId,checksum)).rejects.toMatchObject({status:404});expect(await(await download.attachmentDownload(owner,attachmentId)).text()).toBe('PRIVATE_ATTACHMENT_MARKER');
 });
 it('filters administrator audit/deleted subjects and stale notifications while removing historic embedded snapshot payloads',async()=>{
  const audit=await history.visibleAuditHistory(ctx,null),serialized=JSON.stringify(audit);expect(serialized).toContain('Public audit marker');expect(serialized).toContain('configure');for(const marker of['PRIVATE_AUDIT_MARKER','DELETED_PRIVATE_MARKER','OLD_EMBEDDED_PRIVATE_MARKER'])expect(serialized).not.toContain(marker);
  expect((await history.visibleAuditHistory(owner,'documents')).some(row=>row.record_id===documentId)).toBe(true);expect((await integrations.visibleNotifications(ctx)).map(row=>row.record_id)).toEqual([publicId]);
 });
 it('reads real create history and legacy JSON null/scalars without a PostgreSQL subtraction error',async()=>{
  const created=await service.create(ctx,'documents',{title:'Actual create audit regression'});
  const createAudit=(await history.visibleAuditHistory(ctx,'documents')).find(row=>row.record_id===created.id&&row.action==='create');
  expect(createAudit?.before_data).toBeNull();expect(createAudit?.after_data).toMatchObject({title:'Actual create audit regression'});
  await service.get(ctx,'documents',String(created.id));const timeline=await db.query(`SELECT ${history.auditHistoryProjection} FROM audit_log a ${history.auditHistoryJoins} WHERE a.workspace_id=$1 AND a.resource='documents' AND a.record_id=$2`,[workspaceId,created.id]);expect(timeline.find(row=>row.action==='create')?.before_data).toBeNull();
  for(const snapshot of[null,'legacy scalar',42,true,[]])await db.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,before_data,after_data) VALUES($1,$2,'documents',$3,'legacy_scalar',$4::jsonb,$4::jsonb)",[workspaceId,administrator,created.id,JSON.stringify(snapshot)]);
  const legacy=(await history.visibleAuditHistory(ctx,'documents')).filter(row=>row.action==='legacy_scalar');expect(legacy).toHaveLength(5);for(const row of legacy){expect(row.before_data).toBeNull();expect(row.after_data).toBeNull();expect(row.details).toBeNull();}
 });
 it('never pushes private creator events or exceptions of a private series to a configured calendar',async()=>{
  const config:GoogleConfig={clientId:'isolated',clientSecret:'isolated',redirectUri:'http://localhost/callback',encryptionKey:Buffer.alloc(32,7).toString('base64')},tokens:Tokens={access_token:'isolated',refresh_token:'isolated',expires_at:Date.now()+3600000,scope:''};
  const connection=(await db.query<Connection>("INSERT INTO integration_connections(workspace_id,user_id,provider,status,tokens_encrypted,calendar_id,sync_direction) VALUES($1,$2,'calendar','connected',$3,'primary','push') RETURNING *",[workspaceId,creator,seal(tokens,config.encryptionKey,`${workspaceId}:${creator}:calendar`)]))[0];
  const parent=randomUUID();await db.query("INSERT INTO events(id,workspace_id,company_id,created_by,updated_by,owner_id,title,time_zone,start_at,end_at,is_private,recurrence_rule) VALUES($1,$2,$3,$4,$4,$4,'Private event','UTC','2026-11-01T10:00Z','2026-11-01T11:00Z',true,'FREQ=DAILY;COUNT=2')",[parent,workspaceId,companyId,creator]);
  await db.query("INSERT INTO events(workspace_id,company_id,created_by,updated_by,owner_id,title,time_zone,start_at,end_at,recurrence_parent_id,recurrence_date) VALUES($1,$2,$3,$3,$3,'Private series exception','UTC','2026-11-02T12:00Z','2026-11-02T13:00Z',$4,'2026-11-02')",[workspaceId,companyId,creator,parent]);
  const fetcher=vi.fn<typeof fetch>();await calendar.synchronizeCalendar(connection,new GoogleAdapter(config,fetcher));expect(fetcher).not.toHaveBeenCalled();expect((await db.query('SELECT * FROM external_event_mappings WHERE workspace_id=$1',[workspaceId]))).toEqual([]);
 });
 it('applies chained source privacy consistently to list, search, export, print, audit and custom read-none policies',async()=>{
  const contact=await service.create(owner,'contacts',{name:'Chained surface contact'}),engagement=await service.create(owner,'engagements',{title:'Chained surface engagement',contact_id:contact.id,currency:'USD'}),task=await service.action(owner,'engagements',String(engagement.id),'create_task',{version:engagement.version,title:'Chained surface secret task'});
  expect((await service.get(ctx,'tasks',String(task.id))).id).toBe(task.id);
  const restricted={...owner,permissions:[{resource:'contacts',operation:'read',scope:'none'}]};await expect(service.get(restricted,'tasks',String(task.id))).rejects.toMatchObject({status:404});
  await db.query('INSERT INTO record_grants(workspace_id,resource,record_id,user_id,can_edit) VALUES($1,$2,$3,$4,true)',[workspaceId,'tasks',task.id,administrator]);await service.update(owner,'contacts',String(contact.id),{version:contact.version,is_private:true});
  await expect(service.get(ctx,'tasks',String(task.id))).rejects.toMatchObject({status:404});expect((await service.list(ctx,'tasks',{q:'Chained surface secret'})).rows).toHaveLength(0);expect((await service.search(ctx,'Chained surface secret')).results).toHaveLength(0);expect(JSON.parse((await io.exportRecords(ctx,'tasks',{q:'Chained surface secret'},'json')).content).records).toHaveLength(0);await expect(printing.printRecord(ctx,'tasks',String(task.id))).rejects.toMatchObject({status:404});expect((await history.visibleAuditHistory(ctx,'tasks')).some(row=>row.record_id===task.id)).toBe(false);
  expect((await service.get(owner,'tasks',String(task.id))).id).toBe(task.id);
 });
 it('terminates a forty-document reference cycle and propagates a private tail without privilege or grant bypass',async()=>{
  const ids=Array.from({length:40},()=>randomUUID());for(let index=0;index<ids.length;index++)await db.query("INSERT INTO documents(id,workspace_id,company_id,created_by,updated_by,owner_id,title,related_resource,related_id,is_private) VALUES($1,$2,$3,$4,$4,$4,$5,'documents',$6,$7)",[ids[index],workspaceId,companyId,creator,`Cycle document ${index}`,ids[(index+1)%ids.length],index===39]);
  await db.query('INSERT INTO record_grants(workspace_id,resource,record_id,user_id,can_edit) VALUES($1,$2,$3,$4,true)',[workspaceId,'documents',ids[0],administrator]);await expect(service.get(ctx,'documents',ids[0])).rejects.toMatchObject({status:404});expect((await service.get(owner,'documents',ids[0])).id).toBe(ids[0]);
  const {scope}=await import('../src/domain/core');expect(scope(ctx,'documents').sql.length).toBeLessThan(100000);
 });
 it('loads the latest100 authorized notifications beyond hidden pages with bounded batched queries and exact microsecond cursors',async()=>{
  await db.query("INSERT INTO notifications(workspace_id,user_id,kind,title_key,resource,record_id,dedupe_key,created_at) SELECT $1,$2,'assigned','notification.assigned','documents',$3,'hidden-page-'||i,'2035-01-01T00:00:00Z'::timestamptz+i*interval '1 microsecond' FROM generate_series(1,305)i",[workspaceId,administrator,documentId]);
  await db.query("INSERT INTO notifications(workspace_id,user_id,kind,title_key,resource,record_id,dedupe_key,created_at) SELECT $1,$2,'assigned','notification.assigned','documents',$3,'visible-page-'||i,'2034-01-01T00:00:00Z'::timestamptz+i*interval '1 microsecond' FROM generate_series(1,105)i",[workspaceId,administrator,publicId]);
  await db.query("INSERT INTO notifications(workspace_id,user_id,kind,title_key,resource,record_id,dedupe_key,created_at) VALUES($1,$2,'assigned','notification.assigned','not_a_resource',$3,'unknown-resource','2036-01-01'),($1,$2,'assigned','notification.assigned','documents',$4,'deleted-subject','2036-01-01'),($1,$5,'assigned','notification.assigned','documents',$3,'other-recipient','2036-01-01')",[workspaceId,administrator,publicId,randomUUID(),creator]);
  const spy=vi.spyOn(db,'query');const started=performance.now();try{const rows=await integrations.visibleNotifications(ctx);expect(rows).toHaveLength(100);expect(rows.map(row=>row.dedupe_key)).toEqual(Array.from({length:100},(_,index)=>`visible-page-${105-index}`));expect(rows.every(row=>row.resource==='documents'&&row.record_id===publicId&&!Object.hasOwn(row,'cursor_created_at'))).toBe(true);expect(spy.mock.calls.length).toBeLessThanOrEqual(8);expect(Math.max(...spy.mock.calls.map(call=>String(call[0]).length))).toBeLessThan(200000);console.info(JSON.stringify({notification_candidates:413,visible:rows.length,queries:spy.mock.calls.length,elapsed_ms:Math.round(performance.now()-started)}));}finally{spy.mockRestore();}
 });
 it('paginates authorized audit events beyond hidden batches without expanding every resource graph',async()=>{
  await db.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data,created_at) SELECT $1,$2,'documents',$3,'audit_paging_hidden',jsonb_build_object('marker','hidden'),'2040-01-02T00:00:00Z'::timestamptz+i*interval '1 microsecond' FROM generate_series(1,305)i",[workspaceId,creator,documentId]);
  await db.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data,created_at) SELECT $1,$2,'documents',$3,'audit_paging_visible',jsonb_build_object('sequence',i),'2040-01-01T00:00:00Z'::timestamptz+i*interval '1 microsecond' FROM generate_series(1,205)i",[workspaceId,administrator,publicId]);
  const spy=vi.spyOn(Client.prototype,'query'),start=performance.now();
  try{
   const first=await history.visibleAuditHistory(ctx,'documents'),second=await history.visibleAuditHistory(ctx,'documents',2),third=await history.visibleAuditHistory(ctx,'documents',3);
   expect(first.map(row=>(row.after_data as {sequence:number}).sequence)).toEqual(Array.from({length:100},(_,i)=>205-i));
   expect(second.map(row=>(row.after_data as {sequence:number}).sequence)).toEqual(Array.from({length:100},(_,i)=>105-i));
   expect(third.filter(row=>row.action==='audit_paging_visible').map(row=>(row.after_data as {sequence:number}).sequence)).toEqual([5,4,3,2,1]);
   expect([...first,...second,...third].every(row=>row.action!=='audit_paging_hidden'&&!Object.hasOwn(row,'cursor_created_at'))).toBe(true);
   const statements=spy.mock.calls.map(call=>String(call[0]));expect(Math.max(...statements.map(sql=>sql.length))).toBeLessThan(200000);expect(statements.filter(sql=>sql.startsWith('SELECT')).length).toBeLessThanOrEqual(25);expect(statements).toContain('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
   console.info(JSON.stringify({auditCandidates:510,pages:3,queryCount:statements.length,maxQueryLength:Math.max(...statements.map(sql=>sql.length)),elapsedMs:Math.round(performance.now()-start)}));
  }finally{spy.mockRestore();}
 });
 it('applies subject visibility to grant and integration audit events, including invalid legacy subjects',async()=>{
  for(const [id,marker]of[[documentId,'private'],[publicId,'visible'],['invalid-legacy-id','invalid']]){
   await db.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,'record_grants',$3,'grant',jsonb_build_object('resource','documents','marker',$4::text)),($1,$2,'integrations',$3,'drive_file_linked',jsonb_build_object('marker',$4::text))",[workspaceId,creator,id,marker]);
  }
  await db.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,'record_grants',$3,'grant','{\"resource\":\"not_a_resource\"}'),($1,$2,'integrations',NULL,'connection_configured','{}')",[workspaceId,administrator,publicId]);
  expect((await history.visibleAuditHistory(ctx,'record_grants')).map(row=>(row.after_data as {marker:string}).marker)).toEqual(['visible']);
  const events=await history.visibleAuditHistory(ctx,'integrations');expect(events.map(row=>row.action).sort()).toEqual(['connection_configured','drive_file_linked']);expect(events.find(row=>row.action==='drive_file_linked')?.record_id).toBe(publicId);
 });
});
