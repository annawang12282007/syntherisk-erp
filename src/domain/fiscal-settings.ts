import {z} from 'zod';
import {createHash} from 'node:crypto';
import {pool,transaction} from '../lib/db';
import type {Context} from '../lib/context';
import {companyInformation} from '../lib/company-information';
import {baseCapabilities} from '../lib/capabilities';
import {resources} from './registry';
import {type Client,type Row,fail,isExternal,operationAccess,assertOperation,validate,insert,audit,str} from './core';
import {validateCalendar,containingFiscalYear,fiscalRange,monthlyPeriods,type FiscalCalendar} from './fiscal-calendar';
type Settings=FiscalCalendar&{version:number};
function access(ctx:Context){const read=!isExternal(ctx)&&baseCapabilities(ctx,resources.fiscal_periods).read;return {can_read:read,can_manage:read&&operationAccess(ctx,'fiscal_periods','create')&&operationAccess(ctx,'journal_entries','post')};}
async function profile(c:Client,ctx:Context){return (await c.query('SELECT version,first_year_start,first_year_end,end_month,end_day FROM company_fiscal_settings WHERE workspace_id=$1 AND company_id=$2',[ctx.workspaceId,ctx.companyId])).rows[0] as Settings|undefined;}
async function lock(c:Client,ctx:Context){await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${ctx.workspaceId}:periods`]);}
async function inUse(c:Client,ctx:Context){return Boolean((await c.query("SELECT 1 FROM fiscal_periods WHERE workspace_id=$1 AND company_id=$2 UNION ALL SELECT 1 FROM journal_entries WHERE workspace_id=$1 AND company_id=$2 AND status IN ('posted','reversed') LIMIT 1",[ctx.workspaceId,ctx.companyId])).rowCount);}
export async function fiscalSettings(ctx:Context){
 const rights=access(ctx);if(!rights.can_read)fail('forbidden',403);const current=await profile(pool,ctx);
 const company=await companyInformation(ctx),suggested=company.fields.find(f=>f.key==='incorporation_date')?.value;
 return {...rights,profile:current??null,locked:Boolean(current&&await inUse(pool,ctx)),suggested_start:typeof suggested==='string'?suggested:''};
}
const schema=z.object({version:z.number().int().min(0),first_year_start:z.string(),first_year_end:z.string(),end_month:z.number().int(),end_day:z.number().int().nullable()}).strict();
export async function saveFiscalSettings(ctx:Context,input:unknown){
 if(!access(ctx).can_manage)fail('forbidden',403);const value=schema.parse(input);validateCalendar(value);
 return transaction(async c=>{
  await lock(c,ctx);const before=await profile(c,ctx);if((before?.version??0)!==value.version)fail('version_conflict',409);
  const changed=!before||(['first_year_start','first_year_end','end_month','end_day'] as const).some(k=>before[k]!==value[k]);
  if(!changed)return before!;if(before&&await inUse(c,ctx))fail('fiscal_settings_locked',409);
  const periods=(await c.query('SELECT start_date,end_date FROM fiscal_periods WHERE workspace_id=$1 AND company_id=$2',[ctx.workspaceId,ctx.companyId])).rows;
  for(const period of periods){const range=containingFiscalYear(value,str(period.start_date));if(str(period.end_date)>range.end_date)fail('fiscal_existing_period_conflict',409);}
  if((await c.query("SELECT 1 FROM journal_entries WHERE workspace_id=$1 AND company_id=$2 AND status IN ('posted','reversed') AND entry_date<$3 LIMIT 1",[ctx.workspaceId,ctx.companyId,value.first_year_start])).rowCount)fail('fiscal_existing_period_conflict',409);
  const after=(await c.query('INSERT INTO company_fiscal_settings(workspace_id,company_id,first_year_start,first_year_end,end_month,end_day,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(company_id) DO UPDATE SET first_year_start=$3,first_year_end=$4,end_month=$5,end_day=$6,updated_by=$7,updated_at=now(),version=company_fiscal_settings.version+1 RETURNING version,first_year_start,first_year_end,end_month,end_day',[ctx.workspaceId,ctx.companyId,value.first_year_start,value.first_year_end,value.end_month,value.end_day,ctx.userId])).rows[0];
  await audit(c,ctx,'company_fiscal_settings',ctx.companyId,'configure',before??null,after);return after;
 });
}
async function preview(c:Client,ctx:Context,year:number){
 const current=await profile(c,ctx);if(!current)fail('fiscal_settings_required',409);const range=fiscalRange(current,year);
 const existing=(await c.query('SELECT id,version,start_date,end_date,status,archived FROM fiscal_periods WHERE workspace_id=$1 AND company_id=$2 AND start_date<=$3 AND end_date>=$4 ORDER BY start_date,id',[ctx.workspaceId,ctx.companyId,range.end_date,range.start_date])).rows;
 const periods=monthlyPeriods(range).map(p=>{const matches=existing.filter(r=>r.start_date<=p.end_date&&r.end_date>=p.start_date);return {...p,status:matches.length===0?'new':matches.length===1&&matches[0].start_date===p.start_date&&matches[0].end_date===p.end_date&&!matches[0].archived?'existing':'conflict'};});
 const hash=createHash('sha256').update(JSON.stringify({company:ctx.companyId,profile:current,year,existing,periods})).digest('hex');
 return {year,range,periods,hash,version:current.version};
}
export async function previewFiscalPeriods(ctx:Context,year:number){if(!access(ctx).can_read)fail('forbidden',403);return preview(pool,ctx,year);}
export async function generateFiscalPeriods(ctx:Context,input:Row){
 if(!access(ctx).can_manage)fail('forbidden',403);const data=z.object({year:z.number().int(),version:z.number().int(),hash:z.string().length(64)}).strict().parse(input);
 return transaction(async c=>{await lock(c,ctx);await assertOperation(c,ctx,'fiscal_periods','create');const plan=await preview(c,ctx,data.year);
  if(data.version!==plan.version||data.hash!==plan.hash)fail('fiscal_preview_changed',409);
  if(plan.periods.some(p=>p.status==='conflict'))fail('fiscal_existing_period_conflict',409);
  const created=[];for(const p of plan.periods.filter(p=>p.status==='new')){const values=await validate(c,ctx,'fiscal_periods',{name:`FY ${data.year} · ${p.start_date.slice(0,7)}`,start_date:p.start_date,end_date:p.end_date});const row=await insert(c,ctx,'fiscal_periods',values);created.push(row.id);}
  await audit(c,ctx,'company_fiscal_settings',ctx.companyId,'generate_periods',null,{year:data.year,created,range:plan.range});
  return {created:created.length,existing:plan.periods.length-created.length};
 });
}
