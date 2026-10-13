'use client';
import {useEffect,useState} from 'react';
import {useApp} from './context';
import {api,post,errorMessage} from './api';
import {Button,Modal,ErrorBanner,FieldEditor} from './primitives';
import {RecordForm} from './resource-view';
import {useCompanyWords} from './company-information';
import type {Row} from './types';
type Data=Record<string,unknown>;
export default function MailLinks({connectionId,itemIds,titles,onClose}:{connectionId:unknown;itemIds:string[];titles:string[];onClose:()=>void}){
 const {resources,label,t,navigate}=useApp(),L=useCompanyWords();
 const [resource,setResource]=useState('tasks'),[recordId,setRecordId]=useState(''),[create,setCreate]=useState(false),[links,setLinks]=useState<Data[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[created,setCreated]=useState<Row|null>(null);
 const choices=Object.values(resources).filter(r=>!r.parent&&!r.hidden&&!r.readonly&&r.capabilities?.read&&!['settings','finance'].includes(r.module));
 const run=(action:string,extra:Data={})=>post<Data>('/api/workspace-services',{action,connection_id:connectionId,item_ids:itemIds,...extra});
 const load=()=>run('gmail_item_links').then(r=>setLinks(r.links as Data[])).catch(e=>setError(errorMessage(e,t)));
 useEffect(()=>{void load();},[]);
 const link=async(id=recordId)=>{setBusy(true);setError('');try{await run('gmail_link_items',{resource,record_id:id});setCreated(null);setRecordId('');await load();}catch(e){setError(errorMessage(e,t));}finally{setBusy(false);}};
 return <Modal wide title={L('郵件工作關聯','Related work for selected mail')} onClose={onClose} footer={<Button onClick={onClose}>{L('完成','Done')}</Button>}>{error&&<ErrorBanner message={error}/>}<p>{L('這些關聯只供您整理郵件，不會共享郵件內容。新紀錄的可見範圍由其表單決定；指派、送審及簽署仍在該紀錄中操作。','These personal links do not share mail content. New records use the visibility selected in their forms; assignment, review and signing stay in the record workflow.')}</p><ul>{titles.map((title,i)=><li key={i}>{title}</li>)}</ul>
 <div className="form-grid"><div className="field"><label htmlFor="mail-link-resource">{L('紀錄類型','Record type')}</label><select id="mail-link-resource" disabled={busy||!!created} value={resource} onChange={e=>{setResource(e.target.value);setRecordId('');}}>{choices.map(r=><option key={r.key} value={r.key}>{label(r)}</option>)}</select></div><FieldEditor field={{key:'mail-link-record',label:['既有紀錄','现有记录','Existing record'],type:'reference',ref:resource}} value={recordId} onChange={v=>setRecordId(String(v||''))}/></div>
 <div className="action-wrap"><Button disabled={busy||!recordId} onClick={()=>void link()}>{L('關聯既有項目','Link existing record')}</Button>{resources[resource]?.capabilities?.create&&<Button disabled={busy||!!created} onClick={()=>setCreate(true)}>{L('建立後續項目','Create follow-up record')}</Button>}</div>
 {created&&<p role="status">{L('紀錄已建立，但關聯尚未成功。可重試關聯，請勿重複建立。','Record created but linking failed. Retry the link without creating another record.')} <Button onClick={()=>void link(created.id)}>{L('重試關聯','Retry linking')}</Button></p>}
 <h3>{L('已關聯項目','Linked records')}</h3>{links.length?links.map(linked=><div className="action-wrap" key={String(linked.resource)+linked.record_id}><Button onClick={()=>{onClose();navigate('/data/'+linked.resource+'?record='+linked.record_id);}}>{String(linked.title)}</Button><Button disabled={busy} onClick={async()=>{setBusy(true);try{await run('gmail_unlink_items',linked);await load();}catch(e){setError(errorMessage(e,t));}finally{setBusy(false);}}}>{L('移除所選郵件的關聯','Unlink selected mail')}</Button></div>):<p className="muted">{L('尚未關聯項目。','No linked records yet.')}</p>}
 {create&&resources[resource]&&<RecordForm resource={resources[resource]} defaults={{title:titles[0]??'',name:titles[0]??'',is_private:true}} onClose={()=>setCreate(false)} onSaved={row=>{setCreate(false);setCreated(row);void link(row.id);}}/>}
 </Modal>;
}
