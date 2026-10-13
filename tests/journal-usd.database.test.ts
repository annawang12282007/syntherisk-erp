import {beforeEach,expect,it} from 'vitest';import {randomUUID} from 'node:crypto';
import {query} from '../src/lib/db';import type {Context} from '../src/lib/context';
import {create,update,action,previewSignature,get} from '../src/domain/service';
import {configureAccounting,accountingSettings} from '../src/domain/accounting';
import {journalDraft,saveJournalDraft} from '../src/domain/journal-drafts';
import {convertJournalLines,type JournalFx} from '../src/domain/journal-fx';import type {Row} from '../src/domain/core';
import {genericRecordPrint} from '../src/lib/record-print';
let ctx:Context,accounts:Record<string,string>;
beforeEach(async()=>{const workspaceId=randomUUID(),companyId=randomUUID(),userId=randomUUID();ctx={workspaceId,companyId,userId,roles:['admin','finance']};
 await query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'USD draft tests']);await query("INSERT INTO companies(id,workspace_id,base_currency) VALUES($1,$2,'CAD')",[companyId,workspaceId]);
 await query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[userId,'USD fixture',userId+'@example.invalid']);await query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[workspaceId,userId,ctx.roles]);await query('UPDATE workspaces SET initial_admin_user_id=$2 WHERE id=$1',[workspaceId,userId]);
 await configureAccounting(ctx,{action:'initialize'});accounts=Object.fromEntries((await accountingSettings(ctx)).accounts.map(a=>[String(a.code),String(a.id)]));await create(ctx,'fiscal_periods',{name:'October',start_date:'2026-10-01',end_date:'2026-10-31'});
});
function input(){return {request_id:randomUUID(),title:'USD research',entry_date:'2026-10-09',original_currency:'USD',rate:'1.35',rate_date:'2026-10-09',rate_source:'Fixture evidence',lines:[{account_id:accounts['5200'],description:'Cost',debit_minor:'10000',credit_minor:'0'},{account_id:accounts['1000'],description:'Bank',debit_minor:'0',credit_minor:'10000'}]};}
async function edit(row:Row,values:Row){const d=await journalDraft(ctx,String(row.id)),fx=d.record.fx_input as JournalFx;return saveJournalDraft(ctx,{id:row.id,version:d.record.version,line_hash:d.line_hash,title:d.record.title,entry_date:d.record.entry_date,original_currency:fx?.currency||'CAD',rate:fx?.rate||'',rate_date:fx?.rate_date||'',rate_source:fx?.rate_source||'',lines:d.lines,...values});}
async function post(row:Row){const values={version:row.version,idempotency_key:randomUUID()},preview=await previewSignature(ctx,'journal_entries',String(row.id),'post',values);return action(ctx,'journal_entries',String(row.id),'post',{...values,signature:{typed_name:'USD fixture',consent:true,reviewed_hash:preview.reviewed_hash}});}
it('preserves original USD and converts exact CAD cents for signed posting and reversal',async()=>{
 const row=await saveJournalDraft({...ctx,roles:['finance']},input()),draft=await journalDraft(ctx,String(row.id));
 expect(draft.record.currency).toBe('CAD');expect(String(draft.lines[0].debit_minor)).toBe('10000');expect(String(draft.base_lines[0].debit_minor)).toBe('13500');
 const posted=await post(row);expect(posted.status).toBe('posted');await expect(edit(posted,{rate:'2'})).rejects.toMatchObject({code:'posted_journal_immutable'});
 const html=await (await genericRecordPrint(ctx,'journal_entries',String(row.id))).text();expect(html).toContain('USD');expect(html).toContain('135.00');expect(html).toContain('100.00');expect(html).toContain('Fixture evidence');
 const reversed=await action(ctx,'journal_entries',String(posted.id),'reverse',{version:posted.version,entry_date:'2026-10-10',reason:'Fixture correction'});
 expect(reversed.status).toBe('posted');expect((reversed.fx_input as JournalFx).lines[0].credit_minor).toBe('10000');
 expect((await journalDraft(ctx,String(reversed.id))).base_lines[0].credit_minor).toBe('13500');
});
it('saves missing exchange evidence and restores exact input before recomputing changed rates',async()=>{
 let row=await saveJournalDraft(ctx,{...input(),rate:'',rate_date:'',rate_source:''});
 expect(row.draft_input).not.toBeNull();expect((await journalDraft(ctx,String(row.id))).lines[0].debit_minor).toBe('10000');
 await expect(post(row)).rejects.toMatchObject({code:'journal_draft_incomplete'});
 row=await edit(row,{rate:'1.4',rate_date:'2026-10-09',rate_source:'Evidence'});
 expect(row.draft_input).toBeNull();expect((await journalDraft(ctx,String(row.id))).base_lines[0].debit_minor).toBe('14000');
 row=await edit(row,{rate_source:''});await expect(post(row)).rejects.toMatchObject({code:'journal_draft_incomplete'});
});
it('allocates rounding across multiple lines without fabricating an FX gain or loss',async()=>{
 const data=input();data.lines=[{...data.lines[0],debit_minor:'1'},{...data.lines[0],description:'Second cost',debit_minor:'1'},{...data.lines[1],credit_minor:'2'}];
 const row=await saveJournalDraft(ctx,data),draft=await journalDraft(ctx,String(row.id));
 expect(draft.base_lines.map(l=>[l.debit_minor,l.credit_minor])).toEqual([['1','0'],['2','0'],['0','3']]);expect((await post(row)).status).toBe('posted');
});
it('rejects original imbalance even when rounding makes the CAD totals equal',async()=>{
 const data=input();data.rate='0.4';data.lines[0].debit_minor='2';data.lines[1].credit_minor='3';const row=await saveJournalDraft(ctx,data);
 expect(row.draft_input).toBeNull();await expect(post(row)).rejects.toMatchObject({code:'journal_original_unbalanced'});
});
it('keeps sub-cent converted lines in drafts and validates rates, dates and overflow',async()=>{
 const data=input();data.rate='0.01';data.lines.forEach(l=>{l.debit_minor=l.debit_minor==='0'?'0':'1';l.credit_minor=l.credit_minor==='0'?'0':'1';});
 const row=await saveJournalDraft(ctx,data);expect(row.draft_input).not.toBeNull();await expect(post(row)).rejects.toMatchObject({code:'journal_draft_incomplete'});
 for(const rate of ['0','-1','NaN','Infinity','1e2','1.1234567890123'])await expect(saveJournalDraft(ctx,{...input(),rate})).rejects.toThrow();
 await expect(saveJournalDraft(ctx,{...input(),rate_date:'2026-02-30'})).rejects.toMatchObject({code:'fiscal_invalid_dates'});
 expect(()=>convertJournalLines([{account_id:'',description:'',debit_minor:'99999999999999999999',credit_minor:'0'}],'2')).toThrow();
});
it('detects independent ledger edits, stale signature previews and currency-unit changes',async()=>{
 const row=await saveJournalDraft(ctx,input()),draft=await journalDraft(ctx,String(row.id));const values={version:row.version},preview=await previewSignature(ctx,'journal_entries',String(row.id),'post',values);
 await update(ctx,'journal_lines',String(draft.base_lines[0].id),{version:draft.base_lines[0].version,description:'Changed independently'});
 await expect(action(ctx,'journal_entries',String(row.id),'post',{...values,signature:{typed_name:'USD fixture',consent:true,reviewed_hash:preview.reviewed_hash}})).rejects.toMatchObject({code:'signature_snapshot_changed'});
 await expect(post(await get(ctx,'journal_entries',String(row.id)))).rejects.toMatchObject({code:'journal_fx_changed'});
 await expect(create(ctx,'currencies',{code:'USD',name:'US dollar',minor_digits:0})).rejects.toMatchObject({code:'currency_in_use'});
});
it('requires explicit currency to update a USD draft and clears FX metadata when switching to CAD',async()=>{
 let row=await saveJournalDraft(ctx,input()),d=await journalDraft(ctx,String(row.id));
 await expect(saveJournalDraft(ctx,{id:row.id,version:row.version,line_hash:d.line_hash,title:'old client',entry_date:row.entry_date,lines:input().lines})).rejects.toMatchObject({code:'journal_currency_required'});
 row=await edit(row,{original_currency:'CAD'});expect(row.fx_input).toBeNull();d=await journalDraft(ctx,String(row.id));expect(d.base_lines[0].debit_minor).toBe('10000');
});
