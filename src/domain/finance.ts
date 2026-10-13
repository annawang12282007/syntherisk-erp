import {postAccounting} from './accounting';
import type {Context} from '../lib/context';
import {type Row,type Client,str,fail,find,finance,reviewer,insert,patch,notify,operationAccess,permissionScope} from './core';
import {minor,exchange,decimal,multiplyQuantity,quantityString} from './money';
import {isRecordResponsible} from './responsibilities';
import {convertJournalLines,journalTotals,reverseJournalFx,type JournalFx} from './journal-fx';
import {calendarDate} from './fiscal-calendar';
function financeActionAllowed(ctx:Context,resource:string,action:string){const operation=action==='reverse'?'post':action==='approve'?'approve':`action:${action}`;return finance(ctx)||Boolean(permissionScope(ctx,resource,operation)&&operationAccess(ctx,resource,operation));}
export async function companyCurrency(c:Client,ctx:Context){return str((await c.query('SELECT base_currency FROM companies WHERE id=$1 AND workspace_id=$2',[ctx.companyId,ctx.workspaceId])).rows[0]?.base_currency);}
export async function currencyDigits(c:Client,ctx:Context,code:unknown){const currency=str(code),configured=(await c.query('SELECT minor_digits FROM currencies WHERE workspace_id=$1 AND code=$2 AND company_id=$3 AND NOT archived',[ctx.workspaceId,currency,ctx.companyId])).rows[0];return configured?Number(configured.minor_digits):new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;}
export async function convertCurrency(c:Client,ctx:Context,amount:unknown,rate:unknown,from:unknown,to:unknown){return exchange(amount,rate,await currencyDigits(c,ctx,from),await currencyDigits(c,ctx,to));}
export async function numbered(c:Client,prefix:string){return `${prefix}-${new Date().getUTCFullYear()}-${str((await c.query("SELECT nextval('business_document_number') AS n")).rows[0].n).padStart(7,'0')}`;}
export async function postJournal(c:Client,ctx:Context,row:Row):Promise<Row>{
 if(row.draft_input)fail('journal_draft_incomplete',409);
 if(!operationAccess(ctx,'journal_entries','post'))fail('finance_required',403);if(row.status!=='draft')fail('invalid_transition',409);
 if(row.currency!==await companyCurrency(c,ctx))fail('journal_base_currency_required');
 const period=(await c.query("SELECT * FROM fiscal_periods WHERE workspace_id=$1 AND company_id=$2 AND start_date<=$3 AND end_date>=$3 FOR UPDATE",[ctx.workspaceId,ctx.companyId,row.entry_date])).rows[0];if(!period||period.status!=='open')fail('period_closed_or_missing',409);
 const lines=(await c.query('SELECT l.*,a.active AS account_active FROM journal_lines l JOIN accounts a ON a.id=l.account_id AND a.workspace_id=l.workspace_id WHERE l.workspace_id=$1 AND l.entry_id=$2 AND NOT l.archived ORDER BY l.line_position,l.created_at,l.id FOR UPDATE OF l',[ctx.workspaceId,row.id])).rows as Row[];
 if(row.fx_input){
  const fx=row.fx_input as JournalFx;
  if(fx.currency!=='USD'||fx.currency===row.currency||!fx.rate||!fx.rate_date||!fx.rate_source)fail('journal_fx_required');
  calendarDate(fx.rate_date);
  if(fx.from_digits!==await currencyDigits(c,ctx,fx.currency)||fx.to_digits!==await currencyDigits(c,ctx,row.currency))fail('journal_fx_changed',409);
  const original=journalTotals(fx.lines);if(!original.debit||original.debit!==original.credit)fail('journal_original_unbalanced');
  const expected=convertJournalLines(fx.lines,fx.rate,fx.from_digits,fx.to_digits);
  if(expected.length!==lines.length||expected.some((line,i)=>['account_id','description','project_id','debit_minor','credit_minor'].some(key=>str((line as Row)[key])!==str(lines[i][key]))))fail('journal_fx_changed',409);
 }
 if(lines.length<2)fail('journal_requires_lines');let debit=0n,credit=0n;for(const line of lines){if(!line.account_active)fail('inactive_account');debit+=minor(line.debit_minor);credit+=minor(line.credit_minor);}if(!debit||debit!==credit)fail('journal_unbalanced');
 return patch(c,ctx,'journal_entries',row,{status:'posted',posted_at:new Date()},'post');
}
async function createSourceJournal(c:Client,ctx:Context,resource:string,row:Row,data:Row):Promise<Row>{
 if(row.journal_entry_id)fail('already_posted',409);if(resource==='expense_claims'&&!['paid'].includes(str(row.status)))fail('expense_not_paid',409);
 if(resource==='vendor_bills'&&!['approved','partially_paid','paid'].includes(str(row.status)))fail('bill_not_approved',409);
 if(resource==='customer_invoices'&&!['issued','partially_paid','paid'].includes(str(row.status)))fail('invoice_not_issued',409);
 const debit=await find(c,ctx,'accounts',data.debit_account_id),credit=await find(c,ctx,'accounts',data.credit_account_id);if(debit.id===credit.id)fail('different_accounts_required');
 const base=await companyCurrency(c,ctx);const original=resource==='expense_claims'?minor(row.approved_minor):minor(row.total_minor)-minor(row.credit_minor);
 let amount=original;if(row.currency!==base){if(!row.exchange_rate||!row.exchange_rate_date||!row.exchange_rate_source)fail('exchange_rate_required');amount=await convertCurrency(c,ctx,original,row.exchange_rate,row.currency,base);}
 if(amount<=0n)fail('positive_amount_required');if(!/^\d{4}-\d{2}-\d{2}$/.test(str(data.entry_date)))fail('entry_date_required');
 let journal=await insert(c,ctx,'journal_entries',{title:row.title,entry_date:data.entry_date,currency:base,number:await numbered(c,'JE'),source_resource:resource,source_id:row.id,status:'draft'});
 await insert(c,ctx,'journal_lines',{entry_id:journal.id,account_id:debit.id,debit_minor:amount.toString(),credit_minor:'0',project_id:row.project_id??null,description:row.title});await insert(c,ctx,'journal_lines',{entry_id:journal.id,account_id:credit.id,debit_minor:'0',credit_minor:amount.toString(),project_id:row.project_id??null,description:row.title});
 journal=await postJournal(c,ctx,journal);return patch(c,ctx,resource,row,{journal_entry_id:journal.id,status:'posted',posted_at:new Date(),base_currency:base,base_total_minor:amount.toString()},'post');
}
export async function claimPolicyAllows(c:Client,ctx:Context,row:Row){
 const policies=(await c.query('SELECT p.* FROM approval_policies p WHERE p.workspace_id=$1 AND p.company_id=$2 AND NOT p.archived AND (p.project_id IS NULL OR p.project_id=$3) AND p.min_minor<=$4 AND (p.max_minor=0 OR p.max_minor>=$4) AND (p.category_id IS NULL OR EXISTS(SELECT 1 FROM expense_lines l WHERE l.claim_id=$5 AND l.category_id=p.category_id AND NOT l.archived))',[ctx.workspaceId,ctx.companyId,row.project_id,row.total_minor,row.id])).rows as Row[];
 return !policies.length||policies.some(p=>p.reviewer_id===ctx.userId||p.delegate_id===ctx.userId);
}
async function approveClaim(c:Client,ctx:Context,row:Row,data:Row){
 if(!operationAccess(ctx,'expense_claims','approve'))fail('reviewer_required',403);if(row.created_by===ctx.userId||row.owner_id===ctx.userId||await isRecordResponsible(c,ctx,'expense_claims',str(row.id),ctx.userId))fail('self_approval_forbidden',403);if(row.status!=='submitted')fail('invalid_transition',409);
 const amount=minor(data.approved_minor);if(amount<=0n||amount>minor(row.total_minor))fail('invalid_approved_amount');
 if(!await claimPolicyAllows(c,ctx,row))fail('policy_reviewer_required',403);
 if(Array.isArray(data.line_approvals)){let sum=0n;const lines=(await c.query('SELECT * FROM expense_lines WHERE workspace_id=$1 AND claim_id=$2 AND NOT archived FOR UPDATE',[ctx.workspaceId,row.id])).rows as Row[];const mapped=new Map((data.line_approvals as Row[]).map(x=>[str(x.id),x.approved_minor]));if(mapped.size!==lines.length)fail('line_approvals_incomplete');for(const l of lines){const a=minor(mapped.get(str(l.id)));if(a>minor(l.amount_minor)+minor(l.tax_minor))fail('invalid_approved_amount');sum+=a;await patch(c,ctx,'expense_lines',l,{approved_minor:a.toString()},'approve');}if(sum!==amount)fail('approval_total_mismatch');}
 await insert(c,ctx,'approvals',{claim_id:row.id,reviewer_id:ctx.userId,approved_minor:amount.toString(),reason:str(data.reason)});const out=await patch(c,ctx,'expense_claims',row,{status:'approved',approved_minor:amount.toString(),approved_at:new Date()},'approve');await notify(c,ctx,row.owner_id,'approved','expense_claims',out);return out;
}
async function payment(c:Client,ctx:Context,resource:string,row:Row,data:Row,refund=false){
 if(!operationAccess(ctx,resource,'pay'))fail('finance_required',403);const valid=resource==='expense_claims'?['approved','partially_paid','paid','posted']:resource==='vendor_bills'?['approved','partially_paid','paid','posted']:['issued','partially_paid','paid','posted'];if(!valid.includes(str(row.status)))fail('payment_not_approved',409);
 const allocated=minor(data.amount_minor);if(allocated<=0n)fail('positive_amount_required');const paid=minor(row.paid_minor),total=(resource==='expense_claims'?minor(row.approved_minor):minor(row.total_minor)-minor(row.credit_minor));if(refund?allocated>paid:allocated>total-paid)fail('payment_exceeds_balance',409);
 if(!str(data.reference).trim())fail('payment_reference_required');if(!data.idempotency_key)fail('idempotency_key_required');
 const paymentCurrency=data.payment_currency??row.currency;let paidAmount=allocated,rate='1';
 if(paymentCurrency!==row.currency){if(!/^[A-Z]{3}$/.test(str(paymentCurrency))||!data.payment_amount_minor||!data.exchange_rate||!data.exchange_rate_date||!data.exchange_rate_source)fail('exchange_rate_required');paidAmount=minor(data.payment_amount_minor);rate=str(data.exchange_rate);if(await convertCurrency(c,ctx,paidAmount,rate,paymentCurrency,row.currency)!==allocated)fail('exchange_allocation_mismatch');}
 const paymentDate=data.payment_date?str(data.payment_date):null;if(paymentDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)||new Date(paymentDate+'T00:00:00Z').toISOString().slice(0,10)!==paymentDate))fail('invalid_date');
 const p=await insert(c,ctx,'payments',{payment_date:paymentDate,reference:data.reference,source_resource:resource,source_id:row.id,direction:refund?'refund':resource==='customer_invoices'?'incoming':'outgoing',currency:paymentCurrency,amount_minor:paidAmount.toString(),allocated_minor:allocated.toString(),source_currency:row.currency,exchange_rate:rate,exchange_rate_date:data.exchange_rate_date??null,exchange_rate_source:data.exchange_rate_source??null,paid_at:new Date(),idempotency_key:data.idempotency_key});
 await insert(c,ctx,'payment_allocations',{payment_id:p.id,source_resource:resource,source_id:row.id,amount_minor:allocated.toString()});
 const newPaid=refund?paid-allocated:paid+allocated;const next=row.status==='posted'?'posted':newPaid===total?'paid':newPaid>0n?'partially_paid':resource==='customer_invoices'?'issued':'approved';return {...await patch(c,ctx,resource,row,{paid_minor:newPaid.toString(),status:next,paid_at:new Date()},refund?'refund':'pay'),payment_id:p.id};
}
export async function financeAction(c:Client,ctx:Context,resource:string,row:Row,action:string,data:Row):Promise<Row|undefined>{
 if(action==='post'&&data.accounting)return postAccounting(c,ctx,resource,row,data);
 if(action==='post'&&resource==='payments'&&(await c.query('SELECT 1 FROM accounting_postings WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4',[ctx.workspaceId,ctx.companyId,row.source_resource,row.source_id])).rowCount)fail('accounting_guided_required');
 if(resource==='payments'&&action==='post'){
  if(!operationAccess(ctx,resource,'post'))fail('finance_required',403);if(row.journal_entry_id)fail('already_posted',409);const debit=await find(c,ctx,'accounts',data.debit_account_id),credit=await find(c,ctx,'accounts',data.credit_account_id);if(debit.id===credit.id)fail('different_accounts_required');const base=await companyCurrency(c,ctx);let amount=minor(row.amount_minor),rate='1',rateDate:unknown=null,rateSource:unknown=null;
  if(row.currency!==base){if(row.source_currency===base){rate=str(row.exchange_rate);rateDate=row.exchange_rate_date;rateSource=row.exchange_rate_source;}else{if(!data.base_exchange_rate||!data.base_exchange_rate_date||!data.base_exchange_rate_source)fail('exchange_rate_required');rate=str(data.base_exchange_rate);rateDate=data.base_exchange_rate_date;rateSource=data.base_exchange_rate_source;}amount=await convertCurrency(c,ctx,row.amount_minor,rate,row.currency,base);}
  let journal=await insert(c,ctx,'journal_entries',{title:row.reference,entry_date:data.entry_date,currency:base,number:await numbered(c,'JE'),source_resource:resource,source_id:row.id,status:'draft'});await insert(c,ctx,'journal_lines',{entry_id:journal.id,account_id:debit.id,debit_minor:amount.toString(),credit_minor:'0',description:row.reference});await insert(c,ctx,'journal_lines',{entry_id:journal.id,account_id:credit.id,debit_minor:'0',credit_minor:amount.toString(),description:row.reference});journal=await postJournal(c,ctx,journal);return patch(c,ctx,resource,row,{journal_entry_id:journal.id,base_currency:base,base_amount_minor:amount.toString(),base_exchange_rate:rate,base_exchange_rate_date:rateDate,base_exchange_rate_source:rateSource},action);
 }
 if(resource==='expense_claims'){
  if(action==='submit'){if(row.owner_id!==ctx.userId&&row.created_by!==ctx.userId)fail('own_expense_only',403);if(!['draft','returned'].includes(str(row.status)))fail('invalid_transition',409);if(minor(row.total_minor)<=0n)fail('expense_lines_required');return patch(c,ctx,resource,row,{status:'submitted',submitted_at:new Date()},action);}
  if(action==='approve')return approveClaim(c,ctx,row,data);
  if(action==='return'){if(!operationAccess(ctx,resource,'approve')||row.created_by===ctx.userId)fail('reviewer_required',403);if(row.status!=='submitted'||!str(data.reason).trim())fail('return_reason_required');await insert(c,ctx,'approvals',{claim_id:row.id,reviewer_id:ctx.userId,approved_minor:'0',reason:data.reason});return patch(c,ctx,resource,row,{status:'returned'},action);}
 }
 if(['expense_claims','vendor_bills','customer_invoices'].includes(resource)){
  if(action==='pay'||action==='refund')return payment(c,ctx,resource,row,data,action==='refund');
  if(action==='post'){if(!operationAccess(ctx,resource,'post'))fail('finance_required',403);return createSourceJournal(c,ctx,resource,row,data);}
  if(action==='credit'){if(!(financeActionAllowed(ctx,resource,action)))fail('finance_required',403);if(row.journal_entry_id)fail('posted_requires_reversal',409);if(!['issued','approved','partially_paid','paid'].includes(str(row.status)))fail('invalid_transition',409);const a=minor(data.amount_minor);if(a<=0n||a>minor(row.total_minor)-minor(row.paid_minor)-minor(row.credit_minor))fail('credit_exceeds_balance');if(!str(data.reason).trim())fail('reason_required');await insert(c,ctx,'credit_notes',{source_resource:resource,source_id:row.id,currency:row.currency,amount_minor:a.toString(),reason:data.reason});const credit=minor(row.credit_minor)+a;return patch(c,ctx,resource,row,{credit_minor:credit.toString(),status:minor(row.total_minor)-credit===minor(row.paid_minor)?'paid':row.status},action);}
  if(action==='cancel'){if(!finance(ctx)&&row.owner_id!==ctx.userId&&!(permissionScope(ctx,resource,`action:${action}`)&&operationAccess(ctx,resource,`action:${action}`)))fail('forbidden',403);if(!['draft','returned','submitted'].includes(str(row.status))||minor(row.paid_minor)>0n||row.journal_entry_id)fail('invalid_transition',409);if(resource==='vendor_bills'&&row.purchase_order_id){const order=await find(c,ctx,'purchase_orders',row.purchase_order_id,false,true);const lines=(await c.query('SELECT * FROM bill_lines WHERE workspace_id=$1 AND bill_id=$2 AND purchase_order_line_id IS NOT NULL AND NOT archived',[ctx.workspaceId,row.id])).rows as Row[];for(const line of lines){const poLine=await find(c,ctx,'purchase_order_lines',line.purchase_order_line_id,false,true);const billed=decimal(poLine.billed_quantity)-decimal(line.quantity);if(billed<0n)fail('billing_integrity_error',409);await patch(c,ctx,'purchase_order_lines',poLine,{billed_quantity:quantityString(billed)},'cancel_bill');}await patch(c,ctx,'purchase_orders',order,{},'cancel_bill');}return patch(c,ctx,resource,row,{status:'cancelled'},action);}
 }
 if(['vendor_bills','customer_invoices','customer_quotes'].includes(resource)&&['approve','issue'].includes(action)){
  if(!(financeActionAllowed(ctx,resource,action)))fail('finance_required',403);if(row.status!=='draft')fail('invalid_transition',409);if(minor(row.total_minor)<=0n)fail('line_items_required');return patch(c,ctx,resource,row,{status:action==='approve'?'approved':'issued',...(action==='approve'?{approved_at:new Date()}:{})},action);
 }
 if(resource==='customer_quotes'&&action==='convert'){
  if(!(financeActionAllowed(ctx,resource,action)))fail('finance_required',403);if(row.status!=='accepted')fail('quote_not_accepted',409);const invoice=await insert(c,ctx,'customer_invoices',{title:row.title,organization_id:row.organization_id,contact_id:row.contact_id,project_id:row.project_id,currency:row.currency,due_date:data.due_date??row.due_date,quote_id:row.id,total_minor:row.total_minor,payment_terms:row.payment_terms,number:await numbered(c,'INV'),status:'draft'});
  const lines=(await c.query('SELECT * FROM quote_lines WHERE workspace_id=$1 AND quote_id=$2 AND NOT archived',[ctx.workspaceId,row.id])).rows as Row[];for(const l of lines)await insert(c,ctx,'invoice_lines',{invoice_id:invoice.id,description:l.description,quantity:l.quantity,unit_price_minor:l.unit_price_minor,tax_minor:l.tax_minor});await patch(c,ctx,resource,row,{status:'converted'},action);return {...invoice,_resource:'customer_invoices'};
 }
 if(resource==='journal_entries'){
  if(action==='post')return postJournal(c,ctx,row);
  if(action==='reverse'){
   if(!(financeActionAllowed(ctx,resource,action)))fail('finance_required',403);if(row.status!=='posted'||!str(data.reason).trim())fail('invalid_transition',409);let reversed=await insert(c,ctx,resource,{title:`Reversal: ${row.title}`,entry_date:data.entry_date,currency:row.currency,number:await numbered(c,'JE'),reversal_of:row.id,notes:data.reason,status:'draft',...(row.fx_input?{fx_input:reverseJournalFx(row.fx_input as JournalFx)}:{})});const lines=(await c.query('SELECT * FROM journal_lines WHERE workspace_id=$1 AND entry_id=$2 AND NOT archived ORDER BY line_position,created_at,id',[ctx.workspaceId,row.id])).rows as Row[];for(const l of lines)await insert(c,ctx,'journal_lines',{entry_id:reversed.id,account_id:l.account_id,project_id:l.project_id,debit_minor:l.credit_minor,credit_minor:l.debit_minor,description:l.description,line_position:l.line_position});reversed=await postJournal(c,ctx,reversed);await patch(c,ctx,resource,row,{status:'reversed'},action);return {...reversed,_resource:resource};
  }
 }
 if(resource==='fiscal_periods'&&action==='close'){if(!(financeActionAllowed(ctx,resource,action)))fail('finance_required',403);if(row.status!=='open')fail('invalid_transition',409);return patch(c,ctx,resource,row,{status:'closed'},action);}
 if(resource==='bank_transactions'&&action==='reconcile'){
  if(!(financeActionAllowed(ctx,resource,action)))fail('finance_required',403);if(row.status!=='unmatched')fail('already_reconciled',409);const p=await find(c,ctx,'payments',data.payment_id,false,true);if(p.bank_account_id&&p.bank_account_id!==row.bank_account_id)fail('accounting_bank_mismatch');const incoming=p.direction==='incoming'||p.direction==='refund'&&p.source_resource!=='customer_invoices',signed=minor(p.amount_minor)*(incoming?1n:-1n);if(p.currency!==row.currency||minor(row.amount_minor,true)!==signed)fail('reconciliation_amount_mismatch');const existing=await c.query('SELECT id FROM reconciliations WHERE workspace_id=$1 AND (payment_id=$2 OR bank_transaction_id=$3)',[ctx.workspaceId,p.id,row.id]);if(existing.rowCount)fail('already_reconciled',409);await insert(c,ctx,'reconciliations',{bank_transaction_id:row.id,payment_id:p.id,matched_at:new Date()});return patch(c,ctx,resource,row,{status:'matched'},action);
 }
 return;
}
export async function procurementAction(c:Client,ctx:Context,resource:string,row:Row,action:string,data:Row):Promise<Row|undefined>{
 if(resource==='purchase_orders'&&['receive','bill'].includes(action)){
  if(!ctx.roles.some(r=>['operations','admin','finance'].includes(r))&&!(permissionScope(ctx,resource,`action:${action}`)&&operationAccess(ctx,resource,`action:${action}`)))fail('forbidden',403);if(!['approved','partially_received','received'].includes(str(row.status)))fail('order_not_approved',409);
  const line=await find(c,ctx,'purchase_order_lines',data.line_id,false,true);if(line.order_id!==row.id)fail('line_order_mismatch');const q=decimal(data.quantity);if(q<=0n)fail('positive_quantity_required');const ordered=decimal(line.quantity),received=decimal(line.received_quantity),billed=decimal(line.billed_quantity);
  if(action==='receive'){
   if(received+q>ordered)fail('over_receipt',409);await insert(c,ctx,'receipts',{order_id:row.id,line_id:line.id,quantity:quantityString(q),acceptance_notes:str(data.acceptance_notes)});await patch(c,ctx,'purchase_order_lines',line,{received_quantity:quantityString(received+q)},action);
   const missing=await c.query('SELECT 1 FROM purchase_order_lines WHERE workspace_id=$1 AND order_id=$2 AND NOT archived AND received_quantity<quantity',[ctx.workspaceId,row.id]);return patch(c,ctx,resource,row,{status:missing.rowCount?'partially_received':'received'},action);
  }
  if(billed+q>received)fail('billing_exceeds_receipt',409);const bill=await insert(c,ctx,'vendor_bills',{title:row.title,supplier_id:row.supplier_id,project_id:row.project_id,currency:row.currency,due_date:data.due_date??row.due_date,purchase_order_id:row.id,total_minor:multiplyQuantity(line.unit_price_minor,data.quantity).toString(),number:await numbered(c,'BILL'),status:'draft'});await insert(c,ctx,'bill_lines',{bill_id:bill.id,purchase_order_line_id:line.id,description:line.description,quantity:data.quantity,unit_price_minor:line.unit_price_minor,tax_minor:'0'});await patch(c,ctx,'purchase_order_lines',line,{billed_quantity:quantityString(billed+q)},action);await patch(c,ctx,resource,row,{},action);return {...bill,_resource:'vendor_bills'};
 }
 if(resource==='purchase_requests'&&action==='order'){
  if(!ctx.roles.some(r=>['operations','admin','finance'].includes(r))&&!(permissionScope(ctx,resource,`action:${action}`)&&operationAccess(ctx,resource,`action:${action}`)))fail('forbidden',403);if(row.status!=='approved')fail('request_not_approved',409);const order=await insert(c,ctx,'purchase_orders',{title:row.title,supplier_id:row.supplier_id,project_id:row.project_id,currency:row.currency,request_id:row.id,number:await numbered(c,'PO'),status:'draft'});await patch(c,ctx,resource,row,{status:'ordered'},action);return {...order,_resource:'purchase_orders'};
 }
 if(resource==='assets'){
  if(action==='assign'){if(row.status!=='available')fail('asset_not_available',409);const member=await c.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'",[ctx.workspaceId,data.user_id]);if(!member.rowCount)fail('invalid_member');await insert(c,ctx,'asset_assignments',{asset_id:row.id,user_id:data.user_id,assigned_at:new Date()});return patch(c,ctx,resource,row,{status:'assigned',custodian_id:data.user_id,location:data.location??row.location},action);}
  if(action==='return'){if(row.status!=='assigned')fail('asset_not_assigned',409);const assignment=(await c.query('SELECT * FROM asset_assignments WHERE workspace_id=$1 AND asset_id=$2 AND returned_at IS NULL FOR UPDATE',[ctx.workspaceId,row.id])).rows[0] as Row|undefined;if(!assignment)fail('assignment_missing',409);await patch(c,ctx,'asset_assignments',assignment,{returned_at:new Date()},action);return patch(c,ctx,resource,row,{status:'available',custodian_id:null},action);}
  if(action==='dispose'){if(row.status!=='available')fail('asset_must_be_returned',409);return patch(c,ctx,resource,row,{status:'disposed',notes:str(data.reason)},action);}
 }
 if(resource==='subscriptions'&&action==='renew'){if(!data.due_date||str(data.due_date)<=str(row.due_date))fail('renewal_date_must_advance');return patch(c,ctx,resource,row,{status:'active',due_date:data.due_date},action);}
 return;
}
