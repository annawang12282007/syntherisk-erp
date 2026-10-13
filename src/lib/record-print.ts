import {richTextHtml} from './rich-text';
import {companyLogoWidth} from './brand-size';
import type {Context} from './context';
import {DomainError} from './context';
import {query} from './db';
import {get} from '../domain/service';
import {resources,type FieldDef} from '../domain/registry';
import {type Row} from '../domain/core';
import {getRecordOrganization,organizationSupported} from '../domain/record-organization';
import {readPreferences} from './preferences';
import {assertRecordExport,collectExportRecords,exportColumns} from './io';
import {translate,localeIndex,type Locale} from '../locales';
import {journalDraft} from '../domain/journal-drafts';
import {convertJournalLines,type JournalFx,type JournalInputLine} from '../domain/journal-fx';
import {interfaceText} from '../locales/interface-text';

export const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
function display(row:Row,key:string,field:FieldDef|undefined,locale:Locale){
 const value=row[key];if(key==='owner_id'||key==='responsible_names')return Array.isArray(row.responsible_users)?row.responsible_users.map(person=>String((person as Row).name||(person as Row).id)).join('、'):String(row.owner_name??value??'');
 if(field?.type==='reference')return String(row[key.replace(/_id$/,'')+'_name']??value??'');
 if(value===null||value===undefined)return '—';if(typeof value==='boolean')return translate(locale,value?'yes':'no');if(value instanceof Date)return value.toISOString();
 if(field?.type==='money'&&row.currency&&/^-?\d+$/.test(String(value))){const amount=BigInt(String(value)),absolute=amount<0n?-amount:amount,digits=Number(row.currency_minor_digits??2),scale=10n**BigInt(digits);const parts=new Intl.NumberFormat(locale,{style:'currency',currency:String(row.currency),minimumFractionDigits:digits,maximumFractionDigits:digits,currencyDisplay:'code'}).formatToParts(absolute/scale);return `${amount<0n?'-':''}${parts.map(part=>part.type==='fraction'?String(absolute%scale).padStart(digits,'0'):part.value).join('')}`;}
 if(field?.type==='select'||key==='status')return translate(locale,String(value));
 if(Array.isArray(value))return value.map(item=>typeof item==='object'?JSON.stringify(item):String(item)).join('、');if(typeof value==='object')return JSON.stringify(value,null,2);return String(value);
}
function documentHtml(locale:Locale,title:string,content:string,returnHref:string,landscape=false){
 const t=(key:string)=>translate(locale,key);
 return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Syntherisk</title><link rel="stylesheet" href="/fonts/typography.css"><style>*{box-sizing:border-box}img{max-width:100%;height:auto}body{margin:0;background:#edf3f2;color:#173341;font-family:var(--font-sans),sans-serif;font-size:13px;line-height:1.55}.toolbar{max-width:1000px;margin:20px auto;display:flex;gap:16px;align-items:center;justify-content:space-between}.toolbar button{border:0;border-radius:5px;background:#173341;color:white;padding:10px 16px;font:inherit}.sheet{max-width:1000px;margin:20px auto;background:white;padding:40px}.brand{width:205px;margin-bottom:24px}h1{font-size:25px;margin:0 0 24px}h2{font-size:17px;margin:24px 0 12px;break-after:avoid}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 24px}.field{min-width:0}.field.long{grid-column:1/-1}dt{font-size:11px;color:#61777f}dd{margin:3px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.field:not(.long){break-inside:avoid}footer{margin-top:24px;border-top:1px solid #dae4e5;padding-top:12px;font-size:10px;color:#61777f;overflow-wrap:anywhere}table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:11px}td,th{border:1px solid #d8e2e4;padding:8px;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap;text-align:left}th{background:#edf5f3}.record-section{margin:24px 0;padding-bottom:16px;border-bottom:1px solid #d8e2e4}@page{size:A4 ${landscape?'landscape':'portrait'};margin:16mm}@media print{html,body{background:white;height:auto;overflow:visible}.toolbar{display:none}.sheet{max-width:none;margin:0;padding:0;overflow:visible}thead{display:table-header-group}footer{break-inside:avoid}tr{break-inside:avoid}h1{break-after:avoid}}@media(max-width:650px){.sheet{padding:20px;margin:0}dl{grid-template-columns:1fr}.toolbar{padding:0 15px;flex-wrap:wrap}}</style></head><body><div class="toolbar"><a href="${escapeHtml(returnHref)}">${escapeHtml(t('printReturn'))}</a><span>${escapeHtml(t('printHint'))}</span><button type="button" onclick="window.print()">${escapeHtml(t('print'))}</button></div><main class="sheet"><img class="brand" src="/brand/logo-primary.svg" alt="Syntherisk"><h1>${escapeHtml(title)}</h1>${content}<footer>${escapeHtml(t('printTime'))}: ${escapeHtml(new Date().toISOString())}</footer></main></body></html>`;
}
async function output(ctx:Context,resource:string,html:string,count:number,filters:Row){
 await query('INSERT INTO export_jobs(workspace_id,user_id,resource,row_count,filters) VALUES($1,$2,$3,$4,$5)',[ctx.workspaceId,ctx.userId,resource,count,JSON.stringify(filters)]);
 html=html.replace('.brand{width:205px',`.brand{width:${await companyLogoWidth(ctx)}px;max-width:100%;height:auto`);
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
export async function genericRecordPrint(ctx:Context,resource:string,id:string){
 const definition=resources[resource];if(!definition)throw new DomainError(404,'NOT_FOUND');const row=await get(ctx,resource,id);await assertRecordExport(ctx,resource,id);
 const prefs=await readPreferences(ctx),locale=(prefs.locale??'zh-TW') as Locale,language=localeIndex(locale),t=(key:string)=>translate(locale,key);
 const fields=definition.fields.map(field=>`<div class="field ${['textarea','json'].includes(field.type)?'long':''}"><dt>${escapeHtml(field.type==='money'&&row.currency?field.label[language].replace(/（最小單位）|（最小单位）|\(minor units\)/g,''):field.label[language])}</dt><dd>${richTextHtml(display(row,field.key,field,locale))}</dd></div>`).join('');
 const organization=await organizationPrint(ctx,resource,id,locale);
 let journal='';
 if(resource==='journal_entries'){
  const draft=await journalDraft(ctx,id),fx=draft.record.fx_input as JournalFx|null,L=(zh:string,en:string)=>interfaceText(locale,zh,en);
  for(const line of draft.base_lines)await assertRecordExport(ctx,'journal_lines',String(line.id));
  const lines=draft.lines as JournalInputLine[],currency=fx?.currency||String(row.currency),base=fx?.rate?convertJournalLines(lines,fx.rate,fx.from_digits,fx.to_digits):fx?undefined:lines;
  const amount=(value:string,code:string,digits:number)=>escapeHtml(display({amount_minor:value,currency:code,currency_minor_digits:digits},'amount_minor',{key:'amount_minor',type:'money',label:['','','']},locale));
  const rows=await Promise.all(lines.map(async(line,i)=>{const account=line.account_id?await get(ctx,'accounts',line.account_id):null;return '<tr><td>'+escapeHtml(account?String(account.code)+' · '+String(account.name):L('待选科目','Account needed'))+'</td><td>'+escapeHtml(line.description)+'</td><td>'+amount(line.debit_minor,currency,fx?.from_digits??Number(row.currency_minor_digits??2))+'</td><td>'+amount(line.credit_minor,currency,fx?.from_digits??Number(row.currency_minor_digits??2))+'</td>'+(fx?'<td>'+(base?amount(base[i].debit_minor,String(row.currency),fx.to_digits):'—')+'</td><td>'+(base?amount(base[i].credit_minor,String(row.currency),fx.to_digits):'—')+'</td>':'')+'</tr>';}));
  journal='<h2>'+escapeHtml(L('借贷明细','Journal lines'))+'</h2>'+(fx?'<p>'+escapeHtml('1 '+fx.currency+' = '+(fx.rate||'—')+' '+row.currency+' · '+fx.rate_date+' · '+fx.rate_source)+'</p>':'')+(row.draft_input?'<p>'+escapeHtml(L('草稿资料未完成，折算金额仅供预览。','Incomplete draft. Converted amounts are a preview.'))+'</p>':'')+'<table><thead><tr>'+[L('科目','Account'),L('摘要','Description'),L('借方','Debit')+' ('+currency+')',L('贷方','Credit')+' ('+currency+')',...(fx?[L('折算借方','Converted debit')+' ('+row.currency+')',L('折算贷方','Converted credit')+' ('+row.currency+')']:[])].map(label=>'<th>'+escapeHtml(label)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>';
  if((await journalDraft(ctx,id)).line_hash!==draft.line_hash)throw new DomainError(409,'VERSION_CONFLICT');
 }
 if((await get(ctx,resource,id)).version!==row.version)throw new DomainError(409,'VERSION_CONFLICT');
 const content=`${definition.states?`<p>${escapeHtml(t(String(row.status)))}</p>`:''}<dl>${fields}</dl>${journal}${organization}<footer>${escapeHtml(t('printSource'))}: ${escapeHtml(id)} · ${escapeHtml(t('version'))} ${escapeHtml(row.version)}</footer>`;
 return output(ctx,resource,documentHtml(locale,definition.label[language],content,`/data/${encodeURIComponent(resource)}?record=${encodeURIComponent(id)}`),1,{id,version:row.version,format:'print'});
}
export async function printTable(ctx:Context,resource:string,filters:Record<string,string>){
 const columns=exportColumns(resource,filters.columns),rows=await collectExportRecords(ctx,resource,filters);if(rows.length>2000)throw new DomainError(413,'PRINT_TOO_LARGE');
 const prefs=await readPreferences(ctx),locale=(prefs.locale??'zh-TW') as Locale,language=localeIndex(locale),definition=resources[resource];
 const allowed=new Set(['id',...definition.fields.map(field=>field.key),'status','version','created_at','updated_at']);const visible=columns.filter(key=>allowed.has(key));
 const label=(key:string)=>{const field=definition.fields.find(field=>field.key===key);return field?.type==='money'?field.label[language].replace(/（最小單位）|（最小单位）|\(minor units\)/g,''):field?.label[language]??translate(locale,key);};
 const content=visible.length<=8?`<table><thead><tr>${visible.map(key=>`<th>${escapeHtml(label(key))}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${visible.map(key=>`<td>${richTextHtml(display(row,key,definition.fields.find(field=>field.key===key),locale))}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${visible.length}">${escapeHtml(translate(locale,'noData'))}</td></tr>`}</tbody></table>`:rows.map((row,index)=>`<section class="record-section"><h2>${index+1}</h2><dl>${visible.map(key=>`<div class="field ${['textarea','json'].includes(definition.fields.find(field=>field.key===key)?.type??'')?'long':''}"><dt>${escapeHtml(label(key))}</dt><dd>${richTextHtml(display(row,key,definition.fields.find(field=>field.key===key),locale))}</dd></div>`).join('')}</dl></section>`).join('');
 return output(ctx,resource,documentHtml(locale,definition.label[language],content,`/data/${encodeURIComponent(resource)}`,visible.length>4&&visible.length<=8),rows.length,{...filters,format:'print_table',columns});
}
export async function organizationPrint(ctx:Context,resource:string,id:string,locale:Locale){
 if(!organizationSupported(resource))return '';const info=await getRecordOrganization(ctx,resource,id),t=(key:string)=>translate(locale,key);
 const labels=(info.selected_categories??[]).map(item=>item.builtin_key?t('categoryBuiltin_'+item.builtin_key):item.name).join('、'),projects=[...(info.primary_project?[info.primary_project]:[]),...(info.projects??[])].map(item=>item.name).join('、');
 return `<h2>${escapeHtml(t('recordOrganization'))}</h2><dl><div class="field"><dt>${escapeHtml(t('recordCategories'))}</dt><dd>${escapeHtml(labels||t('recordUnclassified'))}</dd></div><div class="field"><dt>${escapeHtml(t('projects'))}</dt><dd>${escapeHtml(projects||t('unassigned'))}${info.protected_project_count?`\n${escapeHtml(t('recordProtectedLinks'))}`:''}</dd></div></dl>`;
}
