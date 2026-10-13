import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { GoogleAdapter, ProviderError, SCOPES, seal, type GoogleConfig, type GoogleEvent, type Tokens } from '../src/integrations/adapters';
import type { Connection } from '../src/integrations/service';
import type { Context } from '../src/lib/context';

let db: typeof import('../src/lib/db');
let calendar: typeof import('../src/integrations/calendar');
let worker: typeof import('../src/integrations/worker');
let service: typeof import('../src/integrations/service');
let admin:Pool;
const originalUrl=process.env.DATABASE_URL;
const databaseName=`syntherisk_integration_test_${randomUUID().replaceAll('-','')}`;
const workspace=randomUUID(),otherWorkspace=randomUUID(),company=randomUUID(),userId=`integration-${randomUUID()}`;
const ctx:Context={workspaceId:workspace,companyId:company,userId,roles:['admin']};
const config:GoogleConfig={clientId:'isolated',clientSecret:'isolated',redirectUri:'http://localhost:3000/api/integrations',encryptionKey:Buffer.alloc(32,3).toString('base64')};
const tokens:Tokens={access_token:'isolated-token',refresh_token:'isolated-refresh',expires_at:Date.now()+3600000,scope:''};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
it('OAuth success and denial return to the public integration page even behind an internal bind address',async()=>{
 vi.stubEnv('APP_URL','https://erp.example.invalid');vi.stubEnv('GOOGLE_CLIENT_ID',config.clientId);vi.stubEnv('GOOGLE_CLIENT_SECRET',config.clientSecret);vi.stubEnv('GOOGLE_INTEGRATION_REDIRECT_URI','https://erp.example.invalid/api/integrations');vi.stubEnv('INTEGRATION_ENCRYPTION_KEY',config.encryptionKey);vi.stubEnv('GOOGLE_WORKSPACE_DOMAIN','example.test');
 const exchanged=vi.spyOn(GoogleAdapter.prototype,'exchange').mockResolvedValue({...tokens,scope:SCOPES.gmail.join(' ')});
 const identity=vi.spyOn(GoogleAdapter.prototype,'identity').mockResolvedValue({email:`${userId}@example.test`,domain:'example.test',subject:'isolated-subject'});
 try{
  for(const denied of [false,true]){
   const state=randomUUID(),hash=createHash('sha256').update(state).digest('hex');
   await db.query("INSERT INTO integration_connections(workspace_id,user_id,provider) VALUES($1,$2,'gmail') ON CONFLICT(workspace_id,user_id,provider) DO NOTHING",[workspace,userId]);
   await db.query("INSERT INTO oauth_states(state_hash,workspace_id,user_id,provider,verifier_encrypted,expires_at,requested_scopes) VALUES($1,$2,$3,'gmail',$4,now()+interval '10 minutes',$5)",[hash,workspace,userId,seal('isolated-verifier',config.encryptionKey,hash),SCOPES.gmail]);
   const response=await service.handleIntegration(ctx,new Request(`http://0.0.0.0:3000/api/integrations?state=${state}&${denied?'error=access_denied':'code=isolated-code'}`,{headers:{host:'attacker.invalid','x-forwarded-host':'attacker.invalid','x-forwarded-proto':'http'}}));
   expect(response.status).toBe(302);expect(response.headers.get('location')).toBe(`https://erp.example.invalid/settings?section=integrations&integration=${denied?'denied':'connected'}`);
   expect(await db.query('SELECT 1 FROM oauth_states WHERE state_hash=$1',[hash])).toHaveLength(0);
   if(!denied)expect((await db.query("SELECT status,paused FROM integration_connections WHERE workspace_id=$1 AND user_id=$2 AND provider='gmail'",[workspace,userId]))[0]).toMatchObject({status:'connected',paused:false});
  }
  expect(exchanged).toHaveBeenCalledTimes(1);
 }finally{exchanged.mockRestore();identity.mockRestore();vi.unstubAllEnvs();}
});
beforeAll(async()=>{
  if(!originalUrl)throw new Error('DATABASE_URL required for actual isolated PostgreSQL integration tests');
  admin=new Pool({connectionString:originalUrl});
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const isolated=new URL(originalUrl);isolated.pathname=`/${databaseName}`;process.env.DATABASE_URL=isolated.toString();
  db=await import('../src/lib/db');
  const migrationRoot=join(process.cwd(),'prisma','migrations');
  for(const entry of (await readdir(migrationRoot,{withFileTypes:true})).filter(x=>x.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join(migrationRoot,entry.name,'migration.sql'),'utf8'));
  calendar=await import('../src/integrations/calendar');worker=await import('../src/integrations/worker');service=await import('../src/integrations/service');
  await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2),($3,$4)',[workspace,'Isolated integration workspace',otherWorkspace,'Other isolated workspace']);
  await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3)',[company,workspace,'Integration test']);
  await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[userId,'Isolated operator',`${userId}@example.test`]);
  await db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin'])",[workspace,userId]);
},60000);
afterAll(async()=>{
  if(db)await db.pool.end();
  process.env.DATABASE_URL=originalUrl;
  if(admin){await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}
},15000);
async function createConnection(direction='both'){
  const row=(await db.query<Connection>("INSERT INTO integration_connections(workspace_id,user_id,provider,status,calendar_id,sync_direction,tokens_encrypted) VALUES($1,$2,'calendar','connected','isolated-calendar',$3,$4) ON CONFLICT(workspace_id,user_id,provider) DO UPDATE SET status='connected',sync_direction=excluded.sync_direction,sync_token=NULL,tokens_encrypted=excluded.tokens_encrypted RETURNING *",[workspace,userId,direction,seal(tokens,config.encryptionKey,`${workspace}:${userId}:calendar`) ]))[0];return row;
}
async function createEvent(title:string){return (await db.query<{id:string}>("INSERT INTO events(workspace_id,company_id,created_by,updated_by,owner_id,title,time_zone,start_at,end_at) VALUES($1,$2,$3,$3,$3,$4,'America/Los_Angeles','2026-11-01T08:30:00Z','2026-11-01T10:30:00Z') RETURNING id",[workspace,company,userId,title]))[0].id;}
function provider(){
  const events=new Map<string,GoogleEvent>();let seq=0;
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
    const url=new URL(String(input)),id=decodeURIComponent(url.pathname.split('/').at(-1)!);
    if(init?.method==='POST'){
      const event=JSON.parse(String(init.body)) as GoogleEvent;if(events.has(event.id))return json({},409);event.etag=`etag-${++seq}`;events.set(event.id,event);return json(event);
    }
    if(init?.method==='PATCH'){
      const old=events.get(id);if(!old)return json({},404);if((init.headers as Record<string,string>)['If-Match']!==old.etag)return json({},412);
      const event={...old,...JSON.parse(String(init.body))} as GoogleEvent;event.etag=`etag-${++seq}`;events.set(id,event);return json(event);
    }
    if(init?.method==='DELETE'){if(!events.has(id))return json({},404);events.set(id,{...events.get(id)!,status:'cancelled',etag:`etag-${++seq}`});return new Response(null,{status:204});}
    if(id==='events')return json({items:[...events.values()],nextSyncToken:`sync-${seq}`});
    return events.has(id)?json(events.get(id)):json({},404);
  });return {events,fetcher,adapter:new GoogleAdapter(config,fetcher)};
}
describe('real PostgreSQL synchronization and authorization',()=>{
  it('creates, updates and cancels one provider event, preserving mappings and avoiding synchronization loops',async()=>{
    const row=await createConnection(),id=await createEvent('DST meeting'),p=provider();
    await calendar.synchronizeCalendar(row,p.adapter);
    expect(p.events.size).toBe(1);expect((await db.query('SELECT * FROM external_event_mappings WHERE event_id=$1',[id]))).toHaveLength(1);
    await calendar.synchronizeCalendar(row,p.adapter);
    expect(p.fetcher.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1);
    await db.query('UPDATE events SET title=$1,version=version+1 WHERE id=$2',['Revised meeting',id]);await calendar.synchronizeCalendar(row,p.adapter);
    expect([...p.events.values()][0].summary).toBe('Revised meeting');
    await db.query("UPDATE events SET status='cancelled',version=version+1 WHERE id=$1",[id]);await calendar.synchronizeCalendar(row,p.adapter);
    expect([...p.events.values()][0].status).toBe('cancelled');
    await calendar.synchronizeCalendar(row,p.adapter);expect((await db.query('SELECT id FROM events WHERE workspace_id=$1',[workspace]))).toHaveLength(1);
  });
  it('preserves both versions on simultaneous edits, and applies an explicit remote conflict resolution',async()=>{
    await db.query('UPDATE events SET archived=true WHERE workspace_id=$1',[workspace]);
    const row=await createConnection(),id=await createEvent('Original'),p=provider();await calendar.synchronizeCalendar(row,p.adapter);
    const [remote]=p.events.values();p.events.set(remote.id,{...remote,summary:'Remote edit',etag:'provider-concurrent'});
    await db.query('UPDATE events SET title=$1,version=version+1 WHERE id=$2',['Local edit',id]);
    await calendar.synchronizeCalendar(row,p.adapter);
    const mapping=(await db.query<{id:string;status:string;external_snapshot:GoogleEvent}>('SELECT * FROM external_event_mappings WHERE event_id=$1',[id]))[0];
    expect(mapping.status).toBe('conflict');expect(mapping.external_snapshot.summary).toBe('Remote edit');expect((await db.query('SELECT title FROM events WHERE id=$1',[id]))[0].title).toBe('Local edit');
    await calendar.resolveCalendarConflict(row,mapping.id,'remote');expect((await db.query('SELECT title FROM events WHERE id=$1',[id]))[0].title).toBe('Remote edit');
    expect((await db.query('SELECT status FROM external_event_mappings WHERE id=$1',[mapping.id]))[0].status).toBe('synced');
  });
  it('recovers expired incremental sync tokens with a full retry and imports all-day dates without shifting them',async()=>{
    const row=await createConnection('pull');await db.query('UPDATE integration_connections SET sync_token=$1 WHERE id=$2',['expired-sync',row.id]);
    const f=vi.fn<typeof fetch>().mockResolvedValueOnce(json({},410)).mockResolvedValueOnce(json({items:[{id:'all-day',etag:'a1',summary:'All day',start:{date:'2026-11-01'},end:{date:'2026-11-03'}}],nextSyncToken:'fresh'}));
    await calendar.synchronizeCalendar(row,new GoogleAdapter(config,f));
    expect(f).toHaveBeenCalledTimes(2);expect(new URL(String(f.mock.calls[1][0])).searchParams.has('syncToken')).toBe(false);
    const local=(await db.query("SELECT e.*,e.start_date::text AS exact_start_date FROM events e JOIN external_event_mappings m ON m.event_id=e.id WHERE m.external_id='all-day'"))[0];expect(local.all_day).toBe(true);expect(local.start_at).toBeNull();expect(local.exact_start_date).toBe('2026-11-01');
  });
  it('persists authorization expiry and rejects connections belonging to another workspace',async()=>{
    const row=await createConnection();await db.query('UPDATE integration_connections SET tokens_encrypted=$1 WHERE id=$2',[seal({...tokens,expires_at:1},config.encryptionKey,`${workspace}:${userId}:calendar`),row.id]);
    const expired=new GoogleAdapter(config,vi.fn<typeof fetch>().mockResolvedValue(json({error:'invalid_grant'},400)));
    await expect(service.authorizedTokens(row,expired)).rejects.toMatchObject({code:'authorization_expired'});expect((await db.query('SELECT status FROM integration_connections WHERE id=$1',[row.id]))[0].status).toBe('expired');
    await expect(service.connection({...ctx,workspaceId:otherWorkspace},row.id)).rejects.toMatchObject({status:404});
  });
  it('imports a cancelled recurring instance as an exception and preserves provider recurrence metadata',async()=>{
    const row=await createConnection('pull');
    const f=vi.fn<typeof fetch>().mockImplementation(async()=>json({items:[{id:'recurring-parent',etag:'rp1',summary:'Recurring',start:{date:'2026-11-01'},end:{date:'2026-11-02'},recurrence:['RRULE:FREQ=DAILY;COUNT=5','EXDATE;VALUE=DATE:20261103']},{id:'cancelled-instance',etag:'ci1',status:'cancelled',recurringEventId:'recurring-parent',originalStartTime:{date:'2026-11-02'}}],nextSyncToken:'recurring-sync'}));
    await calendar.synchronizeCalendar(row,new GoogleAdapter(config,f));
    const records=await db.query("SELECT e.* FROM events e JOIN external_event_mappings m ON m.event_id=e.id WHERE m.external_id IN ('recurring-parent','cancelled-instance') ORDER BY e.recurrence_parent_id NULLS FIRST");
    expect(records).toHaveLength(2);expect(records[0].recurrence_rule).toBe('FREQ=DAILY;COUNT=5');expect(records[1].status).toBe('cancelled');expect(records[1].recurrence_parent_id).toBe(records[0].id);expect(records[1].recurrence_date).toBe('2026-11-02');
    const snapshot=(await db.query<{external_snapshot:GoogleEvent}>("SELECT external_snapshot FROM external_event_mappings WHERE external_id='recurring-parent'"))[0].external_snapshot;expect(snapshot.recurrence).toContain('EXDATE;VALUE=DATE:20261103');
  });
  it('disconnect removes local token authority and prevents queued synchronization from reusing stale connection data',async()=>{
    const row=await createConnection(),fetcher=vi.fn<typeof fetch>();await db.query("UPDATE integration_connections SET status='disconnected',tokens_encrypted=NULL WHERE id=$1",[row.id]);
    await expect(service.authorizedTokens(row,new GoogleAdapter(config,fetcher))).rejects.toMatchObject({code:'authorization_expired'});
    await expect(calendar.synchronizeCalendar(row,new GoogleAdapter(config,fetcher))).rejects.toMatchObject({code:'authorization_expired'});expect(fetcher).not.toHaveBeenCalled();
    expect((await db.query('SELECT status,tokens_encrypted FROM integration_connections WHERE id=$1',[row.id]))[0]).toEqual({status:'disconnected',tokens_encrypted:null});
  });
});
describe('integration API and identity security regressions',()=>{
  const request=(data:Record<string,unknown>)=>new Request('http://localhost:3000/api/integrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  it('denies external users access to mail drafts and refuses expired OAuth state without a provider request',async()=>{
    expect((await service.handleIntegration({...ctx,roles:['external']},request({action:'messages'}))).status).toBe(403);
    expect((await service.handleIntegration(ctx,new Request('http://localhost:3000/api/integrations?state=expired-state&code=unused'))).status).toBe(400);
  });
  it('previews a campaign group, excludes stopped contacts, and creates deduplicated template drafts',async()=>{
    const template=(await db.query<{id:string}>('INSERT INTO communication_templates(workspace_id,company_id,created_by,updated_by,owner_id,name,subject,body) VALUES($1,$2,$3,$3,$3,$4,$5,$6) RETURNING id',[workspace,company,userId,'Template','Hello {{name}}','Dear {{first_name}}, {{email}}']))[0].id;
    const group=(await db.query<{id:string}>('INSERT INTO audience_groups(workspace_id,company_id,created_by,updated_by,owner_id,name) VALUES($1,$2,$3,$3,$3,$4) RETURNING id',[workspace,company,userId,'Isolated audience']))[0].id;
    for(const state of ['allowed','stopped','preference_none']){const c=(await db.query<{id:string}>('INSERT INTO contacts(workspace_id,company_id,created_by,updated_by,owner_id,name,email,do_not_contact,contact_preference) VALUES($1,$2,$3,$3,$3,$4,$5,$6,$7) RETURNING id',[workspace,company,userId,state==='allowed'?'Allowed Example':state==='stopped'?'Stopped Example':'Preference None',`${state}@example.test`,state==='stopped',state==='preference_none'?'none':null]))[0].id;await db.query('INSERT INTO audience_members(workspace_id,company_id,created_by,updated_by,owner_id,group_id,contact_id) VALUES($1,$2,$3,$3,$3,$4,$5)',[workspace,company,userId,group,c]);}
    const campaign=(await db.query<{id:string}>('INSERT INTO campaigns(workspace_id,company_id,created_by,updated_by,owner_id,title,template_id,group_id) VALUES($1,$2,$3,$3,$3,$4,$5,$6) RETURNING id',[workspace,company,userId,'Isolated campaign',template,group]))[0].id;
    const preview=await service.handleIntegration(ctx,request({action:'preview_campaign',campaign_id:campaign}));expect(preview.status).toBe(200);const previewData=(await preview.json()).data;expect(previewData).toMatchObject({total:3,eligible:1});expect(previewData.recipients.find((r:{name:string})=>r.name==='Preference None')).toMatchObject({eligible:false,reason:'do_not_contact'});
    const prepare=()=>service.handleIntegration(ctx,request({action:'prepare_campaign',campaign_id:campaign,sender_account:'operations@example.test'}));expect((await (await prepare()).json()).data.created).toBe(1);expect((await (await prepare()).json()).data.created).toBe(0);
    expect((await db.query('SELECT subject,status,template_id FROM messages WHERE campaign_id=$1',[campaign]))).toEqual([{subject:'Hello Allowed Example',status:'draft',template_id:template}]);
  });
  it('draft and send APIs respect both contact-stop fields and archived draft identity',async()=>{
    const recipient=(await db.query<{id:string}>('INSERT INTO contacts(workspace_id,company_id,created_by,updated_by,owner_id,name,email,contact_preference) VALUES($1,$2,$3,$3,$3,$4,$5,$6) RETURNING id',[workspace,company,userId,'Eligibility regression','eligible@example.test','none']))[0].id;
    const payload={action:'save_message',contact_id:recipient,subject:'Eligibility draft',body:'Isolated stop-contact evidence',sender_account:'operations@example.test'};
    expect((await (await service.handleIntegration(ctx,request(payload))).json()).error.code).toBe('DO_NOT_CONTACT');
    await db.query("UPDATE contacts SET do_not_contact=true,contact_preference='email' WHERE id=$1",[recipient]);
    expect((await (await service.handleIntegration(ctx,request(payload))).json()).error.code).toBe('DO_NOT_CONTACT');
    expect(await db.query('SELECT id FROM messages WHERE contact_id=$1',[recipient])).toHaveLength(0);
    await db.query('UPDATE contacts SET do_not_contact=false WHERE id=$1',[recipient]);
    const saved=await service.handleIntegration(ctx,request(payload));expect(saved.status).toBe(200);const draft=(await saved.json()).data;
    const reviewed=await service.handleIntegration(ctx,request({action:'review_message',id:draft.id,version:draft.version}));expect(reviewed.status).toBe(200);const row=(await reviewed.json()).data;
    await db.query("UPDATE contacts SET contact_preference='none' WHERE id=$1",[recipient]);
    const stopped=await service.handleIntegration(ctx,request({action:'send_message',id:row.id,version:row.version,confirm:true}));expect(stopped.status).toBe(409);expect((await stopped.json()).error.code).toBe('DO_NOT_CONTACT');
    expect(await db.query('SELECT id FROM deliveries WHERE message_id=$1',[row.id])).toHaveLength(0);
    expect(await db.query("SELECT id FROM outbox WHERE workspace_id=$1 AND payload->>'message_id'=$2",[workspace,row.id])).toHaveLength(0);
    await db.query('UPDATE messages SET archived=true WHERE id=$1',[row.id]);
    expect((await service.handleIntegration(ctx,request({action:'cancel_message',id:row.id,version:row.version}))).status).toBe(404);
  });
  it('exposes member emails and roles only to administrators and only self identity to external viewers',async()=>{
    const identity=await import('../src/lib/identity'),externalId=`external-${randomUUID()}`;await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[externalId,'External tester',`${externalId}@example.test`]);await db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['external'])",[workspace,externalId]);
    const external=await identity.members({...ctx,userId:externalId,roles:['external']});expect(external).toHaveLength(1);expect(external[0].user_id).toBe(externalId);expect(external[0]).not.toHaveProperty('email');expect(external[0]).not.toHaveProperty('roles');
    await db.query("UPDATE memberships SET roles=ARRAY['member'] WHERE workspace_id=$1 AND user_id=$2",[workspace,externalId]);const internal=await identity.members({...ctx,userId:externalId,roles:['member']});expect(internal.every(row=>!('email' in row)&&!('roles' in row))).toBe(true);expect((await identity.members(ctx))[0]).toHaveProperty('email');
  });
  it('invalidates old privileged invitations when a membership is disabled or demoted',async()=>{
    const identity=await import('../src/lib/identity'),targetId=`revoked-${randomUUID()}`,email=`${targetId}@example.test`;await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[targetId,'Revoked tester',email]);await db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin'])",[workspace,targetId]);
    await db.query("UPDATE memberships SET roles=ARRAY['member'] WHERE workspace_id=$1 AND user_id=$2",[workspace,targetId]);
    const token='legacy-privileged-token-'+randomUUID();await db.query("INSERT INTO invitations(workspace_id,email,roles,token_hash,created_by,expires_at) VALUES($1,$2,ARRAY['admin'],$3,$4,now()+interval '7 days')",[workspace,email,(await import('node:crypto')).createHash('sha256').update(token).digest('hex'),userId]);await identity.changeMember(ctx,{user_id:targetId,status:'disabled'});
    await expect(identity.acceptInvitation({token,name:'Revoked tester'})).rejects.toMatchObject({code:'INVALID_INVITATION'});expect((await db.query('SELECT status FROM memberships WHERE workspace_id=$1 AND user_id=$2',[workspace,targetId]))[0].status).toBe('disabled');
  });
  it('locks base currency after monetary data exists while allowing unrelated company configuration',async()=>{
    const identity=await import('../src/lib/identity');let row=(await db.query<{version:number}>('SELECT version FROM companies WHERE id=$1',[company]))[0];
    const changed=await identity.updateCompany(ctx,{name:'Isolated company',base_currency:'USD',time_zone:'America/Los_Angeles',version:row.version});
    await db.query("INSERT INTO expense_claims(workspace_id,company_id,created_by,updated_by,owner_id,title,currency,base_currency) VALUES($1,$2,$3,$3,$3,'Isolated draft expense','USD','USD')",[workspace,company,userId]);
    await expect(identity.updateCompany(ctx,{name:'Isolated company',base_currency:'CAD',time_zone:'America/Los_Angeles',version:changed.version})).rejects.toMatchObject({code:'BASE_CURRENCY_LOCKED'});
    row=(await db.query<{version:number}>('SELECT version FROM companies WHERE id=$1',[company]))[0];expect((await identity.updateCompany(ctx,{name:'Renamed company',base_currency:'USD',time_zone:'America/Vancouver',version:row.version})).name).toBe('Renamed company');
  });
  it('rejects nonlocal cleartext production origins',async()=>{
    const {validateAuthOrigin}=await import('../src/lib/auth');expect(()=>validateAuthOrigin('http://operations.example.test','production')).toThrow('HTTPS_REQUIRED_FOR_PRODUCTION');expect(()=>validateAuthOrigin('https://operations.example.test','production')).not.toThrow();expect(()=>validateAuthOrigin('http://localhost:3000','production')).not.toThrow();
  });
});
describe('durable jobs and safe communications',()=>{
  let contactId:string;
  async function queuedMessage(){
    if(!contactId)contactId=(await db.query<{id:string}>('INSERT INTO contacts(workspace_id,company_id,created_by,updated_by,owner_id,name,email) VALUES($1,$2,$3,$3,$3,$4,$5) RETURNING id',[workspace,company,userId,'Isolated contact','recipient@example.test']))[0].id;
    const id=(await db.query<{id:string}>("INSERT INTO messages(workspace_id,company_id,created_by,updated_by,owner_id,contact_id,to_address,subject,body,sender_account,status,confirmed_by) VALUES($1,$2,$3,$3,$3,$4,'recipient@example.test','Isolated message','Test content','operations@example.test','queued',$3) RETURNING id",[workspace,company,userId,contactId]))[0].id;
    await db.query("INSERT INTO deliveries(workspace_id,message_id,company_id,created_by,updated_by,owner_id,provider,status) VALUES($1,$2,$3,$4,$4,$4,'smtp','pending')",[workspace,id,company,userId]);return id;
  }
  it('deduplicates outbox inserts and gives concurrent workers exclusive durable leases',async()=>{
    await db.query("UPDATE integration_connections SET status='disconnected',tokens_encrypted=NULL WHERE workspace_id=$1",[workspace]);
    const [one,two]=await Promise.all([service.enqueue(workspace,'calendar',{},'same-job'),service.enqueue(workspace,'calendar',{},'same-job')]);expect(one.id).toBe(two.id);
    const claims=await Promise.all([worker.claimJob(),worker.claimJob()]);expect(claims.filter(Boolean)).toHaveLength(1);expect(claims.find(Boolean)?.id).toBe(one.id);
    await db.query("UPDATE outbox SET status='completed' WHERE workspace_id=$1",[workspace]);
  });
  it('persists accepted provider message IDs and never sends a delivered message twice',async()=>{
    const id=await queuedMessage(),send=vi.fn().mockResolvedValue({messageId:'isolated-provider-id'});await worker.deliverMessage(workspace,id,{send});await worker.deliverMessage(workspace,id,{send});
    expect(send).toHaveBeenCalledTimes(1);expect((await db.query('SELECT provider_message_id,status FROM deliveries WHERE message_id=$1',[id]))[0]).toMatchObject({provider_message_id:'isolated-provider-id',status:'sent'});
  });
  it('rechecks stopped-contact preference at delivery time, before contacting the provider',async()=>{
    const id=await queuedMessage();await db.query('UPDATE contacts SET do_not_contact=true WHERE id=$1',[contactId]);const send=vi.fn();
    await expect(worker.deliverMessage(workspace,id,{send})).rejects.toMatchObject({code:'do_not_contact'});expect(send).not.toHaveBeenCalled();await db.query('UPDATE contacts SET do_not_contact=false WHERE id=$1',[contactId]);
  });
  it('blocks archived contacts or messages and no-contact preference before starting delivery',async()=>{
    const send=vi.fn();
    for(const state of ['contact_archived','message_archived','no_contact_preference']){
      const id=await queuedMessage();
      try{
        if(state==='contact_archived')await db.query('UPDATE contacts SET archived=true WHERE id=$1',[contactId]);
        if(state==='message_archived')await db.query('UPDATE messages SET archived=true WHERE id=$1',[id]);
        if(state==='no_contact_preference')await db.query("UPDATE contacts SET contact_preference='none' WHERE id=$1",[contactId]);
        await expect(worker.deliverMessage(workspace,id,{send})).rejects.toMatchObject({code:state==='no_contact_preference'?'do_not_contact':state});
        expect(send).not.toHaveBeenCalled();
        expect((await db.query('SELECT status,attempt_count,started_at FROM deliveries WHERE message_id=$1',[id]))[0]).toMatchObject({status:'pending',attempt_count:0,started_at:null});
        expect((await db.query('SELECT status FROM messages WHERE id=$1',[id]))[0].status).toBe('queued');
      }finally{await db.query('UPDATE contacts SET archived=false,contact_preference=NULL WHERE id=$1',[contactId]);}
    }
  });
  it('parks ambiguous SMTP outcomes and prevents automatic resend',async()=>{
    const id=await queuedMessage(),send=vi.fn().mockRejectedValue(new ProviderError('mail_delivery_uncertain',409));
    await expect(worker.deliverMessage(workspace,id,{send})).rejects.toMatchObject({code:'mail_delivery_uncertain'});
    await expect(worker.deliverMessage(workspace,id,{send})).rejects.toMatchObject({code:'message_not_queued'});expect(send).toHaveBeenCalledTimes(1);expect((await db.query('SELECT status FROM messages WHERE id=$1',[id]))[0].status).toBe('uncertain');
  });
  it('emits browser-independent due notifications once and honors opt-out preferences',async()=>{
    const task=(await db.query<{id:string}>("INSERT INTO tasks(workspace_id,company_id,created_by,updated_by,owner_id,title,due_date) VALUES($1,$2,$3,$3,$3,'Isolated overdue task','2026-01-01') RETURNING id",[workspace,company,userId]))[0].id;
    await worker.scheduleDueNotifications();await worker.scheduleDueNotifications();expect((await db.query('SELECT id FROM notifications WHERE record_id=$1',[task]))).toHaveLength(1);
    await db.query('INSERT INTO notification_preferences(workspace_id,user_id,kind,enabled) VALUES($1,$2,\'due\',false)',[workspace,userId]);
    const other=(await db.query<{id:string}>("INSERT INTO tasks(workspace_id,company_id,created_by,updated_by,owner_id,title,due_date) VALUES($1,$2,$3,$3,$3,'Opted out task','2026-01-01') RETURNING id",[workspace,company,userId]))[0].id;
    await worker.scheduleDueNotifications();expect((await db.query('SELECT id FROM notifications WHERE record_id=$1',[other]))).toHaveLength(0);
    const response=await service.handleIntegration({...ctx,workspaceId:otherWorkspace},new Request('http://localhost:3000/api/integrations'));expect((await response.json()).data.notifications).toHaveLength(0);
  });
  it('reminds recurring occurrences and local-date all-day events once, including active participants and suppressing cancelled exceptions',async()=>{
    await db.query("DELETE FROM notification_preferences WHERE workspace_id=$1 AND user_id=$2 AND kind='due'",[workspace,userId]);
    const participants=[`active-${randomUUID()}`,`declined-${randomUUID()}`,`disabled-${randomUUID()}`];
    for(const [i,id]of participants.entries()){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[id,'Reminder participant',`${id}@example.test`]);await db.query("INSERT INTO memberships(workspace_id,user_id,roles,status) VALUES($1,$2,ARRAY['member'],$3)",[workspace,id,i===2?'disabled':'active']);}
    const recurring=(await db.query<{id:string}>("INSERT INTO events(workspace_id,company_id,created_by,updated_by,owner_id,title,time_zone,start_at,end_at,recurrence_rule,reminder_minutes) VALUES($1,$2,$3,$3,$3,'Recurring reminder','UTC',now()-interval '1 day'+interval '5 minutes',now()-interval '1 day'+interval '1 hour','FREQ=DAILY;COUNT=5',15) RETURNING id",[workspace,company,userId]))[0].id;
    for(const [i,id]of participants.entries())await db.query("INSERT INTO event_participants(workspace_id,company_id,created_by,updated_by,owner_id,event_id,user_id,response) VALUES($1,$2,$3,$3,$3,$4,$5,$6)",[workspace,company,userId,recurring,id,i===1?'declined':'accepted']);
    const allDay=(await db.query<{id:string}>("INSERT INTO events(workspace_id,company_id,created_by,updated_by,owner_id,title,time_zone,all_day,start_date,end_date,reminder_minutes) VALUES($1,$2,$3,$3,$3,'All day reminder','Pacific/Kiritimati',true,(now() AT TIME ZONE 'Pacific/Kiritimati')::date,(now() AT TIME ZONE 'Pacific/Kiritimati')::date+1,0) RETURNING id",[workspace,company,userId]))[0].id;
    const cancelled=(await db.query<{id:string}>("INSERT INTO events(workspace_id,company_id,created_by,updated_by,owner_id,title,time_zone,start_at,end_at,recurrence_rule,reminder_minutes) VALUES($1,$2,$3,$3,$3,'Cancelled occurrence','UTC',now()-interval '1 day'+interval '5 minutes',now()-interval '1 day'+interval '1 hour','FREQ=DAILY;COUNT=5',15) RETURNING id",[workspace,company,userId]))[0].id;
    await db.query("INSERT INTO events(workspace_id,company_id,created_by,updated_by,owner_id,title,time_zone,start_at,end_at,recurrence_parent_id,recurrence_date,status) VALUES($1,$2,$3,$3,$3,'Cancelled exception','UTC',now()+interval '5 minutes',now()+interval '1 hour',$4,((now()+interval '5 minutes') AT TIME ZONE 'UTC')::date,'cancelled')",[workspace,company,userId,cancelled]);
    await worker.scheduleEventNotifications();await db.query('UPDATE events SET version=version+1 WHERE id=$1',[recurring]);await worker.scheduleEventNotifications();
    const reminders=await db.query<{user_id:string;dedupe_key:string}>('SELECT user_id,dedupe_key FROM notifications WHERE record_id=$1 ORDER BY user_id',[recurring]);expect(reminders.map(r=>r.user_id).sort()).toEqual([userId,participants[0]].sort());expect(reminders.every(r=>r.dedupe_key.startsWith(`event-reminder:${recurring}:`))).toBe(true);
    expect(await db.query('SELECT id FROM notifications WHERE record_id=$1',[allDay])).toHaveLength(1);expect(await db.query('SELECT id FROM notifications WHERE record_id=$1',[cancelled])).toHaveLength(0);
    await db.query("DELETE FROM notifications WHERE record_id=$1 AND user_id=$2",[recurring,participants[0]]);await db.query("INSERT INTO notification_preferences(workspace_id,user_id,kind,enabled) VALUES($1,$2,'due',false)",[workspace,participants[0]]);await worker.scheduleEventNotifications();expect(await db.query('SELECT id FROM notifications WHERE record_id=$1 AND user_id=$2',[recurring,participants[0]])).toHaveLength(0);
  });
});

