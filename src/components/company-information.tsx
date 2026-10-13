'use client';
import RichTextEditor from './rich-text-editor';
import RichText from './rich-text';
import ImageSizeControl from './image-size-control';
import {useEffect,useState} from 'react';
import {interfaceText} from '../locales/interface-text';
import {useApp} from './context';
import {api,post,errorMessage} from './api';
import {Button,ErrorBanner,Modal,Spinner} from './primitives';
import MultiMemberPicker from './multi-member-picker';
import {RoleSelector} from './role-manager';
type Grant={read_users:string[];edit_users:string[];read_roles:string[];edit_roles:string[]};
type Company={version:number;can_manage_access:boolean;fields:{key:string;label:string[];value:string;can_edit:boolean}[];policy?:Record<string,Grant>};
export function useCompanyWords(){const {locale}=useApp();return(zh:string,en:string)=>interfaceText(locale,zh,en);}
export default function CompanyInformation(){
 const {t,notify}=useApp(),L=useCompanyWords(),[data,setData]=useState<Company|null>(null),[values,setValues]=useState<Record<string,string>>({}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[field,setField]=useState(''),[grant,setGrant]=useState<Grant>({read_users:[],edit_users:[],read_roles:[],edit_roles:[]});
 useEffect(()=>{api<Company>('/api/company-information').then(setData).catch(e=>setError(errorMessage(e,t)));},[]);
 const save=async(policy?:Record<string,Grant>)=>{setBusy(true);setError('');try{const result=await post<Company>('/api/company-information',{version:data?.version,fields:values,...(policy?{policy}:{})});setData(result);setValues({});setField('');notify(t('success'));}catch(e){setError(errorMessage(e,t));}finally{setBusy(false);}};
 const fields=data?.fields.filter(f=>!['mail_header','mail_footer'].includes(f.key))??[];
 return <section className="settings-card"><header><h2>{L('公司資料與品牌','Company information & brand')}</h2></header>{<div className="brand-settings"><img src="/brand/logo-primary.svg" alt="Syntherisk" style={{width:Number(values.logo_width??data?.fields.find(f=>f.key==='logo_width')?.value)||230,maxWidth:'100%',height:'auto'}}/></div>}{error&&<ErrorBanner message={error}/>} {!data?<Spinner/>:!fields.length?<p className="muted">{L('尚未授權您檢閱公司資料。請向管理員申請需要的欄位。','No company fields have been shared with you. Ask an administrator for the fields you need.')}</p>:<><p className="muted">{L('僅顯示已授權的欄位。公司管理憑證請保存在私密設定，不填入公司備註。','Only authorized fields appear here. Keep administrative credentials in private settings, not company notes.')}</p><div className="form-grid">{fields.map(f=><div className="field" key={f.key}>{<label htmlFor={`company-${f.key}`}>{L(f.label[0],f.label[1])}</label>}{f.can_edit?f.key==='logo_width'?<ImageSizeControl value={Number(values[f.key]??f.value)||230} min={80} max={400} disabled={busy} onChange={v=>setValues({...values,logo_width:String(v)})}/>:['shareholders','directors','tax_information','company_notes','annual_return'].includes(f.key)?<RichTextEditor maxLength={20000} aria-label={L(f.label[0],f.label[1])} id={`company-${f.key}`} rows={4} value={values[f.key]??f.value} onChange={e=>setValues({...values,[f.key]:e.target.value})}/>:<input id={`company-${f.key}`} type={f.key==='incorporation_date'?'date':'text'} value={values[f.key]??f.value} onChange={e=>setValues({...values,[f.key]:e.target.value})}/>:<div className="notice-body"><RichText value={f.value||'—'}/></div>}{data.can_manage_access&&<Button onClick={()=>{setField(f.key);setGrant(data.policy?.[f.key]??{read_users:[],edit_users:[],read_roles:[],edit_roles:[]});}}>{L('設定此欄位權限','Field access')}</Button>}</div>)}</div>{fields.some(f=>f.can_edit)&&<footer className="settings-footer"><Button variant="primary" disabled={busy||!Object.keys(values).length} onClick={()=>void save()}>{t('save')}</Button></footer>}</>}
 {field&&data&&<Modal wide title={L('公司欄位權限','Company field access')} onClose={()=>setField('')} footer={<Button variant="primary" disabled={busy} onClick={()=>void save({...data.policy,[field]:grant})}>{t('save')}</Button>}><p>{L('編輯權限包含檢閱；未勾選者無法透過頁面或介面取得欄位內容。','Editing includes reading. Unselected members cannot retrieve the field from the page or API.')}</p>{(['read','edit'] as const).map(op=><section key={op}><h3>{L(op==='read'?'可檢閱':'可編輯',op==='read'?'Can read':'Can edit')}</h3><MultiMemberPicker id={`company-${op}`} selectionLabel={t('members')} selection={{ids:grant[`${op}_users`],onChange:ids=>setGrant({...grant,[`${op}_users`]:ids})}}/><RoleSelector value={grant[`${op}_roles`]} onChange={roles=>setGrant({...grant,[`${op}_roles`]:roles})}/></section>)}</Modal>}
 </section>;
}
