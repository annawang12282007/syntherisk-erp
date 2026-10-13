import 'dotenv/config';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
// Disposable, loopback-only fixture. These three credentials never apply to
// the configured company database; runtime.json is private and not packaged.
const name=`syntherisk_final_acceptance_${randomUUID().replaceAll('-','')}`,admin=new Pool({connectionString:process.env.DATABASE_URL});
await admin.query(`CREATE DATABASE "${name}"`);
const url=new URL(process.env.DATABASE_URL!);url.pathname='/'+name;
Object.assign(process.env,{DATABASE_URL:url.toString(),APP_URL:'http://127.0.0.1:3016',PORT:'3016',HOSTNAME:'127.0.0.1',NODE_ENV:'production',BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',GOOGLE_LOGIN_ENABLED:'false',SMTP_HOST:'',SMTP_FROM:'',SMTP_USER:'',SMTP_PASSWORD:'',S3_BUCKET:'',AUTH_REQUIRE_EMAIL_VERIFICATION:'false',AUTH_MAIL_MODE:'file-test',AUTH_MAIL_DIR:resolve('work/final-acceptance/mail'),ATTACHMENT_DIR:resolve('work/final-acceptance/attachments')});
async function command(args:string[]){await new Promise<void>((done,fail)=>{const c=spawn(process.execPath,args,{env:process.env,windowsHide:true,stdio:'ignore'});c.on('error',fail);c.on('exit',n=>n===0?done():fail(Error(`Setup command failed: ${n}`)));});}
await command(['node_modules/prisma/build/index.js','migrate','deploy']);
const {bootstrap}=await import('../src/lib/identity');const {auth}=await import('../src/lib/auth');const db=await import('../src/lib/db');const domain=await import('../src/domain/service');
const password=randomBytes(24).toString('base64url');
const base=await bootstrap({name:'驗收管理員',email:'admin@acceptance.invalid',password,workspace:'隔離驗收工作區'});
const ctx={...base,roles:['admin']};await db.query('UPDATE memberships SET roles=$2 WHERE user_id=$1',[ctx.userId,ctx.roles]);
const people:Record<string,typeof ctx>={admin:ctx};
for(const [key,label,roles] of [['operations','驗收營運者',['operations','finance','reviewer','member']],['member','驗收成員',['member']]] as const){
 const user=(await auth.api.signUpEmail({body:{name:label,email:`${key}@acceptance.invalid`,password}})).user;
 await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[ctx.workspaceId,user.id,roles]);people[key]={...ctx,userId:user.id,roles:[...roles]};
}
await db.query('UPDATE workspaces SET operational_owner_user_id=$2 WHERE id=$1',[ctx.workspaceId,people.operations.userId]);
const project=await domain.create(people.operations,'projects',{name:'驗收專案甲'});await domain.create(people.operations,'projects',{name:'驗收專案乙'});
const task=await domain.create(people.operations,'tasks',{title:'驗收搜尋任務',project_id:project.id,responsible_user_ids:[people.operations.userId,people.member.userId]});
await domain.create(people.member,'contacts',{name:'驗收私人聯絡人',is_private:true});
const delegation=await domain.create(people.operations,'delegations',{title:'驗收交辦資料整理',assignee_id:people.member.userId,target_resource:'tasks',target_id:task.id,access_level:'edit',review_required:true,instructions:'請整理資料後回報，這是隔離測試。'});
const doc=await domain.create(people.operations,'documents',{title:'驗收簽署紀錄',content:'這是測試紀錄，沒有真實授權或法律承諾。'});
const signatures=await import('../src/domain/signature-requests');await signatures.mutateSignatureRequests(people.operations,{action:'configure',resource:'documents',record_id:doc.id,version:doc.version,configuration_version:0,enabled:true,parties:[{kind:'internal',user_id:people.member.userId,label:'確認測試資料'}]});await signatures.mutateSignatureRequests(people.operations,{action:'issue',resource:'documents',record_id:doc.id,version:doc.version,configuration_version:1});
// Deliberate synthetic fixtures, no production seed and no Google credentials.
const {saveCompanyInformation}=await import('../src/lib/company-information');
await saveCompanyInformation(ctx,{version:0,fields:{name:'隔離驗收公司',tax_information:'合成稅務資料：僅管理員',mail_header:'Syntherisk ERP TEST ONLY'},policy:{name:{read_roles:['operations','member']},mail_header:{read_roles:['operations','member']}}});
const {saveBoard,saveBoardPost}=await import('../src/lib/team-boards');
const board=await saveBoard(people.operations,{name:'驗收私人協作團隊',description:'合成備忘，非成員不可見',members:[{user_id:people.operations.userId,role:'manager',can_post:true},{user_id:people.member.userId,role:'member',can_post:false}]});
await saveBoardPost(people.operations,{team_id:board.id,title:'驗收釘選備忘',body:'成員先檢閱，待營運者授予發言權後回應。',pinned:true});
const connectionId=randomUUID();await db.query("INSERT INTO integration_connections(id,workspace_id,user_id,provider,status) VALUES($1,$2,$3,'gmail','disconnected')",[connectionId,ctx.workspaceId,people.operations.userId]);
const sources=[];for(let n=1;n<=2;n++){const id=randomUUID();await db.query("INSERT INTO integration_items(id,workspace_id,connection_id,user_id,kind,external_id,fingerprint,data) VALUES($1,$2,$3,$4,'gmail_message',$5,'controlled-fixture',$6)",[id,ctx.workspaceId,connectionId,people.operations.userId,`controlled-mail-${n}`,JSON.stringify({id:`controlled-mail-${n}`,subject:`驗收共享郵件 ${n}`,from:'synthetic@acceptance.invalid',text:'受控合成郵件快照；不是真實 Google 郵件。'})]);sources.push(id);}
for(const source of sources){const [item]=await db.query('SELECT data FROM integration_items WHERE id=$1',[source]);const content:Record<string,unknown>={...(item.data as Record<string,unknown>),html:'<p>受控合成郵件 <a href="https://example.invalid">公司網站</a></p><p>供隔離瀏覽器驗收，沒有連線 Google。</p>'};const [shared]=await db.query("INSERT INTO shared_external_items(workspace_id,company_id,owner_id,source_item_id,provider,title,snapshot,category) VALUES($1,$2,$3,$4,'gmail',$5,$6,'隔離驗收') RETURNING id",[ctx.workspaceId,ctx.companyId,people.operations.userId,source,content.subject,JSON.stringify(content)]);await db.query('INSERT INTO external_item_audience(item_id,user_id,can_comment) VALUES($1,$2,true)',[shared.id,people.member.userId]);await db.query("INSERT INTO shared_mail_attachments(item_id,source_key,filename,mime_type,content,sha256,byte_size) VALUES($1,'fixture-attachment','TEST-ONLY.txt','text/plain',$2,'controlled-fixture',$3)",[shared.id,Buffer.from('Syntherisk ERP TEST ONLY attachment'),Buffer.byteLength('Syntherisk ERP TEST ONLY attachment')]);}
 const itJob=(await db.query("SELECT j.id FROM department_jobs j JOIN departments d ON d.id=j.department_id WHERE d.workspace_id=$1 AND d.prefix='IT' AND j.name='一般員工'",[ctx.workspaceId]))[0];await db.query('INSERT INTO employee_assignments(workspace_id,user_id,job_id) VALUES($1,$2,$3)',[ctx.workspaceId,people.member.userId,itJob.id]);
 const {saveMailIdentity}=await import('../src/lib/mail-identities');await saveMailIdentity(people.operations,{action:'save',label:'Business',display_name:'TEST Operations Business',signature:'Regards, {{user_name}} · {{user_employee_id}}'});
 await saveMailIdentity(people.operations,{action:'save',label:'Research',display_name:'TEST Operations Research',signature:'Research team'});

// Disposable retention and offline cloud-library fixtures for browser acceptance.
const {retentionAction}=await import('../src/domain/retention');
const retentionRecords=[];
for(const tier of ['owner','authorized','approval','archive_only','locked']){
 const record=await domain.create(people.member,'contacts',{name:'封存驗收－'+tier});
 await retentionAction(ctx,{action:'policy',resource:'contacts',id:record.id,version:0,tier});retentionRecords.push(record);
}
const {savePermissionPolicy}=await import('../src/lib/permission-policies');
await savePermissionPolicy(ctx,{role_code:'member',resource:'contacts',operations:['delete'],scopes:['created']});
const {saveSignatureProfile}=await import('../src/lib/signature-profile');
await saveSignatureProfile(people.member,{mode:'generated',version:0,signature_text:'TEST FIRST',label:'可丟棄簽名甲'});
await saveSignatureProfile(people.member,{mode:'generated',version:1,signature_text:'TEST SECOND',label:'可丟棄簽名乙'});
const offlineDrive=randomUUID(),savedFile=randomUUID();
await db.query("INSERT INTO integration_connections(id,workspace_id,user_id,provider,status) VALUES($1,$2,$3,'drive','disconnected')",[offlineDrive,ctx.workspaceId,people.member.userId]);
await db.query("INSERT INTO integration_items(id,workspace_id,connection_id,user_id,kind,external_id,fingerprint,data) VALUES($1,$2,$3,$4,'drive_file','controlled-bookmark','controlled-fixture',$5)",[savedFile,ctx.workspaceId,offlineDrive,people.member.userId,JSON.stringify({name:'可移除的合成雲端保留項目',mimeType:'application/pdf'})]);
await db.query("INSERT INTO cloud_file_library(item_id,notes) VALUES($1,'離線清單測試，不連線 Google。')",[savedFile]);


// Private saved SENT fixtures exercise the mail UI without any Google response.
await db.query("UPDATE integration_connections SET status='pending',google_email='operations@acceptance.invalid' WHERE id=$1",[connectionId]);
await db.query("UPDATE integration_items SET data=data||$1::jsonb WHERE connection_id=$2",[JSON.stringify({labels:['SENT'],internal_date:String(Date.now()),date:new Date().toISOString(),to:'member@acceptance.invalid'}),connectionId]);
const mailContact=await domain.create(people.operations,'contacts',{name:'驗收郵件聯絡人',email:'member@acceptance.invalid'});
const mailGroup=await domain.create(people.operations,'audience_groups',{name:'驗收郵件分組'});
await domain.create(people.operations,'audience_members',{group_id:mailGroup.id,contact_id:mailContact.id});
await domain.create(people.operations,'communication_templates',{name:'驗收企業格式模板',subject:'Syntherisk ERP TEST ONLY 格式驗收',body:'## 專案進度\n**重點** 與 [公司連結](https://example.invalid)\n- 第一項\n- 第二項',body_format:'formatted',mail_header:'Syntherisk ERP TEST ONLY',mail_signature:'{{user_signature}}\n{{user_name}} · {{user_mail}} · {{user_employee_id}}',mail_footer:'僅供隔離驗收，不寄送郵件。',accent_color:'#2e7c80'});

await mkdir('work/final-acceptance',{recursive:true});await writeFile('work/final-acceptance/runtime.json',JSON.stringify({database:name,url:url.toString(),origin:process.env.APP_URL,password,people,records:{task,delegation,doc,retentionRecords}},null,2),{mode:0o600});
await db.pool.end();
const app=spawn(process.execPath,['scripts/start.mjs'],{env:process.env,windowsHide:true,stdio:['ignore','inherit','inherit']});
console.log('Isolated acceptance server starting at http://127.0.0.1:3016 (admin, operations, member @acceptance.invalid)');
let stopping=false;async function stop(){if(stopping)return;stopping=true;if(app.exitCode===null&&app.signalCode===null)await new Promise<void>(done=>{app.once('exit',()=>done());app.kill('SIGTERM');});if(!/^syntherisk_final_acceptance_[a-f0-9]{32}$/.test(name))throw Error('Unsafe fixture database name');await admin.query(`DROP DATABASE IF EXISTS "${name}"`);await admin.end();process.exit(0);}process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());app.on('exit',()=>void stop());
