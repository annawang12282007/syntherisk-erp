import {beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {query} from '../src/lib/db';
import type {Context} from '../src/lib/context';
import {create,action,previewSignature} from '../src/domain/service';
import {accountingSettings,configureAccounting} from '../src/domain/accounting';
import {fiscalSettings,saveFiscalSettings,previewFiscalPeriods,generateFiscalPeriods} from '../src/domain/fiscal-settings';
import {fiscalRange,monthlyPeriods,validateCalendar,annualEnd} from '../src/domain/fiscal-calendar';
import {journalDraft,saveJournalDraft} from '../src/domain/journal-drafts';
import type {Row} from '../src/domain/core';
let ctx:Context,member:Context,accounts:Record<string,string>;
const calendar={first_year_start:'2026-10-07',first_year_end:'2027-09-30',end_month:9,end_day:null};
beforeEach(async()=>{
 const workspaceId=randomUUID(),companyId=randomUUID(),userId=randomUUID();ctx={workspaceId,companyId,userId,roles:['admin','finance']};member={...ctx,userId:randomUUID(),roles:['member']};
 await query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'Fiscal and draft tests']);
 await query("INSERT INTO companies(id,workspace_id,base_currency) VALUES($1,$2,'CAD')",[companyId,workspaceId]);
 for(const c of [ctx,member]){await query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[c.userId,'Journal fixture',c.userId+'@example.invalid']);await query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[workspaceId,c.userId,c.roles]);}
 await query('UPDATE workspaces SET initial_admin_user_id=$2 WHERE id=$1',[workspaceId,userId]);
 await configureAccounting(ctx,{action:'initialize'});accounts=Object.fromEntries((await accountingSettings(ctx)).accounts.map(a=>[String(a.code),String(a.id)]));
});
async function setup(){await saveFiscalSettings(ctx,{version:0,...calendar});return generate();}
async function generate(){const {year,version,hash}=await previewFiscalPeriods(ctx,2027);return generateFiscalPeriods(ctx,{year,version,hash});}
const input=()=>({request_id:randomUUID(),title:'Research costs',entry_date:'2026-10-09',notes:'Draft evidence',lines:[{account_id:accounts['5200'],description:'Research',debit_minor:'12345',credit_minor:'0'},{account_id:accounts['1000'],description:'Bank',debit_minor:'0',credit_minor:'12345'}]});
async function edit(row:Row,patch:Row={}){const draft=await journalDraft(ctx,String(row.id));return saveJournalDraft(ctx,{id:row.id,version:draft.record.version,line_hash:draft.line_hash,title:draft.record.title,entry_date:draft.record.entry_date,notes:draft.record.notes||'',lines:draft.lines.map(l=>({account_id:l.account_id,description:l.description,debit_minor:String(l.debit_minor),credit_minor:String(l.credit_minor),project_id:l.project_id||''})),...patch});}
async function signed(row:Row){const values={version:row.version,idempotency_key:randomUUID()},preview=await previewSignature(ctx,'journal_entries',String(row.id),'post',values);return action(ctx,'journal_entries',String(row.id),'post',{...values,signature:{typed_name:'Journal fixture',consent:true,reviewed_hash:preview.reviewed_hash}});}
it('calculates the confirmed stub year and consecutive monthly periods with leap years',()=>{
 expect(fiscalRange(calendar,2027)).toEqual({start_date:'2026-10-07',end_date:'2027-09-30'});
 expect(fiscalRange(calendar,2028)).toEqual({start_date:'2027-10-01',end_date:'2028-09-30'});
 const periods=monthlyPeriods(fiscalRange(calendar,2027));expect(periods).toHaveLength(12);expect(periods[0]).toEqual({start_date:'2026-10-07',end_date:'2026-10-31'});expect(periods[11].end_date).toBe('2027-09-30');
 expect(annualEnd(2028,2,null)).toBe('2028-02-29');expect(annualEnd(2027,2,null)).toBe('2027-02-28');
 expect(()=>validateCalendar({...calendar,end_day:31})).toThrow();expect(()=>validateCalendar({...calendar,first_year_end:'2027-09-31'})).toThrow();
 expect(()=>validateCalendar({...calendar,first_year_start:'2026-01-01'})).toThrow();
});
it('enforces setup permissions, versions, monthly generation and stable fiscal boundaries',async()=>{
 await expect(saveFiscalSettings(member,{version:0,...calendar})).rejects.toMatchObject({status:403});
 expect(await setup()).toEqual({created:12,existing:0});expect(await generate()).toEqual({created:0,existing:12});
 expect((await fiscalSettings(ctx)).locked).toBe(true);
 await expect(saveFiscalSettings(ctx,{version:0,...calendar})).rejects.toMatchObject({code:'version_conflict'});
 await expect(saveFiscalSettings(ctx,{version:1,...calendar,end_month:8,first_year_end:'2027-08-31'})).rejects.toMatchObject({code:'fiscal_settings_locked'});
 const rows=await query('SELECT start_date,end_date,fiscal_year_end FROM fiscal_periods WHERE workspace_id=$1 ORDER BY start_date',[ctx.workspaceId]);expect(rows).toHaveLength(12);expect(rows.every(r=>r.fiscal_year_end==='2027-09-30')).toBe(true);
});
it('rejects stale previews, all partial-month conflicts, and cross-year manual periods atomically',async()=>{
 await saveFiscalSettings(ctx,{version:0,...calendar});const plan=await previewFiscalPeriods(ctx,2027);
 await create(ctx,'fiscal_periods',{name:'Partial October',start_date:'2026-10-07',end_date:'2026-10-15'});
 await expect(generateFiscalPeriods(ctx,{year:plan.year,version:plan.version,hash:plan.hash})).rejects.toMatchObject({code:'fiscal_preview_changed'});
 await expect(generate()).rejects.toMatchObject({code:'fiscal_existing_period_conflict'});
 expect(await query('SELECT id FROM fiscal_periods WHERE workspace_id=$1',[ctx.workspaceId])).toHaveLength(1);
 await expect(create(ctx,'fiscal_periods',{name:'Cross year',start_date:'2027-09-01',end_date:'2027-10-31'})).rejects.toMatchObject({code:'fiscal_existing_period_conflict'});
 await expect(create(ctx,'fiscal_periods',{name:'Before company',start_date:'2026-09-01',end_date:'2026-09-30'})).rejects.toMatchObject({code:'fiscal_before_start'});
});
it('persists incomplete inputs and blocks posting stale complete lines underneath a draft',async()=>{
 await setup();let row=await saveJournalDraft(ctx,input());
 row=await edit(row,{lines:[{account_id:'',description:'Still choosing account',debit_minor:'12345',credit_minor:'0'}]});
 const saved=await journalDraft(ctx,String(row.id));expect(saved.lines[0].account_id).toBe('');expect(saved.lines[0].description).toBe('Still choosing account');
 await expect(signed(row)).rejects.toMatchObject({code:'journal_draft_incomplete'});
 expect((await query('SELECT status FROM journal_entries WHERE id=$1',[row.id]))[0].status).toBe('draft');
 row=await edit(row,{lines:input().lines});expect(row.draft_input).toBeNull();expect((await signed(row)).status).toBe('posted');
 await expect(edit({...row,version:row.version})).rejects.toMatchObject({code:'posted_journal_immutable'});
});
it('allows unbalanced and empty drafts but preserves exact cents, ordering and signature checks',async()=>{
 await setup();const data=input();data.lines[1].credit_minor='1';let row=await saveJournalDraft(ctx,data);
 const saved=await journalDraft(ctx,String(row.id));expect(saved.lines.map(l=>l.description)).toEqual(['Research','Bank']);expect(String(saved.lines[0].debit_minor)).toBe('12345');
 await expect(signed(row)).rejects.toMatchObject({code:'journal_unbalanced'});
 row=await edit(row,{lines:[]});expect((await journalDraft(ctx,String(row.id))).lines).toEqual([]);
 await expect(signed(row)).rejects.toMatchObject({code:'journal_draft_incomplete'});
 row=await edit(row,{lines:input().lines});
 await expect(action(ctx,'journal_entries',String(row.id),'post',{version:row.version})).rejects.toMatchObject({code:'signature_required'});
});
it('deduplicates creation retries and rejects stale edits including independent child edits',async()=>{
 const data=input(),row=await saveJournalDraft(ctx,data);expect((await saveJournalDraft(ctx,data)).id).toBe(row.id);
 await expect(saveJournalDraft(ctx,{...data,title:'Different retry'})).rejects.toMatchObject({code:'journal_draft_changed'});
 const snapshot=await journalDraft(ctx,String(row.id));
 await query('UPDATE journal_lines SET version=version+1 WHERE entry_id=$1',[row.id]);
 await expect(saveJournalDraft(ctx,{id:row.id,version:row.version,line_hash:snapshot.line_hash,title:'Stale update',entry_date:row.entry_date,lines:data.lines})).rejects.toMatchObject({code:'journal_draft_changed'});
 expect((await journalDraft(ctx,String(row.id))).record.title).toBe(data.title);
});
it('rolls back invalid account changes and denies unauthorized draft writes and reads',async()=>{
 const row=await saveJournalDraft(ctx,input()),bad=input().lines;bad[0].account_id=randomUUID();
 await expect(edit(row,{title:'Must roll back',lines:bad})).rejects.toMatchObject({status:404});
 const saved=await journalDraft(ctx,String(row.id));expect(saved.record.title).toBe('Research costs');expect(saved.lines).toHaveLength(2);
 await expect(saveJournalDraft(member,input())).rejects.toMatchObject({status:403});
 await expect(journalDraft({...ctx,companyId:randomUUID()},String(row.id))).rejects.toMatchObject({status:404});
});
