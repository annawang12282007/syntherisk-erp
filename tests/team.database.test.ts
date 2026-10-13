import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import type {Context} from '../src/lib/context';
let db:typeof import('../src/lib/db'),team:typeof import('../src/lib/team'),admin:Pool;
const originalUrl=process.env.DATABASE_URL,databaseName=`syntherisk_team_test_${randomUUID().replaceAll('-','')}`;
const workspaceId=randomUUID(),companyId=randomUUID(),foreignWorkspace=randomUUID();
const users={admin:randomUUID(),member:randomUUID(),other:randomUUID(),finance:randomUUID(),external:randomUUID(),foreign:randomUUID()};
const context=(who:keyof typeof users,roles:string[]=['member']):Context=>({workspaceId,companyId,userId:users[who],roles});
const manager=context('admin',['admin']),member=context('member'),other=context('other'),finance=context('finance',['finance']);
beforeAll(async()=>{
 if(!originalUrl)throw new Error('DATABASE_URL required');admin=new Pool({connectionString:originalUrl});await admin.query(`CREATE DATABASE "${databaseName}"`);const url=new URL(originalUrl);url.pathname=`/${databaseName}`;process.env.DATABASE_URL=url.toString();db=await import('../src/lib/db');team=await import('../src/lib/team');
 const root=join(process.cwd(),'prisma','migrations');for(const entry of(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.query(await readFile(join(root,entry.name,'migration.sql'),'utf8'));
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2),($3,$4)',[workspaceId,'Isolated team',foreignWorkspace,'Foreign team']);await db.query('INSERT INTO companies(id,workspace_id,name) VALUES($1,$2,$3)',[companyId,workspaceId,'Team fixture']);
 for(const [name,id]of Object.entries(users)){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[id,`Team ${name}`,`${id}@example.invalid`]);await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[name==='foreign'?foreignWorkspace:workspaceId,id,[name==='admin'?'admin':name==='finance'?'finance':name==='external'?'external':'member']]);}
},60000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=originalUrl;if(admin){await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);await admin.end();}});
it('lists active internal accounts without invented profiles or private fields of colleagues',async()=>{
 const list=await team.teamDirectory(member);expect(list.members).toHaveLength(4);expect(list.members.map(row=>row.user_id)).toContain(users.member);expect(list.members.find(row=>row.user_id===users.other)).toMatchObject({profile_version:0,can_edit:false,can_view_private:false});expect(list.members.find(row=>row.user_id===users.other)).not.toHaveProperty('birthday');
 await expect(team.teamDirectory(context('external',['external']))).rejects.toMatchObject({status:403});
});
it('saves self contact and private details with version control and privacy-safe audit',async()=>{
 const saved=await team.updateTeamProfile(member,{user_id:users.member,version:0,personal_email:'self@example.invalid',work_phone:'555-0100',birthday:'2000-02-29',address:'Synthetic test address'});expect(saved).toMatchObject({profile_version:1,personal_email:'self@example.invalid',birthday:'2000-02-29'});
 await expect(team.updateTeamProfile(member,{user_id:users.member,version:0,address:'stale'})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 const colleague=(await team.teamDirectory(other)).members.find(row=>row.user_id===users.member);expect(colleague).toMatchObject({work_phone:'555-0100'});expect(colleague).not.toHaveProperty('personal_email');expect(colleague).not.toHaveProperty('address');expect(colleague).not.toHaveProperty('birthday');
 const audit=await db.query("SELECT after_data FROM audit_log WHERE resource='team_profiles'");expect(JSON.stringify(audit)).not.toContain('Synthetic test address');expect(JSON.stringify(audit)).not.toContain('2000-02-29');expect(JSON.stringify(audit)).toContain('changed_fields');
});
it('managers access private data and explicit scope policies limit each operation independently',async()=>{
 expect((await team.teamDirectory(manager)).members.find(row=>row.user_id===users.member)).toMatchObject({birthday:'2000-02-29',can_edit_private:true});
 await expect(team.updateTeamProfile(finance,{user_id:users.member,version:1,address:'Forbidden'})).rejects.toMatchObject({status:403});
 const financeRead:Context={...finance,permissions:[{resource:'team_private',operation:'read',scope:'all'}]};const allowed=(await team.teamDirectory(financeRead)).members.find(row=>row.user_id===users.member);expect(allowed).toMatchObject({birthday:'2000-02-29',can_edit_private:false});
 await expect(team.updateTeamProfile(financeRead,{user_id:users.member,version:1,address:'Forbidden'})).rejects.toMatchObject({status:403});
 const granted:Context={...finance,permissions:[{resource:'team_private',operation:'read',scope:'all'},{resource:'team_private',operation:'edit',scope:'all'}]};expect(await team.updateTeamProfile(granted,{user_id:users.member,version:1,address:'Updated synthetic address'})).toMatchObject({profile_version:2,address:'Updated synthetic address'});
 const ownOnly={...manager,permissions:[{resource:'team_private',operation:'read',scope:'own'}]};expect((await team.teamDirectory(ownOnly)).members.find(row=>row.user_id===users.member)).not.toHaveProperty('address');
 await expect(team.teamDirectory({...manager,permissions:[{resource:'team_directory',operation:'read',scope:'none'}]})).rejects.toMatchObject({status:403});
});
it('rejects foreign, inactive, malformed and unrecognized edits without writing',async()=>{
 await expect(team.updateTeamProfile(manager,{user_id:users.foreign,version:0,work_phone:'555'})).rejects.toMatchObject({status:404});
 await db.query("UPDATE memberships SET status='disabled' WHERE user_id=$1",[users.other]);await expect(team.updateTeamProfile(manager,{user_id:users.other,version:0,work_phone:'555'})).rejects.toMatchObject({status:404});
 expect((await team.teamDirectory(manager)).members.map(row=>row.user_id)).not.toContain(users.other);
 await expect(team.updateTeamProfile(member,{user_id:users.member,version:2,birthday:'2001-02-29'})).rejects.toThrow();await expect(team.updateTeamProfile(member,{user_id:users.member,version:2,roles:['admin']})).rejects.toThrow();
});
it('changes only the authenticated account name and rejects empty names',async()=>{
 const result=await team.updateAccountName(member,{name:'  Renamed member  ',user_id:users.admin});expect(result).toMatchObject({user:{id:users.member,name:'Renamed member'}});expect((await db.query('SELECT name FROM "user" WHERE id=$1',[users.admin]))[0].name).toBe('Team admin');await expect(team.updateAccountName(member,{name:' '})).rejects.toThrow();
});

it('protects company fields independently and prevents a second administrator bypass',async()=>{
 const company=await import('../src/lib/company-information');
 await db.query('UPDATE workspaces SET initial_admin_user_id=$2,operational_owner_user_id=$3 WHERE id=$1',[workspaceId,users.admin,users.member]);
 const current=await company.companyInformation(manager);expect(current.can_manage_access).toBe(true);
 expect((await company.companyInformation(member)).fields).toEqual([]);
 const saved=await company.saveCompanyInformation(manager,{version:0,fields:{incorporation_date:'2026-10-07',shareholders:'Synthetic protected shareholder'},policy:{incorporation_date:{read_users:[users.member]},shareholders:{edit_users:[users.finance]}}});
 expect((await company.companyInformation(member)).fields.map(f=>f.key)).toEqual(['incorporation_date']);
 expect(JSON.stringify(await company.companyInformation({...other,roles:['admin']}))).not.toContain('Synthetic protected shareholder');
 await expect(company.saveCompanyInformation(member,{version:saved.version,fields:{shareholders:'bypass'}})).rejects.toMatchObject({status:403});
 await expect(company.saveCompanyInformation(finance,{version:saved.version,policy:{shareholders:{read_users:[users.member]}}})).rejects.toMatchObject({status:403});
 const updated=await company.saveCompanyInformation(finance,{version:saved.version,fields:{shareholders:'Allowed edit'}});expect(updated.fields[0]).toMatchObject({key:'shareholders',value:'Allowed edit'});
 expect((await team.teamDirectory(member)).members.some(m=>m.user_id===users.admin)).toBe(false);
});

it('enforces private team membership, posting rights, pins, versions and immediate revocation',async()=>{
 const boards=await import('../src/lib/team-boards');
 await db.query("UPDATE memberships SET status='active' WHERE user_id=$1",[users.other]);
 const creator={...member,roles:['operations']};
 const board=await boards.saveBoard(creator,{name:'Synthetic private board',members:[{user_id:users.member,role:'manager',can_post:true},{user_id:users.other,role:'member',can_post:false}]});
 expect((await boards.listBoards(manager)).teams).toEqual([]);await expect(boards.readBoard(manager,board.id)).rejects.toMatchObject({status:404});
 await expect(boards.saveBoardPost(other,{team_id:board.id,title:'No rights',body:'blocked'})).rejects.toMatchObject({status:403});
 const posted=await boards.saveBoardPost(creator,{team_id:board.id,title:'Memo',body:'Internal only',pinned:true});
 const post=posted.posts[0];await expect(boards.saveBoardPost(creator,{team_id:board.id,id:post.id,version:99,title:'Conflict',body:'No'})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 await boards.saveBoardPost(creator,{team_id:board.id,id:post.id,version:post.version,title:'Memo updated',body:'Updated internal only'});
 expect(await boards.boardHistory(other,board.id,post.id)).toHaveLength(2);
 await boards.saveBoard(creator,{id:board.id,version:board.version,name:'Synthetic private board',members:[{user_id:users.member,role:'manager',can_post:true}]});
 await expect(boards.boardHistory(other,board.id,post.id)).rejects.toMatchObject({status:404});expect((await boards.listBoards(other)).teams).toEqual([]);
});

it('excludes the initial administrator from assignments and defaults new work to the operator',async()=>{
 const service=await import('../src/domain/service');
 expect((await service.list(manager,'members',{})).rows.some(row=>row.id===users.admin)).toBe(false);
 await expect(service.create(manager,'tasks',{title:'Forbidden owner',owner_id:users.admin})).rejects.toMatchObject({code:'invalid_member'});
 const task=await service.create(manager,'tasks',{title:'Operational owner'});expect(task.owner_id).toBe(users.member);expect(task.created_by).toBe(users.admin);
});

it('deletes and restores team notes with author/manager access, version checks and a retained history',async()=>{
 const boards=await import('../src/lib/team-boards'),assistant=await import('../src/workspace-assistant/team-operations');
 const creator={...member,roles:['operations']};
 const board=await boards.saveBoard(creator,{name:'Deletion fixture',members:[{user_id:users.member,role:'manager',can_post:true},{user_id:users.other,role:'member',can_post:true},{user_id:users.finance,role:'member',can_post:false}]});
 const posted=await boards.saveBoardPost(other,{team_id:board.id,title:'Removable memo',body:'Retained history'});
 const note=posted.posts[0],input={team_id:board.id,id:note.id,version:note.version};
 await expect(boards.changeBoardPostDeletion(finance,input)).rejects.toMatchObject({status:403});
 await expect(boards.changeBoardPostDeletion(manager,input)).rejects.toMatchObject({status:404});
 await expect(boards.changeBoardPostDeletion(other,{...input,version:99})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 const deleted=await boards.changeBoardPostDeletion(other,input);expect(deleted.posts).toHaveLength(0);expect(deleted.deleted_posts).toHaveLength(1);
 await expect(boards.readBoardForPost(other,note.id)).rejects.toMatchObject({status:404});
 await expect(boards.saveBoardPost(other,{...input,version:deleted.deleted_posts[0].version,title:'Bypass',body:'No'})).rejects.toMatchObject({status:404});
 await expect(assistant.readAssistantTeam(other,'team_board_posts',note.id)).rejects.toMatchObject({status:404});
 expect((await assistant.listAssistantTeams(other,'team_board_posts',{team_id:board.id})).rows).toHaveLength(0);
 expect((await boards.readBoard(finance,board.id)).deleted_posts).toHaveLength(0);
 const restored=await boards.changeBoardPostDeletion(creator,{...input,version:deleted.deleted_posts[0].version},true);expect(restored.posts[0].body).toBe('Retained history');expect(restored.deleted_posts).toHaveLength(0);
 expect((await boards.boardHistory(other,board.id,note.id)).map(v=>v.version)).toEqual([3,2,1]);
 expect((await db.query("SELECT action FROM audit_log WHERE record_id=$1 ORDER BY created_at",[note.id])).map(v=>v.action)).toEqual(['create','delete','restore']);
 await boards.saveBoard(creator,{id:board.id,version:board.version,name:'Deletion fixture',members:[{user_id:users.member,role:'manager',can_post:true}]});
 await expect(boards.changeBoardPostDeletion(other,{...input,version:3})).rejects.toMatchObject({status:404});
});

it('provisions a team for an operational manager without exposing the root account or private board',async()=>{
 const boards=await import('../src/lib/team-boards');
 const result=await boards.saveBoard(manager,{name:'Provisioned board',members:[{user_id:users.member,role:'manager',can_post:true}]});
 expect(result).toMatchObject({provisioned:true});
 expect((await boards.listBoards(manager)).teams).toEqual([]);
 await expect(boards.readBoard(manager,String(result.id))).rejects.toMatchObject({status:404});
 expect((await boards.readBoard(member,String(result.id))).members.map((m:{user_id:string})=>m.user_id)).toEqual([users.member]);
 await expect(boards.saveBoard(manager,{name:'Root cannot join',members:[{user_id:users.admin,role:'manager',can_post:true}]})).rejects.toMatchObject({code:'invalid_member'});
});

it('shares only selected mail snapshots and enforces recipients, comments, teams, versions and revocation',async()=>{
 const shared=await import('../src/integrations/collaboration'),boards=await import('../src/lib/team-boards'),core=await import('../src/integrations/workspace-core');
 const sessionMock=vi.spyOn(core,'session').mockImplementation(async()=>({ctx:member,row:{provider:'gmail'},tokens:{},adapter:{request:async(pathOrTokens:unknown,path:string)=>path.includes('/attachments/')?{data:Buffer.from('Synthetic shared attachment').toString('base64url')}:{id:'synthetic-message',payload:{headers:[{name:'Subject',value:'Synthetic selected mail'}],mimeType:'multipart/mixed',parts:[{mimeType:'text/html',body:{data:Buffer.from('<p>Private synthetic <a href="https://company.example/help">Help</a></p>').toString('base64url')}},{partId:'1',filename:'test.txt',mimeType:'text/plain',body:{size:27,attachmentId:'test-attachment'}}]}}}} as unknown as Awaited<ReturnType<typeof core.session>>));
 const [connection]=await db.query("INSERT INTO integration_connections(workspace_id,user_id,provider,status) VALUES($1,$2,'gmail','connected') RETURNING id",[workspaceId,users.member]);
 const [source]=await db.query("INSERT INTO integration_items(workspace_id,connection_id,user_id,kind,external_id,fingerprint,data) VALUES($1,$2,$3,'gmail_message','synthetic-message','test',$4) RETURNING id",[workspaceId,connection.id,users.member,JSON.stringify({subject:'Synthetic selected mail',text:'Private synthetic message'})]);
 await expect(shared.shareSelected(manager,{item_ids:[source.id],user_ids:[users.other]})).rejects.toMatchObject({status:404});
 await expect(shared.shareSelected(member,{item_ids:[source.id],user_ids:[users.admin]})).rejects.toMatchObject({code:'invalid_member'});
 const [result]=await shared.shareSelected(member,{item_ids:[source.id],user_ids:[users.other],can_comment:false});
 expect((await shared.sharedList(other,'received','gmail'))).toHaveLength(1);
 const detail=await shared.sharedDetail(other,result.id),file=detail.attachments[0];expect(file.filename).toBe('test.txt');expect((detail.snapshot as Record<string,unknown>).html).toContain('target="_blank"');
 expect(await shared.sharedAction(other,{action:'attachment',id:result.id,attachment_id:file.id})).toMatchObject({filename:'test.txt',content_base64:Buffer.from('Synthetic shared attachment').toString('base64')});
 await expect(shared.sharedAction(manager,{action:'attachment',id:result.id,attachment_id:file.id})).rejects.toMatchObject({status:404});
 expect((await shared.sharedList(other,'received','cloud'))).toEqual([]);
 expect((await shared.sharedList(manager))).toEqual([]);
 await expect(shared.sharedDetail(manager,result.id)).rejects.toMatchObject({status:404});
 await expect(shared.sharedAction(other,{action:'comment',id:result.id,body:'Blocked'})).rejects.toMatchObject({status:403});
 await expect(shared.sharedAction(other,{action:'access',id:result.id,version:1,user_ids:[users.finance]})).rejects.toMatchObject({status:403});
 await shared.sharedAction(member,{action:'access',id:result.id,version:1,user_ids:[users.other],can_comment:true});
 await expect(shared.sharedAction(member,{action:'access',id:result.id,version:1,user_ids:[users.other]})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 await shared.sharedAction(other,{action:'comment',id:result.id,body:'Reviewed synthetic content'});
 expect((await shared.sharedDetail(other,result.id)).comments).toHaveLength(1);
 await shared.sharedAction(member,{action:'access',id:result.id,version:2,user_ids:[]});
 await expect(shared.sharedDetail(other,result.id)).rejects.toMatchObject({status:404});
 await expect(shared.sharedAction(other,{action:'attachment',id:result.id,attachment_id:file.id})).rejects.toMatchObject({status:404});
 const board=await boards.saveBoard({...member,roles:['operations']},{name:'Mail sharing team',members:[{user_id:users.member,role:'manager',can_post:true},{user_id:users.other,role:'member',can_post:true}]});
 await shared.sharedAction(member,{action:'access',id:result.id,version:3,team_ids:[String(board.id)]});
 expect(await shared.sharedDetail(other,result.id)).toMatchObject({title:'Synthetic selected mail'});
 await boards.saveBoard({...member,roles:['operations']},{id:board.id,version:board.version,name:'Mail sharing team',members:[{user_id:users.member,role:'manager',can_post:true}]});
 await expect(shared.sharedAction(other,{action:'history',id:result.id})).rejects.toMatchObject({status:404});
 await expect(shared.sharedAction(member,{action:'access',id:result.id,version:4,user_ids:[users.admin]})).rejects.toMatchObject({code:'invalid_member'});
 const {richTextValue}=await import('../src/lib/rich-text');
 await shared.sharedAction(member,{action:'access',id:result.id,version:4,user_ids:[users.other],can_comment:true});
 const comment=richTextValue('<b>Reviewed</b><img alt="Test" src="data:image/png;base64,'+'A'.repeat(12000)+'">');
 await shared.sharedAction(other,{action:'comment',id:result.id,body:comment});
 expect((await shared.sharedDetail(other,result.id)).comments.some(c=>c.body===comment)).toBe(true);
 const service=await import('../src/domain/service');
 const linked=await service.create(member,'tasks',{title:'Keep after shared mail deletion'});
 await shared.sharedAction(member,{action:'link',id:result.id,resource:'tasks',record_id:linked.id});
 await expect(shared.sharedAction(other,{action:'remove',id:result.id,version:4})).rejects.toMatchObject({status:403});
 await expect(shared.sharedAction(context('foreign'),{action:'remove',id:result.id,version:4})).rejects.toMatchObject({status:404});
 await expect(shared.sharedAction(member,{action:'remove',id:result.id,version:3})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 expect(await shared.sharedAction(member,{action:'remove',id:result.id,version:5})).toEqual({removed:true});
 await expect(shared.sharedDetail(other,result.id)).rejects.toMatchObject({status:404});
 await expect(shared.sharedAttachment(other,result.id,file.id)).rejects.toMatchObject({status:404});
 for(const table of ['shared_mail_attachments','external_item_records','external_item_comments','external_item_versions','external_item_audience'])expect(await db.query('SELECT * FROM '+table+' WHERE item_id=$1',[result.id])).toHaveLength(0);
 expect(await db.query('SELECT id FROM integration_items WHERE id=$1',[source.id])).toHaveLength(1);
 expect(await db.query('SELECT id FROM tasks WHERE id=$1',[linked.id])).toHaveLength(1);
 expect((await db.query("SELECT after_data FROM audit_log WHERE resource='shared_external_items' AND record_id=$1 AND action='remove'",[result.id]))[0]).toMatchObject({after_data:{source_retained:true}});
 sessionMock.mockRestore();
});


it('provisions department jobs and immutable numbers, combines grants and blocks operator self-administration',async()=>{
 const org=await import('../src/lib/organization'),core=await import('../src/domain/core');
 const data=await org.organization(manager);expect(data.departments).toHaveLength(3);expect(data.jobs).toHaveLength(7);
 const [fin]=await db.query("SELECT j.id FROM department_jobs j JOIN departments d ON d.id=j.department_id WHERE d.workspace_id=$1 AND j.name_zh='财务管理员'",[workspaceId]);
 const [itJob]=await db.query("SELECT j.id FROM department_jobs j JOIN departments d ON d.id=j.department_id WHERE d.workspace_id=$1 AND d.prefix='IT' AND j.name_zh='普通员工'",[workspaceId]);
 const employee=randomUUID();await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[employee,'Synthetic employee',employee+'@example.invalid']);
 await db.query('INSERT INTO memberships(workspace_id,user_id,roles,onboarding_jobs) VALUES($1,$2,$3,$4)',[workspaceId,employee,['member'],[itJob.id,fin.id]]);
 const [number]=await db.query('SELECT * FROM employee_numbers WHERE workspace_id=$1 AND user_id=$2',[workspaceId,employee]);expect(number.employee_number).toMatch(/^IT[0-9]{4}$/);
 const current=async()=>({...member,userId:employee,permissions:await db.query<{resource:string;operation:string;scope:string}>('SELECT * FROM effective_permissions($1,$2,$3)',[workspaceId,employee,['member']])});expect(core.finance(await current())).toBe(true);
 await org.saveOrganization(manager,{action:'assign',user_id:employee,job_ids:[itJob.id],version:number.version});expect(core.finance(await current())).toBe(false);
 expect((await db.query('SELECT employee_number FROM employee_numbers WHERE user_id=$1',[employee]))[0].employee_number).toBe(number.employee_number);
 const operator={...member,roles:['operations']};await expect(org.saveOrganization(operator,{action:'operator',name:'Escalated',permissions:[],version:1})).rejects.toMatchObject({status:403});
 await expect(org.saveOrganization(operator,{action:'employee_number',user_id:employee,employee_number:'IT9999',version:2,reason:'test reason'})).rejects.toMatchObject({status:403});
 await expect(org.saveOrganization(member,{action:'department',name:'Unauthorized',prefix:'BAD',permissions:[],active:true,version:0})).rejects.toMatchObject({status:403});
 await org.saveOrganization(manager,{action:'employee_number',user_id:employee,employee_number:'IT9999',version:2,reason:'Synthetic correction'});
 expect((await db.query('SELECT employee_number FROM employee_number_history WHERE workspace_id=$1 AND user_id=$2',[workspaceId,employee])).map(v=>v.employee_number)).toEqual(expect.arrayContaining([number.employee_number,'IT9999']));
 await expect(org.saveOrganization(manager,{action:'employee_number',user_id:employee,employee_number:'IT9999',version:2,reason:'Stale correction'})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 const opPermissions=await db.query<{resource:string;operation:string;scope:string}>('SELECT * FROM effective_permissions($1,$2,$3)',[workspaceId,users.member,['operations']]);expect(core.finance({...operator,permissions:opPermissions})).toBe(true);expect(core.permissionScope({...operator,permissions:opPermissions},'team_private','read')).toBe('none');
 await expect(org.saveOrganization(operator,{action:'job'})).rejects.toMatchObject({status:403});
 await db.query("UPDATE memberships SET roles=ARRAY['operations'] WHERE workspace_id=$1 AND user_id=$2",[workspaceId,users.member]);
 const updated=await org.organization(manager),job=updated.jobs.find(j=>j.id===itJob.id)!;await org.saveOrganization(operator,{...job,action:'job',active:false});
 await db.query("UPDATE memberships SET roles=ARRAY['member'] WHERE workspace_id=$1 AND user_id=$2",[workspaceId,users.member]);
 expect((await current()).permissions.some(p=>p.resource==='team_directory')).toBe(false);
});
it('owns multiple mail names independently, removes selectable versions without mutating draft identity, and blocks template edits by ordinary members',async()=>{
 const identities=await import('../src/lib/mail-identities'),core=await import('../src/domain/core');
 const original=(await db.query('SELECT name FROM "user" WHERE id=$1',[users.member]))[0].name;
 const one=await identities.saveMailIdentity(member,{action:'save',label:'Business',display_name:'Sample Business',signature:'Thanks, {{user_name}}'});
 const two=await identities.saveMailIdentity(member,{action:'save',label:'Research',display_name:'Sample Research',signature:'Regards'});
 expect((await identities.mailIdentities(member)).variables.user_name).toBe('Sample Research');await identities.saveMailIdentity(member,{action:'activate',id:one.id});expect((await identities.mailIdentities(member)).variables.user_name).toBe('Sample Business');
 await expect(identities.saveMailIdentity(other,{action:'delete',id:one.id})).rejects.toMatchObject({status:404});await identities.saveMailIdentity(member,{action:'delete',id:one.id});
 expect((await identities.mailIdentities(member)).identities.map(i=>i.id)).toEqual([two.id]);expect((await db.query('SELECT name FROM "user" WHERE id=$1',[users.member]))[0].name).toBe(original);
 expect(core.operationAccess(member,'communication_templates','create')).toBe(false);expect(core.operationAccess({...member,permissions:[{resource:'communication_templates',operation:'create',scope:'all'}]},'communication_templates','create')).toBe(false);
});

it('removes withdrawn templates from department catalogs and normalizes old grants when saving',async()=>{
 const org=await import('../src/lib/organization');const data=await org.organization(manager);
 expect(data.policy_resources).not.toHaveProperty('communication_templates');
 const rules=[{resource:'tasks',operation:'read',scope:'all'},{resource:'communication_templates',operation:'edit',scope:'all'}];
 const department=data.departments[0];await db.query('UPDATE departments SET permissions=$2 WHERE id=$1',[department.id,JSON.stringify(rules)]);
 const current=(await org.organization(manager)).departments.find(d=>d.id===department.id)!;
 expect(current).toMatchObject({permissions:[rules[0]]});
 await org.saveOrganization(manager,{...current,action:'department',permissions:rules,description_zh:'Unrelated department edit'});
 expect((await db.query('SELECT permissions,description FROM departments WHERE id=$1',[department.id]))[0]).toMatchObject({permissions:[rules[0]],description:'Unrelated department edit'});
});

it('keeps historical team and company layouts but does not expose or overwrite them',async()=>{
 const boards=await import('../src/lib/team-boards'),company=await import('../src/lib/company-information');
 const creator={...member,roles:['operations']},members=[{user_id:users.member,role:'manager',can_post:true}];
 const b=await boards.saveBoard(creator,{name:'No mail controls',members});
 await db.query("UPDATE company_teams SET mail_header='Historical header',mail_footer='Historical footer' WHERE id=$1",[b.id]);
 expect(await boards.readBoard(creator,b.id)).not.toHaveProperty('mail_header');
 expect((await boards.listBoards(creator)).teams.find(t=>t.id===b.id)).not.toHaveProperty('mail_footer');
 const saved=await boards.saveBoard(creator,{id:b.id,version:b.version,name:'Rename allowed',members,mail_header:'Old browser overwrite',mail_footer:''});
 expect(saved).not.toHaveProperty('mail_header');
 expect((await db.query('SELECT mail_header,mail_footer FROM company_teams WHERE id=$1',[b.id]))[0]).toEqual({mail_header:'Historical header',mail_footer:'Historical footer'});
 await db.query(`UPDATE company_information SET fields=fields||'{"mail_header":"Historical company header"}'::jsonb WHERE workspace_id=$1`,[workspaceId]);
 const info=await company.companyInformation(manager);expect(info.fields.some(f=>f.key==='mail_header')).toBe(false);
 await expect(company.saveCompanyInformation(manager,{version:info.version,fields:{mail_header:'Overwrite'}})).rejects.toMatchObject({code:'INVALID_COMPANY_FIELD'});
});

it('only exposes policy editing for roles the actor can change and rejects direct protected-role writes',async()=>{
 const policies=await import('../src/lib/permission-policies');
 for(const role of ['admin','operations','member'])await db.query("INSERT INTO permissions(workspace_id,role_code,resource,operation,scope) VALUES($1,$2,'tasks','read','all') ON CONFLICT(workspace_id,role_code,resource,operation) DO NOTHING",[workspaceId,role]);
 const secondary={...member,roles:['admin','operations']};
 const shown=await policies.permissionPolicyCatalog(secondary);
 expect(shown.find(p=>p.role_code==='admin')).toMatchObject({can_edit:false});expect(shown.find(p=>p.role_code==='operations')).toMatchObject({can_edit:false});expect(shown.find(p=>p.role_code==='member')).toMatchObject({can_edit:true});
 expect((await policies.permissionPolicyCatalog(manager)).find(p=>p.role_code==='operations')).toMatchObject({can_edit:true});
 await expect(policies.savePermissionPolicy(secondary,{role_code:'operations',resource:'tasks',operations:['read'],scopes:['all']})).rejects.toMatchObject({status:403});
 await expect(policies.savePermissionPolicy(manager,{role_code:'admin',resource:'tasks',operations:['read'],scopes:['all']})).rejects.toMatchObject({code:'ADMIN_POLICY_FIXED'});
});
