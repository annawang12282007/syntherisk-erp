import {normalizeRichText} from '../lib/rich-text';
import {containingFiscalYear,type FiscalCalendar} from './fiscal-calendar';
import {builtinRoles} from './permission-options';
import type {PoolClient} from 'pg';
import {query,pool} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {resources,type ResourceDef} from './registry';
import {minor,decimal,multiplyQuantity} from './money';
import {responsiblePredicate} from './responsibility-scope';
import {delegatedPredicate} from './delegation-scope';
import {privacyGraphPredicate} from './privacy-scope';
import {privacyResources,supportsPrivacy} from './privacy-resources';
export type Row=Record<string,unknown>;
export type Client=Pick<PoolClient,'query'>;
export const str=(v:unknown)=>v===null||v===undefined?'':String(v);
export const elevated=(ctx:Context)=>ctx.roles.some(r=>['admin','operations'].includes(r));
export const finance=(ctx:Context)=>ctx.roles.some(role=>['finance','admin'].includes(role))||ctx.permissions?.some(p=>p.resource==='finance_management'&&p.operation==='operate'&&p.scope==='all')===true;
export const reviewer=(ctx:Context)=>ctx.roles.includes('reviewer');
export const isExternal=(ctx:Context)=>ctx.roles.length>0&&ctx.roles.every(r=>r==='external');
type PermissionRule={resource:string;operation:string;scope:string;role_code?:string};
export function permissionScope(ctx:Context,resource:string,operation:string):string|undefined{
 const rules=((ctx as unknown as {permissions?:PermissionRule[]}).permissions??[]).filter(p=>(p.resource===resource||p.resource==='*'&&!['team_private','finance_management'].includes(resource))&&p.operation===operation&&(!p.role_code||ctx.roles.includes(p.role_code)));
 if(!rules.length)return ctx.roles.length&&!ctx.roles.some(role=>builtinRoles.includes(role))?'none':undefined;
 const scopes=[...new Set(rules.flatMap(rule=>rule.scope.split(',')))];
 if(scopes.includes('all'))return 'all';
 return scopes.filter(scope=>scope!=='none').sort().join(',')||'none';
}
export function operationAccess(ctx:Context,resource:string,operation:string):boolean{
 if(resource==='communication_templates'&&['create','edit'].includes(operation))return false;
 const custom=permissionScope(ctx,resource,operation);if(custom)return custom!=='none';
 if(isExternal(ctx))return operation==='read';
 if(operation.startsWith('action:'))return operationAccess(ctx,resource,'edit');
 if(operation==='pay'||operation==='post')return finance(ctx);
 if(operation==='approve')return resource==='expense_claims'?reviewer(ctx)||ctx.roles.includes('admin'):reviewer(ctx)||elevated(ctx)||finance(ctx);
 if(operation==='delete'||operation==='delete_review')return elevated(ctx);
 if(operation==='publish')return elevated(ctx);
 if(operation==='export')return finance(ctx)||elevated(ctx)||resources[resource]?.module!=='finance';
 if(operation==='create')return resources[resource]?.module!=='finance'||finance(ctx)||['expense_claims','expense_lines'].includes(resource);
 return true;
}
export async function assertOperation(c:Client,ctx:Context,resource:string,operation:string,row?:Row){
 if(!operationAccess(ctx,resource,operation))fail('forbidden',403);
 const custom=permissionScope(ctx,resource,operation);if(!custom||custom==='all'||!row)return;
 const scopes=custom.split(',');
 if((scopes.includes('own')||scopes.includes('created'))&&row.created_by===ctx.userId)return;
 if(scopes.some(scope=>['own','responsible','assigned'].includes(scope))){
  if(row.owner_id===ctx.userId)return;
  if(scopes.includes('assigned')&&[row.recipient_id,row.to_user_id,row.reviewer_id,row.assignee_id].includes(ctx.userId))return;
  if((await c.query('SELECT 1 FROM record_responsibles WHERE workspace_id=$1 AND company_id=$2 AND resource=$3 AND record_id=$4 AND user_id=$5',[ctx.workspaceId,ctx.companyId,resource,row.id,ctx.userId])).rowCount)return;
  if(scopes.includes('assigned')&&resource==='tasks'&&(await c.query('SELECT 1 FROM task_collaborators WHERE workspace_id=$1 AND task_id=$2 AND user_id=$3 AND NOT archived',[ctx.workspaceId,row.id,ctx.userId])).rowCount)return;
 }
 if(scopes.includes('granted')&&(await c.query(`SELECT 1 FROM record_grants WHERE workspace_id=$1 AND resource=$2 AND record_id=$3 AND user_id=$4${['read','export'].includes(operation)?'':' AND can_edit'}`,[ctx.workspaceId,resource,row.id,ctx.userId])).rowCount)return;
 fail('forbidden',403);
}
export function fail(code:string,status=422):never{throw new DomainError(status,code);}
export const def=(resource:string):ResourceDef=>resources[resource]??fail('resource_not_found',404);
export async function lockCurrencyConfiguration(c:Client,ctx:Context,resource:string){if(resource==='currencies'||def(resource).fields.some(f=>f.key==='currency'))await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${ctx.workspaceId}:${ctx.companyId}:currency_configuration`]);}
export async function currencyUsed(c:Client,ctx:Context,code:unknown){const tables=Object.values(resources).filter(r=>r.fields.some(f=>f.key==='currency'));const sql=tables.map(r=>`SELECT 1 FROM ${r.key} WHERE workspace_id=$1 AND company_id=$2 AND currency=$3`).join(' UNION ALL ')+" UNION ALL SELECT 1 FROM journal_entries WHERE workspace_id=$1 AND company_id=$2 AND fx_input->>'currency'=$3";return Boolean((await c.query(`SELECT 1 FROM (${sql}) AS usage LIMIT 1`,[ctx.workspaceId,ctx.companyId,code])).rowCount);}
export async function enrichCurrencyUnits(ctx:Context,value:unknown){const configured=await query('SELECT code,minor_digits FROM currencies WHERE workspace_id=$1 AND company_id=$2 AND NOT archived',[ctx.workspaceId,ctx.companyId]);const digits=new Map(configured.map(row=>[str(row.code),Number(row.minor_digits)]));const visit=(input:unknown):void=>{if(Array.isArray(input)){for(const item of input)visit(item);return;}if(!input||typeof input!=='object'||input instanceof Date)return;const row=input as Row;for(const field of ['currency','base_currency','source_currency'])if(row[field]){const code=str(row[field]);let exponent=digits.get(code);if(exponent===undefined){try{exponent=new Intl.NumberFormat('en',{style:'currency',currency:code}).resolvedOptions().maximumFractionDigits??2;}catch{exponent=2;}}row[`${field}_minor_digits`]=exponent;}for(const item of Object.values(row))if(item&&typeof item==='object')visit(item);};visit(value);return value;}
export function dashboardPredicate(ctx:Context,resource:string,preset:string,view:unknown='mine'):string|undefined{const mine=view!=='team',own=mine?' AND '+responsiblePredicate(resource):'',today="(now() AT TIME ZONE (SELECT time_zone FROM companies WHERE id=$2))::date",taskOwn=mine?" AND ((r.completion_required AND $3=ANY(r.completion_user_ids)) OR "+responsiblePredicate("tasks")+" OR EXISTS(SELECT 1 FROM task_collaborators c WHERE c.workspace_id=$1 AND c.task_id=r.id AND c.user_id=$3 AND NOT c.archived))":'';const rules:Record<string,[string,string]>={tasks:['tasks',`r.status NOT IN ('done','cancelled')${taskOwn}`],overdue_tasks:['tasks',`r.status NOT IN ('done','cancelled') AND r.due_date<${today}${taskOwn}`],requests:['work_requests',`r.status IN ('pending','needs_info','submitted')${mine?' AND (r.recipient_id=$3 OR r.requester_id=$3)':''}`],handoffs:['handoffs',`r.status IN ('pending','needs_info')${mine?' AND r.to_user_id=$3':''}`],reviews:['reviews',`r.status='pending'${mine?' AND r.reviewer_id=$3':''}`],payments:['expense_claims',`r.status IN ('approved','partially_paid','posted') AND r.approved_minor>r.paid_minor${finance(ctx)?'':own}`],expense_approvals:['expense_claims',"r.status='submitted'"],bills:['vendor_bills',"r.status IN ('approved','partially_paid','posted') AND r.total_minor-r.credit_minor>r.paid_minor"],events:['events',`(r.status='scheduled' OR r.recurrence_parent_id IS NOT NULL) AND ((r.all_day AND r.start_date>=${today} AND r.start_date<${today}+14) OR (NOT r.all_day AND r.start_at>=now() AND r.start_at<now()+interval '14 day') OR r.recurrence_rule IS NOT NULL OR r.recurrence_parent_id IS NOT NULL)${mine?' AND ('+responsiblePredicate('events')+' OR EXISTS(SELECT 1 FROM event_participants p WHERE p.workspace_id=$1 AND p.event_id=r.id AND p.user_id=$3 AND NOT p.archived))':''}`],subscriptions:['subscriptions',`r.status='active' AND (r.due_date<=${today}+30 OR r.cancel_by<=${today}+30)${own}`]};const rule=rules[preset];return rule?.[0]===resource?rule[1]:undefined;}
export const uuid=(value:unknown):string=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str(value))?str(value):fail('invalid_id');
const parentKeys:Record<string,[string,string]>={payment_allocations:['payments','payment_id'],engagement_collaborators:['engagements','engagement_id'],expense_lines:['expense_claims','claim_id'],approvals:['expense_claims','claim_id'],quote_lines:['customer_quotes','quote_id'],invoice_lines:['customer_invoices','invoice_id'],bill_lines:['vendor_bills','bill_id'],journal_lines:['journal_entries','entry_id'],purchase_order_lines:['purchase_orders','order_id'],budget_lines:['budgets','budget_id'],document_versions:['documents','document_id'],task_collaborators:['tasks','task_id'],task_comments:['tasks','task_id'],task_checklist:['tasks','task_id'],task_dependencies:['tasks','task_id'],project_members:['projects','project_id'],event_participants:['events','event_id'],audience_members:['audience_groups','group_id']};
export {parentKeys};
/** Alias is internal constant; resource is registry-validated before interpolation. */
export function scope(ctx:Context,resource:string,alias='r',write=false,allowGrants=true,targetHint?:{resource:string|null},privacyReader=false,includeDeleted=false):{sql:string;values:unknown[]} {
 const r=def(resource),values:unknown[]=[ctx.workspaceId,ctx.companyId,ctx.userId];
 let base=`${alias}.workspace_id=$1 AND ${alias}.company_id=$2 AND $3::text IS NOT NULL`;
 if(!privacyReader&&!includeDeleted)base+=` AND NOT EXISTS(SELECT 1 FROM record_disposals disposal WHERE disposal.workspace_id=$1 AND disposal.company_id=$2 AND disposal.resource='${resource}' AND disposal.record_id=${alias}.id)`;
 const delegated=allowGrants?delegatedPredicate(resource,alias,write):'false';
 const grant=allowGrants?`(EXISTS(SELECT 1 FROM record_grants g WHERE g.workspace_id=$1 AND g.resource='${resource}' AND g.record_id=${alias}.id AND g.user_id=$3${write?' AND g.can_edit':''}) OR ${delegated})`:'false';
 if(!privacyReader&&supportsPrivacy(resource))base+=` AND ${privacyGraphPredicate(ctx,`'${resource}'`,`${alias}.id`,allowGrants)}`;
 const parentField=r.parent?r.fields.find(f=>f.ref===r.parent):undefined,privacyParent=parentKeys[resource]??(r.parent&&parentField?[r.parent,parentField.key]:undefined);if(privacyParent){const p=scope(ctx,privacyParent[0],`privacy_parent_${resource}`,false,allowGrants,undefined,privacyReader);base+=` AND EXISTS(SELECT 1 FROM ${privacyParent[0]} privacy_parent_${resource} WHERE privacy_parent_${resource}.id=${alias}.${privacyParent[1]} AND ${p.sql})`;}
 if(!privacyReader&&!supportsPrivacy(resource)&&!['finance','procurement','settings'].includes(r.module))for(const field of r.fields.filter(f=>f.ref&&supportsPrivacy(f.ref)&&f.key!==privacyParent?.[1])){base+=` AND (${alias}.${field.key} IS NULL OR ${privacyGraphPredicate(ctx,`'${field.ref}'`,`${alias}.${field.key}`,allowGrants,field.key!=='project_id')})`;}
 if(!privacyReader&&['handoffs','work_requests','reviews','delegations'].includes(resource)&&(resource==='reviews'||!targetHint||targetHint.resource&&supportsPrivacy(targetHint.resource))){const targetExpression=targetHint?.resource?`'${targetHint.resource}'`:`${alias}.target_resource`;base+=` AND (${alias}.target_resource IS NULL${resource==='reviews'?'':` OR ${alias}.target_resource NOT IN(${privacyResources.map(key=>`'${key}'`).join(',')})`} OR ${privacyGraphPredicate(ctx,targetExpression,`${alias}.target_id`,allowGrants)})`; }
 const custom=permissionScope(ctx,resource,write?'edit':'read');if(custom){
  const clauses=custom.split(',').map(selected=>{
   if(selected==='all')return 'true';
   if(selected==='created')return `${alias}.created_by=$3`;
   if(selected==='responsible')return responsiblePredicate(resource,alias);
   if(selected==='own')return `(${responsiblePredicate(resource,alias)} OR ${alias}.created_by=$3)`;
   if(selected==='granted')return grant;
   if(selected==='assigned')return `(${resource==='tasks'&&!write?`(${alias}.completion_required AND $3=ANY(${alias}.completion_user_ids)) OR `:''}${responsiblePredicate(resource,alias)}${resource==='tasks'?` OR EXISTS(SELECT 1 FROM task_collaborators tc WHERE tc.task_id=${alias}.id AND tc.workspace_id=$1 AND tc.user_id=$3 AND NOT tc.archived)`:''}${resource==='work_requests'?` OR ${alias}.recipient_id=$3`:''}${resource==='handoffs'?` OR ${alias}.to_user_id=$3`:''}${resource==='reviews'?` OR ${alias}.reviewer_id=$3`:''}${resource==='delegations'?` OR ${alias}.assignee_id=$3`:''})`;
   return 'false';
  });return {sql:`${base} AND (${clauses.join(' OR ')}${custom!=='none'?' OR '+delegated:''})`,values};
 }
 const parent=parentKeys[resource];if(parent&&(isExternal(ctx)||write||r.module==='finance'||parent[0]==='tasks')){const p=scope(ctx,parent[0],'parent_record',write,allowGrants,undefined,privacyReader);return {sql:`${base} AND EXISTS(SELECT 1 FROM ${parent[0]} parent_record WHERE parent_record.id=${alias}.${parent[1]} AND ${p.sql})`,values};}
 if(resource==='delegations')return {sql:`${base} AND ($3=${alias}.requester_id OR $3=${alias}.assignee_id${ctx.roles.includes('admin')?' OR true':''})`,values};
 if(isExternal(ctx))return {sql:`${base} AND ${grant}`,values};
 if(r.module==='finance'){
  if(finance(ctx)||ctx.roles.includes('admin')&&!write)return {sql:`${base} AND $3::text IS NOT NULL`,values};
  if(resource==='expense_claims')return {sql:`${base} AND (${responsiblePredicate(resource,alias)} OR ${alias}.created_by=$3${reviewer(ctx)&&!write?` OR ${alias}.status IN ('submitted','approved','partially_paid','paid','posted')`:''} OR ${delegated})`,values};
  if(resource==='expense_lines'||resource==='approvals')return {sql:`${base} AND EXISTS(SELECT 1 FROM expense_claims p WHERE p.id=${alias}.claim_id AND p.workspace_id=$1 AND (${responsiblePredicate('expense_claims','p')} OR p.created_by=$3${reviewer(ctx)&&!write?` OR p.status IN ('submitted','approved','partially_paid','paid','posted')`:''}))`,values};
  return {sql:`${base} AND $3::text IS NOT NULL AND ${delegated}`,values};
 }
 if(r.module==='settings'&&!ctx.roles.includes('admin')&&!finance(ctx))return {sql:`${base} AND $3::text IS NOT NULL AND ${write?'false':'true'}`,values};
 if(elevated(ctx))return {sql:`${base} AND $3::text IS NOT NULL`,values};
 const own=`${responsiblePredicate(resource,alias)} OR ${alias}.created_by=$3`;
 if(resource==='handoffs')return {sql:`${base} AND (${own} OR ${alias}.from_user_id=$3 OR ${alias}.to_user_id=$3)`,values};
 if(resource==='work_requests')return {sql:`${base} AND (${own} OR ${alias}.requester_id=$3 OR ${alias}.recipient_id=$3)`,values};
 if(resource==='reviews')return {sql:`${base} AND (${own} OR ${alias}.reviewer_id=$3)`,values};
 if(write)return {sql:`${base} AND (${own} OR ${grant}${resource==='tasks'?` OR EXISTS(SELECT 1 FROM task_collaborators tc WHERE tc.workspace_id=$1 AND tc.task_id=${alias}.id AND tc.user_id=$3 AND NOT tc.archived)`:''}${resource==='engagements'?` OR EXISTS(SELECT 1 FROM engagement_collaborators ec WHERE ec.workspace_id=$1 AND ec.engagement_id=${alias}.id AND ec.user_id=$3 AND NOT ec.archived)`:''})`,values};
 return {sql:`${base} AND $3::text IS NOT NULL`,values};
}
export async function find(c:Client,ctx:Context,resource:string,id:unknown,write=false,lock=false):Promise<Row>{
 const key=def(resource).key,recordId=uuid(id);let hint:{resource:string|null}|undefined;
 // Only routing metadata is read first; it is never returned. The final scoped query
 // rechecks the exact value, including NULL, so a concurrent retarget fails closed.
 if(['handoffs','work_requests','reviews','delegations'].includes(resource)){const routing=(await c.query(`SELECT target_resource FROM ${key} WHERE workspace_id=$1 AND company_id=$2 AND id=$3`,[ctx.workspaceId,ctx.companyId,recordId])).rows[0];if(!routing||routing.target_resource!==null&&(typeof routing.target_resource!=='string'||!resources[routing.target_resource]))fail('record_not_found',404);hint={resource:routing.target_resource};}
 const s=scope(ctx,resource,'r',write,true,hint),result=await c.query(`SELECT r.* FROM ${key} r WHERE ${s.sql} AND r.id=$4${hint?' AND r.target_resource IS NOT DISTINCT FROM $5::text':''}${lock?' FOR UPDATE OF r':''}`,[...s.values,recordId,...(hint?[hint.resource]:[])]);return result.rows[0]??fail('record_not_found',404);
}
export async function assertAccess(ctx:Context,resource:string,id:string,mode:'read'|'write'='read'):Promise<Row>{return find(pool,ctx,resource,id,mode==='write');}
export async function canReadRecord(ctx:Context,resource:string,id:string):Promise<boolean>{try{await assertAccess(ctx,resource,id);return true;}catch{return false;}}
export function checkVersion(row:Row,data:Row){if(!Number.isInteger(Number(data.version))||Number(data.version)!==row.version)fail('version_conflict',409);}
export async function validateActionValues(c:Client,ctx:Context,resource:string,action:string,data:Row){for(const f of def(resource).actionFields?.[action]??[]){const value=data[f.key];if(value===undefined||value===null||value==='')continue;if(f.type==='money'){minor(value);continue;}if(f.type==='number'){decimal(value);continue;}if(f.type==='boolean'){if(typeof value!=='boolean')fail('invalid_boolean');continue;}if(typeof value!=='string')fail('invalid_text');if(f.type==='reference'){if(f.ref==='members'){const member=await c.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active' AND user_id IS DISTINCT FROM (SELECT initial_admin_user_id FROM workspaces WHERE id=$1)",[ctx.workspaceId,value]);if(!member.rowCount)fail('invalid_member');}else await find(c,ctx,str(f.ref),value);}if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))))fail('invalid_date');if(f.type==='datetime'&&(!/(Z|[+-]\d{2}:\d{2})$/.test(value)||Number.isNaN(Date.parse(value))))fail('timezone_offset_required');if(f.key==='url'||f.key.endsWith('_url')){try{if(!['https:','http:'].includes(new URL(value).protocol))fail('invalid_url');}catch{fail('invalid_url');}}}}
export async function audit(c:Client,ctx:Context,resource:string,id:string,action:string,before:Row|null,after:Row|null){
 const safe=(r:Row|null)=>r?Object.fromEntries(Object.entries(r).filter(([k])=>!['body','content','direct_record','direct_quote','notes','snapshot','submitted_snapshot','target_snapshot','interpretation','purpose','description','url','video_url','signed_document_url'].includes(k))):null;
 await c.query('INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)',[ctx.workspaceId,ctx.userId,resource,id,action,JSON.stringify(safe(before)),JSON.stringify(safe(after))]);
}
export async function notify(c:Client,ctx:Context,userId:unknown,kind:string,resource:string,row:Row){if(!userId)return;await c.query("INSERT INTO notifications(workspace_id,user_id,kind,title_key,resource,record_id,dedupe_key) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active') AND NOT EXISTS(SELECT 1 FROM notification_preferences WHERE workspace_id=$1 AND user_id=$2 AND kind=$3 AND NOT enabled) ON CONFLICT DO NOTHING",[ctx.workspaceId,userId,kind,`notification.${kind}`,resource,row.id,`${resource}:${row.id}:${kind}:${row.version}`]);}
export async function assertDependenciesComplete(c:Client,ctx:Context,id:unknown){const blocked=await c.query("SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on_id AND t.workspace_id=d.workspace_id WHERE d.workspace_id=$1 AND d.task_id=$2 AND NOT d.archived AND t.status<>'done'",[ctx.workspaceId,id]);if(blocked.rowCount)fail('dependency_incomplete',409);}
export async function notifyDependents(c:Client,ctx:Context,task:Row){const dependents=(await c.query("SELECT t.* FROM tasks t WHERE t.workspace_id=$1 AND t.company_id=$2 AND NOT t.archived AND EXISTS(SELECT 1 FROM task_dependencies d WHERE d.workspace_id=$1 AND d.task_id=t.id AND d.depends_on_id=$3 AND NOT d.archived) AND NOT EXISTS(SELECT 1 FROM task_dependencies d JOIN tasks prerequisite ON prerequisite.id=d.depends_on_id AND prerequisite.workspace_id=d.workspace_id WHERE d.workspace_id=$1 AND d.task_id=t.id AND NOT d.archived AND prerequisite.status<>'done')",[ctx.workspaceId,ctx.companyId,task.id])).rows as Row[];for(const dependent of dependents)await notify(c,ctx,dependent.owner_id,'dependency_ready','tasks',dependent);}
export async function insert(c:Client,ctx:Context,resource:string,data:Row):Promise<Row>{
 const [workspace]=(await c.query('SELECT initial_admin_user_id,operational_owner_user_id FROM workspaces WHERE id=$1',[ctx.workspaceId])).rows;const owner=data.owner_id===undefined?ctx.userId:data.owner_id;const safeOwner=owner===workspace?.initial_admin_user_id?workspace.operational_owner_user_id:owner;
 const fields={workspace_id:ctx.workspaceId,company_id:ctx.companyId,created_by:ctx.userId,updated_by:ctx.userId,...data,owner_id:safeOwner};const keys=Object.keys(fields);const row=(await c.query(`INSERT INTO ${def(resource).key}(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,Object.values(fields))).rows[0] as Row;await audit(c,ctx,resource,str(row.id),'create',null,row);return row;
}
export async function patch(c:Client,ctx:Context,resource:string,row:Row,data:Row,action='update'):Promise<Row>{
 const fields={...data,updated_by:ctx.userId,updated_at:new Date(),version:Number(row.version)+1};const keys=Object.keys(fields);const result=await c.query(`UPDATE ${def(resource).key} SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} WHERE id=$${keys.length+1} AND workspace_id=$${keys.length+2} AND version=$${keys.length+3} RETURNING *`,[...Object.values(fields),row.id,ctx.workspaceId,row.version]);const updated=result.rows[0] as Row|undefined;if(!updated)fail('version_conflict',409);await audit(c,ctx,resource,str(row.id),action,row,updated);return updated;
}
export async function validate(c:Client,ctx:Context,resource:string,data:Row,existing?:Row):Promise<Row>{
 const r=def(resource),out:Row={};
 for(const [key,value] of Object.entries(data)){
  if(key==='version'||key==='idempotency_key')continue;
  const f=r.fields.find(f=>f.key===key);if(!f||f.readonly)fail('readonly_or_unknown_field');
  if(supportsPrivacy(resource)&&['viewer_user_ids','viewer_team_ids','completion_user_ids'].includes(key)){if(!Array.isArray(value)||value.some(item=>typeof item!=='string'))fail(key==='viewer_team_ids'?'invalid_record_teams':'invalid_record_viewers');out[key]=value;continue;}
  if(resource==='currencies'&&key==='minor_digits'){
   if((typeof value!=='number'&&typeof value!=='string')||typeof value==='string'&&!value.trim()||!Number.isInteger(Number(value))||Number(value)<0||Number(value)>6)fail('invalid_currency_digits');
   out[key]=Number(value);continue;
  }
  if(value===null||value===''){if(f.required)fail('required_field');out[key]=null;continue;}
  if(f.type==='boolean'){if(typeof value!=='boolean')fail('invalid_boolean');out[key]=value;}
  else if(f.type==='money')out[key]=minor(value,resource==='bank_transactions').toString();
  else if(f.type==='number'){if(/quantity/.test(key)){decimal(value);out[key]=str(value);}else {if(!Number.isInteger(Number(value))||Math.abs(Number(value))>2147483647)fail('invalid_number');out[key]=Number(value);}}
  else if(f.type==='date'){if(!/^\d{4}-\d{2}-\d{2}$/.test(str(value))||Number.isNaN(Date.parse(str(value))))fail('invalid_date');out[key]=str(value);}
  else if(f.type==='datetime'){if(!/(Z|[+-]\d{2}:\d{2})$/.test(str(value))||Number.isNaN(Date.parse(str(value))))fail('timezone_offset_required');out[key]=new Date(str(value));}
  else if(f.type==='reference'){
   if(f.ref==='members'){if(!(key==='owner_id'&&existing&&value===existing.owner_id)){const m=await c.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active' AND user_id IS DISTINCT FROM (SELECT initial_admin_user_id FROM workspaces WHERE id=$1)",[ctx.workspaceId,value]);if(!m.rowCount)fail('invalid_member');}out[key]=str(value);}
   else {const p=await find(c,ctx,str(f.ref),value);if(p.archived)fail('reference_archived');out[key]=uuid(value);}
  }else if(f.type==='textarea'){if(typeof value!=='string')fail('invalid_text');try{out[key]=normalizeRichText(value,200000,f.required?1:0);}catch{fail('invalid_text');}}else {if(typeof value!=='string'||value.length>200000)fail('invalid_text');if(f.type==='email'&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))fail('invalid_email');if(f.options&&!f.options.includes(value))fail('invalid_option');if((key==='currency'||key.endsWith('_currency'))&&!/^[A-Z]{3}$/.test(value))fail('invalid_currency');if(key==='rate'||key==='exchange_rate'){if(decimal(value,12)<=0n)fail('invalid_rate');}if(['url','website','video_url','signed_document_url'].includes(key)){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol))fail('invalid_url');}catch{fail('invalid_url');}}out[key]=value;}
 }
 // Persist the same explicit default used by validation; the legacy database default is zero.
 if(resource==='currencies'&&!existing&&!Object.hasOwn(out,'minor_digits'))out.minor_digits=2;
 const merged={...existing,...out};for(const f of r.fields){if(f.required&&(merged[f.key]===undefined||merged[f.key]===null||merged[f.key]===''))fail('required_field');}
 if(!existing&&isExternal(ctx))fail('forbidden',403);
 let delegatedCreate=false;const parentForCreate=parentKeys[resource];
 if(!existing&&parentForCreate&&r.module==='finance'&&permissionScope(ctx,resource,'create')!=='none'){
  const [parent,key]=parentForCreate,p=scope(ctx,parent,'p',true);delegatedCreate=Boolean((await c.query(`SELECT 1 FROM ${parent} p WHERE ${p.sql} AND p.id=$4 AND ${delegatedPredicate(parent,'p',true)}`,[...p.values,merged[key]])).rowCount);
 }
 if(!existing&&!operationAccess(ctx,resource,'create')&&!delegatedCreate)fail('forbidden',403);
 if(!existing&&r.module==='finance'&&!finance(ctx)&&!['expense_claims','expense_lines'].includes(resource)&&!permissionScope(ctx,resource,'create')&&!delegatedCreate)fail('finance_required',403);
 if(r.module==='settings'&&!ctx.roles.includes('admin')&&!finance(ctx))fail('forbidden',403);
 if(resource==='expense_claims'&&!existing&&out.owner_id&&out.owner_id!==ctx.userId)fail('own_expense_only',403);
 if(resource==='engagements'){if(Boolean(merged.pipeline_id)!==Boolean(merged.stage_id))fail('pipeline_stage_pair_required');if(merged.stage_id){const stage=await find(c,ctx,'pipeline_stages',merged.stage_id);if(stage.pipeline_id!==merged.pipeline_id)fail('stage_pipeline_mismatch');if(stage.required_next_step&&!merged.next_step)fail('next_step_required');}}
 if(resource==='events')validateEvent(merged);
 if(resource==='documents'&&(merged.related_resource||merged.related_id)){if(!merged.related_resource||!merged.related_id)fail('related_record_required');await find(c,ctx,str(merged.related_resource),merged.related_id);}
 if(['quote_lines','invoice_lines','bill_lines','purchase_order_lines'].includes(resource)&&decimal(merged.quantity)<=0n)fail('positive_quantity_required');
 if(resource==='budgets'){const base=(await c.query('SELECT base_currency FROM companies WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,ctx.companyId])).rows[0]?.base_currency;if(merged.currency!==base)fail('budget_base_currency_required');}
 if(resource==='accounts'&&existing&&((out.kind&&out.kind!==existing.kind)||(out.code&&out.code!==existing.code))){const used=await c.query("SELECT 1 FROM journal_lines l JOIN journal_entries j ON j.id=l.entry_id WHERE l.account_id=$1 AND l.workspace_id=$2 AND j.status IN ('posted','reversed') LIMIT 1",[existing.id,ctx.workspaceId]);if(used.rowCount)fail('posted_account_classification_immutable',409);}
 if(resource==='tasks'&&merged.parent_task_id){if(existing?.id===merged.parent_task_id)fail('dependency_cycle');let current:unknown=merged.parent_task_id;for(let i=0;current&&i<1000;i++){const p=await find(c,ctx,'tasks',current);if(existing?.id===p.id)fail('dependency_cycle');current=p.parent_task_id;} }
 if(resource==='task_dependencies'){
  if(merged.task_id===merged.depends_on_id)fail('dependency_cycle');
  const cycle=await c.query('WITH RECURSIVE chain(id) AS (SELECT depends_on_id FROM task_dependencies WHERE workspace_id=$1 AND task_id=$2 AND NOT archived UNION SELECT d.depends_on_id FROM task_dependencies d JOIN chain ON d.task_id=chain.id WHERE d.workspace_id=$1 AND NOT d.archived) SELECT 1 FROM chain WHERE id=$3',[ctx.workspaceId,merged.depends_on_id,merged.task_id]);if(cycle.rowCount)fail('dependency_cycle');
 }
 if(resource==='tasks'&&merged.milestone_id){const milestone=await find(c,ctx,'milestones',merged.milestone_id);if(merged.project_id&&milestone.project_id!==merged.project_id)fail('milestone_project_mismatch');}
 if(resource==='event_participants'&&!merged.user_id&&!merged.contact_id)fail('participant_required');
 if(resource==='fiscal_periods'){if(str(merged.start_date)>str(merged.end_date))fail('invalid_period');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${ctx.workspaceId}:periods`]);const overlap=await c.query('SELECT 1 FROM fiscal_periods WHERE workspace_id=$1 AND company_id=$2 AND start_date<=$3 AND end_date>=$4 AND ($5::uuid IS NULL OR id<>$5::uuid)',[ctx.workspaceId,ctx.companyId,merged.end_date,merged.start_date,existing?.id??null]);if(overlap.rowCount)fail('period_overlap');const profile=(await c.query('SELECT first_year_start,first_year_end,end_month,end_day FROM company_fiscal_settings WHERE workspace_id=$1 AND company_id=$2',[ctx.workspaceId,ctx.companyId])).rows[0] as FiscalCalendar|undefined;if(profile){const range=containingFiscalYear(profile,str(merged.start_date));if(str(merged.end_date)>range.end_date)fail('fiscal_existing_period_conflict',409);out.fiscal_year_end=range.end_date;}}
 if(resource==='fiscal_periods'&&existing&&(out.start_date||out.end_date)){if(existing.status==='closed')fail('closed_period_immutable',409);const posted=await c.query("SELECT 1 FROM journal_entries WHERE workspace_id=$1 AND company_id=$2 AND entry_date BETWEEN $3 AND $4 AND status IN ('posted','reversed') LIMIT 1",[ctx.workspaceId,ctx.companyId,existing.start_date,existing.end_date]);if(posted.rowCount)fail('posted_period_dates_immutable',409);}
 if(resource==='approval_policies'){const minimum=minor(merged.min_minor),maximum=minor(merged.max_minor);if(maximum!==0n&&maximum<minimum)fail('invalid_approval_range');}
 if(resource==='currencies'){if(!/^[A-Z]{3}$/.test(str(merged.code)))fail('invalid_currency');if(!Number.isInteger(merged.minor_digits)||Number(merged.minor_digits)<0||Number(merged.minor_digits)>6)fail('invalid_currency_digits');const previousDigits=existing?Number(existing.minor_digits):new Intl.NumberFormat('en',{style:'currency',currency:str(merged.code)}).resolvedOptions().maximumFractionDigits??2;if((existing&&merged.code!==existing.code||Number(merged.minor_digits)!==previousDigits)&&(await currencyUsed(c,ctx,existing?.code??merged.code)||existing&&await currencyUsed(c,ctx,merged.code)))fail('currency_in_use',409);}
 return out;
}
export function validateEvent(row:Row){try{new Intl.DateTimeFormat('en',{timeZone:str(row.time_zone)});}catch{fail('invalid_timezone');}
 if(row.reminder_minutes!=null&&(!Number.isInteger(Number(row.reminder_minutes))||Number(row.reminder_minutes)<0||Number(row.reminder_minutes)>10080))fail('invalid_reminder_minutes');
 if(row.all_day){if(!row.start_date||!row.end_date||str(row.end_date)<=str(row.start_date)||row.start_at||row.end_at)fail('invalid_all_day_dates');}
 else {if(!row.start_at||!row.end_at||new Date(str(row.end_at)).getTime()<=new Date(str(row.start_at)).getTime()||row.start_date||row.end_date)fail('invalid_event_times');}
 if(row.recurrence_rule&&!/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;(INTERVAL|COUNT)=\d+|;UNTIL=\d{8}T\d{6}Z|;BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*)*$/.test(str(row.recurrence_rule)))fail('invalid_recurrence_rule');
}
export async function lockParent(c:Client,ctx:Context,resource:string,data:Row):Promise<Row|undefined>{const relation=parentKeys[resource];if(!relation)return;const [parent,key]=relation;const p=await find(c,ctx,parent,data[key],true,true);if(['expense_claims','customer_quotes','customer_invoices','vendor_bills','journal_entries','purchase_orders'].includes(parent)&&!['draft','returned'].includes(str(p.status)))fail('parent_locked',409);if(resource==='bill_lines'&&p.purchase_order_id)fail('purchase_bill_lines_immutable',409);return p;}
export async function refreshTotal(c:Client,ctx:Context,resource:string,parent:Row|undefined){if(!parent)return;const info:Record<string,[string,string,string]>={expense_lines:['expense_claims','claim_id','amount_minor'],quote_lines:['customer_quotes','quote_id','unit_price_minor'],invoice_lines:['customer_invoices','invoice_id','unit_price_minor'],bill_lines:['vendor_bills','bill_id','unit_price_minor']};const p=info[resource];if(!p)return;const lines=(await c.query(`SELECT * FROM ${resource} WHERE workspace_id=$1 AND ${p[1]}=$2 AND NOT archived`,[ctx.workspaceId,parent.id])).rows as Row[];let total=0n;for(const l of lines)total+=(resource==='expense_lines'?minor(l.amount_minor):multiplyQuantity(l.unit_price_minor,l.quantity))+minor(l.tax_minor);await patch(c,ctx,p[0],parent,{total_minor:total.toString()},'recalculate');}
