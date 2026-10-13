'use client';
import {useEffect,useState} from 'react';
import {Mail,Search} from 'lucide-react';
import {useApp} from './context';
import {api,errorMessage} from './api';
import {Button} from './primitives';
import {translate} from '@/locales';
import type {Row} from './types';
import styles from './mail-recipient.module.css';

type Recipient=Row&{name?:string;email?:string|null;do_not_contact?:boolean;contact_preference?:string;archived?:boolean};
type Snapshot={id:string;name:string;email:string};
type Results={query:string;page:number;rows:Recipient[];total:number;error?:string};
function unavailableReason(contact:Recipient):string|undefined{
 if(contact.archived)return 'mailRecipientArchived';
 if(contact.do_not_contact||contact.contact_preference==='none')return 'mailRecipientStopped';
 if(!contact.email)return 'mailRecipientMissingEmail';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))return 'mailRecipientInvalidEmail';
}

export function MailRecipient({value,snapshot,onChange,onEligibilityChange,disabled=false}:{value:string;snapshot?:Snapshot;onChange:(id:string)=>void;onEligibilityChange:(eligible:boolean)=>void;disabled?:boolean}){
 const {t,locale}=useApp();
 const [query,setQuery]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
 const [results,setResults]=useState<Results|null>(null);
 const [selection,setSelection]=useState<{id:string;contact?:Recipient;error?:string}>({id:''});
 const [acceptedEmail,setAcceptedEmail]=useState('');
 const term=query.trim();
 useEffect(()=>{
  let active=true;const timer=setTimeout(()=>{
   const params=new URLSearchParams({q:term,page:String(page),pageSize:'50',sort:'name',order:'asc'});
   api<{rows:Recipient[];total:number}>(`/api/data/contacts?${params}`).then(result=>{if(active)setResults(previous=>({query:term,page,rows:page>1&&previous?.query===term?Array.from(new Map([...previous.rows,...result.rows].map(row=>[row.id,row])).values()):result.rows,total:result.total}));}).catch(error=>{if(active)setResults({query:term,page,rows:[],total:0,error:errorMessage(error,key=>translate(locale,key))});});
  },200);return()=>{active=false;clearTimeout(timer);};
 },[term,page,revision,locale]);
 useEffect(()=>{
  if(!value)return;let active=true;
  api<Recipient>(`/api/data/contacts/${encodeURIComponent(value)}`).then(contact=>{if(active)setSelection({id:value,contact});}).catch(()=>{if(active)setSelection({id:value,error:'mailRecipientUnavailable'});});
  return()=>{active=false;};
 },[value,revision]);
 const loading=!results||results.query!==term||results.page!==page;
 const rows=(results?.query===term?results.rows:[]).filter(row=>!term||`${row.name||''} ${row.email||''}`.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
 const selected=selection.id===value?selection.contact:undefined;
 const original=snapshot?.id===value?snapshot:undefined;
 const checking=Boolean(value)&&selection.id!==value;
 const reason=selected?unavailableReason(selected):selection.id===value?selection.error:undefined;
 const emailChanged=Boolean(original?.email&&selected?.email&&original.email!==selected.email);
 const emailAccepted=!emailChanged||acceptedEmail===`${value}:${selected?.email}`;
 const eligible=Boolean(value&&selected&&!reason&&emailAccepted);
 useEffect(()=>{onEligibilityChange(eligible);},[eligible,onEligibilityChange]);
 const name=selected?.name||original?.name||t('mailRecipientOriginal');
 const address=selected?.email||original?.email||t('mailRecipientMissingEmail');
 const label=(contact:Recipient)=>`${contact.name||t('mailRecipientUnnamed')} — ${contact.email||t('mailRecipientMissingEmail')}${unavailableReason(contact)?` · ${t(unavailableReason(contact)!)}`:''}`;
 const hasMore=Boolean(results&&results.query===term&&results.rows.length<results.total);
 const hasEligible=rows.some(row=>!unavailableReason(row));
 return <div className={`field full-field ${styles.picker}`}>
  <label htmlFor="field-contact_id">{t('recipient')}<span className="required" aria-label={t('required')}> *</span></label>
  <div className={styles.search}><Search size={16} aria-hidden="true"/><input type="search" value={query} disabled={disabled} onChange={event=>{setQuery(event.target.value);setPage(1);}} placeholder={t('mailRecipientSearch')} aria-label={t('mailRecipientSearch')}/></div>
  <select id="field-contact_id" required value={value} disabled={disabled} aria-describedby="mail-recipient-status" onChange={event=>{const id=event.target.value,contact=rows.find(row=>row.id===id);if(contact&&unavailableReason(contact))return;setAcceptedEmail('');setSelection(contact?{id,contact}:{id:''});onEligibilityChange(false);onChange(id);}}>
   <option value="">{t('mailRecipientSelect')}</option>
   {value&&!rows.some(row=>row.id===value)&&<option value={value} disabled={Boolean(reason)||checking}>{name} — {address}{reason?` · ${t(reason)}`:''}</option>}
   {rows.map(contact=><option key={contact.id} value={contact.id} disabled={Boolean(unavailableReason(contact))}>{label(contact)}</option>)}
  </select>
  <div id="mail-recipient-status" aria-live="polite" className={styles.status}>
   {value?<div className={`${styles.selection} ${reason?styles.unavailable:''}`}><Mail size={17} aria-hidden="true"/><div><strong>{name}</strong><span className={styles.address}>{address}</span>{checking&&<small>{t('mailRecipientChecking')}</small>}{reason&&<small className="field-error">{t(reason)}</small>}{original&&reason&&<small>{t('mailRecipientPreserved')}</small>}{emailChanged&&<><small>{t('mailRecipientPreviousAddress')}: {original?.email}</small><label className={styles.confirm}><input type="checkbox" disabled={disabled||Boolean(reason)} checked={emailAccepted} onChange={event=>setAcceptedEmail(event.target.checked?`${value}:${selected?.email}`:'')}/><span>{t('mailRecipientConfirmUpdatedEmail')}</span></label></>}</div></div>:<span className="muted">{t('mailRecipientNotSelected')}</span>}
   {loading&&<small className="muted">{t('loading')}</small>}
   {results?.error&&<div className={styles.notice}><span className="field-error">{results.error}</span><Button type="button" onClick={()=>setRevision(current=>current+1)}>{t('retry')}</Button></div>}
   {!loading&&!results?.error&&!hasEligible&&!hasMore&&<div className={styles.notice}><span>{t(term?'mailRecipientNoMatches':'mailRecipientNoneEligible')}</span><a href="/data/contacts" target="_blank" rel="noopener noreferrer">{t('mailRecipientManageContacts')}</a></div>}
  </div>
  {hasMore&&<Button type="button" disabled={disabled||loading} onClick={()=>setPage(current=>current+1)}>{t('loadMore')}</Button>}
 </div>;
}
