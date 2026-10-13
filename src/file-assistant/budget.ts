import {richString} from '../lib/rich-text-schema';
import {z} from 'zod';
import {pool,query,transaction} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {accountAuthority,canManageAccount} from '../lib/account-authority';
import {builtinRoles} from '../domain/permission-options';
import {audit,type Client} from '../domain/core';
import {configuration,MODEL} from './provider';
export function budgetMonth(date=new Date()){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit'}).formatToParts(date);return p.find(v=>v.type==='year')!.value+'-'+p.find(v=>v.type==='month')!.value;}
export type BudgetPolicy={kind:string;subject:string;limit_microusd:string|number};
export function allowance(p:BudgetPolicy[],user:string,roles:string[],jobs:string[]){
 const own=p.find(v=>v.kind==='user'&&v.subject===user);if(own)return{amount:Number(own.limit_microusd),source:'user'};
 const matched=p.filter(v=>v.kind==='role'&&roles.includes(v.subject)||v.kind==='job'&&jobs.includes(v.subject));
 if(matched.length)return{amount:Math.max(...matched.map(v=>Number(v.limit_microusd))),source:'role_job'};
 return{amount:Number(p.find(v=>v.kind==='default')?.limit_microusd??10_000_000),source:'default'};
}
export async function budgetStatus(ctx:Context,c:Client=pool){
 const month=budgetMonth(),cfg=configuration();
 const member=(await c.query("SELECT roles FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'",[ctx.workspaceId,ctx.userId])).rows[0];
 if(!member||member.roles.every((r:string)=>r==='external'))throw new DomainError(403,'FORBIDDEN');
 const jobs=(await c.query('SELECT a.job_id FROM employee_assignments a JOIN department_jobs j ON j.id=a.job_id JOIN departments d ON d.id=j.department_id WHERE a.workspace_id=$1 AND a.user_id=$2 AND j.active AND d.active',[ctx.workspaceId,ctx.userId])).rows.map(r=>r.job_id);
 const policies=(await c.query('SELECT kind,subject,limit_microusd FROM assistant_budget_policies WHERE workspace_id=$1',[ctx.workspaceId])).rows;
 const base=allowance(policies,ctx.userId,member.roles,jobs);
 const usage=(await c.query("SELECT COALESCE(sum(actual_microusd),0)::text spent,count(*) FILTER(WHERE state='uncertain')::int uncertain,count(*) FILTER(WHERE state='pending')::int pending FROM file_assistant_usage WHERE workspace_id=$1 AND user_id=$2 AND month=$3",[ctx.workspaceId,ctx.userId,month])).rows[0];
 const extras=(await c.query("SELECT COALESCE(sum(approved_microusd) FILTER(WHERE status='approved'),0)::text extra,bool_or(status='pending') pending FROM assistant_budget_requests WHERE workspace_id=$1 AND user_id=$2 AND month=$3",[ctx.workspaceId,ctx.userId,month])).rows[0];
 const limit=base.amount+Number(extras.extra),spent=Number(usage.spent);
 return{month,limit_usd:limit/1e6,base_limit_usd:base.amount/1e6,additional_usd:Number(extras.extra)/1e6,used_usd:spent/1e6,available_usd:Math.max(0,limit-spent)/1e6,source:base.source,exhausted:spent>=limit,can_request:spent>=limit&&!extras.pending,pending_request:Boolean(extras.pending),uncertain_calls:usage.uncertain,pending_calls:usage.pending,model:MODEL,configured:cfg.configured};
}
// No money is reserved. Serialize each user's paid calls; settle actual charges.
// The last call may exceed the remaining allowance; the next call is then blocked.
export async function beginUsage(run:string,workspace:string,attempt:number){return transaction(async c=>{
 const owner=(await c.query('SELECT user_id,company_id FROM file_assistant_runs WHERE id=$1 AND workspace_id=$2',[run,workspace])).rows[0];if(!owner)throw new DomainError(404,'NOT_FOUND');
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['assistant-usage:'+workspace+':'+owner.user_id]);
 const status=await budgetStatus({workspaceId:workspace,companyId:owner.company_id,userId:owner.user_id,roles:[]},c);
 if(!status.configured)throw new DomainError(503,'ASSISTANT_NOT_CONFIGURED');
 if(status.exhausted)throw new DomainError(429,'ASSISTANT_BUDGET_EXCEEDED');
 if((await c.query("SELECT 1 FROM file_assistant_usage WHERE workspace_id=$1 AND user_id=$2 AND state IN ('pending','uncertain')",[workspace,owner.user_id])).rowCount)throw new DomainError(409,'ASSISTANT_USAGE_PENDING');
 if((await c.query('SELECT id FROM file_assistant_usage WHERE run_id=$1 AND attempt=$2',[run,attempt])).rowCount)throw new DomainError(409,'ASSISTANT_ALREADY_ANALYZED');
 return(await c.query("INSERT INTO file_assistant_usage(run_id,workspace_id,user_id,attempt,month,model,reserved_microusd,state) VALUES($1,$2,$3,$4,$5,$6,0,'pending') RETURNING id",[run,workspace,owner.user_id,attempt,status.month,MODEL])).rows[0].id as string;
});}
export async function settle(id:string,usage:{cost:number;input:number;output:number}|null,uncertain=false){
 if(usage&&![usage.cost,usage.input,usage.output].every(n=>Number.isSafeInteger(n)&&n>=0))throw new DomainError(422,'ASSISTANT_INVALID_USAGE');
 await query("UPDATE file_assistant_usage SET state=$2,actual_microusd=$3,input_tokens=$4,output_tokens=$5 WHERE id=$1 AND state='pending'",[id,uncertain?'uncertain':'settled',uncertain?null:usage?.cost??0,usage?.input??null,usage?.output??null]);
}
async function administrator(ctx:Context,c:Client=pool){const actor=await accountAuthority(ctx,c);if(!actor.root&&!actor.roles.some(r=>['admin','operations'].includes(r)))throw new DomainError(403,'FORBIDDEN');return actor;}
export async function budgetAdministration(ctx:Context){
 const actor=await administrator(ctx);
 const members=await query('SELECT m.user_id,u.name,m.roles FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status=\'active\' AND ($2 OR m.user_id IS DISTINCT FROM $3) ORDER BY u.name',[ctx.workspaceId,actor.root,actor.rootId]);
 const visible=members.filter(m=>canManageAccount(actor,String(m.user_id),m.roles as string[])),ids=visible.map(m=>m.user_id);
 return{policies:await query("SELECT * FROM assistant_budget_policies WHERE workspace_id=$1 AND (kind<>'user' OR subject=ANY($2::text[]))",[ctx.workspaceId,ids]),members:visible,roles:[...builtinRoles.filter(r=>r!=='external'&&(actor.root||!['admin','operations'].includes(r))).map(code=>({code,name:code})),...await query('SELECT code,name FROM workspace_roles WHERE workspace_id=$1 AND active',[ctx.workspaceId])],jobs:await query('SELECT j.id,j.name,j.name_zh,j.name_en FROM department_jobs j JOIN departments d ON d.id=j.department_id WHERE d.workspace_id=$1 AND j.active AND d.active',[ctx.workspaceId]),requests:await query('SELECT r.*,u.name FROM assistant_budget_requests r JOIN "user" u ON u.id=r.user_id WHERE r.workspace_id=$1 AND r.user_id=ANY($2::text[]) ORDER BY r.created_at DESC LIMIT 100',[ctx.workspaceId,ids]),usage:await query('SELECT user_id,COALESCE(sum(actual_microusd),0)::text spent FROM file_assistant_usage WHERE workspace_id=$1 AND month=$2 AND user_id=ANY($3::text[]) GROUP BY user_id',[ctx.workspaceId,budgetMonth(),ids])};
}
const dollars=z.number().finite().min(0).max(1000).multipleOf(.01);
export async function unresolvedUsage(ctx:Context){const actor=await administrator(ctx);return(await query('SELECT a.id,a.user_id,a.month,a.created_at,u.name,m.roles FROM file_assistant_usage a JOIN "user" u ON u.id=a.user_id JOIN memberships m ON m.workspace_id=a.workspace_id AND m.user_id=a.user_id WHERE a.workspace_id=$1 AND a.state=\'uncertain\' ORDER BY a.created_at',[ctx.workspaceId])).filter(r=>actor.root||canManageAccount(actor,String(r.user_id),r.roles as string[])).map(r=>({id:r.id,user_id:r.user_id,month:r.month,created_at:r.created_at,name:r.name}));}
export async function reconcileUsage(ctx:Context,input:unknown){const v=z.object({id:z.uuid(),actual_usd:z.number().finite().min(0).max(1000),note:richString(1000,5)}).parse(input);return transaction(async c=>{
 const actor=await administrator(ctx,c),row=(await c.query('SELECT a.*,m.roles FROM file_assistant_usage a JOIN memberships m ON m.workspace_id=a.workspace_id AND m.user_id=a.user_id WHERE a.workspace_id=$1 AND a.id=$2 FOR UPDATE OF a',[ctx.workspaceId,v.id])).rows[0];
 if(!row||(!actor.root&&!canManageAccount(actor,row.user_id,row.roles)))throw new DomainError(404,'NOT_FOUND');if(row.state!=='uncertain')throw new DomainError(409,'VERSION_CONFLICT');
 await c.query("UPDATE file_assistant_usage SET state='settled',actual_microusd=$2 WHERE id=$1",[v.id,Math.round(v.actual_usd*1e6)]);await audit(c,ctx,'assistant_usage',v.id,'reconcile',{state:'uncertain'},{actual_usd:v.actual_usd,note:v.note});return{saved:true};
});}
export async function saveBudgetPolicy(ctx:Context,input:unknown){
 const data=z.object({kind:z.enum(['default','role','job','user']),subject:z.string().min(1).max(150),limit_usd:dollars,version:z.number().int().nonnegative(),remove:z.boolean().default(false)}).parse(input);
 return transaction(async c=>{const actor=await administrator(ctx,c);await c.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[ctx.workspaceId]);
  if(data.kind==='default'&&data.subject!=='*')throw new DomainError(422,'INVALID_REFERENCE');
  if(data.kind==='role'){if(['admin','operations'].includes(data.subject)&&!actor.root)throw new DomainError(403,'INITIAL_ADMIN_REQUIRED');if(!builtinRoles.includes(data.subject)&&!(await c.query('SELECT 1 FROM workspace_roles WHERE workspace_id=$1 AND code=$2 AND active',[ctx.workspaceId,data.subject])).rowCount)throw new DomainError(422,'INVALID_REFERENCE');}
  if(data.kind==='job'&&!(await c.query('SELECT 1 FROM department_jobs j JOIN departments d ON d.id=j.department_id WHERE d.workspace_id=$1 AND j.id::text=$2 AND j.active AND d.active',[ctx.workspaceId,data.subject])).rowCount)throw new DomainError(422,'INVALID_REFERENCE');
  if(data.kind==='user'){const target=(await c.query('SELECT roles FROM memberships WHERE workspace_id=$1 AND user_id=$2',[ctx.workspaceId,data.subject])).rows[0];if(!target||!canManageAccount(actor,data.subject,target.roles))throw new DomainError(403,'ACCOUNT_HIERARCHY_FORBIDDEN');}
  const current=(await c.query('SELECT version FROM assistant_budget_policies WHERE workspace_id=$1 AND kind=$2 AND subject=$3',[ctx.workspaceId,data.kind,data.subject])).rows[0];if(Number(current?.version??0)!==data.version)throw new DomainError(409,'VERSION_CONFLICT');
  if(data.remove)await c.query('DELETE FROM assistant_budget_policies WHERE workspace_id=$1 AND kind=$2 AND subject=$3',[ctx.workspaceId,data.kind,data.subject]);
  else await c.query('INSERT INTO assistant_budget_policies(workspace_id,kind,subject,limit_microusd,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,kind,subject) DO UPDATE SET limit_microusd=excluded.limit_microusd,version=assistant_budget_policies.version+1,updated_by=excluded.updated_by,updated_at=now()',[ctx.workspaceId,data.kind,data.subject,Math.round(data.limit_usd*1e6),ctx.userId]);
  await audit(c,ctx,'assistant_budget',ctx.workspaceId,'configure',null,data);return{saved:true};
 });
}
export async function requestExtra(ctx:Context,input:unknown){const data=z.object({amount_usd:dollars.refine(n=>n>0),reason:richString(1000,3)}).parse(input);return transaction(async c=>{
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['assistant-usage:'+ctx.workspaceId+':'+ctx.userId]);const status=await budgetStatus(ctx,c);if(!status.can_request)throw new DomainError(409,'ASSISTANT_REQUEST_NOT_AVAILABLE');
 const row=(await c.query('INSERT INTO assistant_budget_requests(workspace_id,user_id,month,requested_microusd,reason) VALUES($1,$2,$3,$4,$5) RETURNING id',[ctx.workspaceId,ctx.userId,status.month,Math.round(data.amount_usd*1e6),data.reason])).rows[0];await audit(c,ctx,'assistant_budget',row.id,'request',null,data);return row;
});}
export async function reviewExtra(ctx:Context,input:unknown){const data=z.object({id:z.uuid(),approve:z.boolean(),amount_usd:dollars,note:richString(1000)}).parse(input);return transaction(async c=>{
 const actor=await administrator(ctx,c),request=(await c.query('SELECT r.*,m.roles FROM assistant_budget_requests r JOIN memberships m ON m.workspace_id=r.workspace_id AND m.user_id=r.user_id WHERE r.workspace_id=$1 AND r.id=$2 FOR UPDATE OF r',[ctx.workspaceId,data.id])).rows[0];
 if(!request)throw new DomainError(404,'NOT_FOUND');if(!canManageAccount(actor,request.user_id,request.roles))throw new DomainError(403,'ACCOUNT_HIERARCHY_FORBIDDEN');if(request.status!=='pending'||request.month!==budgetMonth())throw new DomainError(409,'VERSION_CONFLICT');if(data.approve&&data.amount_usd<=0)throw new DomainError(422,'VALIDATION_ERROR');
 await c.query("UPDATE assistant_budget_requests SET status=$2,approved_microusd=$3,reviewed_by=$4,review_note=$5,reviewed_at=now() WHERE id=$1",[data.id,data.approve?'approved':'declined',data.approve?Math.round(data.amount_usd*1e6):0,ctx.userId,data.note]);await audit(c,ctx,'assistant_budget',data.id,'review',null,data);return{saved:true};
});}
