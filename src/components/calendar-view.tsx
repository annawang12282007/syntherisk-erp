'use client';
import {useEffect,useMemo,useState} from 'react';
import {addDays,addMonths,addWeeks,format,startOfMonth,startOfWeek,endOfMonth,endOfWeek,isSameMonth,isSameDay} from 'date-fns';
import {formatInTimeZone} from 'date-fns-tz';
import {ChevronLeft,ChevronRight,Plus,Globe2,Download} from 'lucide-react';
import {useApp} from './context';
import {api,errorMessage} from './api';
import {Button,Empty,ErrorBanner,Spinner} from './primitives';
import {RecordDetail,RecordForm} from './resource-view';
import ExportDialog from './export-dialog';
import CalendarConnection from './calendar-connection';
import type {Row} from './types';
type CalendarEntry={row:Row;resource:string;day:string;time:string;source:'events'|'google'|'interviews'|'tasks'|'finance';occurrence:string};
function displayDate(value:unknown,zone:string){try{return formatInTimeZone(new Date(String(value)),zone,'yyyy-MM-dd');}catch{return '';}}
function displayTime(value:unknown,zone:string){try{return formatInTimeZone(new Date(String(value)),zone,'HH:mm');}catch{return '';}}
async function allRows(resource:string,filters:Record<string,string>){const rows:Row[]=[];for(let page=1;;page++){const params=new URLSearchParams({...filters,pageSize:'200',page:String(page)});const result=await api<{rows:Row[];total:number}>(`/api/data/${resource}?${params}`);rows.push(...result.rows);if(!result.rows.length||rows.length>=result.total)return rows;}}
export default function CalendarView(){
 const {t,locale,prefs,savePrefs,resources,refreshKey,me}=useApp();
 const [showExport,setShowExport]=useState(false);const [anchor,setAnchor]=useState(new Date());const [mode,setMode]=useState('month');const [source,setSource]=useState('all');const [scope,setScope]=useState('team');
 const [events,setEvents]=useState<Row[]>([]);const [tasks,setTasks]=useState<Row[]>([]);const [interviews,setInterviews]=useState<Row[]>([]);const [deadlines,setDeadlines]=useState<{row:Row;resource:string}[]>([]);
 const [busy,setBusy]=useState(true);const [error,setError]=useState('');const [edit,setEdit]=useState<Record<string,unknown>|null>(null);const [detail,setDetail]=useState<{row:Row;resource:string}|null>(null);const [revision,setRevision]=useState(0);
 const timezone=prefs.timezone||'America/Los_Angeles';const rangeStart=mode==='month'?startOfWeek(startOfMonth(anchor)):mode==='week'?startOfWeek(anchor):anchor;
 const rangeEnd=mode==='month'?endOfWeek(endOfMonth(anchor)):mode==='week'?endOfWeek(anchor):mode==='agenda'?addMonths(anchor,1):anchor;
 const start=format(rangeStart,'yyyy-MM-dd');const end=format(rangeEnd,'yyyy-MM-dd');const exclusiveEnd=format(addDays(rangeEnd,1),'yyyy-MM-dd');
 useEffect(()=>{
  let active=true;const owner=scope==='mine'?me.user.id:'';const dueFilters={due_date_from:start,due_date_to:end,owner_id:owner};
  const eventParams=new URLSearchParams({start_date:start,end_date:exclusiveEnd,pageSize:'100',expand:'true',owner_id:owner});
  const financeSources=['customer_invoices','vendor_bills','subscriptions'];
  Promise.all([api<{rows:Row[]}>(`/api/data/events?${eventParams}`),allRows('tasks',dueFilters),allRows('interviews',{calendar_start:start,calendar_end:exclusiveEnd,owner_id:owner}),Promise.all(financeSources.map(async resource=>({resource,rows:await allRows(resource,dueFilters)})))]).then(([eventRows,taskRows,interviewRows,financeRows])=>{
   if(active){setEvents(eventRows.rows);setTasks(taskRows);setInterviews(interviewRows);setDeadlines(financeRows.flatMap(({resource,rows})=>rows.filter(row=>row.due_date&&!['cancelled','paid','posted','expired'].includes(String(row.status))).map(row=>({row,resource}))));setError('');}
  }).catch(e=>{if(active)setError(errorMessage(e,t));}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[start,end,exclusiveEnd,scope,revision,refreshKey,me.user.id]);
 const entries=useMemo(()=>{
  const result:CalendarEntry[]=[];const interviewsByEvent=new Map(interviews.filter(row=>row.event_id).map(row=>[String(row.event_id),row]));
  if(['all','events','google','interviews'].includes(source))for(const row of events.filter(event=>event.status!=='cancelled')){
   const interview=interviewsByEvent.get(row.id),google=row.source_resource==='google_calendar';if(source==='google'&&!google)continue;if(source==='events'&&google)continue;if(source==='interviews'&&!interview)continue;if(source==='events'&&interview)continue;
   const first=row.all_day?String(row.start_date).slice(0,10):displayDate(row.start_at,timezone);
   const last=row.all_day?format(addDays(new Date(String(row.end_date).slice(0,10)+'T12:00:00'),-1),'yyyy-MM-dd'):displayDate(new Date(new Date(String(row.end_at)).getTime()-1).toISOString(),timezone);
   const from=first<start?start:first;const to=last>end?end:last;
   for(let day=from;day<=to;day=format(addDays(new Date(day+'T12:00:00'),1),'yyyy-MM-dd'))result.push({row:interview||row,resource:interview?'interviews':google?'google':'events',source:interview?'interviews':google?'google':'events',occurrence:String(row.occurrence_id||row.id),day,time:row.all_day?'':day===first?displayTime(row.start_at,timezone):'↳'});
  }
  if(['all','tasks'].includes(source))for(const row of tasks.filter(task=>task.due_date&&!['done','cancelled'].includes(String(task.status))))result.push({row,resource:'tasks',source:'tasks',occurrence:row.id,day:String(row.due_date).slice(0,10),time:''});
  if(['all','finance'].includes(source))for(const item of deadlines)result.push({...item,source:'finance',occurrence:item.row.id,day:String(item.row.due_date).slice(0,10),time:''});
  return result.filter(entry=>entry.day>=start&&entry.day<=end).sort((a,b)=>(a.day+a.time).localeCompare(b.day+b.time));
 },[events,tasks,interviews,deadlines,source,timezone,start,end]);
 const changeAnchor=(value:Date)=>{setBusy(true);setAnchor(value);setRevision(v=>v+1);};
 const move=(by:number)=>changeAnchor(mode==='month'?addMonths(anchor,by):mode==='week'?addWeeks(anchor,by):addDays(anchor,by));
 const days=mode==='month'?Array.from({length:Math.round((rangeEnd.getTime()-rangeStart.getTime())/86400000)+1},(_,i)=>addDays(rangeStart,i)):mode==='week'?Array.from({length:7},(_,i)=>addDays(rangeStart,i)):[anchor];
 const entry=(item:CalendarEntry)=><button key={`${item.resource}-${item.occurrence}-${item.day}`} className={`calendar-event ${item.source==='tasks'?'task-event':item.source==='finance'?'finance-event':item.source==='interviews'?'interview-event':''}`} onClick={()=>setDetail({row:item.row,resource:item.resource})}><span>{item.time||t(item.source==='tasks'?'taskDeadline':item.source==='finance'?'financeDeadline':item.source==='interviews'?'interviews':'allDay')}</span><strong>{String(item.row.title||item.row.name)}</strong>{item.source==='google'&&<small>Google</small>}</button>;
 return <section><div className="page-heading"><div><div className="eyebrow">{t('calendar')}</div><h1>{new Intl.DateTimeFormat(locale,{year:'numeric',month:'long'}).format(anchor)}</h1><p>{t('calendarHint')}</p></div><div className="heading-actions"><Button icon={Download} onClick={()=>setShowExport(true)}>{t('exportEvents')}</Button><Button variant="primary" icon={Plus} onClick={()=>setEdit({})}>{t('add')} {t('event')}</Button></div></div>
 <CalendarConnection onSynced={()=>{setBusy(true);setRevision(v=>v+1);}}/>
 <div className="calendar-panel"><div className="calendar-toolbar"><div className="calendar-date-controls"><Button onClick={()=>changeAnchor(new Date())}>{t('today')}</Button><button className="icon-button" aria-label={t('previous')} onClick={()=>move(-1)}><ChevronLeft size={19}/></button><button className="icon-button" aria-label={t('next')} onClick={()=>move(1)}><ChevronRight size={19}/></button></div><div className="segmented text-segments">{['month','week','day','agenda'].map(value=><button key={value} aria-pressed={mode===value} onClick={()=>{if(value!==mode){setBusy(true);setMode(value);}}}>{t(value)}</button>)}</div><select aria-label={t('source')} value={source} onChange={e=>setSource(e.target.value)}><option value="all">{t('all')}</option><option value="events">{t('manualEvents')}</option><option value="google">Google Calendar</option><option value="interviews">{t('interviews')}</option><option value="tasks">{t('taskDeadline')}</option><option value="finance">{t('financeDeadline')}</option></select><select aria-label={t('filters')} value={scope} onChange={e=>{setBusy(true);setScope(e.target.value);}}><option value="team">{t('team')}</option><option value="mine">{t('mine')}</option></select></div>
 <div className="timezone-row"><Globe2 size={14}/><label>{t('timezone')} <select aria-label={t('timezone')} value={timezone} onChange={e=>void savePrefs({...prefs,timezone:e.target.value})}>{['America/Los_Angeles','America/Toronto','America/Montreal','Asia/Taipei','Asia/Shanghai','Europe/London','UTC'].map(zone=><option key={zone}>{zone}</option>)}</select></label></div>
 {error&&<ErrorBanner message={error} onRetry={()=>{setBusy(true);setRevision(v=>v+1);}}/>}
 {busy?<div className="page-loading"><Spinner/></div>:mode==='agenda'?<div className="agenda-list">{entries.length?entries.map(item=><div key={`${item.resource}-${item.occurrence}-${item.day}`}><time>{new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',weekday:'short'}).format(new Date(item.day+'T12:00:00'))}</time>{entry(item)}</div>):<Empty title={t('noData')} description=" "/>}</div>:mode==='month'?<><div className="calendar-weekdays">{t('weekdays').split(',').map(day=><span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map(day=>{const key=format(day,'yyyy-MM-dd');return <div key={key} className={`calendar-day ${!isSameMonth(day,anchor)?'outside-month':''} ${isSameDay(day,new Date())?'is-today':''}`}><button className="day-number" aria-label={`${t('add')} ${key}`} onClick={()=>setEdit({start_date:key,end_date:format(addDays(day,1),'yyyy-MM-dd'),all_day:true})}>{day.getDate()}</button>{entries.filter(e=>e.day===key).map(entry)}</div>;})}</div></>:<div className={`time-grid ${mode==='day'?'single-day':''}`}>{days.map(day=>{const key=format(day,'yyyy-MM-dd');return <section key={key}><header>{new Intl.DateTimeFormat(locale,{weekday:'short',day:'numeric',month:'short'}).format(day)}<button className="icon-button" aria-label={t('add')} onClick={()=>setEdit({start_date:key,end_date:format(addDays(day,1),'yyyy-MM-dd'),all_day:true})}><Plus size={15}/></button></header><div className="time-grid-body">{entries.filter(e=>e.day===key).map(entry)}{!entries.some(e=>e.day===key)&&<span className="muted small">—</span>}</div></section>;})}</div>}
 </div>{showExport&&resources.events&&<ExportDialog resource={resources.events} currentColumns={['title','start_at','end_at','all_day','start_date','end_date','location','owner_id']} filters={new URLSearchParams({start_date:start,end_date:exclusiveEnd,owner_id:scope==='mine'?me.user.id:''}).toString()} onClose={()=>setShowExport(false)}/>} {edit&&resources.events&&<RecordForm resource={resources.events} initial={edit} onClose={()=>setEdit(null)} onSaved={()=>{setEdit(null);setRevision(v=>v+1);}}/>}{detail&&resources[detail.resource]&&<RecordDetail resource={resources[detail.resource]} row={detail.row} onClose={()=>setDetail(null)} onChanged={row=>{setDetail({...detail,row});setRevision(v=>v+1);}}/>}</section>;
}
