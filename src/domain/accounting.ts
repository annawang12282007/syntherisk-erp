import {standardChart} from './chart-of-accounts';
import {createHash} from 'node:crypto';
import type {Context} from '../lib/context';
import {transaction,pool} from '../lib/db';
import {type Client,type Row,str,fail,find,scope,assertOperation,operationAccess,insert,patch,audit,checkVersion} from './core';
import {companyCurrency,convertCurrency,postJournal,numbered} from './finance';
import {minor} from './money';
import {canonicalJson} from './signatures';

export const accountingResources=['expense_claims','vendor_bills','customer_invoices','payments'];
type Line={account_id:string;account_name:string;debit_minor:string;credit_minor:string};
type Plan={resource:string;record_id:string;version:number;currency:string;original_currency:string;original_minor:string;total_minor:string;tax_minor:string;entry_date:string;control_account_id:string;lines:Line[];profile_version:number;rate:string;rate_date:string;rate_source:string;source_journal_id:string|null;hash:string};
const chart=standardChart;
function manager(ctx:Context){if(!operationAccess(ctx,'accounts','create')||!operationAccess(ctx,'journal_entries','post'))fail('forbidden',403);}
export async function accountingSettings(ctx:Context){
 const c=await pool.connect();try{if(!operationAccess(ctx,'accounts','read')||!operationAccess(ctx,'journal_entries','post'))fail('forbidden',403);const s=scope(ctx,'accounts');return {base_currency:await companyCurrency(c,ctx),profile:(await c.query('SELECT version,tax_registration,gst_hst_number FROM accounting_profiles WHERE company_id=$1 AND workspace_id=$2',[ctx.companyId,ctx.workspaceId])).rows[0]??{version:0,tax_registration:'unconfirmed',gst_hst_number:''},accounts:(await c.query(`SELECT r.id,r.code,r.name,r.kind,r.active FROM accounts r WHERE ${s.sql} AND NOT r.archived ORDER BY r.code`,s.values)).rows};}finally{c.release();}
}
export async function configureAccounting(ctx:Context,data:Row){return transaction(async c=>{
 manager(ctx);await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[ctx.companyId+':accounting_setup']);
 if(data.action==='initialize'){
  if(await companyCurrency(c,ctx)!=='CAD')fail('accounting_cad_required');
  const existing=(await c.query('SELECT count(*)::int AS n FROM accounts WHERE workspace_id=$1 AND company_id=$2',[ctx.workspaceId,ctx.companyId])).rows[0].n;if(existing)fail('accounting_chart_exists',409);
  for(const account of chart)await insert(c,ctx,'accounts',{...account});
  return {created:chart.length};
 }
 const before=(await c.query('SELECT * FROM accounting_profiles WHERE company_id=$1 AND workspace_id=$2 FOR UPDATE',[ctx.companyId,ctx.workspaceId])).rows[0] as Row|undefined;
 if(Number(data.version)!==Number(before?.version??0))fail('version_conflict',409);
 if(!['unconfirmed','registered','not_registered'].includes(str(data.tax_registration)))fail('invalid_value');
 const number=str(data.gst_hst_number).trim();if(data.tax_registration==='registered'&&!/^\d{9}RT\d{4}$/i.test(number))fail('accounting_registration_number');
 const after=(await c.query('INSERT INTO accounting_profiles(workspace_id,company_id,tax_registration,gst_hst_number,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(company_id) DO UPDATE SET tax_registration=EXCLUDED.tax_registration,gst_hst_number=EXCLUDED.gst_hst_number,updated_by=EXCLUDED.updated_by,updated_at=now(),version=accounting_profiles.version+1 RETURNING *',[ctx.workspaceId,ctx.companyId,data.tax_registration,number.toUpperCase(),ctx.userId])).rows[0];
 await audit(c,ctx,'accounting_profiles',ctx.companyId,'configure',before??null,after);return after;
});}
export async function buildAccountingPlan(c:Client,ctx:Context,resource:string,row:Row,input:Row):Promise<Plan>{
 if(!accountingResources.includes(resource))fail('unsupported_resource');
 if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid_value');
 await assertOperation(c,ctx,resource,'post',row);await assertOperation(c,ctx,'journal_entries','post');
 if(row.journal_entry_id)fail('already_posted',409);if(row.archived)fail('record_archived',409);
 const base=await companyCurrency(c,ctx);if(base!=='CAD')fail('accounting_cad_required');
 const date=str(input.entry_date);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail('entry_date_required');
 const periods=(await c.query("SELECT id FROM fiscal_periods WHERE workspace_id=$1 AND company_id=$2 AND start_date<=$3 AND end_date>=$3 AND status='open' AND NOT archived FOR SHARE",[ctx.workspaceId,ctx.companyId,date])).rows;if(periods.length!==1)fail('period_closed_or_missing',409);
 const profile=(await c.query('SELECT * FROM accounting_profiles WHERE workspace_id=$1 AND company_id=$2 FOR SHARE',[ctx.workspaceId,ctx.companyId])).rows[0];
 const lines:Line[]=[];
 async function account(id:unknown,kinds:string[]){const a=await find(c,ctx,'accounts',id);if(!a.active||a.archived||!kinds.includes(str(a.kind)))fail('accounting_account_kind');return a;}
 async function line(id:unknown,amount:bigint,debit:boolean,kinds:string[]){if(!amount)return;const a=await account(id,kinds);lines.push({account_id:str(a.id),account_name:str(a.code)+' · '+str(a.name),debit_minor:debit?amount.toString():'0',credit_minor:debit?'0':amount.toString()});}
 const original=resource==='payments'?minor(row.amount_minor):resource==='expense_claims'?minor(row.approved_minor):minor(row.total_minor);
 if(original<=0n)fail('positive_amount_required');
 const rate=row.currency===base?'1':str(input.rate),rateDate=row.currency===base?date:str(input.rate_date),rateSource=row.currency===base?'Same currency':str(input.rate_source).trim();
 if(row.currency!==base&&(!rate||!/^\d{4}-\d{2}-\d{2}$/.test(rateDate)||!rateSource))fail('exchange_rate_required');
 const converted=await convertCurrency(c,ctx,original,rate,row.currency,base);if(converted<=0n)fail('positive_amount_required');
 let control=str(input.control_account_id),tax=0n,sourceJournal:string|null=null;
 if(resource==='payments'){
  if(row.direction==='refund')fail('accounting_refund_review_required');
  if(!['expense_claims','vendor_bills','customer_invoices'].includes(str(row.source_resource)))fail('unsupported_resource');
  await find(c,ctx,str(row.source_resource),row.source_id,false,true);
  const recognized=(await c.query('SELECT p.*,j.status AS journal_status FROM accounting_postings p JOIN journal_entries j ON j.id=p.journal_entry_id WHERE p.workspace_id=$1 AND p.company_id=$2 AND p.resource=$3 AND p.record_id=$4',[ctx.workspaceId,ctx.companyId,row.source_resource,row.source_id])).rows[0];
  if(!recognized||recognized.journal_status!=='posted')fail('accounting_source_first',409);
  sourceJournal=str(recognized.journal_entry_id);control=str(recognized.control_account_id);
  // Allocate carrying value cumulatively so the final partial settlement clears rounding exactly.
  const settled=(await c.query("SELECT COALESCE(sum(p.allocated_minor),0)::text AS original,COALESCE(sum((a.plan->>'carrying_minor')::numeric),0)::text AS base FROM payments p JOIN accounting_postings a ON a.record_id=p.id AND a.resource='payments' AND a.workspace_id=p.workspace_id WHERE p.workspace_id=$1 AND p.company_id=$2 AND p.source_resource=$3 AND p.source_id=$4",[ctx.workspaceId,ctx.companyId,row.source_resource,row.source_id])).rows[0];
  const allocated=minor(row.allocated_minor),prior=minor(settled.original),sourceTotal=minor(recognized.original_minor);
  if(prior+allocated>sourceTotal)fail('payment_exceeds_balance',409);
  const cumulative=(minor(recognized.base_minor)*(prior+allocated)+sourceTotal/2n)/sourceTotal,carrying=cumulative-minor(settled.base);
  const incoming=row.direction==='incoming';await line(control,carrying,!incoming,incoming?['asset']:['liability']);
  if(str(input.bank_account_id)===control)fail('different_accounts_required');await line(input.bank_account_id,converted,incoming,['asset','liability']);
  const loss=incoming?carrying-converted:converted-carrying;
  if(loss)await line(loss>0n?input.fx_loss_account_id:input.fx_gain_account_id,loss<0n?-loss:loss,loss>0n,loss>0n?['expense']:['revenue']);
 }else{
  if(!['approved','issued','partially_paid','paid'].includes(str(row.status)))fail('payment_not_approved',409);
  if(minor(row.credit_minor??0)>0n)fail('accounting_credit_review_required');
  if((await c.query('SELECT 1 FROM payments WHERE workspace_id=$1 AND company_id=$2 AND source_resource=$3 AND source_id=$4 AND journal_entry_id IS NOT NULL',[ctx.workspaceId,ctx.companyId,resource,row.id])).rowCount)fail('accounting_legacy_review_required',409);
  const child=resource==='expense_claims'?'expense_lines':resource==='vendor_bills'?'bill_lines':'invoice_lines',parent=resource==='expense_claims'?'claim_id':resource==='vendor_bills'?'bill_id':'invoice_id';
  const taxTotal=minor((await c.query(`SELECT COALESCE(sum(tax_minor),0)::text AS tax FROM ${child} WHERE workspace_id=$1 AND company_id=$2 AND ${parent}=$3 AND NOT archived`,[ctx.workspaceId,ctx.companyId,row.id])).rows[0].tax);
  tax=minor(input.tax_minor??0);if(tax>taxTotal||tax>original)fail('accounting_tax_exceeds_source');
  if(tax>0n&&profile?.tax_registration!=='registered')fail('accounting_registration_required');
  const income=resource==='customer_invoices';if(income&&tax!==taxTotal)fail('accounting_sales_tax_required');
  const controlRow=await account(control,income?['asset']:['liability']);control=str(controlRow.id);
  if(!Array.isArray(input.allocations)||!input.allocations.length||input.allocations.length>30)fail('accounting_allocations_required');
  let sum=0n,baseSum=0n;const taxBase=await convertCurrency(c,ctx,tax,rate,row.currency,base),costBase=converted-taxBase;
  for(const [i,allocation] of (input.allocations as Row[]).entries()){
   if(!allocation||typeof allocation!=='object'||Array.isArray(allocation))fail('invalid_value');
   const amount=minor(allocation.amount_minor);if(amount<=0n)fail('positive_amount_required');sum+=amount;
   const part=i===input.allocations.length-1?costBase-baseSum:await convertCurrency(c,ctx,amount,rate,row.currency,base);baseSum+=part;
   if(part<0n||str(allocation.account_id)===control)fail('accounting_allocations_required');await line(allocation.account_id,part,!income,income?['revenue']:['expense','asset']);
  }
  if(sum+tax!==original)fail('accounting_allocation_mismatch');
  if(taxBase){if(str(input.tax_account_id)===control)fail('different_accounts_required');await line(input.tax_account_id,taxBase,!income,income?['liability']:['asset']);}
  await line(control,converted,income,income?['asset']:['liability']);
 }
 const debit=lines.reduce((s,l)=>s+BigInt(l.debit_minor),0n),credit=lines.reduce((s,l)=>s+BigInt(l.credit_minor),0n);if(!debit||debit!==credit||lines.length<2)fail('journal_unbalanced');
 const plan={resource,record_id:str(row.id),version:Number(row.version),currency:base,original_currency:str(row.currency),original_minor:original.toString(),total_minor:converted.toString(),tax_minor:tax.toString(),entry_date:date,control_account_id:control,lines,profile_version:Number(profile?.version??0),rate,rate_date:rateDate,rate_source:rateSource,source_journal_id:sourceJournal};
 return {...plan,hash:createHash('sha256').update(canonicalJson(plan)).digest('hex')};
}
export async function previewAccounting(ctx:Context,data:Row){return transaction(async c=>{const resource=str(data.resource);if(!accountingResources.includes(resource))fail('unsupported_resource');const row=await find(c,ctx,resource,data.id,false,true);checkVersion(row,data);return buildAccountingPlan(c,ctx,resource,row,data.accounting as Row??{});});}
export async function postAccounting(c:Client,ctx:Context,resource:string,row:Row,data:Row){
 const plan=await buildAccountingPlan(c,ctx,resource,row,data.accounting as Row??{});if(plan.hash!==data.accounting_hash)fail('accounting_preview_changed',409);
 let journal=await insert(c,ctx,'journal_entries',{title:row.title??row.reference,entry_date:plan.entry_date,currency:plan.currency,number:await numbered(c,'JE'),source_resource:resource,source_id:row.id,status:'draft'});
 for(const l of plan.lines)await insert(c,ctx,'journal_lines',{entry_id:journal.id,account_id:l.account_id,debit_minor:l.debit_minor,credit_minor:l.credit_minor,project_id:row.project_id??null,description:row.title??row.reference});
 journal=await postJournal(c,ctx,journal);
 const carrying=resource==='payments'?plan.lines.filter(l=>l.account_id===plan.control_account_id).reduce((n,l)=>n+BigInt(l.debit_minor)+BigInt(l.credit_minor),0n).toString():plan.total_minor;
 await c.query('INSERT INTO accounting_postings(workspace_id,company_id,resource,record_id,journal_entry_id,control_account_id,original_minor,base_minor,tax_minor,plan,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[ctx.workspaceId,ctx.companyId,resource,row.id,journal.id,plan.control_account_id,plan.original_minor,plan.total_minor,plan.tax_minor,JSON.stringify({...plan,carrying_minor:carrying}),ctx.userId]);
 return patch(c,ctx,resource,row,{journal_entry_id:journal.id,base_currency:plan.currency,...(resource==='payments'?{bank_account_id:(data.accounting as Row).bank_account_id,base_amount_minor:plan.total_minor,base_exchange_rate:plan.rate,base_exchange_rate_date:plan.rate_date,base_exchange_rate_source:plan.rate_source}:{status:'posted',posted_at:new Date(),base_total_minor:plan.total_minor,exchange_rate:plan.rate,exchange_rate_date:plan.rate_date,exchange_rate_source:plan.rate_source})},'post');
}
export async function financeOverview(ctx:Context){
 const groups:Row[]=[];for(const resource of ['expense_claims','vendor_bills','customer_invoices','payments','bank_transactions']){
  const s=scope(ctx,resource);const amounts=resource==='payments'||resource==='bank_transactions'?'amount_minor':resource==='expense_claims'?'approved_minor-paid_minor':'total_minor-credit_minor-paid_minor';
  const condition=resource==='payments'?'journal_entry_id IS NULL':resource==='bank_transactions'?"status='unmatched'":"status NOT IN ('draft','returned','submitted','cancelled')";
  const rows=(await pool.query(`SELECT currency,count(*)::int AS count,COALESCE(sum(${amounts}),0)::text AS amount_minor FROM ${resource} r WHERE ${s.sql} AND NOT r.archived AND ${condition} GROUP BY currency`,s.values)).rows;
  groups.push({resource,rows});
 }return {groups};
}
