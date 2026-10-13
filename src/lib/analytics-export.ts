import type {Context} from './context';
import {DomainError} from './context';
import {operationAccess} from '../domain/core';
import {analytics} from '../domain/reports';
import {resources} from '../domain/registry';
import {query} from './db';
import {workbook,type Sheet} from './xlsx';

/** Report values come from the existing scoped calculations; this layer only serializes them. */
export function reportSheets(data:Record<string,unknown>,filters:Record<string,string>,generatedAt:string):Sheet[]{
 const result:Sheet[]=[],index:Record<string,unknown>[]=[];
 const add=(path:string,rows:Record<string,unknown>[],currency:string|null)=>{
  const number=String(result.length+1).padStart(2,'0'),name=(number+' '+path.split('.').at(-1)+(currency?' '+currency:'')).replace(/[\\/*?:\[\]]/g,' ').slice(0,31);
  const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];result.push({name,columns:columns.length?columns:['value'],rows});index.push({sheet:name,report:path,currency,rows:rows.length});
 };
 const visit=(value:unknown,path:string,inheritedCurrency:string|null=null)=>{
  if(value===null||value===undefined)return;
  if(Array.isArray(value)){
   const groups=new Map<string,Record<string,unknown>[]>();
   for(const item of value){const row:Record<string,unknown>=item&&typeof item==='object'&&!Array.isArray(item)?item as Record<string,unknown>:{value:item};const code=typeof row.currency==='string'?row.currency:inheritedCurrency??'';const rows=groups.get(code)??[];rows.push(row);groups.set(code,rows);}
   if(!groups.size)add(path,[],inheritedCurrency);else for(const [currency,rows] of groups)add(path,rows,currency||null);return;
  }
  if(typeof value==='object'){
   const object=value as Record<string,unknown>,currency=typeof object.currency==='string'?object.currency:inheritedCurrency;
   const scalars=Object.fromEntries(Object.entries(object).filter(([,item])=>item===null||typeof item!=='object'||item instanceof Date));
   if(Object.keys(scalars).length)add(path,[scalars],currency);
   for(const [key,item] of Object.entries(object))if(item!==null&&typeof item==='object'&&!(item instanceof Date))visit(item,path+'.'+key,currency);return;
  }
  add(path,[{value}],inheritedCurrency);
 };
 for(const section of ['operational','finance']){const reports=data[section];if(reports&&typeof reports==='object')for(const [key,value] of Object.entries(reports))if(!key.endsWith('_minor_digits'))visit(value,section+'.'+key);}
 const metadata=[{field:'generated_at',value:generatedAt},{field:'amounts',value:'Fields ending in _minor are exact integer minor units; currency and minor_digits fields determine the scale. Different currencies are not combined.'},...Object.entries(filters).filter(([key])=>key!=='format').map(([field,value])=>({field:'filter.'+field,value}))];
 return [{name:'Index',columns:['sheet','report','currency','rows'],rows:index},{name:'Export information',columns:['field','value'],rows:metadata},...result];
}
function safeReportData(data:Record<string,unknown>){
 const finance=data.finance as Record<string,unknown>|null;
 if(!finance||!Array.isArray(finance.budgets))return data;
 const allowed=new Set([...resources.budgets.fields.map(field=>field.key),'id','status','version','budget_minor','actual_minor','committed_minor','available_minor','over_budget','missing_rates','base_currency','project_name','currency_minor_digits','base_currency_minor_digits']);
 return {...data,finance:{...finance,budgets:finance.budgets.map(row=>Object.fromEntries(Object.entries(row as Record<string,unknown>).filter(([key])=>allowed.has(key))))}};
}
export async function exportAnalytics(ctx:Context,params:Record<string,string>){
 if(!['json','xlsx'].includes(params.format))throw new DomainError(400,'EXPORT_FORMAT_UNAVAILABLE');
 if(!operationAccess(ctx,'analytics','export'))throw new DomainError(403,'EXPORT_FORBIDDEN');
 const data=safeReportData(await analytics(ctx,params)),generated_at=new Date().toISOString();
 const body=params.format==='xlsx'?new Uint8Array(workbook(reportSheets(data,params,generated_at))):JSON.stringify({...data,filters:params,generated_at},null,2);
 await query("INSERT INTO export_jobs(workspace_id,user_id,resource,row_count,filters) VALUES($1,$2,'analytics',1,$3)",[ctx.workspaceId,ctx.userId,JSON.stringify(params)]);
 return new Response(body,{headers:{'Content-Type':params.format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="syntherisk-report.${params.format}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
