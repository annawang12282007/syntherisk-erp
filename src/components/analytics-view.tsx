'use client';
import {useEffect,useState} from 'react';
import {useSearchParams,useRouter} from 'next/navigation';
import {Download,Filter,BarChart3} from 'lucide-react';
import {useApp} from './context';
import {api,errorMessage} from './api';
import {Button,Empty,ErrorBanner,Spinner} from './primitives';
import {StructuredResult} from './resource-view';
import type {Row} from './types';
import styles from './analytics-view.module.css';
import ExportDialog from './export-dialog';
const postedReports=new Set(['trial_balance','ledger','profit_loss','balance_sheet','per_currency','expenses_by_category','project_costs']);
const managementScopes:Record<string,string>={ar_ap:'analyticsScopeApproved',budgets:'analyticsScopeBudget',subscriptions:'analyticsScopeSubscriptions',cashflow:'analyticsScopePayments'};
export default function AnalyticsView(){
 const {t,me}=useApp();
 const [data,setData]=useState<Record<string,unknown>|null>(null);
 const [filters,setFilters]=useState({from:'',to:'',currency:'',project_id:'',owner_ids:''});
 const [projects,setProjects]=useState<Row[]>([]);
 const [members,setMembers]=useState<Row[]>([]);const [currencies,setCurrencies]=useState<string[]>([me.company.base_currency]);
 const params=useSearchParams(),router=useRouter(),tab=params.get('tab')==='finance'?'finance':'operational',setTab=(value:string)=>router.replace('/analytics?tab='+value,{scroll:false});
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(true);
 const [revision,setRevision]=useState(0);
 const [showExport,setShowExport]=useState(false);
 useEffect(()=>{api<{rows:Row[]}>('/api/data/projects?pageSize=100').then(result=>setProjects(result.rows)).catch(()=>{});api<{rows:Row[]}>('/api/data/members?pageSize=200').then(result=>setMembers(result.rows)).catch(()=>{});let active=true;async function loadCurrencies(){const codes=new Set([me.company.base_currency]);let loaded=0;for(let page=1;;page++){const result=await api<{rows:Row[];total:number}>('/api/data/currencies?pageSize=200&page='+page);for(const row of result.rows)if(row.code)codes.add(String(row.code));loaded+=result.rows.length;if(!result.rows.length||loaded>=result.total)break;}if(active)setCurrencies([...codes].filter(Boolean).sort());}void loadCurrencies().catch(()=>{});return()=>{active=false;};},[me.company.base_currency]);
 useEffect(()=>{let active=true;api<Record<string,unknown>>(`/api/analytics?${new URLSearchParams(filters)}`).then(result=>{if(active){setData(result);setError('');}}).catch(e=>{if(active)setError(errorMessage(e,t));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[filters,revision]);
 const section=(data?.[tab]||{}) as Record<string,unknown>;
 const reports=Object.entries(section).filter(([key])=>key!=='base_currency'&&!key.endsWith('_minor_digits'));
 const financialReports=reports.filter(([key])=>postedReports.has(key));
 const managementReports=reports.filter(([key])=>!postedReports.has(key));
 const metadata=(scope:string,currency?:string)=><dl className={styles.metadata}><div><dt>{t('analyticsDataScope')}</dt><dd>{t(scope)}</dd></div>{currency&&<div><dt>{t('currency')}</dt><dd>{t(currency)}</dd></div>}</dl>;
 const report=([key,value]:[string,unknown],managed=false)=><article key={key} className={`report-card ${styles.card}`}><header><h3>{t(key)}</h3><BarChart3 size={17} aria-hidden="true"/></header>{managed&&metadata(managementScopes[key]||'analyticsScopeByReport',key==='budgets'?'analyticsBudgetCurrency':'analyticsSeparateCurrencies')}<StructuredResult value={value}/></article>;
 return <section>{showExport&&<ExportDialog analytics filters={new URLSearchParams(filters).toString()} onClose={()=>setShowExport(false)}/>}<div className="page-heading"><div><div className="eyebrow">{t('management')}</div><h1>{t('analytics')}</h1></div><Button icon={Download} disabled={!data} onClick={()=>setShowExport(true)}>{t('export')}</Button></div>
 <div className="tabs report-tabs">{['operational','finance'].map(value=><button key={value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{t(value==='operational'?'analyticsOperationalReports':value)}</button>)}</div>
 <div className={styles.filterPanel}>
 <div className="report-filters"><Filter size={18}/><label>{t('from')}<input type="date" value={filters.from} onChange={e=>{setBusy(true);setFilters({...filters,from:e.target.value});}}/></label><label>{t('to')}<input type="date" value={filters.to} onChange={e=>{setBusy(true);setFilters({...filters,to:e.target.value});}}/></label><label>{t('currency')}<select value={filters.currency} onChange={e=>{setBusy(true);setFilters({...filters,currency:e.target.value});}}><option value="">{t('all')}</option>{currencies.map(c=><option key={c}>{c}</option>)}</select></label><label>{t('projects')}<select value={filters.project_id} onChange={e=>{setBusy(true);setFilters({...filters,project_id:e.target.value});}}><option value="">{t('all')}</option>{projects.map(p=><option key={p.id} value={p.id}>{String(p.name)}</option>)}</select></label><div className={styles.ownerFilter}><span>{t('owner')}</span><details><summary>{filters.owner_ids?members.filter(member=>filters.owner_ids.split(',').includes(member.id)).map(member=>String(member.name)).join('、'):t('all')}</summary><div className={styles.ownerOptions} role="group" aria-label={t('owner')}>{members.map(member=><label key={member.id}><input type="checkbox" value={member.id} checked={filters.owner_ids.split(',').includes(member.id)} onChange={event=>{const selected=filters.owner_ids.split(',').filter(Boolean);setBusy(true);setFilters({...filters,owner_ids:(event.target.checked?[...selected,member.id]:selected.filter(id=>id!==member.id)).join(',')});}}/>{String(member.name)}</label>)}<button type="button" className="text-button" onClick={()=>{setBusy(true);setFilters({...filters,owner_ids:''});}}>{t('clearFilters')}</button></div></details></div></div>
 <div className={styles.filterContext}>{metadata(tab==='operational'?'analyticsScopeOperational':'analyticsScopeByReport')}{tab==='finance'&&<dl className={styles.metadata}><div><dt>{t('baseCurrency')}</dt><dd>{String(section.base_currency||me.company.base_currency)}</dd></div></dl>}</div>
 </div>
 {error&&<ErrorBanner message={error} onRetry={()=>{setBusy(true);setRevision(v=>v+1);}}/>}
 {busy?<div className="page-loading"><Spinner/></div>:data?<>
  {tab==='operational'?<div className="report-grid">{reports.map(entry=>report(entry))}</div>:<>
   {financialReports.length>0&&<section className={styles.reportSection} aria-labelledby="posted-reports-heading"><header className={styles.sectionHeader}><div><h2 id="posted-reports-heading">{t('analyticsFinancialStatements')}</h2>{metadata('analyticsScopePosted','analyticsSeparateCurrencies')}</div><details className={styles.definition}><summary>{t('analyticsReportingBasis')}</summary><p>{t('analyticsPostedBasis')}</p></details></header><div className="report-grid">{financialReports.map(entry=>report(entry))}</div></section>}
   {managementReports.length>0&&<section className={styles.reportSection} aria-labelledby="management-reports-heading"><header className={styles.sectionHeader}><h2 id="management-reports-heading">{t('analyticsManagementReports')}</h2></header><div className="report-grid">{managementReports.map(entry=>report(entry,true))}</div></section>}
  </>}
  {!reports.length&&<Empty title={t('analyticsNoReports')} description=" "/>}
 </>:null}</section>;
}
