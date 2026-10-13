import 'dotenv/config';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import type {Context} from '../src/lib/context';

let db:typeof import('../src/lib/db'),download:typeof import('../src/lib/attachment-download'),storage:typeof import('../src/lib/storage'),admin:Pool,scratch:string;
const originalUrl=process.env.DATABASE_URL,originalDir=process.env.ATTACHMENT_DIR,originalBucket=process.env.S3_BUCKET;
const databaseName=`syntherisk_attachments_test_${randomUUID().replaceAll('-','')}`;
const workspaceId=randomUUID(),companyId=randomUUID(),userId=randomUUID(),contactId=randomUUID(),attachmentId=randomUUID();
const ctx:Context={workspaceId,companyId,userId,roles:['admin']};
const bytes=Buffer.from('Isolated download integrity fixture\n'),sha256=createHash('sha256').update(bytes).digest('hex'),key=`${workspaceId}/${attachmentId}`;
beforeAll(async()=>{
 if(!originalUrl)throw new Error('DATABASE_URL required for isolated attachment tests');
 admin=new Pool({connectionString:originalUrl});await admin.query(`CREATE DATABASE "${databaseName}"`);
 const url=new URL(originalUrl);url.pathname=`/${databaseName}`;process.env.DATABASE_URL=url.toString();scratch=await mkdtemp(join(tmpdir(),'syntherisk-attachments-'));process.env.ATTACHMENT_DIR=scratch;delete process.env.S3_BUCKET;
 db=await import('../src/lib/db');download=await import('../src/lib/attachment-download');storage=await import('../src/lib/storage');
 const root=join(process.cwd(),'prisma','migrations');for(const entry of(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join(root,entry.name,'migration.sql'),'utf8'));
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'Isolated attachment test']);await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3)',[companyId,workspaceId,'Isolated attachment company']);
 await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[userId,'Attachment test',`${userId}@example.invalid`]);await db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin'])",[workspaceId,userId]);
 await db.query('INSERT INTO contacts(id,workspace_id,company_id,name,created_by,updated_by,owner_id) VALUES($1,$2,$3,$4,$5,$5,$5)',[contactId,workspaceId,companyId,'Isolated attachment owner',userId]);
 await storage.putFile(key,bytes,'text/plain');await db.query("INSERT INTO attachments(id,workspace_id,company_id,resource,record_id,filename,mime_type,byte_size,sha256,storage_key,created_by) VALUES($1,$2,$3,'contacts',$4,'preserved.txt','text/plain',$5,$6,$7,$8)",[attachmentId,workspaceId,companyId,contactId,bytes.length,sha256,key,userId]);
},60000);
afterAll(async()=>{
 if(db)await db.pool.end();process.env.DATABASE_URL=originalUrl;if(originalDir===undefined)delete process.env.ATTACHMENT_DIR;else process.env.ATTACHMENT_DIR=originalDir;if(originalBucket===undefined)delete process.env.S3_BUCKET;else process.env.S3_BUCKET=originalBucket;
 if(admin){await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}if(scratch)await rm(scratch,{recursive:true,force:true});
});
describe('attachment download actual PostgreSQL permissions and integrity',()=>{
 it('keeps original download bytes and provides a verified checksum ZIP for the authorized record',async()=>{
  const original=await download.attachmentDownload(ctx,attachmentId);expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes);expect(original.headers.get('Content-Type')).toBe('text/plain');
  const bundle=await download.attachmentDownload(ctx,attachmentId,true);const zip=Buffer.from(await bundle.arrayBuffer());expect(zip.readUInt32LE(0)).toBe(0x04034b50);expect(bundle.headers.get('X-Attachment-SHA256')).toBe(sha256);expect(bundle.headers.get('X-Content-SHA256')).toBe(createHash('sha256').update(zip).digest('hex'));expect(bundle.headers.get('Cache-Control')).toBe('private, no-store');expect(bundle.headers.get('Content-Disposition')).toContain('preserved.txt.checksum.zip');
 });
 it('rejects cross-workspace IDs and external viewers without a grant before storage is read',async()=>{
  await storage.removeFile(key);
  try{await expect(download.attachmentDownload({...ctx,workspaceId:randomUUID()},attachmentId,true)).rejects.toMatchObject({status:404});await expect(download.attachmentDownload({...ctx,userId:randomUUID(),roles:['external']},attachmentId,true)).rejects.toMatchObject({status:404});}finally{await storage.putFile(key,bytes,'text/plain');}
 });
 it('honors a read grant and immediately rejects download after grant revocation',async()=>{
  const viewer=randomUUID();await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[viewer,'Isolated viewer',`${viewer}@example.invalid`]);await db.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['external'])",[workspaceId,viewer]);
  await db.query("INSERT INTO record_grants(workspace_id,resource,record_id,user_id) VALUES($1,'contacts',$2,$3)",[workspaceId,contactId,viewer]);const external={...ctx,userId:viewer,roles:['external']};expect((await download.attachmentDownload(external,attachmentId,true)).status).toBe(200);
  await db.query("DELETE FROM record_grants WHERE workspace_id=$1 AND resource='contacts' AND record_id=$2 AND user_id=$3",[workspaceId,contactId,viewer]);await expect(download.attachmentDownload(external,attachmentId,true)).rejects.toMatchObject({status:404});
 });
 it('refuses altered storage content instead of issuing a reassuring manifest',async()=>{
  await storage.removeFile(key);await storage.putFile(key,Buffer.from('altered bytes'),'text/plain');try{await expect(download.attachmentDownload(ctx,attachmentId,true)).rejects.toMatchObject({status:409,code:'ATTACHMENT_INTEGRITY_MISMATCH'});}finally{await storage.removeFile(key);await storage.putFile(key,bytes,'text/plain');}
 });
});
