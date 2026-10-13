'use client';
import {useEffect,useState} from 'react';
import {useApp} from './context';
import {api,post,errorMessage} from './api';
import {Button,ErrorBanner,FieldEditor} from './primitives';
import {MailComposer} from './mail-hub';
import {useCompanyWords} from './company-information';
import type {Row} from './types';
type Data=Record<string,unknown>;
export default function MailAssetTools({resource,row}:{resource:string;row:Row}){
 const {t,navigate}=useApp(),L=useCompanyWords(),[connection,setConnection]=useState<Data|null>(null),[compose,setCompose]=useState<Data|null>(null),[members,setMembers]=useState<Row[]>([]),[contact,setContact]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[memberPage,setMemberPage]=useState(1),[memberTotal,setMemberTotal]=useState(0);
 useEffect(()=>{api<{connections:Data[]}>('/api/integrations').then(r=>setConnection(r.connections.find(c=>c.provider==='gmail'&&c.status!=='disconnected')??null)).catch(e=>setError(errorMessage(e,t)));},[]);
 useEffect(()=>{if(resource==='audience_groups')api<{rows:Row[];total:number}>('/api/data/audience_members?group_id='+row.id+'&pageSize=100&page='+memberPage).then(r=>{setMembers(r.rows);setMemberTotal(r.total);}).catch(e=>setError(errorMessage(e,t)));},[resource,row.id,revision,memberPage]);
 const start=async()=>{if(!connection){navigate('/settings?section=integrations');return;}setBusy(true);try{{const result=await post<Data>('/api/workspace-services',{action:'gmail_group_recipients',group_id:row.id});const recipients=result.recipients as Data[];if(recipients.length>100){setError(L('此分組超過 100 人，請在撰信視窗使用分組選擇器挑選本次收件者。','This group exceeds 100 recipients. Use the group selector in Compose to choose recipients.'));setCompose({});}else if(!recipients.length)setError(L('此分組目前沒有可寄送的聯絡人。請先新增成員並確認信箱與聯絡偏好。','This group has no eligible recipients. Add members and check their email and contact preferences.'));else setCompose({bcc:recipients.map(r=>r.email).join(', ')});}}catch(e){setError(errorMessage(e,t));}finally{setBusy(false);}};
 return <section className="settings-card mail-asset-tools">{error&&<ErrorBanner message={error}/>}<h3>{L('分組成員與使用','Group members and usage')}</h3><p>{L('將 CRM 聯絡人加入分組，即可在撰信時選取、去重並加入收件者。拒絕聯絡、封存或您無權存取的聯絡人會排除。','Add CRM contacts to select and deduplicate recipients when composing. Archived, inaccessible or do-not-contact contacts are excluded.')}</p>
 <Button variant="primary" disabled={busy} onClick={()=>void start()}>{connection?L('寄信給此分組','Compose to this group'):L('先連接 Gmail','Connect Gmail first')}</Button>
 <FieldEditor field={{key:'group-contact',label:['加入聯絡人','加入联系人','Add contact'],type:'reference',ref:'contacts'}} value={contact} onChange={v=>setContact(String(v||''))}/>
 <Button disabled={busy||!contact} onClick={async()=>{setBusy(true);setError('');try{await post('/api/data/audience_members',{group_id:row.id,contact_id:contact});setContact('');setRevision(v=>v+1);}catch(e){setError(errorMessage(e,t));}finally{setBusy(false);}}}>{L('加入分組','Add to group')}</Button>
 <p className="muted">{L('分組成員','Group members')}：{memberTotal} · {memberPage} / {Math.max(1,Math.ceil(memberTotal/100))}</p><div className="action-wrap"><Button disabled={memberPage===1} onClick={()=>setMemberPage(p=>p-1)}>{L('上一頁','Previous')}</Button><Button disabled={memberPage*100>=memberTotal} onClick={()=>setMemberPage(p=>p+1)}>{L('下一頁','Next')}</Button></div><div className="mail-group-members">{members.map(m=><div className="action-wrap" key={m.id}><span>{String(m.contact_name||m.contact_id)}</span><Button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await post('/api/data/audience_members/'+m.id+'/actions/archive',{version:m.version});setRevision(v=>v+1);}catch(e){setError(errorMessage(e,t));}finally{setBusy(false);}}}>{L('移出分組','Remove from group')}</Button></div>)}</div>

 {compose&&connection&&<MailComposer connection={connection} initial={compose} onClose={()=>setCompose(null)}/>}
 </section>;
}
