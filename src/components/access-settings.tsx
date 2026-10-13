'use client';
import {isRetiredResource} from '../domain/retired-features';
import {useEffect,useState} from 'react';
import {Plus,Check,Share2} from 'lucide-react';
import {useApp} from './context';
import {api,post,errorMessage} from './api';
import {Button,ErrorBanner,FieldEditor,Modal,Spinner} from './primitives';
import type {Row} from './types';
import './access-settings.css';
import {useCompanyWords} from './company-information';
import RoleManager,{RoleSelector,roleLabel,type RoleOption} from './role-manager';

type PolicyForm={role_code:string;resource:string;operations:string[];scopes:string[]};
type GrantForm={resource:string;record_id:string;user_id:string;can_edit:boolean};
const newPolicy=():PolicyForm=>({role_code:'member',resource:'contacts',operations:['read'],scopes:['created','responsible']});
const newGrant=():GrantForm=>({resource:'contacts',record_id:'',user_id:'',can_edit:false});

export default function AccessSettings(){
 const {t,resources,label,notify,me}=useApp(),L=useCompanyWords();
 const [roleFilter,setRoleFilter]=useState(''),[resourceFilter,setResourceFilter]=useState('');
 const [data,setData]=useState<{permissions:Row[];grants:Row[];roles:RoleOption[];operation_options:Record<string,string[]>}>({permissions:[],grants:[],roles:[],operation_options:{}});
 const [editing,setEditing]=useState<'policy'|'grant'|null>(null);
 const [policy,setPolicy]=useState<PolicyForm>(newPolicy);
 const [grant,setGrant]=useState<GrantForm>(newGrant);
 const [loadError,setLoadError]=useState<unknown>(null);
 const [formError,setFormError]=useState<unknown>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;api<typeof data>('/api/access').then(result=>{if(active){setData(result);setLoadError(null);}}).catch(error=>{if(active)setLoadError(error);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[revision]);
 const refresh=()=>{setLoading(true);setRevision(value=>value+1);};
 const roleName=(code:string)=>{const role=data.roles.find(role=>role.code===code);return role?roleLabel(role,t):code;};const operationName=(value:string)=>value==='read'?t('permissionRead'):t(value.replace(/^action:/,''));
 const resourceName=(key:string)=>resources[key]?label(resources[key]):t(key==='*'?'allResources':key==='team_directory'?'teamDirectory':key==='team_private'?'teamPrivate':key);
 const editableRoles=data.roles.filter(role=>role.active&&(role.can_edit_policy??(role.code!=='admin'&&(role.code!=='operations'||me.initial_administrator))));
 const openPolicy=(row?:Row)=>{if(row&&row.can_edit!==true)return;setFormError(null);setPolicy(row?{role_code:String(row.role_code),resource:String(row.resource),operations:[String(row.operation)],scopes:String(row.scope).split(',')}:{...newPolicy(),role_code:editableRoles[0]?.code??''});setEditing('policy');};
 const openGrant=()=>{setFormError(null);setGrant(newGrant());setEditing('grant');};
 const canGrant=Boolean(resources[grant.resource]&&grant.record_id&&grant.user_id);
 const save=async()=>{if(!editing||busy||(editing==='grant'&&!canGrant))return;setBusy(true);setFormError(null);try{await post('/api/access',editing==='grant'?{action:'grant',...grant}:{action:'policy',...policy});refresh();setEditing(null);notify(t('success'));}catch(error){setFormError(error);}finally{setBusy(false);}};
 const revoke=async(row:Row)=>{try{await post('/api/access',{action:'revoke',resource:row.resource,record_id:row.record_id,user_id:row.user_id,can_edit:Boolean(row.can_edit)});refresh();notify(t('success'));}catch(error){setLoadError(error);}};
 const resourceOptions=Object.values(resources).filter(resource=>!isRetiredResource(resource.key)&&Boolean(data.operation_options[resource.key]?.length)).map(resource=><option key={resource.key} value={resource.key}>{label(resource)}</option>);
 return <div className="settings-card access-settings">
  <header><h2>{t('permissions')}</h2>{editableRoles.length>0&&<Button icon={Plus} variant="primary" onClick={()=>openPolicy()}>{t('permissionPolicy')}</Button>}</header>
  <p className="muted">{t('accessPolicyOverview')}</p>
  {loadError!==null&&<ErrorBanner message={errorMessage(loadError,t)}/>}
  {loading?<Spinner/>:<>
   <div className="form-grid"><label>{L('按角色查看','Filter by role')}<select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}><option value="">{L('所有角色','All roles')}</option>{data.roles.map(r=><option key={r.code} value={r.code}>{roleLabel(r,t)}</option>)}</select></label><label>{L('搜索功能','Find a function')}<input value={resourceFilter} onChange={e=>setResourceFilter(e.target.value)} placeholder={L('例如：联系人、任务、财务','For example: contacts, tasks, finance')}/></label></div>
   <p className="muted">{L('先选角色，再查找功能并编辑。每条规则由“能做什么”和“对哪些记录生效”组成；多个角色与职务的授权取并集。部门／职务授权和员工实际权限可在“公司与团队 → 部门信息”查看。','Choose a role, find a function, then edit. Each rule specifies an operation and a record scope. Role and job grants are combined. Department/job grants and member permission sources are under Company & teams → Departments.')}</p>
   <div className="table-scroll"><table className="data-table compact"><thead><tr><th>{t('roles')}</th><th>{t('resource')}</th><th>{t('permissionOperations')}</th><th>{t('permissionScopes')}</th><th/></tr></thead><tbody>{data.permissions.filter(row=>!isRetiredResource(String(row.resource))&&(!roleFilter||row.role_code===roleFilter)&&resourceName(String(row.resource)).toLowerCase().includes(resourceFilter.toLowerCase())).map(row=><tr key={row.id}><td>{roleName(String(row.role_code))}</td><td>{resourceName(String(row.resource))}</td><td>{operationName(String(row.operation))}</td><td>{String(row.scope).split(',').map(scope=>t(`scope_${scope}`)).join('、')}</td><td>{row.can_edit===true&&<Button onClick={()=>openPolicy(row)}>{t('edit')}</Button>}</td></tr>)}</tbody></table>{!data.permissions.length&&<p className="compact-empty muted">{t('defaultPermissions')}</p>}</div>
   <RoleManager roles={data.roles} onSaved={refresh}/>
   <section className="access-sharing-section" aria-labelledby="access-sharing-title">
    <div className="section-heading"><h3 id="access-sharing-title">{t('accessRecordSharing')}</h3><Button icon={Plus} onClick={openGrant}>{t('accessAddGrant')}</Button></div>
    <p className="access-section-hint">{t('accessGrantOverview')}</p>
    <details className="access-permission-details"><summary>{t('accessPermissionDetails')}</summary><p>{t('accessGrantLimits')}</p><p>{t('accessExistingRights')}</p></details>
    {data.grants.length?<div className="table-scroll"><table className="data-table compact"><thead><tr><th>{t('accessRecordType')}</th><th>{t('accessRecordToShare')}</th><th>{t('accessRecipient')}</th><th>{t('accessGrantPermission')}</th><th/></tr></thead><tbody>{data.grants.map(row=><tr key={row.id}><td>{resourceName(String(row.resource))}</td><td className="small access-identifier" title={String(row.record_id)}>{String(row.record_name||row.record_title||String(row.record_id).slice(0,8))}</td><td className="small access-identifier" title={String(row.user_id)}>{String(row.user_name||row.member_name||String(row.user_id).slice(0,10))}</td><td>{t(row.can_edit?'accessReadEdit':'accessReadOnly')}</td><td><Button onClick={()=>void revoke(row)}>{t('accessRevoke')}</Button></td></tr>)}</tbody></table></div>:<div className="access-empty"><Share2 size={23} aria-hidden="true"/><strong>{t('accessEmptyTitle')}</strong><p>{t('accessEmptyHint')}</p></div>}
   </section>
  </>}
  {editing&&<Modal title={t(editing==='policy'?'permissionPolicy':'accessAddGrant')} onClose={()=>{if(!busy)setEditing(null);}} footer={<Button variant="primary" icon={Check} disabled={busy||(editing==='grant'?!canGrant:!policy.operations.length||!policy.scopes.length)} onClick={()=>void save()}>{busy?t('saving'):t(editing==='grant'?'accessGrantAccess':'save')}</Button>}>
   {formError!==null&&<ErrorBanner message={errorMessage(formError,t)}/>}
   {editing==='grant'&&<div className="access-grant-overview"><p>{t('accessGrantOverview')}</p><span>{t('accessDefaultReadOnly')}</span></div>}
   <div className="form-grid single">
    <div className="field"><label htmlFor="access-resource">{t(editing==='grant'?'accessRecordType':'resource')}</label><select id="access-resource" aria-label={t(editing==='grant'?'accessRecordType':'resource')} value={editing==='grant'?grant.resource:policy.resource} onChange={event=>{if(editing==='grant')setGrant(current=>({...current,resource:event.target.value,record_id:''}));else setPolicy(current=>({...current,resource:event.target.value,operations:[data.operation_options[event.target.value]?.[0]??'read'],scopes:['analytics','team_boards'].includes(event.target.value)?['all']:['created']}));}}>{editing==='policy'&&<><option value="*">{t('allResources')}</option><option value="google_integrations">{t('google_integrations')}</option><option value="announcements">{t('announcements')}</option><option value="analytics">{t('analytics')}</option><option value="workforce">{t('workforce')}</option><option value="team_directory">{t('teamDirectory')}</option><option value="team_boards">{t('team_boards')}</option><option value="team_private">{t('teamPrivate')}</option></>}{resourceOptions}</select></div>
    {editing==='policy'?<>
     <div className="field"><label htmlFor="access-role">{t('roles')}</label><select id="access-role" value={policy.role_code} onChange={event=>setPolicy({...policy,role_code:event.target.value})}>{editableRoles.map(role=><option key={role.code} value={role.code}>{roleLabel(role,t)}</option>)}</select></div>
     <fieldset className="permission-choices"><legend>{t('permissionOperations')}</legend>{(data.operation_options[policy.resource]||[]).map(operation=><label key={operation}><input type="checkbox" checked={policy.operations.includes(operation)} onChange={e=>setPolicy({...policy,operations:e.target.checked?[...policy.operations,operation]:policy.operations.filter(value=>value!==operation),scopes:policy.resource==='workforce'&&e.target.checked&&['schedule','payroll'].includes(operation)?(policy.scopes.includes('none')?['none']:['all']):policy.scopes})}/>{operationName(operation)}</label>)}</fieldset>
     <fieldset className="permission-choices"><legend>{t('permissionScopes')}</legend>{(policy.resource==='workforce'?(policy.operations.some(operation=>['schedule','payroll'].includes(operation))?['all','none']:['all','own','created','assigned','none']):['analytics','team_boards'].includes(policy.resource)?['all','none']:['team_directory','team_private','announcements','google_integrations','team_boards'].includes(policy.resource)?['all','created','none']:['all','created','responsible','assigned','granted','none',...(policy.scopes.includes('own')?['own']:[])]).map(scope=><label key={scope}><input type="checkbox" checked={policy.scopes.includes(scope)} onChange={e=>setPolicy({...policy,scopes:e.target.checked?(['all','none'].includes(scope)?[scope]:[...policy.scopes.filter(value=>!['all','none'].includes(value)),scope]):policy.scopes.filter(value=>value!==scope)})}/>{t(`scope_${scope}`)}</label>)}</fieldset><p className="muted small">{t(policy.resource==='workforce'?'workforcePermissionHint':'permissionScopeHint')}</p>
    </>:<>
     <FieldEditor key={grant.resource} field={{key:'record_id',type:'reference',ref:grant.resource,label:[t('accessRecordToShare'),t('accessRecordToShare'),t('accessRecordToShare')],required:true}} value={grant.record_id} hint={t('accessRecordPickerHint')} onChange={value=>setGrant(current=>({...current,record_id:String(value||'')}))}/>
     <FieldEditor field={{key:'user_id',type:'reference',ref:'members',label:[t('accessRecipient'),t('accessRecipient'),t('accessRecipient')],required:true}} value={grant.user_id} hint={t('accessRecipientHint')} onChange={value=>setGrant(current=>({...current,user_id:String(value||'')}))}/>
     <div className="access-edit-choice"><label className="check-line"><input type="checkbox" checked={grant.can_edit} aria-describedby="access-edit-hint" onChange={event=>setGrant({...grant,can_edit:event.target.checked})}/>{t('accessAllowEditing')}</label><p id="access-edit-hint">{t('accessEditHint')}</p></div>
    </>}
   </div>
   {editing==='grant'&&<details className="access-permission-details access-grant-notes"><summary>{t('accessPermissionDetails')}</summary><p>{t('accessRecordScope')}</p><p>{t('accessMemberDetails')}</p><p>{t('accessGrantLimits')}</p><p>{t('accessExistingRights')}</p></details>}
  </Modal>}
 </div>;
}
export function MemberEdit({row,onClose,onSaved}:{row:Row;onClose:()=>void;onSaved:()=>void}){const {t,notify}=useApp();const [roles,setRoles]=useState<string[]>(Array.isArray(row.roles)?row.roles as string[]:[]);const [status,setStatus]=useState(String(row.status||'active'));const [error,setError]=useState('');return <Modal title={`${t('roles')} · ${String(row.name||row.email)}`} onClose={onClose} footer={<Button variant="primary" disabled={!roles.length} onClick={async()=>{try{await post('/api/identity',{action:'update-member',user_id:row.user_id||row.id,roles,status});notify(t('success'));onSaved();}catch(e){setError(errorMessage(e,t));}}}>{t('save')}</Button>}>{error&&<ErrorBanner message={error}/>}<RoleSelector assigning value={roles} onChange={setRoles}/><div className="field" style={{marginTop:20}}><label>{t('status')}</label><select value={status} onChange={e=>setStatus(e.target.value)}>{['active','disabled'].map(value=><option key={value} value={value}>{t(value)}</option>)}</select></div></Modal>;}

