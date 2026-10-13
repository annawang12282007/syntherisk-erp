'use client';
import {ChevronRight} from 'lucide-react';
import {useApp} from './context';
import {DisplayValue,Empty} from './primitives';
import {configurationField,ConfigurationValue} from './configuration-guide';
import {localeKeys} from '@/locales';
import type {Field,Resource,Row} from './types';
import './history-timeline.css';

type AuditEntry=Record<string,unknown>;
type Snapshot=Record<string,unknown>;
const hiddenKeys=new Set(['id','workspace_id','company_id','record_id','actor_id','created_by','updated_by','created_at','updated_at','deleted_at','version','currency_minor_digits','base_currency_minor_digits','source_currency_minor_digits']);
const labels=new Set(localeKeys);
function visibleKey(key:string){return !hiddenKeys.has(key)&&!key.startsWith('_')&&!/(?:password|secret|token|credential|authorization|cookie|content_base64)/i.test(key);}
function snapshot(value:unknown):Snapshot|null{if(typeof value==='string'){try{value=JSON.parse(value);}catch{return null;}}return value&&typeof value==='object'&&!Array.isArray(value)?value as Snapshot:null;}
function comparable(value:unknown):string{if(Array.isArray(value))return '['+value.map(comparable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}:${comparable(v)}`).join(',')+'}';return JSON.stringify(value)??'null';}
function fieldsIn(value:Snapshot){return Object.keys(value).filter(key=>visibleKey(key)&&!(key.endsWith('_name')&&Object.hasOwn(value,key.slice(0,-5)+'_id')));}
function timestamp(value:unknown){const time=new Date(String(value||'')).getTime();return Number.isNaN(time)?0:time;}

export default function HistoryTimeline({entries,resourceKey}:{entries:AuditEntry[];resourceKey?:string}){
 const {t,label,locale,prefs,resources}=useApp();
 if(!entries.length)return <Empty title={t('noActivity')} description=" "/>;
 const roleName=(role:string)=>t(role==='operations'?'operationsRole':role==='finance'?'financeRole':role);
 return <ol className="history-timeline">{[...entries].sort((a,b)=>timestamp(b.created_at)-timestamp(a.created_at)).map((entry,index)=>{
  const resource=resources[String(entry.resource||resourceKey||'')];
  const action=String(entry.action||entry.action_type||'');const actionText=labels.has('history_action_'+action)?t('history_action_'+action):labels.has(action)?t(action):`${t('historyAction')} · ${action.replaceAll('_',' ')}`;
  const values=snapshot(entry.after_data)||snapshot(entry.before_data)||snapshot(entry.details);const title=String(values?.[resource?.titleField||'title']||values?.name||values?.title||'');
  const basis=String(entry.actor_role_basis||'unknown');
  const actor=basis==='system'?t('historySystem'):String(entry.actor_name||entry.actor||t('historyUnknownActor'));
  const roles=Array.isArray(entry.actor_roles)?entry.actor_roles.filter((role):role is string=>typeof role==='string'):[];
  let date=t('historyTimeUnknown');const time=timestamp(entry.created_at);
  if(time)try{date=new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short',timeZone:prefs.timezone||'America/Los_Angeles'}).format(new Date(time));}catch{}
  return <li key={String(entry.id||index)}><details className="history-entry"><summary>
   <ChevronRight size={15} className="history-chevron" aria-hidden="true"/>
   <span className="history-overview"><strong>{actionText}{resource?` · ${label(resource)}`:''}</strong>{title&&<span>{title}</span>}<small>{actor}</small></span>
   <span className="history-roles">{basis==='system'?t('historySystem'):roles.length?roles.map(roleName).join(' · '):t('historyUnknownRole')}{basis==='current'&&roles.length>0&&<small>{t('historyCurrentRole')}</small>}</span>
   <time dateTime={time?new Date(time).toISOString():undefined}>{date}</time>
  </summary><div className="history-expanded"><HistoryDetails entry={entry} resource={resource}/></div></details></li>;
 })}</ol>;
}

function HistoryDetails({entry,resource}:{entry:AuditEntry;resource?:Resource}){
 const {t,label,resources}=useApp();
 const before=snapshot(entry.before_data),after=snapshot(entry.after_data)??snapshot(entry.details);
 const action=String(entry.action||entry.action_type||'');
 const names=(field:string)=>{const found=resource?.fields.find(item=>item.key===field)||Object.values(resources).flatMap(item=>item.fields).find(item=>item.key===field);return found?label(configurationField(resource?.key||'',found)):labels.has(field)?t(field):t('historyAdditional');};
 const render=(field:string,value:unknown,row:Snapshot)=><HistoryValue name={field} value={value} row={row} resource={resource}/>;
 const changed=before&&after?[...new Set([...fieldsIn(before),...fieldsIn(after)])].filter(key=>comparable(before[key])!==comparable(after[key])):[];
 const data=after||before;
 return <><header className="history-action"><strong>{labels.has('history_action_'+action)?t('history_action_'+action):action&&labels.has(action)?t(action):`${t('historyAction')} · ${action.replaceAll('_',' ')}`}</strong>{resource&&<span>{label(resource)}</span>}</header>
  {before&&after?(changed.length?<div className="history-change-list"><div className="history-change-head"><span>{t('historyField')}</span><span>{t('historyBefore')}</span><span>{t('historyAfter')}</span></div>{changed.map(key=><div className="history-change" key={key} data-history-field={key}><strong>{names(key)}</strong><div data-value="before"><small>{t('historyBefore')}</small>{render(key,before[key],before)}</div><div data-value="after"><small>{t('historyAfter')}</small>{render(key,after[key],after)}</div></div>)}</div>:<p className="history-empty-change">{t('historyNoFieldChanges')}</p>):data&&fieldsIn(data).length?<section className="history-snapshot"><h4>{t(after?'historySnapshot':'historyPreviousSnapshot')}</h4><dl>{fieldsIn(data).map(key=><div key={key} data-history-field={key}><dt>{names(key)}</dt><dd>{render(key,data[key],data)}</dd></div>)}</dl></section>:<p className="history-empty-change">{t('historyNoFieldChanges')}</p>}
 </>;
}

export function HistoryValue({name,value,row,resource,depth=0}:{name:string;value:unknown;row:Snapshot;resource?:Resource;depth?:number}){
 const {t,label,resources}=useApp();
 if(value===null||value===undefined||value==='')return <span className="muted">{t('historyUnset')}</span>;
 if(typeof value==='boolean')return <span>{t(value?'historyEnabled':'historyDisabled')}</span>;
 if(name==='reference_notes'&&typeof value==='object'&&!Array.isArray(value))return <dl className="history-nested history-reference-notes">{Object.entries(value).filter(([key,note])=>visibleKey(key)&&typeof note==='string'&&note).map(([key,note])=>{const field=resource?.fields.find(field=>field.key===key)||Object.values(resources).flatMap(item=>item.fields).find(field=>field.key===key);return <div key={key}><dt>{field?label(field):t('reference')}</dt><dd><span>{String(note)}</span></dd></div>;})}</dl>;
 const field=resource?.fields.find(item=>item.key===name)||Object.values(resources).flatMap(item=>item.fields).find(item=>item.key===name);
 if(field?.type==='reference'||name.endsWith('_id')){const display=row[name.replace(/_id$/,'')+'_name']||row[name.replace(/_id$/,'')+'_title'];return <span title={String(value)}>{typeof display==='string'&&display?display:`${t('historyLinkedRecord')} · ${String(value).slice(0,8)}`}</span>;}
 if(Array.isArray(value))return depth>2?<span>{t('historyMoreValues')}</span>:<ul className="history-value-list">{value.map((item,index)=><li key={index}>{name==='roles'&&typeof item==='string'?t(item==='operations'?'operationsRole':item==='finance'?'financeRole':item):<HistoryValue name={name} value={item} row={row} resource={resource} depth={depth+1}/>}</li>)}</ul>;
 if(typeof value==='object')return depth>2?<span>{t('historyMoreValues')}</span>:<dl className="history-nested">{fieldsIn(value as Snapshot).map(key=>{const nested=resource?.fields.find(item=>item.key===key)||Object.values(resources).flatMap(item=>item.fields).find(item=>item.key===key);return <div key={key}><dt>{nested?label(nested):labels.has(key)?t(key):t('historyAdditional')}</dt><dd><HistoryValue name={key} value={(value as Snapshot)[key]} row={value as Snapshot} resource={resource} depth={depth+1}/></dd></div>;})}</dl>;
 if(['status','scope','operation','role_code'].includes(name)&&typeof value==='string')return <span>{t(value==='operations'?'operationsRole':value==='finance'?'financeRole':value)}</span>;
 if(name==='resource'&&resources[String(value)])return <span>{label(resources[String(value)])}</span>;
 if(resource&&field)return <ConfigurationValue resourceKey={resource.key} field={field} value={value} row={row as Row}/>;
 const inferred:Field|undefined=field||(/_at$/.test(name)?{key:name,label:[name,name,name],type:'datetime'}:undefined);
 return <DisplayValue field={inferred} value={value} row={row as Row}/>;
}
