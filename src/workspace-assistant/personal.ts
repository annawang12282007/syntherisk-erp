import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {query,transaction} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {isExternal,audit} from '../domain/core';
import {liveContext} from './context';
import {budgetStatus} from '../file-assistant/budget';
export const personalTopics={tasks:'tasks',requests:'work_requests',handoffs:'handoffs',reviews:'reviews',events:'events',subscriptions:'subscriptions'} as const;
const timezone=z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}});
const settingsSchema=z.object({daily_enabled:z.boolean(),report_time:z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),timezone,topics:z.array(z.enum(['tasks','requests','handoffs','reviews','events','subscriptions'])).min(1).max(6),instruction:z.string().trim().max(2000),version:z.number().int().nonnegative()});
function guard(ctx:Context){if(isExternal(ctx)||!ctx.roles.length)throw new DomainError(403,'FORBIDDEN');}
export async function personalOverview(ctx:Context){
 guard(ctx);const prefs=(await query('SELECT settings FROM user_preferences WHERE workspace_id=$1 AND user_id=$2',[ctx.workspaceId,ctx.userId]))[0]?.settings as {timezone?:string}|undefined;
 const settings=(await query('SELECT * FROM assistant_personal_settings WHERE workspace_id=$1 AND user_id=$2',[ctx.workspaceId,ctx.userId]))[0]??{daily_enabled:false,report_time:'09:00',timezone:prefs?.timezone??'America/Los_Angeles',topics:['tasks','requests','handoffs','reviews','events'],instruction:'',version:0};
 const reports=await query("SELECT d.local_date,d.run_id,d.status,r.error_code,r.status AS run_status FROM assistant_daily_reports d LEFT JOIN file_assistant_runs r ON r.id=d.run_id AND r.deleted_at IS NULL WHERE d.workspace_id=$1 AND d.user_id=$2 ORDER BY d.local_date DESC LIMIT 30",[ctx.workspaceId,ctx.userId]);
 let latest_summary='';const latest=reports.find(r=>r.run_status==='completed');if(latest?.run_id){try{const {workspaceDetail}=await import('./service');const detail=await workspaceDetail(ctx,String(latest.run_id));latest_summary=String((detail.preview as {summary?:string})?.summary??'').slice(0,4000);}catch{/* A report with revoked source access is not displayed. */}}
 return{settings,reports,latest_summary,budget:await budgetStatus(ctx)};
}
export async function savePersonal(ctx:Context,input:unknown){guard(ctx);const value=settingsSchema.parse(input);return transaction(async c=>{
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['assistant-settings:'+ctx.workspaceId+':'+ctx.userId]);const current=(await c.query('SELECT version FROM assistant_personal_settings WHERE workspace_id=$1 AND user_id=$2',[ctx.workspaceId,ctx.userId])).rows[0];if(Number(current?.version??0)!==value.version)throw new DomainError(409,'VERSION_CONFLICT');
 await c.query('INSERT INTO assistant_personal_settings(workspace_id,user_id,daily_enabled,report_time,timezone,topics,instruction) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,user_id) DO UPDATE SET daily_enabled=excluded.daily_enabled,report_time=excluded.report_time,timezone=excluded.timezone,topics=excluded.topics,instruction=excluded.instruction,version=assistant_personal_settings.version+1,updated_at=now()',[ctx.workspaceId,ctx.userId,value.daily_enabled,value.report_time,value.timezone,[...new Set(value.topics)],value.instruction]);
 await audit(c,ctx,'personal_assistant',ctx.workspaceId,'configure',null,{daily_enabled:value.daily_enabled,report_time:value.report_time,timezone:value.timezone,topics:value.topics});return{saved:true};
});}
export async function schedulePersonalReports(){
 const due=await query("SELECT s.*,c.id company_id,COALESCE(p.settings->>'locale','zh-CN') locale,(now() AT TIME ZONE s.timezone)::date::text local_date FROM assistant_personal_settings s JOIN memberships m ON m.workspace_id=s.workspace_id AND m.user_id=s.user_id AND m.status='active' AND NOT(m.roles <@ ARRAY['external']::text[]) JOIN LATERAL(SELECT id FROM companies WHERE workspace_id=s.workspace_id ORDER BY created_at LIMIT 1)c ON true LEFT JOIN user_preferences p ON p.workspace_id=s.workspace_id AND p.user_id=s.user_id WHERE s.daily_enabled AND to_char(now() AT TIME ZONE s.timezone,'HH24:MI')>=s.report_time AND NOT EXISTS(SELECT 1 FROM assistant_daily_reports d WHERE d.workspace_id=s.workspace_id AND d.user_id=s.user_id AND d.local_date=(now() AT TIME ZONE s.timezone)::date) ORDER BY s.workspace_id,s.user_id LIMIT 50");
 for(const s of due){try{
  const ctx=await liveContext({workspace_id:String(s.workspace_id),user_id:String(s.user_id)},String(s.company_id)),budget=await budgetStatus(ctx);
  await transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['assistant-settings:'+ctx.workspaceId+':'+ctx.userId]);
   const settings=(await c.query('SELECT * FROM assistant_personal_settings WHERE workspace_id=$1 AND user_id=$2',[ctx.workspaceId,ctx.userId])).rows[0];if(!settings?.daily_enabled||settings.version!==s.version)return;
   const claimed=await c.query('INSERT INTO assistant_daily_reports(workspace_id,user_id,local_date,status) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING local_date',[ctx.workspaceId,ctx.userId,s.local_date,budget.exhausted?'skipped_budget':!budget.configured?'not_configured':'queued']);if(!claimed.rowCount||budget.exhausted||!budget.configured)return;
   const id=randomUUID(),instruction=s.locale==='zh-TW'?'產生我的每日工作報告：優先列出逾期與未完成任務、待處理請求及審核、近期行程和具體下一步。只使用本人有權存取的紀錄。':s.locale==='en'?'Create my daily report: prioritize overdue and unfinished work, pending requests and reviews, upcoming events, and concrete next steps. Use only my permitted records.':'生成我的每日工作报告：优先列出逾期与未完成任务、待处理请求及审批、近期日程和具体下一步。只使用本人有权访问的记录。';
   await c.query("INSERT INTO file_assistant_runs(id,workspace_id,company_id,user_id,mode,instruction,supplement,locale,status,attempt) VALUES($1,$2,$3,$4,'personal',$5,$6,$7,'queued',1)",[id,ctx.workspaceId,ctx.companyId,ctx.userId,instruction,s.instruction,s.locale]);
   await c.query('UPDATE assistant_daily_reports SET run_id=$4 WHERE workspace_id=$1 AND user_id=$2 AND local_date=$3',[ctx.workspaceId,ctx.userId,s.local_date,id]);
   await c.query("INSERT INTO outbox(workspace_id,kind,payload,dedupe_key) VALUES($1,'file_assistant_analysis',$2,$3)",[ctx.workspaceId,JSON.stringify({run_id:id,attempt:1}),'file-assistant:'+id+':1']);
  });
 }catch{/* Each account is independent; the next scheduling pass can retry pre-queue failures. */}}
}
