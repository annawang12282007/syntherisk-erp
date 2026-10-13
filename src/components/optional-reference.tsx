'use client';
import {useEffect,useState} from 'react';
import {api} from './api';
import {useApp} from './context';
import type {Field,Row} from './types';
import './optional-reference.css';

export type ReferenceDraft={text:string;create:boolean};
export type ReferenceDraftControl=ReferenceDraft&{linkedLabel?:string;onChange:(value:{id:string;text:string;create:boolean})=>void};
export function supportsReferenceDraft(field:Field){return field.type==='reference'&&!field.required&&!field.readonly&&((field.key==='project_id'&&field.ref==='projects')||(field.key==='meeting_id'&&field.ref==='meetings'));}

export default function OptionalReference({field,value,draft,disabled,describedBy}:{field:Field;value:string;draft:ReferenceDraftControl;disabled:boolean;describedBy?:string}){
 const {t,label,resources}=useApp();const [rows,setRows]=useState<Row[]>([]),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false),[query,setQuery]=useState('');const target=resources[field.ref||''],canRead=target?.capabilities?.read!==false,canCreate=target?.capabilities?.create===true;const prefix=`field-${field.key}`;
 useEffect(()=>{if(!canRead)return;let stopped=false;const timer=setTimeout(()=>{setLoading(true);setFailed(false);api<{rows:Row[]}>(`/api/data/${field.ref}?pageSize=100&q=${encodeURIComponent(query)}`).then(result=>{if(!stopped)setRows(result.rows||[]);}).catch(()=>{if(!stopped)setFailed(true);}).finally(()=>{if(!stopped)setLoading(false);});},180);return()=>{stopped=true;clearTimeout(timer);};},[field.ref,query,canRead]);
 const linkedName=draft.linkedLabel||String(rows.find(row=>row.id===value)?.[target?.titleField||'title']||value);
 return <div className="optional-reference">
  <input id={`${prefix}-text`} type="text" value={value?linkedName:draft.text} disabled={disabled||Boolean(value)} maxLength={300} aria-label={label(field)} aria-describedby={[describedBy,`${prefix}-reference-help`].filter(Boolean).join(' ')} placeholder={t(field.key==='project_id'?'referenceProjectPlaceholder':'referenceMeetingPlaceholder')} onChange={event=>draft.onChange({id:'',text:event.target.value,create:Boolean(event.target.value.trim())&&draft.create})}/>
  {!value&&<label className="optional-reference-create"><input id={`${prefix}-create`} type="checkbox" checked={draft.create} disabled={disabled||!canCreate||!draft.text.trim()} onChange={event=>draft.onChange({id:'',text:draft.text,create:event.target.checked})}/><span>{t(field.key==='project_id'?'referenceCreateProject':'referenceCreateMeeting')}</span></label>}
  <details className="optional-reference-existing" open={value?true:undefined}><summary>{t('referenceExisting')}</summary><input type="search" value={query} aria-label={`${t('search')} ${label(field)}`} placeholder={t('searchRecords')} disabled={disabled||!canRead} onChange={event=>setQuery(event.target.value)}/><select id={prefix} value={value} disabled={disabled||!canRead} aria-label={`${t('referenceExisting')} · ${label(field)}`} aria-describedby={describedBy} onChange={event=>draft.onChange({id:event.target.value,text:event.target.value?'':value?linkedName:draft.text,create:false})}><option value="">{loading?t('loading'):t('unassigned')}</option>{value&&!rows.some(row=>row.id===value)&&<option value={value}>{linkedName}</option>}{rows.map(row=><option key={row.id} value={row.id}>{String(row[target?.titleField||'title']||row.name||row.id)}</option>)}</select>{failed&&<small className="field-error">{t('forbidden')}</small>}</details>
  <small id={`${prefix}-reference-help`} className="field-help">{t(value?'referenceLinkedHint':draft.create?'referenceCreateHint':'referenceTextHint')}</small>
 </div>;
}
