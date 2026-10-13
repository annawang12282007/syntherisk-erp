import {richString} from '../lib/rich-text-schema';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {pool,transaction} from '../lib/db';
import type {Context} from '../lib/context';
import {type Row,type Client,find,fail,patch,assertOperation,str,lockCurrencyConfiguration} from './core';
import {createInTransaction,updateInTransaction,actionInTransaction} from './service';
import {companyCurrency,currencyDigits} from './finance';
import {convertJournalLines,validJournalRate,type JournalFx} from './journal-fx';
import {calendarDate} from './fiscal-calendar';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function journalCurrencyOptions(ctx:Context){
 await assertOperation(pool,ctx,'journal_entries','read');const base=await companyCurrency(pool,ctx);
 return {base_currency:base,digits:Object.fromEntries(await Promise.all([...new Set([base,'USD'])].map(async code=>[code,await currencyDigits(pool,ctx,code)??2])))};
}
async function snapshot(c:Client,ctx:Context,id:string){
 const record=await find(c,ctx,'journal_entries',id);
 const lines=(await c.query('SELECT * FROM journal_lines WHERE workspace_id=$1 AND company_id=$2 AND entry_id=$3 AND NOT archived ORDER BY line_position,created_at,id',[ctx.workspaceId,ctx.companyId,id])).rows;
 for(const line of lines)await find(c,ctx,'journal_lines',line.id);
 return {record,lines,line_hash:hash({lines:lines.map(l=>[l.id,l.version]),draft:record.draft_input,fx:record.fx_input})};
}
export async function journalDraft(ctx:Context,id:string){
 const result=await snapshot(pool,ctx,id);return {...result,base_lines:result.lines,lines:(result.record.draft_input as {lines?:unknown[]}|null)?.lines??(result.record.fx_input as JournalFx|null)?.lines??result.lines};
}
const amount=z.string().regex(/^\d{1,20}$/);
const line=z.object({account_id:z.union([z.uuid(),z.literal('')]),description:z.string().max(2000),debit_minor:amount,credit_minor:amount,project_id:z.union([z.uuid(),z.literal('')]).optional()}).strict();
const schema=z.object({id:z.uuid().optional(),version:z.number().int().optional(),line_hash:z.string().length(64).optional(),request_id:z.uuid().optional(),title:z.string().trim().min(1).max(500),entry_date:z.string(),notes:richString(20000).default(''),original_currency:z.string().regex(/^[A-Z]{3}$/).optional(),rate:z.string().trim().max(25).default(''),rate_date:z.string().default(''),rate_source:z.string().trim().max(500).default(''),lines:z.array(line).max(100)}).strict();
export async function saveJournalDraft(ctx:Context,input:unknown){
 const data=schema.parse(input);calendarDate(data.entry_date);
 const lines=data.lines.filter(l=>l.account_id||l.description.trim()||BigInt(l.debit_minor)||BigInt(l.credit_minor));
 for(const l of lines)if(BigInt(l.debit_minor)>0n&&BigInt(l.credit_minor)>0n)fail('journal_one_side');
 return transaction(async c=>{
  await lockCurrencyConfiguration(c,ctx,'journal_entries');
  let record:Row;const currency=await companyCurrency(c,ctx);
  const originalCurrency=data.original_currency??currency,foreign=originalCurrency!==currency;
  if(foreign&&originalCurrency!=='USD')fail('journal_currency_unsupported');
  if(foreign&&data.rate&&!validJournalRate(data.rate))fail('journal_fx_rate');
  if(foreign&&data.rate_date)calendarDate(data.rate_date);
  const fx:JournalFx|null=foreign?{currency:originalCurrency,rate:data.rate,rate_date:data.rate_date,rate_source:data.rate_source,from_digits:await currencyDigits(c,ctx,originalCurrency)??2,to_digits:await currencyDigits(c,ctx,currency)??2,lines}:null;
  const converted=fx&&fx.rate?convertJournalLines(lines,fx.rate,fx.from_digits,fx.to_digits):lines;
  if(data.id){
   record=await find(c,ctx,'journal_entries',data.id,true,true);await assertOperation(c,ctx,'journal_entries','edit',record);
   if(record.status!=='draft'||record.archived||record.source_resource||record.reversal_of)fail('posted_journal_immutable',409);
   if(record.fx_input&&!data.original_currency)fail('journal_currency_required');
   const before=await snapshot(c,ctx,data.id);if(data.version!==record.version||data.line_hash!==before.line_hash)fail('journal_draft_changed',409);
   record=await updateInTransaction(c,ctx,'journal_entries',data.id,{version:record.version,title:data.title,entry_date:data.entry_date,currency,notes:data.notes});
  }else{
   await assertOperation(c,ctx,'journal_entries','create');if(!data.request_id)fail('invalid_value');
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[ctx.workspaceId+':journal-draft:'+data.request_id]);
   const previous=(await c.query('SELECT entry_id,fingerprint FROM journal_draft_requests WHERE workspace_id=$1 AND company_id=$2 AND user_id=$3 AND request_id=$4',[ctx.workspaceId,ctx.companyId,ctx.userId,data.request_id])).rows[0];
   if(previous){if(previous.fingerprint!==hash(data))fail('journal_draft_changed',409);return find(c,ctx,'journal_entries',previous.entry_id);}
   record=await createInTransaction(c,ctx,'journal_entries',{title:data.title,entry_date:data.entry_date,currency,notes:data.notes});
  }
  // Drafts may be incomplete, but every selected account/project must be accessible.
  await assertOperation(c,ctx,'journal_lines','create');
  for(const l of lines){if(l.account_id){const account=await find(c,ctx,'accounts',l.account_id);if(!account.active||account.archived)fail('inactive_account');}if(l.project_id)await find(c,ctx,'projects',l.project_id);}
  const complete=lines.length>0&&(!fx||Boolean(fx.rate&&fx.rate_date&&fx.rate_source))&&converted.every(l=>l.account_id&&(BigInt(l.debit_minor)>0n||BigInt(l.credit_minor)>0n));
  if(complete){
   const old=(await c.query('SELECT id,version FROM journal_lines WHERE workspace_id=$1 AND company_id=$2 AND entry_id=$3 AND NOT archived ORDER BY id',[ctx.workspaceId,ctx.companyId,record.id])).rows;
   for(const l of old)await actionInTransaction(c,ctx,'journal_lines',str(l.id),'archive',{version:l.version});
   for(const [index,l] of converted.entries()){
    const created=await createInTransaction(c,ctx,'journal_lines',{entry_id:record.id,account_id:l.account_id,description:l.description,debit_minor:l.debit_minor,credit_minor:l.credit_minor,...(l.project_id?{project_id:l.project_id}:{})});
    await c.query('UPDATE journal_lines SET line_position=$1 WHERE id=$2 AND workspace_id=$3 AND company_id=$4',[index,created.id,ctx.workspaceId,ctx.companyId]);
   }
  }
  record=await patch(c,ctx,'journal_entries',record,{draft_input:complete?null:{lines},fx_input:fx},'save_draft');
  if(!data.id)await c.query('INSERT INTO journal_draft_requests(workspace_id,company_id,user_id,request_id,fingerprint,entry_id) VALUES($1,$2,$3,$4,$5,$6)',[ctx.workspaceId,ctx.companyId,ctx.userId,data.request_id,hash(data),record.id]);
  return record;
 });
}
