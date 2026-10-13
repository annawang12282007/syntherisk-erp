import 'dotenv/config';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir, rm, unlink, cp, access } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Pool } from 'pg';
import { beforeAll, afterAll, expect, it } from 'vitest';
import type { BackupManifest } from '../src/lib/backup';

const suffix=randomUUID().replaceAll('-',''),dbNames=[`syntherisk_backup_source_${suffix}`,`syntherisk_backup_target_${suffix}`,`syntherisk_backup_retry_${suffix}`];
const originalUrl=process.env.DATABASE_URL,originalAttachments=process.env.ATTACHMENT_DIR,originalBucket=process.env.S3_BUCKET;
const root=resolve(process.cwd(),'work',`backup-test-${suffix}`),backupDir=join(root,'snapshot'),filesDir=join(root,'source-files');
const workspace=randomUUID(),company=randomUUID(),contact=randomUUID(),userId=`backup-${suffix}`,firstId=randomUUID(),secondId=randomUUID();
const keys=[`${workspace}/${firstId}`,`${workspace}/${secondId}`];
let admin:Pool,source:typeof import('../src/lib/db'),backupModule:typeof import('../src/lib/backup'),manifest:BackupManifest;
const urls:string[]=[];
async function migrate(url:string){const p=new Pool({connectionString:url});try{for(const entry of (await readdir('prisma/migrations',{withFileTypes:true})).filter(x=>x.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await p.query(await readFile(join('prisma/migrations',entry.name,'migration.sql'),'utf8'));}finally{await p.end();}}
beforeAll(async()=>{
  if(!originalUrl)throw new Error('DATABASE_URL required for isolated restore verification');admin=new Pool({connectionString:originalUrl});
  for(const name of dbNames){await admin.query(`CREATE DATABASE "${name}"`);const url=new URL(originalUrl);url.pathname='/'+name;urls.push(url.toString());await migrate(url.toString());}
  process.env.DATABASE_URL=urls[0];process.env.ATTACHMENT_DIR=filesDir;delete process.env.S3_BUCKET;
  source=await import('../src/lib/db');backupModule=await import('../src/lib/backup');
  await source.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspace,'Isolated restore workspace']);await source.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3)',[company,workspace,'Restore test']);
  await source.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[userId,'Restore tester',`${userId}@example.test`]);await source.query("INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,ARRAY['admin'])",[workspace,userId]);
  await source.query('INSERT INTO contacts(id,workspace_id,company_id,created_by,updated_by,owner_id,name) VALUES($1,$2,$3,$4,$4,$4,$5)',[contact,workspace,company,userId,'Preserved contact']);
  for(let i=0;i<keys.length;i++){
    const bytes=Buffer.from(`Restore attachment ${i}`),hash=createHash('sha256').update(bytes).digest('hex');await mkdir(join(filesDir,workspace),{recursive:true});await writeFile(join(filesDir,keys[i]),bytes);
    await source.query("INSERT INTO attachments(id,workspace_id,company_id,resource,record_id,filename,mime_type,byte_size,sha256,storage_key,created_by) VALUES($1,$2,$3,'contacts',$4,$5,'text/plain',$6,$7,$8,$9)",[i===0?firstId:secondId,workspace,company,contact,`proof-${i}.txt`,bytes.length,hash,keys[i],userId]);
  }
  await source.query("INSERT INTO signature_profiles(user_id,mode,image_data,image_sha256) VALUES($1,'uploaded',$2,$3)",[userId,Buffer.from([0,1,128,255]),'test']);
  await source.query("SELECT setval('business_document_number',1234567,true)");manifest=await backupModule.backup(backupDir);
},60000);
afterAll(async()=>{
  if(source)await source.pool.end();process.env.DATABASE_URL=originalUrl;process.env.ATTACHMENT_DIR=originalAttachments;if(originalBucket===undefined)delete process.env.S3_BUCKET;else process.env.S3_BUCKET=originalBucket;
  if(admin){for(const name of dbNames)await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();}
  const allowed=resolve(process.cwd(),'work');if(root.startsWith(allowed+sep)&&root.includes(`backup-test-${suffix}`))await rm(root,{recursive:true,force:true});
},60000);
it('restores source IDs, references, attachments and the exact sequence high-water mark above one million',async()=>{
  expect(manifest.format).toBe(2);expect(manifest.sequences.business_document_number).toEqual({lastValue:'1234567',isCalled:true});expect(manifest.snapshot.walLsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);
  // JSON object order can differ when moved between operating systems.
  await writeFile(join(backupDir,'manifest.json'),JSON.stringify({...manifest,migrations:Object.fromEntries(Object.entries(manifest.migrations).reverse())}));
  const restored=await backupModule.restore(backupDir,urls[1],join(root,'restored-files'));expect(restored.attachments).toBe(2);
  const target=new Pool({connectionString:urls[1]});try{
    expect((await target.query('SELECT image_data FROM signature_profiles')).rows[0].image_data).toEqual(Buffer.from([0,1,128,255]));
    expect((await target.query('SELECT id,name FROM contacts')).rows).toEqual([{id:contact,name:'Preserved contact'}]);
    expect((await target.query('SELECT count(*)::int AS count FROM attachments a JOIN contacts c ON c.id=a.record_id AND c.workspace_id=a.workspace_id')).rows[0].count).toBe(2);
    expect((await target.query("SELECT last_value::text,is_called FROM business_document_number")).rows[0]).toEqual({last_value:'1234567',is_called:true});
    expect((await target.query("SELECT nextval('business_document_number')::text AS next")).rows[0].next).toBe('1234568');
    expect((await target.query('SELECT count(*)::int AS count FROM session')).rows[0].count).toBe(0);
    expect((await target.query('SELECT id,builtin_key FROM record_categories ORDER BY id')).rows).toEqual(await source.query('SELECT id,builtin_key FROM record_categories ORDER BY id'));
    expect((await target.query('SELECT access_revision FROM workspaces WHERE id=$1',[workspace])).rows).toEqual(await source.query('SELECT access_revision FROM workspaces WHERE id=$1',[workspace]));
    expect((await target.query("SELECT count(*)::int AS count FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='D'")).rows[0].count).toBe(0);
    const newWorkspace=randomUUID();await target.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[newWorkspace,'After restore trigger verification']);await target.query('INSERT INTO companies(workspace_id) VALUES($1)',[newWorkspace]);expect((await target.query('SELECT count(*)::int AS count FROM record_categories WHERE workspace_id=$1',[newWorkspace])).rows[0].count).toBe(7);
  }finally{await target.end();}
  for(const key of keys)expect(await readFile(join(root,'restored-files',key))).toEqual(await readFile(join(filesDir,key)));
},30000);
it('refuses restoration into the source database even when the URL text differs',async()=>{
  const alias=new URL(urls[0]);alias.searchParams.set('application_name','alternate-text');await expect(backupModule.restore(backupDir,alias.toString(),join(root,'alias-files'))).rejects.toThrow('separate empty database');
});
it('rolls back copied files on a later file collision and succeeds when retried after the collision is corrected',async()=>{
  const destination=join(root,'retry-files'),collision=join(destination,keys[1]);await mkdir(join(destination,workspace),{recursive:true});await writeFile(collision,'Preexisting unrelated content');
  await expect(backupModule.restore(backupDir,urls[2],destination)).rejects.toThrow('Existing restore attachment differs');
  await expect(access(join(destination,keys[0]))).rejects.toThrow();expect(await readFile(collision,'utf8')).toBe('Preexisting unrelated content');
  const target=new Pool({connectionString:urls[2]});try{expect((await target.query('SELECT count(*)::int AS count FROM workspaces')).rows[0].count).toBe(0);expect((await target.query('SELECT last_value::text,is_called FROM business_document_number')).rows[0]).toEqual({last_value:'1',is_called:false});}finally{await target.end();}
  await unlink(collision);expect((await backupModule.restore(backupDir,urls[2],destination)).attachments).toBe(2);
},30000);
it('rejects modified database payloads before any restoration',async()=>{
  const tampered=join(root,'tampered');await cp(backupDir,tampered,{recursive:true});await writeFile(join(tampered,'database.json'),'{}');await expect(backupModule.restore(tampered,urls[1],join(root,'tampered-files'))).rejects.toThrow('Database checksum mismatch');
});
it('refuses an incomplete table inventory even when a manifest hash is recomputed',async()=>{
  const incomplete=join(root,'incomplete');await cp(backupDir,incomplete,{recursive:true});const tables=JSON.parse(await readFile(join(incomplete,'database.json'),'utf8'));delete tables.contacts;const text=JSON.stringify(tables);await writeFile(join(incomplete,'database.json'),text);await writeFile(join(incomplete,'manifest.json'),JSON.stringify({...manifest,databaseHash:createHash('sha256').update(text).digest('hex')}));
  await expect(backupModule.restore(incomplete,urls[1],join(root,'incomplete-files'))).rejects.toThrow('Backup table inventory mismatch');
});
it('does not overwrite a prior backup artifact',async()=>{await expect(backupModule.backup(backupDir)).rejects.toThrow('Backup destination must be empty');});

