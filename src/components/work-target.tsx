'use client';
import {useApp} from './context';
import {FieldEditor} from './primitives';
import type {Me,Resource,Row} from './types';
import './work-target.css';

export function WorkTargetFields({resource,data,onChange,disabled=false,fixed=false}:{resource:Resource;data:Record<string,unknown>;onChange:(patch:Record<string,unknown>)=>void;disabled?:boolean;fixed?:boolean}){
 const {resources,t,label}=useApp();const typeField=resource.fields.find(field=>field.key==='target_resource');const recordField=resource.fields.find(field=>field.key==='target_id');
 if(!typeField||!recordField)return null;
 const selected=String(data.target_resource||'');const options=(typeField.options||[]).filter(key=>resources[key]);
 return <fieldset className="work-target-fields full-field" disabled={disabled||fixed}><legend>{t('workTarget')}</legend><div className="form-grid"><div className="field"><label htmlFor="field-target_resource">{label(typeField)}</label><select id="field-target_resource" value={selected} aria-describedby="work-target-help" onChange={event=>onChange({target_resource:event.target.value,target_id:null})}><option value="">{t('workTargetNone')}</option>{options.map(key=><option key={key} value={key}>{label(resources[key])}</option>)}</select></div>{selected&&resources[selected]&&<FieldEditor key={selected} field={{...recordField,type:'reference',ref:selected,required:true}} value={data.target_id} onChange={value=>onChange({target_id:value})} disabled={disabled||fixed}/>}</div><small id="work-target-help" className="field-help">{t('workTargetHint')}</small></fieldset>;
}

export function WorkTargetLink({row}:{row:Row}){
 const {resources,t,label,navigate}=useApp();const resource=resources[String(row.target_resource||'')];
 if(!resource||!row.target_id)return null;
 return <div className="work-target-link"><span>{t('workTarget')}</span><button type="button" className="reference-link" onClick={()=>navigate(`/data/${resource.key}?record=${encodeURIComponent(String(row.target_id))}`)}><strong>{String(row.target_title||row.target_name||String(row.target_id).slice(0,8))}</strong><small>{label(resource)}</small></button></div>;
}

export function DelegationGuide({compact=false}:{compact?:boolean}){
 const {t}=useApp();return <div className={`delegation-guide${compact?' compact':''}`}><p>{t('delegationSummary')}</p><details><summary>{t('delegationScope')}</summary><p>{t('delegationAccessHint')}</p><p>{t('delegationReviewHint')}</p></details></div>;
}

export function delegationActionVisible(action:string,row:Row,me:Me){
 const state=String(row.status),assignee=row.assignee_id===me.user.id,reviewer=!assignee&&(row.requester_id===me.user.id||me.roles.some(role=>['admin','operations'].includes(role)));
 if(['completed','revoked'].includes(state))return false;
 if(action==='revoke')return reviewer;
 if(action==='reissue')return row.requester_id===me.user.id&&['expired','needs_reissue'].includes(String(row.access_state));
 if(action==='start')return assignee&&['assigned','needs_changes'].includes(state);
 if(action==='report')return assignee&&['assigned','in_progress','needs_changes'].includes(state);
 if(['request_changes','confirm'].includes(action))return reviewer&&state==='submitted'&&Boolean(row.review_required);
 return false;
}

export function DelegationStatus({row}:{row:Row}){
 const {t}=useApp();const state=String(row.access_state||'');const known=['editable','read_only','read_only_review','standalone','expired','needs_reissue','completed','revoked'].includes(state);
 return <section className="delegation-access-status"><strong>{t('delegationAccessStatus')}</strong>{known&&<span>{t(`delegationAccess_${state}`)}</span>}{['expired','needs_reissue'].includes(state)&&<p>{t('delegationReissueHint')}</p>}{row.status==='submitted'&&row.target_id&&!row.submitted_snapshot_available?<p>{t('delegationReportOnly')}</p>:null}</section>;
}

