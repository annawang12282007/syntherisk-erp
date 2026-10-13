'use client';
import {useState} from 'react';
import {useApp} from './context';
import {ResourceView} from './resource-view';
import './work-target.css';

export default function DelegationWorkspace({initialFilters={}}:{initialFilters?:Record<string,string>}){
 const {t}=useApp();const [scope,setScope]=useState(()=>['assigned','sent','all'].includes(initialFilters.assignment_view)?initialFilters.assignment_view:'assigned');
 return <section className="delegation-workspace"><div className="delegation-scope-tabs" role="group" aria-label={t('delegationScopeFilter')}>{['all','assigned','sent'].map(value=><button key={value} aria-pressed={scope===value} onClick={()=>setScope(value)}>{t(value==='assigned'?'delegationAssigned':value==='sent'?'delegationSent':'all')}</button>)}</div><ResourceView key={scope+JSON.stringify(initialFilters)} resourceKey="delegations" initialFilters={{...initialFilters,assignment_view:scope}}/></section>;
}
