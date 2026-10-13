'use client';
import {richTextPlain} from '../lib/rich-text';
import RichTextEditor from './rich-text-editor';
import RichText from './rich-text';
import {useEffect,useState} from 'react';
import {Plus} from 'lucide-react';
import {useApp} from './context';
import {api,post,errorMessage} from './api';
import {Button,ErrorBanner,Modal} from './primitives';

export type RoleOption={code:string;name:string;name_zh?:string;name_en?:string;description:string;active:boolean;version:number;builtin:boolean;can_edit_policy?:boolean};
export function roleLabel(role:RoleOption,t:(key:string)=>string){return role.code==='operations'?t('operationsRole'):role.builtin?t(role.code==='operations'?'operationsRole':role.code==='finance'?'financeRole':role.code):role.name;}
export function RoleSelector({value,onChange,assigning=false}:{value:string[];onChange:(roles:string[])=>void;assigning?:boolean}){
 const {t,me}=useApp();const [roles,setRoles]=useState<RoleOption[]>([]),[error,setError]=useState('');
 useEffect(()=>{api<RoleOption[]>('/api/roles').then(setRoles).catch(e=>setError(errorMessage(e,t)));},[]);
 return <>{error&&<ErrorBanner message={error}/>}<div className="check-grid">{roles.filter(role=>role.active&&(!assigning||me.initial_administrator||(role.code!=='operations'&&(role.code!=='admin'||me.roles.includes('operations'))))).map(role=><label key={role.code} title={richTextPlain(role.description)}><input type="checkbox" checked={value.includes(role.code)} onChange={e=>onChange(e.target.checked?[...value,role.code]:value.filter(code=>code!==role.code))}/>{roleLabel(role,t)}</label>)}</div></>;
}
export default function RoleManager({roles,onSaved}:{roles:RoleOption[];onSaved:()=>void}){
 const {t}=useApp();const [form,setForm]=useState<Partial<RoleOption>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <section className="access-sharing-section"><div className="section-heading"><h3>{t('customRoles')}</h3><Button icon={Plus} onClick={()=>{setForm({name:'',description:'',active:true});setError('');}}>{t('createRole')}</Button></div><p className="muted small">{t('customRoleDefault')}</p><div className="role-list">{roles.filter(role=>!role.builtin).map(role=><div key={role.code}><strong>{role.name}</strong><div><RichText value={role.description}/></div><span>{t(role.active?'active':'disabled')}</span><Button onClick={()=>{setForm(role);setError('');}}>{t('edit')}</Button></div>)}</div>{form&&<Modal title={t(form.code?'editRole':'createRole')} onClose={()=>{if(!busy)setForm(null);}} footer={<Button variant="primary" disabled={busy||!form.name?.trim()} onClick={async()=>{setBusy(true);setError('');try{await post('/api/roles',form);setForm(null);onSaved();}catch(e){setError(errorMessage(e,t));}finally{setBusy(false);}}}>{t(busy?'saving':'save')}</Button>}>{error&&<ErrorBanner message={error}/>}<div className="form-grid single"><div className="field"><label htmlFor="role-name">{t('roleName')}</label><input id="role-name" maxLength={100} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div><div className="field"><label htmlFor="role-description">{t('roleDescription')}</label><RichTextEditor aria-label={t('roleDescription')} id="role-description" maxLength={2000} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>{form.code&&<label className="check-line"><input type="checkbox" checked={Boolean(form.active)} onChange={e=>setForm({...form,active:e.target.checked})}/>{t('active')}</label>}</div></Modal>}</section>;
}
