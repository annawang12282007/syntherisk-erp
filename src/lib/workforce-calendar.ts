import {fromZonedTime} from 'date-fns-tz';
import type {WorkforceShift} from './workforce-types';

function civilDate(day:string):Date {
  const date=new Date(`${day}T00:00:00.000Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)throw new RangeError('Invalid calendar date');
  return date;
}

function dateKey(date:Date):string {
  return date.toISOString().slice(0,10);
}

export function calendarMonthRange(anchor:string,weekStart=1):{days:string[];from:string;to:string} {
  if(!Number.isInteger(weekStart)||weekStart<0||weekStart>6)throw new RangeError('Invalid calendar week start');
  const first=civilDate(anchor);
  first.setUTCDate(1);
  const afterMonth=new Date(first);
  afterMonth.setUTCMonth(afterMonth.getUTCMonth()+1);
  first.setUTCDate(first.getUTCDate()-(first.getUTCDay()-weekStart+7)%7);
  afterMonth.setUTCDate(afterMonth.getUTCDate()+(weekStart-afterMonth.getUTCDay()+7)%7);
  const days:string[]=[];
  const cursor=new Date(first);
  while(cursor<afterMonth){
    days.push(dateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  return {days,from:dateKey(first),to:dateKey(afterMonth)};
}

export function moveCalendarMonth(anchor:string,delta:number):string {
  if(!Number.isInteger(delta))throw new RangeError('Invalid calendar month offset');
  const date=civilDate(anchor);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth()+delta);
  return dateKey(date);
}

export function shiftsOnCalendarDay(shifts:WorkforceShift[],day:string,zone:string):WorkforceShift[] {
  const tomorrow=civilDate(day);
  tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  // Convert each local midnight separately: a work day can contain 23 or 25 hours.
  const from=fromZonedTime(`${day}T00:00:00`,zone).getTime();
  const to=fromZonedTime(`${dateKey(tomorrow)}T00:00:00`,zone).getTime();
  if(!Number.isFinite(from)||!Number.isFinite(to))throw new RangeError('Invalid calendar time zone');
  if(to<=from)return [];
  return shifts.filter(shift=>{
    const start=Date.parse(shift.start_at),end=Date.parse(shift.end_at);
    return Number.isFinite(start)&&Number.isFinite(end)&&end>start&&start<to&&end>from;
  }).sort((left,right)=>Date.parse(left.start_at)-Date.parse(right.start_at)||(left.id<right.id?-1:left.id>right.id?1:0));
}
