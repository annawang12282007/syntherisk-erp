import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {beforeAll,afterAll,expect,it} from 'vitest';
import type {Context} from '../src/lib/context';
import type {Row} from '../src/domain/core';

let db:typeof import('../src/lib/db'),service:typeof import('../src/domain/service'),admin:Pool,ctx:Context;
const originalUrl=process.env.DATABASE_URL,databaseName=`syntherisk_list_order_test_${randomUUID().replaceAll('-','')}`,tasks:Row[]=[];
beforeAll(async()=>{
 if(!originalUrl)throw new Error('DATABASE_URL required');
 admin=new Pool({connectionString:originalUrl});await admin.query(`CREATE DATABASE "${databaseName}"`);
 const url=new URL(originalUrl);url.pathname=`/${databaseName}`;process.env.DATABASE_URL=url.toString();
 db=await import('../src/lib/db');service=await import('../src/domain/service');
 const root=join(process.cwd(),'prisma','migrations');
 for(const entry of(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join(root,entry.name,'migration.sql'),'utf8'));
 ctx={workspaceId:randomUUID(),companyId:randomUUID(),userId:randomUUID(),roles:['admin','operations']};
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[ctx.workspaceId,'Isolated sorting regression']);
 await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3)',[ctx.companyId,ctx.workspaceId,'Sorting fixture']);
 await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[ctx.userId,'Sorting member',`${ctx.userId}@example.invalid`]);
 await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[ctx.workspaceId,ctx.userId,ctx.roles]);
 // Insert out of priority order, with duplicates and blanks spanning pages.
 for(const [index,priority] of ['normal','urgent',null,'high','low','high',null].entries()){
  const row=await service.create(ctx,'tasks',{title:`Sorting ${String.fromCharCode(71-index)}`,priority,due_date:index<5?`2026-10-${String(index+12).padStart(2,'0')}`:null});
  await db.query('UPDATE tasks SET updated_at=$2,created_at=$2 WHERE id=$1',[row.id,`2026-10-${String(index+1).padStart(2,'0')}T12:00:00Z`]);tasks.push(row);
 }
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=originalUrl;if(admin){await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}});

const ids=(rows:Row[])=>rows.map(row=>String(row.id));
async function allPages(sort:string,order:string){
 const rows:Row[]=[];
 for(let page=1;page<=4;page++){
  const result=await service.list(ctx,'tasks',{sort,order,page,pageSize:2});
  expect(result).toMatchObject({total:tasks.length,page,pageSize:2});rows.push(...result.rows);
 }
 expect(new Set(ids(rows)).size).toBe(tasks.length);return rows;
}

it.each(['asc','desc'])('sorts the full task priority scale %s before pagination, with stable ties and blank priorities last',async order=>{
 const priorities=order==='asc'?['low','normal','high','urgent',null]:['urgent','high','normal','low',null];
 const expected=priorities.flatMap(priority=>tasks.filter(task=>task.priority===priority).sort((a,b)=>String(a.id).localeCompare(String(b.id))));
 const actual=await allPages('priority',order);
 expect(ids(actual)).toEqual(ids(expected));expect(ids(await allPages('priority',order))).toEqual(ids(actual));
});

it.each(['asc','desc'])('keeps ordinary dates chronological %s and missing dates last',async order=>{
 const dated=tasks.filter(task=>task.due_date).sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date))*(order==='asc'?1:-1));
 const blank=tasks.filter(task=>!task.due_date).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 expect(ids(await allPages('due_date',order))).toEqual(ids([...dated,...blank]));
});

it('preserves ordinary title ordering and safely falls back for invalid or derived columns',async()=>{
 for(const order of ['asc','desc']){
  const expected=[...tasks].sort((a,b)=>String(a.title).localeCompare(String(b.title))*(order==='asc'?1:-1));
  expect(ids(await allPages('title',order))).toEqual(ids(expected));
 }
 for(const sort of ['priority; DROP TABLE tasks; --','blocked_by_dependencies'])expect(ids(await allPages(sort,'asc'))).toEqual(ids(tasks));
 expect(ids(await allPages('updated_at','DESC NULLS FIRST; --'))).toEqual(ids([...tasks].reverse()));
});
