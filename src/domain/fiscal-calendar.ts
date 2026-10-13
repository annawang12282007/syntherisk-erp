import {DomainError} from '../lib/context';
export type FiscalCalendar={first_year_start:string;first_year_end:string;end_month:number;end_day:number|null};
export type DateRange={start_date:string;end_date:string};
const invalid=(code='fiscal_invalid_dates'):never=>{throw new DomainError(422,code);};
export function calendarDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'2199-12-31'||new Date(value+'T00:00:00Z').toJSON()?.slice(0,10)!==value)invalid();return value;}
export function monthEnd(year:number,month:number){return new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);}
export function nextDate(value:string){return new Date(Date.parse(value+'T00:00:00Z')+86400000).toISOString().slice(0,10);}
export function annualEnd(year:number,month:number,day:number|null){
 if(!Number.isInteger(year)||year<1900||year>2199||!Number.isInteger(month)||month<1||month>12)invalid();
 if(day===null)return monthEnd(year,month);
 // Fixed days must exist every year. February month-end is a separate choice.
 if(!Number.isInteger(day)||day<1||day>Number(monthEnd(2001,month).slice(8)))invalid();
 return calendarDate(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
}
export function validateCalendar(calendar:FiscalCalendar){
 calendarDate(calendar.first_year_start);calendarDate(calendar.first_year_end);
 if(calendar.first_year_end>'2198-12-31')invalid('fiscal_year_unavailable');
 const days=(Date.parse(calendar.first_year_end)-Date.parse(calendar.first_year_start))/86400000+1;
 if(days<1||days>371)invalid('fiscal_first_year_length');
 if(annualEnd(Number(calendar.first_year_end.slice(0,4)),calendar.end_month,calendar.end_day)!==calendar.first_year_end)invalid('fiscal_end_mismatch');
 return calendar;
}
export function fiscalRange(calendar:FiscalCalendar,year:number):DateRange{
 validateCalendar(calendar);const first=Number(calendar.first_year_end.slice(0,4));
 if(!Number.isInteger(year)||year<first||year>2199)invalid('fiscal_year_unavailable');
 return {start_date:year===first?calendar.first_year_start:nextDate(annualEnd(year-1,calendar.end_month,calendar.end_day)),end_date:annualEnd(year,calendar.end_month,calendar.end_day)};
}
export function containingFiscalYear(calendar:FiscalCalendar,date:string){
 calendarDate(date);if(date<calendar.first_year_start)invalid('fiscal_before_start');
 if(date<=calendar.first_year_end)return fiscalRange(calendar,Number(calendar.first_year_end.slice(0,4)));
 const year=Number(date.slice(0,4));return fiscalRange(calendar,date<=annualEnd(year,calendar.end_month,calendar.end_day)?year:year+1);
}
export function monthlyPeriods(range:DateRange){
 const periods:DateRange[]=[];let start=range.start_date;
 while(start<=range.end_date){const end=monthEnd(Number(start.slice(0,4)),Number(start.slice(5,7))),end_date=end<range.end_date?end:range.end_date;periods.push({start_date:start,end_date});start=nextDate(end_date);if(periods.length>14)invalid();}
 return periods;
}
