import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import type {Context} from '../src/lib/context';
import {readWorkbook} from './export-readers';

let db:typeof import('../src/lib/db'),io:typeof import('../src/lib/io'),printing:typeof import('../src/lib/print'),table:typeof import('../src/lib/record-print'),reports:typeof import('../src/lib/analytics-export'),admin:Pool;
const originalUrl=process.env.DATABASE_URL,databaseName=`syntherisk_export_test_${randomUUID().replaceAll('-','')}`,workspaceId=randomUUID(),companyId=randomUUID(),userId=randomUUID(),other=randomUUID(),documentId=randomUUID();
const ctx:Context={workspaceId,companyId,userId,roles:['admin']};
beforeAll(async()=>{
 if(!originalUrl)throw Error('DATABASE_URL required');admin=new Pool({connectionString:originalUrl});await admin.query(`CREATE DATABASE "${databaseName}"`);const url=new URL(originalUrl);url.pathname='/'+databaseName;process.env.DATABASE_URL=url.toString();
 db=await import('../src/lib/db');io=await import('../src/lib/io');printing=await import('../src/lib/print');table=await import('../src/lib/record-print');reports=await import('../src/lib/analytics-export');
 const root=join(process.cwd(),'prisma','migrations');for(const entry of(await readdir(root,{withFileTypes:true})).filter(item=>item.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join(root,entry.name,'migration.sql'),'utf8'));
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'Isolated export fixture']);await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3)',[companyId,workspaceId,'Export fixture']);
 for(const [id,name] of [[userId,'Primary responsible'],[other,'Joint responsible']]){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[id,name,`${id}@example.invalid`]);await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[workspaceId,id,['admin']]);}
 await db.query("INSERT INTO contacts(workspace_id,company_id,created_by,updated_by,owner_id,name,email) SELECT $1,$2,$3,$3,$3,'Export fixture '||g,'fixture-'||g||'@example.invalid' FROM generate_series(1,205)g",[workspaceId,companyId,userId]);
 await db.query("INSERT INTO contacts(workspace_id,company_id,created_by,updated_by,owner_id,name) VALUES($1,$2,$3,$3,$3,'Other scope')",[workspaceId,companyId,other]);
 await db.query('INSERT INTO documents(id,workspace_id,company_id,created_by,updated_by,owner_id,title,content) VALUES($1,$2,$3,$4,$4,$4,$5,$6)',[documentId,workspaceId,companyId,userId,'Preserved document','Start marker\n'+Array.from({length:100},(_,i)=>`Paragraph ${i}: readable content`).join('\n')+'\nEnd marker <script>unsafe</script>']);
 await db.query("INSERT INTO record_responsibles(workspace_id,company_id,resource,record_id,user_id,created_by) VALUES($1,$2,'documents',$3,$4,$5)",[workspaceId,companyId,documentId,other,userId]);
 await db.query('INSERT INTO user_preferences(workspace_id,user_id,settings) VALUES($1,$2,$3)',[workspaceId,userId,JSON.stringify({locale:'en'})]);
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=originalUrl;if(admin){await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}});
describe('isolated export and print access/format regression',()=>{
 it('keeps formatted content in print and structured export, while tabular exports remain readable',async()=>{
  const {richTextValue}=await import('../src/lib/rich-text'),richId=randomUUID();
  const content=richTextValue('<p><b>Purpose</b> <span style="font-size:24px;color:#aa2244">Research</span></p><img alt="Example" src="data:image/png;base64,aGVsbG8=" width="240">');
  await db.query('INSERT INTO documents(id,workspace_id,company_id,created_by,updated_by,owner_id,title,content) VALUES($1,$2,$3,$4,$4,$4,$5,$6)',[richId,workspaceId,companyId,userId,'Rich export fixture',content]);
  const html=await(await printing.printRecord(ctx,'documents',richId)).text();expect(html).toContain('<b>Purpose</b>');expect(html).toContain('font-size:24px');expect(html).toContain('width="240"');expect(html).not.toContain('&lt;!--syntherisk-rich');
  const csv=await io.exportRecords(ctx,'documents',{columns:'title,content',q:'Rich export fixture'},'csv');expect(csv.content).toContain('Purpose Research');expect(csv.content).not.toContain('syntherisk-rich');expect(csv.content).not.toContain('data:image');
  const json=JSON.parse((await io.exportRecords(ctx,'documents',{columns:'title,content',q:'Rich export fixture'},'json')).content);expect(json.records[0].content).toBe(content);
 });
 it('exports all filtered pages with selected safe columns and scope intersection in each format',async()=>{
  const policy:Context={...ctx,permissions:[{resource:'contacts',operation:'read',scope:'all'},{resource:'contacts',operation:'export',scope:'own'}]};
  const json=JSON.parse((await io.exportRecords(policy,'contacts',{columns:'name,email',q:'Export fixture',page:'9',pageSize:'1'},'json')).content);expect(json.records).toHaveLength(205);expect(Object.keys(json.records[0])).toEqual(['name','email']);expect(JSON.stringify(json)).not.toContain('created_by');
  const excel=await io.exportRecords(policy,'contacts',{columns:'name,email',q:'Export fixture 205'},'xlsx');expect(excel.extension).toBe('xlsx');expect(readWorkbook(Buffer.from(excel.bytes!)).sheets.contacts.values).toEqual([['name','email'],['Export fixture 205','fixture-205@example.invalid']]);
  const csv=await io.exportRecords(policy,'contacts',{columns:'name',q:'Export fixture 205'},'csv');expect(csv.content).toBe('\uFEFFname\nExport fixture 205\n');
 });
 it('rejects unknown fields/formats and honors denied export/read scope for every output',async()=>{
  for(const format of ['csv','json','xlsx'])await expect(io.exportRecords({...ctx,permissions:[{resource:'contacts',operation:'export',scope:'none'}]},'contacts',{},format)).rejects.toMatchObject({status:403});
  await expect(io.exportRecords(ctx,'contacts',{columns:'name,password'},'json')).rejects.toMatchObject({code:'INVALID_EXPORT_COLUMNS'});await expect(io.exportRecords(ctx,'contacts',{},'pdf')).rejects.toMatchObject({code:'EXPORT_FORMAT_UNAVAILABLE'});
  const empty=JSON.parse((await io.exportRecords({...ctx,permissions:[{resource:'contacts',operation:'read',scope:'none'}]},'contacts',{},'json')).content);expect(empty.records).toEqual([]);
 });
 it('prints generic long records with safe escaped content, all responsibles and no administrative fields',async()=>{
  const response=await printing.printRecord(ctx,'documents',documentId),html=await response.text();expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(html).toContain('Primary responsible、Joint responsible');expect(html).toContain('End marker &lt;script&gt;unsafe&lt;/script&gt;');expect(html).not.toContain('<script>unsafe</script>');expect(html).not.toContain('created_by');expect(html).toContain('Classification &amp; links');expect(html).toContain('Return to records');expect(html).toContain(`/data/documents?record=${documentId}`);
 });
 it('rejects direct print without read/export scope and prints only filtered selected table columns',async()=>{
  await expect(printing.printRecord({...ctx,permissions:[{resource:'documents',operation:'export',scope:'none'}]},'documents',documentId)).rejects.toMatchObject({status:403});
  await expect(printing.printRecord({...ctx,roles:['external'],userId:randomUUID()},'documents',documentId)).rejects.toMatchObject({status:404});
  const html=await(await table.printTable(ctx,'contacts',{columns:'name',q:'Export fixture 205'})).text();expect(html).toContain('Export fixture 205');expect(html).not.toContain('fixture-205@example.invalid');expect(html).not.toContain('Other scope');
 });
 it('keeps analytics export authorization and financial role restrictions for XLSX and JSON',async()=>{
  await expect(reports.exportAnalytics({...ctx,permissions:[{resource:'analytics',operation:'export',scope:'none'}]},{format:'xlsx'})).rejects.toMatchObject({status:403});
  const member={...ctx,roles:['member']};const json=await(await reports.exportAnalytics(member,{format:'json'})).json();expect(json.finance).toBeNull();
  const workbook=readWorkbook(Buffer.from(await(await reports.exportAnalytics(member,{format:'xlsx'})).arrayBuffer()));expect(JSON.stringify(workbook)).not.toContain('finance.ledger');expect(workbook.names).toContain('Index');
 });
 it('exports financial exact minor units, currency scale and all responsible names, while keeping itemized print totals correct',async()=>{
  const quoteId=randomUUID(),exact='9007199254740993123';
  await db.query("INSERT INTO customer_quotes(id,workspace_id,company_id,created_by,updated_by,owner_id,title,currency,total_minor) VALUES($1,$2,$3,$4,$4,$4,'Exact financial document','USD',$5)",[quoteId,workspaceId,companyId,userId,exact]);
  await db.query("INSERT INTO quote_lines(workspace_id,company_id,created_by,updated_by,owner_id,quote_id,description,quantity,unit_price_minor,tax_minor) VALUES($1,$2,$3,$3,$3,$4,'Exact line',1,$5,0)",[workspaceId,companyId,userId,quoteId,exact]);
  await db.query("INSERT INTO record_responsibles(workspace_id,company_id,resource,record_id,user_id,created_by) VALUES($1,$2,'customer_quotes',$3,$4,$5)",[workspaceId,companyId,quoteId,other,userId]);
  const filters={columns:'title,total_minor,owner_id',q:'Exact financial document'};
  const json=JSON.parse((await io.exportRecords(ctx,'customer_quotes',filters,'json')).content);expect(json.records[0].total_minor).toBe(exact);expect(json.records[0].currency).toBe('USD');expect(json.records[0].currency_minor_digits).toBe(2);expect(json.records[0].responsible_names.sort()).toEqual(['Joint responsible','Primary responsible']);
  const excel=readWorkbook(Buffer.from((await io.exportRecords(ctx,'customer_quotes',filters,'xlsx')).bytes!));const sheet=excel.sheets.customer_quotes,headers=sheet.values[0];expect(sheet.values[1][headers.indexOf('total_minor')]).toBe(exact);expect(sheet.values[1][headers.indexOf('responsible_names')]).toContain('Joint responsible');
  const html=await(await printing.printRecord(ctx,'customer_quotes',quoteId)).text();expect(html).toContain('90,071,992,547,409,931.23');expect(html).toContain('Joint responsible');expect(html).toContain('Exact line');
 });
});
