'use client';
import RichTextEditor from './rich-text-editor';
import {useState} from 'react';
import {useApp} from './context';
import {post,errorMessage} from './api';
import {Button,ErrorBanner} from './primitives';
import {useCompanyWords} from './company-information';
type Data=Record<string,unknown>;
export default function MailOrganization({connectionId,mail,onSaved}:{connectionId:unknown;mail:Data;onSaved:(value:Data)=>void}){
 const {t}=useApp(),L=useCompanyWords(),[value,setValue]=useState<Data>((mail.organization as Data)??{category:'',notes:'',pinned:false,version:0}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
 const change=(key:string,next:unknown)=>{setValue({...value,[key]:next});setSaved(false);};
 return <details><summary>{L('個人分類與備註','Personal category and notes')}</summary><p className="muted">{L('僅自己可見，儲存在 ERP；不變更 Gmail 標籤或分享內容。','Visible only to you in ERP; Gmail labels and shared snapshots remain unchanged.')}</p>{error&&<ErrorBanner message={error}/>}<div className="field"><label htmlFor="mail-category">{L('分類','Category')}</label><input id="mail-category" maxLength={100} value={String(value.category??'')} onChange={e=>change('category',e.target.value)}/></div><div className="field"><label htmlFor="mail-notes">{L('備註','Notes')}</label><RichTextEditor aria-label={L('備註','Notes')} maxLength={10000} id="mail-notes" value={String(value.notes??'')} onChange={e=>change('notes',e.target.value)}/></div><label><input type="checkbox" checked={value.pinned===true} onChange={e=>change('pinned',e.target.checked)}/>{L('置頂','Pin')}</label><Button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const result=await post<Data>('/api/workspace-services',{action:'gmail_organize',connection_id:connectionId,message_id:mail.id,category:value.category,notes:value.notes,pinned:value.pinned,version:value.version});setValue(result);onSaved(result);setSaved(true);}catch(e){setError(errorMessage(e,t));}finally{setBusy(false);}}}>{t('save')}</Button>{saved&&<p role="status">{L('個人整理已儲存','Personal organization saved')}</p>}</details>;
}
