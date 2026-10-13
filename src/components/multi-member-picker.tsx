'use client';
import {useEffect,useState} from 'react';
import {X,Search} from 'lucide-react';
import {useApp} from './context';
import {api,errorMessage} from './api';
import './multi-member-picker.css';
export type ResponsibleMember={id:string;name:string;active?:boolean};
export type MemberSelection={ids:string[];people?:ResponsibleMember[];lockedIds?:string[];onChange:(ids:string[])=>void};
export default function MultiMemberPicker({selection,id,disabled=false,describedBy,purpose,selectionLabel}:{purpose?:string;selectionLabel?:string;selection:MemberSelection;id:string;disabled?:boolean;describedBy?:string}){
 const {t}=useApp();const [query,setQuery]=useState(''),[rows,setRows]=useState<ResponsibleMember[]>([]),[cache,setCache]=useState<ResponsibleMember[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<unknown>(null);
 useEffect(()=>{let active=true;const timer=setTimeout(()=>{setLoading(true);api<{rows:ResponsibleMember[]}>(`/api/data/members?pageSize=200&q=${encodeURIComponent(query)}${purpose?`&purpose=${encodeURIComponent(purpose)}`:''}`).then(result=>{if(active){setRows(result.rows);setCache(current=>[...new Map([...current,...result.rows].map(person=>[person.id,person])).values()]);setError(null);}}).catch(error=>{if(active)setError(error);}).finally(()=>{if(active)setLoading(false);});},180);return()=>{active=false;clearTimeout(timer);};},[query,purpose]);
 const known=new Map([...(selection.people||[]),...cache].map(person=>[person.id,person]));
 const name=(memberId:string)=>known.get(memberId)?.name||`${t('responsibilityUnavailable')} · ${memberId.slice(0,8)}`;
 const change=(memberId:string,checked:boolean)=>{if(disabled||selection.lockedIds?.includes(memberId))return;selection.onChange(checked?[...new Set([...selection.ids,memberId])]:selection.ids.filter(value=>value!==memberId));};
 return <div className="multi-member-picker responsible-members"><div className="multi-member-selected" role="group" aria-label={selectionLabel||t('responsibilitySelected')}>{selection.ids.length?selection.ids.map(memberId=><span className="member-chip" key={memberId}><span title={memberId}>{name(memberId)}{known.get(memberId)?.active===false&&<small>{t('responsibilityInactive')}</small>}</span><button type="button" disabled={disabled||selection.lockedIds?.includes(memberId)} aria-label={`${t('remove')} ${name(memberId)}`} onClick={()=>change(memberId,false)}><X size={13}/></button></span>):<span className="muted">{t('unassigned')}</span>}</div>
  <div className="multi-member-search"><Search size={14} aria-hidden="true"/><input id={id} type="search" value={query} disabled={disabled} aria-label={t('responsibilitySearch')} aria-describedby={describedBy} placeholder={t('responsibilitySearch')} onChange={event=>setQuery(event.target.value)}/></div>
  <div className="multi-member-options" role="group" aria-label={t('members')}>{rows.map(person=><label key={person.id}><input type="checkbox" value={person.id} checked={selection.ids.includes(person.id)} disabled={disabled||selection.lockedIds?.includes(person.id)} onChange={event=>change(person.id,event.target.checked)}/><span>{person.name}</span></label>)}{loading&&<span role="status" className="muted small">{t('loading')}</span>}{!loading&&!rows.length&&error===null&&<span className="muted small">{t('noResults')}</span>}</div>
  {error!==null&&<small role="alert" className="field-error">{errorMessage(error,t)}</small>}{Boolean(selection.lockedIds?.length)&&<small className="field-help">{t('responsibilityClaimant')}</small>}
 </div>;
}
