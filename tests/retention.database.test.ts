import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {Pool} from 'pg';
import {beforeAll,afterAll,it,expect} from 'vitest';
import type {Context} from '../src/lib/context';
import type {Row} from '../src/domain/core';
import type {Connection} from '../src/integrations/service';
const original=process.env.DATABASE_URL,name='syntherisk_retention_test_'+randomUUID().replaceAll('-','');
const admin:Context={workspaceId:randomUUID(),companyId:randomUUID(),userId:randomUUID(),roles:['admin']},member={...admin,userId:randomUUID(),roles:['member']},reviewer={...admin,userId:randomUUID(),roles:['operations']},stranger={...member,userId:randomUUID()};
let root:Pool,db:typeof import('../src/lib/db'),retention:typeof import('../src/domain/retention'),domain:typeof import('../src/domain/service'),core:typeof import('../src/domain/core'),profiles:typeof import('../src/lib/signature-profile'),library:typeof import('../src/integrations/cloud-library');
beforeAll(async()=>{
 root=new Pool({connectionString:original});await root.query('CREATE DATABASE "'+name+'"');const url=new URL(original!);url.pathname='/'+name;process.env.DATABASE_URL=url.toString();
 db=await import('../src/lib/db');retention=await import('../src/domain/retention');domain=await import('../src/domain/service');core=await import('../src/domain/core');profiles=await import('../src/lib/signature-profile');library=await import('../src/integrations/cloud-library');
 for(const entry of (await readdir('prisma/migrations')).sort())if(/^\d/.test(entry))await db.query(await readFile('prisma/migrations/'+entry+'/migration.sql','utf8'));
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[admin.workspaceId,'Retention isolated']);
 await db.query('INSERT INTO companies(id,workspace_id) VALUES($1,$2)',[admin.companyId,admin.workspaceId]);
 for(const actor of [admin,member,reviewer,stranger]){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[actor.userId,actor.roles[0],actor.userId+'@example.invalid']);await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[admin.workspaceId,actor.userId,actor.roles]);}
},120000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=original;if(root){await root.query('DROP DATABASE IF EXISTS "'+name+'" WITH (FORCE)');await root.end();}});
async function contact(ctx=member,priv=false){return domain.create(ctx,'contacts',{name:'Retention '+randomUUID(),is_private:priv});}
async function policy(row:Row,tier:string){const info=await retention.retentionInfo(db.pool,admin,'contacts',row);return retention.retentionAction(admin,{action:'policy',resource:'contacts',id:row.id,version:info.policy_version,tier});}
async function act(ctx:Context,row:Row,action:string,extra:Row={}){return retention.retentionAction(ctx,{action,resource:'contacts',id:row.id,version:row.version,...extra});}
async function reload(row:Row){return (await db.query('SELECT * FROM contacts WHERE id=$1',[row.id]))[0];}
it('deletes only the creator at owner level and restores through archive, hiding ordinary access and search',async()=>{
 let row=await contact();await policy(row,'owner');
 await expect(act(member,row,'delete',{reason:'Before archive'})).rejects.toMatchObject({code:'RETENTION_ARCHIVE_FIRST'});
 await act(member,row,'archive');row=await reload(row);
 await expect(act(admin,row,'delete',{reason:'Not creator'})).rejects.toMatchObject({code:'RETENTION_CREATOR_REQUIRED'});
 await act(member,row,'delete',{reason:'No longer needed'});row=await reload(row);
 await expect(domain.get(member,'contacts',String(row.id))).rejects.toMatchObject({status:404});
 expect((await retention.retentionList(member,{resource:'contacts',view:'deleted'})).rows.some(r=>r.id===row.id)).toBe(true);
 await expect(core.find(db.pool,stranger,'contacts',row.id)).rejects.toMatchObject({status:404});
 await act(member,row,'recover');row=await reload(row);expect(row.archived).toBe(true);
 await act(member,row,'restore');expect((await reload(row)).archived).toBe(false);
});
it('requires explicit deletion permission at authorized level, even when a member may edit',async()=>{
 let row=await contact();await act(member,row,'archive');row=await reload(row);
 await expect(act(member,row,'delete',{reason:'No deletion grant'})).rejects.toMatchObject({status:403});
 await db.query("INSERT INTO permissions(workspace_id,role_code,resource,operation,scope) VALUES($1,'member','contacts','delete','created')",[admin.workspaceId]);
 await act(member,row,'delete',{reason:'Permission now granted'});
});
it('enforces locked tiers in the existing archive and merge paths and the database archive guard',async()=>{
 const row=await contact(),target=await contact();await policy(row,'locked');
 await expect(act(member,row,'archive')).rejects.toMatchObject({code:'RETENTION_LOCKED'});
 await expect(domain.action(member,'contacts',String(row.id),'archive',{version:row.version})).rejects.toMatchObject({code:'RETENTION_LOCKED'});
 await expect(domain.action(admin,'contacts',String(row.id),'merge',{version:row.version,target_id:target.id})).rejects.toMatchObject({code:'RETENTION_LOCKED'});
 await expect(db.query('UPDATE contacts SET archived=true WHERE id=$1',[row.id])).rejects.toMatchObject({code:'P0004'});
 await expect(act(member,row,'policy',{tier:'owner'})).rejects.toMatchObject({status:403});
});
it('protects archive-only records and never grants administrators access to another member’s private archive',async()=>{
 let row=await contact();await policy(row,'archive_only');await act(member,row,'archive');row=await reload(row);
 await expect(act(admin,row,'delete',{reason:'Protected'})).rejects.toMatchObject({code:'RETENTION_DELETE_PROTECTED'});
 const privateRow=await contact(member,true);await act(member,privateRow,'archive');
 expect((await retention.retentionList(admin,{resource:'contacts',view:'archived'})).rows.some(r=>r.id===privateRow.id)).toBe(false);
 await expect(act(admin,await reload(privateRow),'policy',{tier:'owner'})).rejects.toMatchObject({status:404});
});
it('requires a distinct reviewer, rejects changed versions, and records a valid approval once',async()=>{
 let row=await contact();await policy(row,'approval');await act(member,row,'archive');row=await reload(row);
 await expect(act(member,row,'delete',{reason:'Bypass'})).rejects.toMatchObject({code:'RETENTION_APPROVAL_REQUIRED'});
 await expect(act(member,row,'request',{reason:'Self',reviewer_id:member.userId})).rejects.toMatchObject({code:'RETENTION_REVIEWER_REQUIRED'});
 await act(member,row,'request',{reason:'Reviewed disposal',reviewer_id:reviewer.userId});
 const req=(await db.query('SELECT * FROM record_deletion_requests WHERE record_id=$1',[row.id]))[0];
 await expect(retention.retentionAction(admin,{action:'approve',request_id:req.id,version:req.version,reason:'Wrong reviewer'})).rejects.toMatchObject({code:'RETENTION_REVIEWER_REQUIRED'});
 await db.query('UPDATE contacts SET version=version+1 WHERE id=$1',[row.id]);
 await expect(retention.retentionAction(reviewer,{action:'approve',request_id:req.id,version:req.version,reason:'Stale'})).rejects.toMatchObject({code:'RETENTION_REVIEW_CHANGED'});
 await retention.retentionAction(member,{action:'cancel',request_id:req.id,version:req.version,reason:'Resubmit changed version'});
 row=await reload(row);await act(member,row,'request',{reason:'Current version',reviewer_id:reviewer.userId});
 const current=(await db.query("SELECT * FROM record_deletion_requests WHERE record_id=$1 AND status='pending'",[row.id]))[0];
 await retention.retentionAction(reviewer,{action:'approve',request_id:current.id,version:current.version,reason:'Retention reviewed'});
 await expect(core.find(db.pool,member,'contacts',row.id)).rejects.toMatchObject({status:404});
 await expect(retention.retentionAction(reviewer,{action:'approve',request_id:current.id,version:current.version,reason:'Duplicate'})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 expect((await retention.retentionList(reviewer,{resource:'contacts',view:'requests'})).requests.some(r=>r.id===current.id&&r.status==='approved')).toBe(true);
});
it('rechecks revoked reviewer and requester authority; restoring cancels a pending request',async()=>{
 let row=await contact();await policy(row,'approval');await act(member,row,'archive');row=await reload(row);
 await act(member,row,'request',{reason:'Review required',reviewer_id:reviewer.userId});
 const req=(await db.query('SELECT * FROM record_deletion_requests WHERE record_id=$1',[row.id]))[0];
 await db.query("UPDATE memberships SET roles=ARRAY['member'] WHERE user_id=$1",[reviewer.userId]);
 await expect(retention.retentionAction(reviewer,{action:'approve',request_id:req.id,version:1,reason:'Old session roles'})).rejects.toMatchObject({status:403});
 await db.query("UPDATE memberships SET roles=ARRAY['operations'] WHERE user_id=$1",[reviewer.userId]);
 await act(member,row,'restore');
 expect((await db.query('SELECT status FROM record_deletion_requests WHERE id=$1',[req.id]))[0].status).toBe('cancelled');
});
it('does not delete records still used by another record, even when the reference is archived',async()=>{
 let row=await contact();await policy(row,'owner');
 await domain.create(member,'activities',{title:'Referenced contact',contact_id:row.id});
 await act(member,row,'archive');row=await reload(row);
 await expect(act(member,row,'delete',{reason:'Still referenced'})).rejects.toMatchObject({code:'RETENTION_REFERENCED'});
});
it('identifies archived handoff blockers without disclosing inaccessible references or counting owned children',async()=>{
 const task=await domain.create(admin,'tasks',{title:'Dependency diagnostic'});
 const handoff=await domain.create(admin,'handoffs',{title:'Archived handoff',task_id:task.id,to_user_id:member.userId});
 await db.query("UPDATE handoffs SET archived=true,status='withdrawn' WHERE id=$1",[handoff.id]);
 await domain.create(admin,'task_comments',{task_id:task.id,body:'Owned child follows task'});
 const result=await retention.retentionDependencies(admin,'tasks',String(task.id));expect(result.blocked).toBe(true);expect(result.records).toEqual([expect.objectContaining({resource:'handoffs',id:handoff.id,archived:true,title:'Archived handoff'})]);
 const restricted=await retention.retentionDependencies({...admin,roles:['member'],permissions:[{resource:'tasks',operation:'read',scope:'all'},{resource:'handoffs',operation:'read',scope:'none'}]},'tasks',String(task.id));expect(restricted.records).toHaveLength(0);expect(restricted.restricted).toBe(true);
 const privateRow=await contact(member,true);await expect(retention.retentionDependencies(admin,'contacts',String(privateRow.id))).rejects.toMatchObject({status:404});
});
it('deletes personal signature presets with monotonically increasing versions; frozen appearance bytes remain unchanged',async()=>{
 const a=await profiles.saveSignatureProfile(member,{mode:'generated',version:0,signature_text:'First',label:'First'});
 const b=await profiles.saveSignatureProfile(member,{mode:'generated',version:a.version,signature_text:'Second',label:'Second'}),snapshot=JSON.stringify(b);
 const current=await profiles.deleteSignatureVersion(member,{revision:b.saved_version,version:b.version});
 expect(current.signature_text).toBe('First');expect(current.versions).toHaveLength(1);expect(JSON.stringify(b)).toBe(snapshot);
 await expect(profiles.deleteSignatureVersion(member,{revision:a.saved_version,version:b.version})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 const empty=await profiles.deleteSignatureVersion(member,{revision:a.saved_version,version:current.version});expect(empty.versions).toHaveLength(0);expect(empty.saved_version).toBeNull();
 const next=await profiles.saveSignatureProfile(member,{mode:'generated',version:empty.version,signature_text:'New',label:'New'});expect(next.saved_version).toBeGreaterThan(b.saved_version!);
 await expect(profiles.deleteSignatureVersion(stranger,{revision:next.saved_version,version:0})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
});
it('removes and restores only the caller’s cloud bookmark while disconnected, retaining notes, links and history',async()=>{
 const [connection]=await db.query("INSERT INTO integration_connections(workspace_id,user_id,provider,status) VALUES($1,$2,'drive','disconnected') RETURNING *",[admin.workspaceId,member.userId]);
 const [item]=await db.query("INSERT INTO integration_items(workspace_id,user_id,connection_id,kind,external_id,data,fingerprint) VALUES($1,$2,$3,'drive_file','fixture-file','{}','controlled') RETURNING *",[admin.workspaceId,member.userId,connection.id]);
 await db.query("INSERT INTO cloud_file_library(item_id,notes) VALUES($1,'Retained note')",[item.id]);
 const s={ctx:member,row:connection as unknown as Connection};
 await library.libraryAction(s,'cloud_remove',{item_id:item.id,version:1});
 expect(await library.libraryAction(s,'cloud_library',{})).toHaveLength(0);
 const removed=await library.libraryAction(s,'cloud_library',{removed:true}) as Row[];expect(removed[0].notes).toBe('Retained note');
 await expect(library.libraryAction({ctx:stranger,row:s.row},'cloud_restore',{item_id:item.id,version:2})).rejects.toMatchObject({status:404});
 await expect(library.libraryAction(s,'cloud_restore',{item_id:item.id,version:1})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 await library.libraryAction(s,'cloud_restore',{item_id:item.id,version:2});
 expect(await library.libraryAction(s,'cloud_library',{})).toHaveLength(1);
 expect((await db.query('SELECT * FROM cloud_file_history WHERE item_id=$1',[item.id])).map(r=>r.action)).toEqual(['cloud_remove','cloud_restore']);
});

it('rejects approval after a retention-policy change without deleting anything',async()=>{
 let row=await contact();await policy(row,'approval');await act(member,row,'archive');row=await reload(row);
 await act(member,row,'request',{reason:'Policy stability',reviewer_id:reviewer.userId});
 const req=(await db.query("SELECT * FROM record_deletion_requests WHERE record_id=$1 AND status='pending'",[row.id]))[0];
 await policy(row,'approval');
 await expect(retention.retentionAction(reviewer,{action:'approve',request_id:req.id,version:1,reason:'Changed policy'})).rejects.toMatchObject({code:'RETENTION_REVIEW_CHANGED'});
 expect(await db.query('SELECT 1 FROM record_disposals WHERE record_id=$1',[row.id])).toHaveLength(0);
 await retention.retentionAction(reviewer,{action:'reject',request_id:req.id,version:1,reason:'Please resubmit'});
});
it('enforces financial and signature protection even when an administrator selects owner deletion',async()=>{
 const financial=await retention.retentionInfo(db.pool,admin,'journal_entries');expect(financial.tier).toBe('locked');
 const doc=await domain.create(member,'documents',{title:'Signed preservation test'});
 const configuration=await import('../src/domain/signature-requests');
 await configuration.mutateSignatureRequests(member,{action:'configure',resource:'documents',record_id:doc.id,version:doc.version,configuration_version:0,enabled:true,parties:[{kind:'internal',user_id:member.userId,label:'Controlled signature'}]});
 await configuration.mutateSignatureRequests(member,{action:'issue',resource:'documents',record_id:doc.id,version:doc.version,configuration_version:1});
 // A synthetic completed status exercises the server retention floor; this is not a real signature.
 await db.query("UPDATE signature_requests SET status='signed' WHERE batch_id IN(SELECT id FROM signature_request_batches WHERE record_id=$1)",[doc.id]);
 await retention.retentionAction(admin,{action:'policy',resource:'documents',id:doc.id,version:0,tier:'owner'});
 expect((await retention.retentionInfo(db.pool,member,'documents',doc)).tier).toBe('archive_only');
 await retention.retentionAction(member,{action:'archive',resource:'documents',id:doc.id,version:doc.version});
 await expect(retention.retentionAction(member,{action:'delete',resource:'documents',id:doc.id,version:Number(doc.version)+1,reason:'Must retain signed evidence'})).rejects.toMatchObject({code:'RETENTION_DELETE_PROTECTED'});
});

it('archives and removes an unsigned document with owned versions while hiding and preserving its version history',async()=>{
 let doc=await domain.create(member,'documents',{title:'Owned versions',content:'First'});
 doc=await domain.action(member,'documents',String(doc.id),'new_version',{version:doc.version,content:'Second'});
 const versions=await db.query('SELECT id FROM document_versions WHERE document_id=$1',[doc.id]);expect(versions.length).toBeGreaterThan(0);
 await retention.retentionAction(admin,{action:'policy',resource:'documents',id:doc.id,version:0,tier:'owner'});
 await retention.retentionAction(member,{action:'archive',resource:'documents',id:doc.id,version:doc.version});
 doc=(await db.query('SELECT * FROM documents WHERE id=$1',[doc.id]))[0];
 await retention.retentionAction(member,{action:'delete',resource:'documents',id:doc.id,version:doc.version,reason:'Unsigned draft no longer needed'});
 await expect(domain.get(member,'document_versions',String(versions[0].id))).rejects.toMatchObject({status:404});
 expect(await db.query('SELECT id FROM document_versions WHERE document_id=$1',[doc.id])).toHaveLength(versions.length);
});
