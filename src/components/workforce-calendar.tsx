'use client';

import {useId} from 'react';
import {formatInTimeZone} from 'date-fns-tz';
import {ChevronLeft,ChevronRight,Plus} from 'lucide-react';
import {calendarMonthRange,moveCalendarMonth,shiftsOnCalendarDay} from '../lib/workforce-calendar';
import type {WorkforceData,WorkforceShift} from '../lib/workforce-types';
import {useApp} from './context';
import {Button} from './primitives';
import styles from './workforce-calendar.module.css';

type Props={
 data:WorkforceData;
 month:string;
 onMonthChange:(day:string)=>void;
 onCreate:(day:string)=>void;
 onSelect:(shift:WorkforceShift)=>void;
 busy:boolean;
};

export function WorkforceCalendar({data,month,onMonthChange,onCreate,onSelect,busy}:Props){
 const {t,locale}=useApp();
 const titleId=useId();
 const hintId=useId();
 const zone=data.settings.time_zone;
 const today=formatInTimeZone(new Date(data.as_of),zone,'yyyy-MM-dd');
 const {days}=calendarMonthRange(month,data.settings.week_start);
 const date=(day:string)=>new Date(`${day}T12:00:00Z`);
 const fullDate=new Intl.DateTimeFormat(locale,{year:'numeric',month:'long',day:'numeric',weekday:'long',timeZone:'UTC'});
 const monthTitle=new Intl.DateTimeFormat(locale,{year:'numeric',month:'long',timeZone:'UTC'}).format(date(month));
 const weekday=new Intl.DateTimeFormat(locale,{weekday:'short',timeZone:'UTC'});
 const shiftDate=new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:zone});
 const weeks=Array.from({length:days.length/7},(_,index)=>days.slice(index*7,index*7+7));
 const dayShifts=new Map(days.map(day=>[day,shiftsOnCalendarDay(data.shifts,day,zone)]));
 const hasShifts=[...dayShifts.values()].some(shifts=>shifts.length>0);

 return <div className={styles.calendar}>
  <div className={styles.toolbar}>
   <div className={styles.monthHeading}>
    <h3 id={titleId} aria-live="polite">{monthTitle}</h3>
    <span className={styles.zone}>{zone}</span>
   </div>
   <div className={styles.navigation}>
    <Button type="button" disabled={busy} onClick={()=>onMonthChange(today)}>{t('workforceToday')}</Button>
    <Button type="button" disabled={busy} className={styles.arrow} aria-label={t('workforcePreviousMonth')} title={t('workforcePreviousMonth')} onClick={()=>onMonthChange(moveCalendarMonth(month,-1))}><ChevronLeft size={18} aria-hidden="true"/></Button>
    <Button type="button" disabled={busy} className={styles.arrow} aria-label={t('workforceNextMonth')} title={t('workforceNextMonth')} onClick={()=>onMonthChange(moveCalendarMonth(month,1))}><ChevronRight size={18} aria-hidden="true"/></Button>
   </div>
  </div>
  <p className={styles.hint} id={hintId}>{t('workforceCalendarHint')}{data.capabilities.manage_schedule&&<> {t('workforceCalendarManageHint')}</>}</p>
  <div className={styles.scroll} role="region" tabIndex={0} aria-labelledby={titleId} aria-describedby={hintId}>
   <table className={styles.grid} aria-label={`${monthTitle} ${t('workforceSchedule')}`}>
    <thead><tr>{days.slice(0,7).map(day=><th scope="col" key={day}>{weekday.format(date(day))}</th>)}</tr></thead>
    <tbody>{weeks.map(week=><tr key={week[0]}>{week.map(day=>{
     const label=fullDate.format(date(day));
     return <td key={day} className={styles.day} data-date={day} data-outside={day.slice(0,7)!==month.slice(0,7)} data-today={day===today} aria-label={label}>
      <div className={styles.dayHeading}>
       <time className={styles.dayNumber} dateTime={day} aria-label={label} aria-current={day===today?'date':undefined}>{Number(day.slice(8))}</time>
       {data.capabilities.manage_schedule&&<button type="button" className={styles.add} disabled={busy} aria-label={`${t('workforceAddShiftOn')} ${label}`} title={`${t('workforceAddShiftOn')} ${label}`} onClick={()=>onCreate(day)}><Plus size={15} aria-hidden="true"/></button>}
      </div>
      <div className={styles.events}>{dayShifts.get(day)!.map(shift=>{
       const firstDay=formatInTimeZone(new Date(shift.start_at),zone,'yyyy-MM-dd');
       const endDay=formatInTimeZone(new Date(shift.end_at),zone,'yyyy-MM-dd');
       const lastDay=formatInTimeZone(new Date(new Date(shift.end_at).getTime()-1),zone,'yyyy-MM-dd');
       const startsHere=firstDay===day;
       const time=`${startsHere?formatInTimeZone(new Date(shift.start_at),zone,'HH:mm'):'00:00'}–${endDay>day?'24:00':formatInTimeZone(new Date(shift.end_at),zone,'HH:mm')}`;
       const summary=`${shift.title} · ${shift.user_name} · ${shiftDate.format(new Date(shift.start_at))} – ${shiftDate.format(new Date(shift.end_at))} · ${t(shift.status)}`;
       return <button key={shift.id} type="button" className={styles.event} data-status={shift.status} disabled={busy} onClick={()=>onSelect(shift)} title={summary} aria-label={`${label} · ${summary}`}>
        <span className={styles.eventTime}>{time}</span>
        <strong className={styles.eventTitle}>{shift.title}</strong>
        <span className={styles.worker}>{shift.user_name}</span>
        <span className={styles.eventFooter}><span className={styles.status}>{t(shift.status)}</span>{!startsHere?<span>{t('workforceContinuedShift')}</span>:lastDay>day?<span>{t('workforceContinuesNextDay')}</span>:null}</span>
       </button>;
      })}</div>
     </td>;
    })}</tr>)}</tbody>
   </table>
  </div>
  {!hasShifts&&<p className={styles.empty}>{t('workforceNoShifts')}</p>}
 </div>;
}
