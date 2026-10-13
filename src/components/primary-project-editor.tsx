'use client';
import {useState} from 'react';
import {useApp} from './context';
import {api,errorMessage} from './api';
import {Button,ErrorBanner,FieldEditor,Modal} from './primitives';
import type {Resource,Row} from './types';

export default function PrimaryProjectEditor({resource,row,onSaved,disabled=false}:{resource:Resource;row:Row;disabled?:boolean;onSaved:(row:Row)=>void}){
 const {t,notify}=useApp();const [open,setOpen]=useState(false),[value,setValue]=useState<unknown>(row.project_id??''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const field=resource.fields.find(field=>field.key==='project_id');if(!field)return null;
 return <><Button disabled={disabled} onClick={()=>{setValue(row.project_id??'');setError('');setOpen(true);}}>{t('edit')} · {t('recordPrimaryProject')}</Button>{open&&<Modal title={t('recordPrimaryProject')} onClose={()=>{if(!busy)setOpen(false);}} footer={<><Button disabled={busy} onClick={()=>setOpen(false)}>{t('cancel')}</Button><Button variant="primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const updated=await api<Row>(`/api/data/${resource.key}/${row.id}`,{method:'PATCH',body:JSON.stringify({version:row.version,project_id:value||null})});onSaved(updated);setOpen(false);notify(t('saved'));}catch(e){setError(errorMessage(e,t));}finally{setBusy(false);}}}>{t(busy?'saving':'save')}</Button></>}>{error&&<ErrorBanner message={error}/>}<FieldEditor field={field} value={value} onChange={setValue}/></Modal>}</>;
}
