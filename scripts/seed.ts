import 'dotenv/config';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {auth} from '../src/lib/auth';
import {bootstrap} from '../src/lib/identity';
import {query,pool} from '../src/lib/db';
import {create,action,seedDefaults,list} from '../src/domain/service';
import type {Context} from '../src/lib/context';
if(process.env.NODE_ENV==='production')throw new Error('Demo seed is disabled in production.');
async function seed(){
 try{const prior=JSON.parse(await readFile('data/demo-credentials.json','utf8')) as {workspaceId:string};if((await query('SELECT id FROM workspaces WHERE id=$1',[prior.workspaceId])).length){console.log('Existing explicit demo preserved. Credentials: data/demo-credentials.json');return;}}catch{/* First explicit seed. */}
 const password=randomBytes(21).toString('base64url');const initial=await bootstrap({email:'owner@demo.invalid',password,name:'營運管理者（示範）',workspace:'Syntherisk ERP · 隔離示範'});const ctx:Context={...initial,roles:['admin','operations','finance','reviewer','member']};
 const users:{email:string;password:string;name:string;id:string;roles:string[]}[]=[{email:'owner@demo.invalid',password,name:'營運管理者（示範）',id:ctx.userId,roles:ctx.roles}];
 for(const[email,name,roles]of [['member@demo.invalid','專案成員（示範）',['member']],['reviewer@demo.invalid','費用審核者（示範）',['member','reviewer']],['finance@demo.invalid','財務負責人（示範）',['finance','member']],['external@demo.invalid','限定檢視者（示範）',['external']]] as [string,string,string[]][]){const pw=randomBytes(21).toString('base64url');const u=(await auth.api.signUpEmail({body:{email,password:pw,name}})).user;await query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[ctx.workspaceId,u.id,roles]);users.push({email,password:pw,name,id:u.id,roles});}
 await mkdir('data',{recursive:true});await writeFile('data/demo-credentials.json',JSON.stringify({workspaceId:ctx.workspaceId,companyId:ctx.companyId,users},null,2),{mode:0o600});await seedDefaults(ctx);
 const org=await create(ctx,'organizations',{name:'示範研究實驗室',kind:'laboratory',location:'Taipei',time_zone:'Asia/Taipei',language:'en',notes:'僅供隔離驗收；不是實際客戶或合作關係。'});
 const contact=await create(ctx,'contacts',{name:'Sample Researcher',email:'researcher@example.invalid',job_title:'研究聯絡人（示範）',contact_preference:'email',do_not_contact:true,location:'Taipei',language:'en',tags:'DEMO',notes:'此聯絡人禁止寄送，僅供驗收。'});
 await create(ctx,'contact_affiliations',{contact_id:contact.id,organization_id:org.id,role:'研究聯絡',start_date:'2026-10-01'});
 const project=await create(ctx,'projects',{name:'示範 · 合作流程驗收',goal:'確認團隊接洽、交接與文件流程',start_date:'2026-10-01',due_date:'2026-10-30'});await action(ctx,'projects',String(project.id),'start',{version:project.version});
 const milestone=await create(ctx,'milestones',{title:'示範 · 訪談準備',project_id:project.id,due_date:'2026-10-14'});
 const task=await create(ctx,'tasks',{title:'示範 · 整理訪談問題',project_id:project.id,milestone_id:milestone.id,priority:'high',due_date:'2026-10-10',owner_id:ctx.userId,notes:'完成後送交另一位成員審閱。'});
 await create(ctx,'tasks',{title:'示範 · 核對資料授權範圍',project_id:project.id,priority:'normal',due_date:'2026-10-12',owner_id:users[1].id});
 await create(ctx,'task_collaborators',{task_id:task.id,user_id:users[1].id,responsibility:'資料來源整理'});
 await create(ctx,'handoffs',{title:'示範 · 訪談準備交接',task_id:task.id,to_user_id:users[1].id,progress:'訪綱草案已完成',remaining_work:'核對問題順序',next_step:'接收後審閱訪綱',due_date:'2026-10-10'});
 await create(ctx,'work_requests',{title:'示範 · 請協助核對訪綱',kind:'review',recipient_id:users[1].id,project_id:project.id,purpose:'核對是否涵蓋研究問題',due_date:'2026-10-12'});
 const pipeline=(await list(ctx,'pipelines',{q:'專家訪談'})).rows[0];const stage=(await list(ctx,'pipeline_stages',{pipeline_id:pipeline.id,sort:'position',order:'asc'})).rows[0];
 await create(ctx,'engagements',{title:'示範 · 專家訪談接洽',pipeline_id:pipeline.id,stage_id:stage.id,contact_id:contact.id,organization_id:org.id,project_id:project.id,goal:'測試完整訪談接洽流程',next_step:'準備訪綱',currency:'TWD',follow_up_at:'2026-10-09T17:00:00Z'});
 await create(ctx,'events',{title:'示範 · 專案討論',project_id:project.id,start_at:'2026-10-09T17:00:00Z',end_at:'2026-10-09T17:45:00Z',time_zone:'Asia/Taipei',all_day:false,location:'內部測試',reminder_minutes:30});
 await create(ctx,'documents',{title:'示範 · 訪談準備紀錄',project_id:project.id,category:'meeting',content:'這是驗收文件，不代表已進行真實訪談。'});
 await create(ctx,'feedback',{title:'示範 · 操作流程回饋',contact_id:contact.id,project_id:project.id,observation:'隔離測試中的操作紀錄',interpretation:'僅用於驗證來源追溯',importance:'normal',evidence_source:'Synthetic acceptance data'});
 await create(ctx,'subscriptions',{name:'示範 · 測試服務',currency:'TWD',amount_minor:'0',cycle:'monthly',due_date:'2026-10-20',cancel_by:'2026-10-15',reminder_days:14,purpose:'不代表已訂閱服務'});
 await create(ctx,'assets',{name:'示範 · 測試設備',asset_number:'DEMO-001',category:'test',currency:'TWD',cost_minor:'0',location:'測試工作區'});
 console.log('Explicit demo initialized. No mail sent. Private local credentials: data/demo-credentials.json');
}
try{await seed();}finally{await pool.end();}
