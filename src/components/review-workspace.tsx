'use client';
import {useMemo,useState} from 'react';
import {useApp} from './context';
import {ResourceView} from './resource-view';
import type {Resource} from './types';
import './review-workspace.css';

const requestLabels=['審核請求','审核请求','Review requests'] as const;
const resultLabels=['成果審核','成果审核','Deliverable reviews'] as const;
export function RequestLaneView({lane,initialFilters={}}:{lane:'assistance'|'review';initialFilters?:Record<string,string>}){
 const {resources,t}=useApp();const source=resources.work_requests;
 const creation=useMemo<Resource|undefined>(()=>source?{...source,label:lane==='review'?requestLabels:source.label,fields:source.fields.map(field=>field.key==='kind'?{...field,options:lane==='review'?['review','decision','payment']:['help','information'],required:lane==='review'||field.required}:field)}:undefined,[source,lane]);
 if(!creation)return null;
 const dashboard=initialFilters.dashboard==='requests';const filters={...initialFilters};delete filters.request_lane;if(!dashboard)filters.request_lane=lane;
 return <ResourceView key={lane+JSON.stringify(initialFilters)} resourceKey="work_requests" initialFilters={filters} presentation={{label:dashboard?[t('pendingRequests'),t('pendingRequests'),t('pendingRequests')]:creation.label,create:creation,initial:lane==='review'?{kind:'review'}:undefined}}/>;
}
export default function ReviewWorkspace({initialFilters={}}:{initialFilters?:Record<string,string>}){
 const {locale}=useApp();const [tab,setTab]=useState<'requests'|'results'>(()=>initialFilters.record||initialFilters.dashboard==='reviews'?'results':'requests');const index=locale==='en'?2:locale==='zh-CN'?1:0;
 const requestFilters={...initialFilters};delete requestFilters.record;if(initialFilters.request)requestFilters.record=initialFilters.request;delete requestFilters.request;
 return <section className="review-workspace"><div className="review-workspace-nav" role="group" aria-label={['成果與審核','成果与审核','Results & reviews'][index]}><button aria-pressed={tab==='requests'} onClick={()=>setTab('requests')}>{requestLabels[index]}</button><button aria-pressed={tab==='results'} onClick={()=>setTab('results')}>{resultLabels[index]}</button></div>{tab==='requests'?<RequestLaneView lane="review" initialFilters={requestFilters}/>:<ResourceView resourceKey="reviews" initialFilters={initialFilters} presentation={{label:resultLabels}}/>}</section>;
}
