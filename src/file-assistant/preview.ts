import {createHash} from 'node:crypto';
import type {Context} from '../lib/context';
import {find,assertOperation,type Client,str} from '../domain/core';
import {decimal,multiplyQuantity} from '../domain/money';
import {bilingual,type Plan,type Source,type Target,type Preview,type PreviewItem} from './schema';
function canonical(value:unknown):unknown{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;}
export const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))??'null').digest('hex');
export function receiptFingerprint(r:Plan['receipts'][number],file:Source){return fingerprint(['receipt',r.supplier.trim().toLowerCase(),r.reference.trim().toLowerCase(),r.date,r.currency,r.total_minor,r.reference?'':file.sha256]);}
export async function buildPreview(c:Client,ctx:Context,plan:Plan,files:Source[],targets:Target[]):Promise<Preview>{
 const items:PreviewItem[]=[],seen=new Set<string>();
 for(const [i,p]of plan.contacts.entries()){
  const email=p.email.trim().toLowerCase(),duplicate=seen.has(email)||(await c.query('SELECT 1 FROM contacts WHERE workspace_id=$1 AND company_id=$2 AND lower(email)=$3 LIMIT 1',[ctx.workspaceId,ctx.companyId,email])).rowCount;
  seen.add(email);items.push({key:'contacts:'+i,kind:'contacts',title:p.name||p.email,status:duplicate?'duplicate':'ready',reason:duplicate?'ASSISTANT_DUPLICATE':undefined,source_file:p.source_file,detail:{name:p.name||p.email,email:p.email,job_title:p.job_title,do_not_contact:p.do_not_contact,notes:bilingual(p.notes_zh,p.notes_en)}});
 }
 for(const [i,p]of plan.receipts.entries()){
  const file=files.find(f=>f.id===p.source_file)!,key=receiptFingerprint(p,file);
  const duplicate=seen.has(key)||(await c.query('SELECT 1 FROM file_assistant_origins WHERE workspace_id=$1 AND company_id=$2 AND fingerprint=$3 LIMIT 1',[ctx.workspaceId,ctx.companyId,key])).rowCount||(await c.query("SELECT 1 FROM attachments WHERE workspace_id=$1 AND company_id=$2 AND sha256=$3 AND resource IN ('vendor_bills','documents') LIMIT 1",[ctx.workspaceId,ctx.companyId,file.sha256])).rowCount;
  seen.add(key);
  const currency=(await c.query('SELECT minor_digits FROM currencies WHERE workspace_id=$1 AND company_id=$2 AND code=$3 AND NOT archived',[ctx.workspaceId,ctx.companyId,p.currency])).rows[0];
  const suppliers=(await c.query('SELECT id FROM suppliers WHERE workspace_id=$1 AND company_id=$2 AND lower(trim(name))=lower(trim($3)) AND NOT archived',[ctx.workspaceId,ctx.companyId,p.supplier])).rows;
  let reason='';if(!p.supplier||!p.title||!p.currency||!currency||!p.date||p.total_minor===null||!p.lines.length)reason='ASSISTANT_RECEIPT_INCOMPLETE';
  if(p.lines.some(l=>!l.description||decimal(l.quantity)<=0n)||p.total_minor!==null&&p.lines.reduce((sum,l)=>sum+multiplyQuantity(l.unit_price_minor,l.quantity)+BigInt(l.tax_minor),0n)!==BigInt(p.total_minor))reason='ASSISTANT_TOTAL_MISMATCH';
  if(suppliers.length>1)reason='ASSISTANT_SUPPLIER_AMBIGUOUS';
  if(suppliers.length===1){try{await find(c,ctx,'suppliers',suppliers[0].id);}catch{reason='ASSISTANT_SUPPLIER_UNAVAILABLE';}}
  items.push({key:'receipts:'+i,kind:'receipts',title:p.title||p.supplier,status:duplicate?'duplicate':reason?'blocked':'ready',reason:duplicate?'ASSISTANT_DUPLICATE':reason||undefined,source_file:p.source_file,detail:{supplier:p.supplier,supplier_id:suppliers.length===1&&!reason?suppliers[0].id:null,title:p.title,reference:p.reference,date:p.date,currency:p.currency,minor_digits:currency?.minor_digits??2,total_minor:p.total_minor,lines:p.lines,notes:bilingual(p.notes_zh,p.notes_en),payment_evidence:p.payment_evidence}});
 }
 for(const [i,p]of plan.notes.entries()){
  const target=targets.find(t=>t.id===p.target_id)!;let reason='';
  try{const row=await find(c,ctx,target.resource,target.id,true);await assertOperation(c,ctx,target.resource,'edit',row);if(row.archived||target.resource==='vendor_bills'&&!['draft','returned'].includes(str(row.status)))reason='ASSISTANT_RECORD_LOCKED';else if(Number(row.version)!==target.version)reason='ASSISTANT_RECORD_CHANGED';}catch{reason='ASSISTANT_RECORD_UNAVAILABLE';}
  items.push({key:'notes:'+i,kind:'notes',title:target.title,status:reason?'blocked':'ready',reason:reason||undefined,before:target.notes,after:bilingual(p.notes_zh,p.notes_en),detail:{target_id:target.id,resource:target.resource,version:target.version}});
 }
 return{summary:plan.summary,questions:plan.questions,warnings:plan.warnings,items};
}
