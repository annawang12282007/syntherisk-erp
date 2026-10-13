import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {Pool} from 'pg';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {GoogleAdapter,type Tokens} from '../src/integrations/adapters';
import type {Session} from '../src/integrations/workspace-core';
import type {Context} from '../src/lib/context';
const original=process.env.DATABASE_URL,name='syntherisk_cloud_test_'+randomUUID().replaceAll('-','');
const ctx:Context={workspaceId:randomUUID(),companyId:randomUUID(),userId:randomUUID(),roles:['admin']},other={...ctx,userId:randomUUID()};
let root:Pool,db:typeof import('../src/lib/db'),exports:typeof import('../src/integrations/cloud-export'),domain:typeof import('../src/domain/service'),library:typeof import('../src/integrations/cloud-library'),s:Session;
let permissions=[{id:'owner',type:'user',role:'owner',emailAddress:'test@example.invalid'}],fileSeq=0;
const calls:{path:string;method:string;body:unknown}[]=[];
const fetcher=vi.fn<typeof fetch>().mockImplementation(async(url,init)=>{
 const u=new URL(String(url)),path=u.pathname;calls.push({path,method:init?.method||'GET',body:init?.body});
 const json=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
 if(path.endsWith('/permissions'))return json({permissions});
 if(path.endsWith('/export'))return new Response('%PDF-controlled-test',{headers:{'Content-Type':'application/pdf'}});
 if(path==='/upload/drive/v3/files')return json({id:'file-'+(++fileSeq)});
 if(path==='/v1/forms'&&init?.method==='POST'){expect(u.searchParams.get('unpublished')).toBe('true');return json({formId:'form-'+(++fileSeq)});}
 if(init?.method==='PATCH'||path.includes(':batchUpdate'))return json({});
 return json({id:path.split('/').at(-1),name:'Controlled folder',version:'1',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true,canEdit:true},permissions});
});
beforeAll(async()=>{
 root=new Pool({connectionString:original});await root.query(`CREATE DATABASE "${name}"`);const url=new URL(original!);url.pathname='/'+name;process.env.DATABASE_URL=url.toString();
 db=await import('../src/lib/db');exports=await import('../src/integrations/cloud-export');domain=await import('../src/domain/service');library=await import('../src/integrations/cloud-library');
 for(const entry of (await readdir('prisma/migrations')).sort())if(entry.match(/^\d/))await db.query(await readFile(`prisma/migrations/${entry}/migration.sql`,'utf8'));
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[ctx.workspaceId,'Cloud export controlled']);await db.query('INSERT INTO companies(id,workspace_id) VALUES($1,$2)',[ctx.companyId,ctx.workspaceId]);
 for(const actor of [ctx,other]){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[actor.userId,'Controlled user',actor===ctx?'test@example.invalid':'other@example.invalid']);await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[ctx.workspaceId,actor.userId,actor.roles]);}
 const [row]=await db.query("INSERT INTO integration_connections(workspace_id,user_id,provider,status,google_email) VALUES($1,$2,'drive','connected','test@example.invalid') RETURNING *",[ctx.workspaceId,ctx.userId]);
 const adapter=new GoogleAdapter({clientId:'controlled',clientSecret:'controlled',redirectUri:'http://localhost:3000/api/integrations',encryptionKey:Buffer.alloc(32).toString('base64')},fetcher);
 s={ctx,row:row as Session['row'],adapter,tokens:{scope:'https://www.googleapis.com/auth/drive.file'} as Tokens};
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=original;if(root){await root.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await root.end();}});
const input=(format:string)=>({resource:'tasks',columns:'title',format,folder_id:'folder',title:'Controlled export',snapshot_at:'2026-10-07T12:00:00.000Z',acknowledge_external_visibility:true});
it('builds stable previews and immutable source versions, excludes unexportable columns',async()=>{
 await domain.create(ctx,'tasks',{title:'A < B & C',is_private:true});
 const first=await exports.cloudExportPlan(s,input('xlsx')),again=await exports.cloudExportPlan(s,input('xlsx'));expect(first.file.content_base64).toBe(again.file.content_base64);expect(first.sources).toHaveLength(1);expect(first.private_source).toBe(true);
 await expect(exports.cloudExportPlan(s,{...input('json'),columns:'password'})).rejects.toMatchObject({code:'INVALID_EXPORT_COLUMNS'});
 const docs=await exports.cloudExportPlan(s,input('google_docs'));expect(Buffer.from(docs.file.content_base64,'base64').toString()).toContain('A &lt; B &amp; C');
});
it('blocks private data in a folder shared with another person and rejects disabled export policies',async()=>{
 permissions.push({id:'other',type:'user',role:'reader',emailAddress:'other@example.invalid'});
 await expect(exports.cloudExportPlan(s,input('json'))).rejects.toMatchObject({code:'PRIVATE_DESTINATION_REQUIRED'});permissions=permissions.slice(0,1);
 const restricted={...s,ctx:{...ctx,roles:['member'],permissions:[{resource:'tasks',operation:'export',scope:'none'}]}};
 await expect(exports.cloudExportPlan(restricted,input('json'))).rejects.toMatchObject({status:403});
});
it.each(['google_docs','google_sheets','google_forms','pdf','xlsx','csv','json'])('creates %s with one private ERP document, source lineage and idempotent filing',async format=>{
 const p=await exports.cloudExportPlan(s,input(format));
 const [op]=await db.query("INSERT INTO integration_operations(workspace_id,company_id,user_id,connection_id,kind,input,preview,fingerprint,status) VALUES($1,$2,$3,$4,'cloud_export','{}',$5,'controlled','running') RETURNING id",[ctx.workspaceId,ctx.companyId,ctx.userId,s.row.id,JSON.stringify(p)]);
 const written=await exports.writeCloudExport(s,String(op.id),p);expect(written.document_id).toBeTruthy();
 const doc=await domain.get(ctx,'documents',String(written.document_id));expect(doc.is_private).toBe(true);expect(doc.drive_file_id).toBe(written.file_id);
 expect((await db.query('SELECT * FROM cloud_export_sources WHERE document_id=$1',[doc.id]))).toHaveLength(1);
 const again=await exports.linkCloudExport(s,String(op.id),p,{id:written.file_id,url:written.url});expect(again.document_id).toBe(doc.id);
 // Even an administrator cannot see another creator's private export.
 await expect(domain.get(other,'documents',String(doc.id))).rejects.toMatchObject({status:404});
 if(format==='google_forms'){expect(p.tables).toHaveLength(0);expect(p.file.content_base64).toBe('');expect(p.questions).toHaveLength(1);const requests=calls.filter(c=>c.path.includes(':batchUpdate'));expect(JSON.stringify(requests.at(-1)?.body)).not.toContain('A < B');}
});
it('persists chosen cloud files, detects remote versions and isolates notes and history',async()=>{
 const {item}=await library.rememberFile(s,'chosen-file'),again=await library.rememberFile(s,'chosen-file');expect(again.item.id).toBe(item.id);
 const rows=await library.libraryAction(s,'cloud_library',{}) as Record<string,unknown>[];const row=rows.find(v=>v.id===item.id)!;expect(row).toBeTruthy();
 await library.libraryAction(s,'cloud_notes',{item_id:item.id,version:row.version,notes:'Private note'});
 await expect(library.libraryAction(s,'cloud_notes',{item_id:item.id,version:row.version,notes:'Stale'})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 await expect(library.libraryAction({...s,ctx:other},'cloud_history',{item_id:item.id})).rejects.toMatchObject({status:404});
 const history=await library.libraryAction(s,'cloud_history',{item_id:item.id}) as {history:unknown[]};expect(history.history).toHaveLength(2);
});
