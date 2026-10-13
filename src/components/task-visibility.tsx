'use client';
import {useEffect,useState} from 'react';
import {Check,X,Search} from 'lucide-react';
import {useApp} from './context';
import {api,errorMessage} from './api';
import {Button,ErrorBanner} from './primitives';
import MultiMemberPicker,{type ResponsibleMember} from './multi-member-picker';
import type {Resource,Row} from './types';
import './task-visibility.css';

type Team={id:string;name:string};
export type VisibilityValues={visibility:'team'|'restricted'|'selected_teams';is_private:boolean;viewer_user_ids:string[];viewer_team_ids:string[]};
const modeLabels={team:'taskVisibilityTeam',selected_teams:'recordVisibilityTeams',restricted:'taskVisibilityRestricted'} as const;
export function taskVisibilityValues(row?:Record<string,unknown>):VisibilityValues{return {
 visibility:row?.visibility==='restricted'?'restricted':row?.visibility==='selected_teams'?'selected_teams':'team',
 is_private:row?.is_private===true,
 viewer_user_ids:Array.isArray(row?.viewer_user_ids)?row.viewer_user_ids.map(String):[],
 viewer_team_ids:Array.isArray(row?.viewer_team_ids)?row.viewer_team_ids.map(String):[],
};}
function TeamPicker({ids,teams=[],disabled,onChange}:{ids:string[];teams?:Team[];disabled:boolean;onChange:(ids:string[])=>void}){
 const {t}=useApp(),[search,setSearch]=useState(''),[rows,setRows]=useState<Team[]>([]),[cache,setCache]=useState<Team[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<unknown>(null);
 useEffect(()=>{let active=true;const timer=setTimeout(()=>{
  setLoading(true);api<{rows:Team[]}>(`/api/record-visibility/teams?q=${encodeURIComponent(search)}`).then(result=>{if(active){setRows(result.rows);setCache(current=>[...new Map([...current,...result.rows].map(team=>[team.id,team])).values()]);setError(null);}}).catch(reason=>{if(active)setError(reason);}).finally(()=>{if(active)setLoading(false);});
 },180);return()=>{active=false;clearTimeout(timer);};},[search]);
 const known=new Map([...teams,...cache].map(team=>[team.id,team])),name=(id:string)=>known.get(id)?.name||t('recordVisibilityTeamUnavailable');
 const change=(id:string,checked:boolean)=>{if(!disabled)onChange(checked?[...new Set([...ids,id])]:ids.filter(value=>value!==id));};
 return <div className="record-team-picker multi-member-picker">
  <div className="multi-member-selected" role="group" aria-label={t('recordVisibilitySelectedTeams')}>{ids.length?ids.map(id=><span className="member-chip" key={id}><span>{name(id)}</span><button type="button" disabled={disabled} aria-label={`${t('remove')} ${name(id)}`} onClick={()=>change(id,false)}><X size={13}/></button></span>):<span className="muted">{t('recordVisibilityChooseTeams')}</span>}</div>
  <div className="multi-member-search"><Search size={14} aria-hidden="true"/><input id="record-team-search" type="search" value={search} disabled={disabled} aria-label={t('recordVisibilitySearchTeams')} placeholder={t('recordVisibilitySearchTeams')} onChange={event=>setSearch(event.target.value)}/></div>
  <div className="multi-member-options" role="group" aria-label={t('recordVisibilitySelectedTeams')}>{rows.map(team=><label key={team.id}><input type="checkbox" checked={ids.includes(team.id)} disabled={disabled} onChange={event=>change(team.id,event.target.checked)}/><span>{team.name}</span></label>)}{loading&&<span role="status" className="muted small">{t('loading')}</span>}{!loading&&!rows.length&&error===null&&<span className="muted small">{t(search?'noResults':'recordVisibilityNoTeams')}</span>}</div>
  {error!==null&&<small role="alert" className="field-error">{errorMessage(error,t)}</small>}
 </div>;
}
export function TaskVisibilityFields({value,people,teams=[],onChange,disabled=false,canManage=true,canPrivate=false}:{value:VisibilityValues;people?:ResponsibleMember[];teams?:Team[];onChange:(value:VisibilityValues)=>void;disabled?:boolean;canManage?:boolean;canPrivate?:boolean}){
 const {t}=useApp();
 return <fieldset className="record-visibility-fields task-visibility-fields full-field" disabled={disabled}>
  <legend>{t('taskVisibility')}</legend>
  {(canPrivate||value.is_private)&&<label className="record-private-option"><input id="record-is-private" type="checkbox" checked={value.is_private} disabled={!canPrivate} aria-describedby="task-visibility-hint" onChange={event=>onChange({...value,is_private:event.target.checked})}/><span>{t('recordVisibilityPrivate')}</span></label>}
  {!value.is_private&&(canManage?<div className="task-visibility-modes">{(['team','selected_teams','restricted'] as const).map(mode=><label key={mode}><input type="radio" name="task-visibility" value={mode} checked={value.visibility===mode} aria-describedby="task-visibility-hint" onChange={()=>onChange({...value,visibility:mode})}/><span>{t(modeLabels[mode])}</span></label>)}</div>:<p className="record-visibility-current">{t(modeLabels[value.visibility])}</p>)}
  {!value.is_private&&value.visibility==='restricted'&&canManage&&<div className="task-viewers"><label htmlFor="task-viewer-search">{t('taskVisibilityMembers')}</label><MultiMemberPicker id="task-viewer-search" purpose="record_visibility" selectionLabel={t('taskVisibilityMembers')} disabled={disabled} describedBy="task-visibility-hint" selection={{ids:value.viewer_user_ids,people,onChange:ids=>onChange({...value,viewer_user_ids:ids})}}/></div>}
  {!value.is_private&&value.visibility==='selected_teams'&&(canManage?<div className="task-viewers"><label htmlFor="record-team-search">{t('recordVisibilitySelectedTeams')}</label><TeamPicker ids={value.viewer_team_ids} teams={teams} disabled={disabled} onChange={ids=>onChange({...value,viewer_team_ids:ids})}/></div>:<div className="responsible-names">{teams.map(team=><span key={team.id} className="responsible-name">{team.name}</span>)}</div>)}
  <p id="task-visibility-hint" className="field-help">{t(value.is_private?'recordVisibilityPrivateHint':value.visibility==='restricted'?'taskVisibilityRestrictedHint':value.visibility==='selected_teams'?'recordVisibilityTeamsHint':'taskVisibilityTeamHint')}</p>
 </fieldset>;
}
export default function TaskVisibilityPanel({resource,row,onSaved}:{resource:Resource;row:Row;onSaved:(row:Row)=>void}){
 const {t,notify}=useApp(),[value,setValue]=useState(()=>taskVisibilityValues(row)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const people=Array.isArray(row.viewer_users)?row.viewer_users as ResponsibleMember[]:[],teams=Array.isArray(row.viewer_teams)?row.viewer_teams as Team[]:[],dirty=JSON.stringify(value)!==JSON.stringify(taskVisibilityValues(row));
 const save=async()=>{setBusy(true);setError('');try{const result=await api<Row>(`/api/data/${resource.key}/${row.id}`,{method:'PATCH',body:JSON.stringify({...(row.can_manage_visibility?{visibility:value.visibility,viewer_user_ids:value.viewer_user_ids,viewer_team_ids:value.viewer_team_ids}:{}),...(row.can_choose_private?{is_private:value.is_private}:{}),version:row.version})});onSaved(result);notify(t('success'));}catch(reason){setError(errorMessage(reason,t));}finally{setBusy(false);}};
 if(!row.can_manage_visibility&&!row.can_choose_private)return <section className="record-visibility-summary task-visibility-summary"><h3>{t('taskVisibility')}</h3><p>{t(row.is_private?'recordVisibilityPrivate':modeLabels[value.visibility])}</p>{!row.is_private&&<div className="responsible-names">{(row.visibility==='restricted'?people:row.visibility==='selected_teams'?teams:[]).map(item=><span key={item.id} className="responsible-name">{item.name}</span>)}</div>}</section>;
 return <section className="record-visibility-panel task-visibility-panel">{error&&<ErrorBanner message={error}/>}<TaskVisibilityFields value={value} people={people} teams={teams} onChange={setValue} disabled={busy} canManage={row.can_manage_visibility===true} canPrivate={row.can_choose_private===true}/><footer><Button variant="primary" icon={Check} disabled={busy||!dirty} onClick={()=>void save()}>{t(busy?'saving':'save')}</Button></footer></section>;
}