it('binds OAuth consent to the current member and company domain, consumes state once, and invalidates changed email',async()=>{
 const previous={...process.env};const email=`${userId}@example.invalid`;let identity={sub:'isolated-subject',email,email_verified:true,hd:'example.invalid'};
 Object.assign(process.env,{GOOGLE_CLIENT_ID:config.clientId,GOOGLE_CLIENT_SECRET:config.clientSecret,GOOGLE_INTEGRATION_REDIRECT_URI:config.redirectUri,INTEGRATION_ENCRYPTION_KEY:config.encryptionKey,GOOGLE_WORKSPACE_DOMAIN:'example.invalid'});
 await db.query('UPDATE "user" SET email=$2 WHERE id=$1',[userId,email]);
 const transport=vi.fn<typeof fetch>().mockImplementation(async input=>String(input).includes('oauth2.googleapis.com/token')?json({access_token:'isolated-access',refresh_token:'isolated-refresh',expires_in:3600,scope:SCOPES.calendar.join(' ')}):json(identity));vi.stubGlobal('fetch',transport);
 const connect=async()=>{const response=await service.handleIntegration(ctx,new Request(config.redirectUri,{method:'POST',body:JSON.stringify({action:'connect',provider:'calendar'})}));expect(response.status).toBe(200);return new URL((await response.json()).data.authorizationUrl).searchParams.get('state')!;};
 const complete=(state:string,actor=ctx)=>service.handleIntegration(actor,new Request(`${config.redirectUri}?state=${encodeURIComponent(state)}&code=isolated-code`));
 try{
  let state=await connect();expect((await complete(state,{...ctx,userId:randomUUID()})).status).toBe(400);expect((await complete(state)).status).toBe(302);expect((await complete(state)).status).toBe(400);
  let row=await createConnection();row=(await db.query<Connection>('SELECT * FROM integration_connections WHERE id=$1',[row.id]))[0];expect(row.google_email).toBe(email);
  await db.query('UPDATE "user" SET email=$2 WHERE id=$1',[userId,'changed@example.invalid']);await expect(service.authorizedTokens(row,new GoogleAdapter(config,transport))).rejects.toMatchObject({code:'authorization_expired'});await db.query('UPDATE "user" SET email=$2 WHERE id=$1',[userId,email]);
  identity={...identity,email:'different@example.invalid'};state=await connect();expect((await complete(state)).status).toBe(403);
  identity={...identity,email,hd:'other.example'};state=await connect();expect((await complete(state)).status).toBe(403);
 }finally{vi.unstubAllGlobals();for(const key of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_INTEGRATION_REDIRECT_URI','INTEGRATION_ENCRYPTION_KEY','GOOGLE_WORKSPACE_DOMAIN']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}await db.query('UPDATE "user" SET email=$2 WHERE id=$1',[userId,`${userId}@example.test`]);await db.query('UPDATE integration_connections SET google_email=NULL WHERE workspace_id=$1 AND user_id=$2',[workspace,userId]);}
});

  it('retains private ERP provenance when a file is selected again and linked elsewhere',async()=>{
    const {stage,linkItem}=await import('../src/integrations/workspace-core');const {drivePermissionPlan}=await import('../src/integrations/drive-permissions');
    const domain=await import('../src/domain/service');
    const original=await domain.create(ctx,'documents',{title:'Private export source',is_private:true}),other=await domain.create(ctx,'documents',{title:'Another linked record'});
    const row=(await db.query<Connection>("INSERT INTO integration_connections(workspace_id,user_id,provider,status,google_email) VALUES($1,$2,'drive','connected',$3) ON CONFLICT(workspace_id,user_id,provider) DO UPDATE SET status='connected' RETURNING *",[workspace,userId,`${userId}@example.test`]))[0];
    const recipient=randomUUID();await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[recipient,'Synthetic recipient',`${recipient}@example.test`]);await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[workspace,recipient,['member']]);
    const adapter=new GoogleAdapter(config,vi.fn(async()=>json({id:'private-file',name:'Private',mimeType:'text/plain',capabilities:{canShare:true},permissions:[]})));
    const s={ctx,row,adapter,tokens:{...tokens,scope:'https://www.googleapis.com/auth/drive.file'}};
    const item=await stage(s,'drive_file','private-file',{source:{resource:'documents',id:original.id},name:'Private'});
    await linkItem(s,item.id,'documents',other.id);await stage(s,'drive_file','private-file',{id:'private-file',name:'Selected again'});
    expect((await db.query('SELECT data FROM integration_items WHERE id=$1',[item.id]))[0].data).toMatchObject({source:{id:original.id}});
    expect(await db.query('SELECT record_id FROM integration_item_links WHERE item_id=$1',[item.id])).toHaveLength(2);
    await expect(drivePermissionPlan(s,{file_id:'private-file',user_id:recipient,role:'reader',acknowledge_external_visibility:true})).rejects.toMatchObject({code:'PRIVATE_DESTINATION_REQUIRED'});
  });
  it('does not mark an unsynchronized local edit as synced when Meet finishes asynchronously',async()=>{
    const row=await createConnection(),id=await createEvent('Pending Meet'),p=provider();const initial={id:'meet-pending',etag:'pending',summary:'Pending Meet',start:{dateTime:'2026-11-01T08:30:00Z'},end:{dateTime:'2026-11-01T10:30:00Z'}};p.events.set(initial.id,initial);await db.query("INSERT INTO external_event_mappings(workspace_id,connection_id,event_id,external_id,etag,local_version,external_snapshot) VALUES($1,$2,$3,$4,$5,1,$6)",[workspace,row.id,id,initial.id,initial.etag,JSON.stringify(initial)]);
    const [mapping]=await db.query('SELECT * FROM external_event_mappings WHERE event_id=$1',[id]),remote=p.events.get(String(mapping.external_id))!;
    await db.query('UPDATE events SET notes=$1,version=version+1 WHERE id=$2',['Unsynced local note',id]);
    remote.etag='meet-ready';remote.hangoutLink='https://meet.google.com/abc-defg-hij';p.events.set(remote.id,remote);
    const {readWorkspace}=await import('../src/integrations/workspace-reads');await readWorkspace({ctx,row,adapter:p.adapter,tokens},'meet_status',{event_id:remote.id});
    const [updated]=await db.query('SELECT local_version FROM external_event_mappings WHERE id=$1',[mapping.id]),[local]=await db.query('SELECT version,notes FROM events WHERE id=$1',[id]);
    expect(updated.local_version).toBe(mapping.local_version);expect(Number(local.version)).toBeGreaterThan(Number(updated.local_version));expect(local.notes).toBe('Unsynced local note');
  });
