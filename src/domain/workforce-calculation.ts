import type {WorkforceAttendance,WorkforcePayRate,WorkforcePayrollItem,WorkforceSettings,WorkforceWorker,WorkforceDayType} from '../lib/workforce-types';
import {addDays,dateAt,instant,localDate,midnight,validateSettings,workforceError} from './workforce-policy';

type Worker=Pick<WorkforceWorker,'user_id'|'name'|'active'|'start_date'|'end_date'>;
type Input={settings:WorkforceSettings;start_date:string;end_date_exclusive:string;workers:Worker[];rates:WorkforcePayRate[];attendance:WorkforceAttendance[]};
type Fraction={n:bigint;d:bigint};
type Span={start:number;end:number;unlocated_break?:number};
type Day={user_id:string;date:string;kind:WorkforceDayType;spans:Span[];seconds:number};
type PayrollItem=Omit<WorkforcePayrollItem,'id'>;
const maxMoney=9223372036854775807n;
const gcd=(a:bigint,b:bigint):bigint=>b?gcd(b,a%b):a;
function fraction(n:bigint,d=1n):Fraction{const divisor=gcd(n,d);return {n:n/divisor,d:d/divisor};}
function add(a:Fraction,b:Fraction):Fraction{return fraction(a.n*b.d+b.n*a.d,a.d*b.d);}
function ceiling(value:Fraction):bigint{return (value.n+value.d-1n)/value.d;}
function money(value:string):bigint{
  if(!/^[1-9]\d{0,18}$/.test(value))workforceError('invalid_pay_rate');
  const result=BigInt(value);if(result>maxMoney)workforceError('invalid_pay_rate');return result;
}
function seconds(value:string):number{
  const number=Date.parse(instant(value))/1000;
  if(!Number.isSafeInteger(number))workforceError('whole_second_required');
  return number;
}
const iso=(value:number)=>new Date(value*1000).toISOString();
function weekOf(date:string,weekStart:number){return addDays(date,-((new Date(date+'T00:00:00Z').getUTCDay()-weekStart+7)%7));}
function fullCalendarMonth(start:string,end:string){return start.endsWith('-01')&&addDays(end,-1).slice(0,7)===start.slice(0,7)&&end.endsWith('-01');}

function paidSpans(row:WorkforceAttendance,zone:string):Span[]{
  if(row.status!=='approved')workforceError('attendance_not_approved');
  if(!row.clock_out_at||row.break_started_at)workforceError('attendance_open');
  const start=seconds(row.clock_in_at),end=seconds(row.clock_out_at);
  if(end<=start)workforceError('invalid_attendance_interval');
  const breaks=row.breaks.map(value=>({start:seconds(value.start_at),end:seconds(value.end_at)})).sort((a,b)=>a.start-b.start);
  let cursor=start,unpaid=0;const spans:Span[]=[];
  for(const pause of breaks){
    if(pause.start<cursor||pause.end<=pause.start||pause.end>end)workforceError('invalid_break_intervals');
    if(pause.start>cursor)spans.push({start:cursor,end:pause.start});
    unpaid+=pause.end-pause.start;cursor=pause.end;
  }
  if(cursor<end)spans.push({start:cursor,end});
  if(!Number.isSafeInteger(row.unpaid_break_seconds)||row.unpaid_break_seconds<0||row.unpaid_break_seconds>end-start)workforceError('invalid_break_intervals');
  if(unpaid!==row.unpaid_break_seconds){
    if(breaks.length||dateAt(iso(start),zone)!==dateAt(iso(end-1),zone))workforceError('break_intervals_required');
    // The pause's position is unknown. Keep the real interval and deduct only
    // from the one day's total; never fabricate a timed break or split it across dates.
    spans.splice(0,spans.length,{start,end,unlocated_break:row.unpaid_break_seconds});
  }
  const paid=end-start-row.unpaid_break_seconds;
  if(row.paid_seconds!==null&&row.paid_seconds!==paid)workforceError('attendance_total_mismatch');
  if(paid>43200)workforceError('daily_limit_exceeded');
  return spans;
}

/** Gross wages only: approved actual attendance; exact fractions until final upward rounding.
 * Taiwan standard daily tiers: https://calcr2.mol.gov.tw/Index
 * Monthly hourly basis: https://calcr2.mol.gov.tw/Monthly
 * Callers must supply complete attendance for all weeks intersecting this local-date period.
 */
export function calculateWorkforcePayroll(input:Input):{items:PayrollItem[];warnings:string[]}{
  const settings=validateSettings(input.settings),start=localDate(input.start_date),end=localDate(input.end_date_exclusive);
  if(end<=start||Date.parse(end)-Date.parse(start)>366*86400000)workforceError('invalid_payroll_period');
  const zone=settings.time_zone,contextStart=weekOf(start,settings.week_start),contextEnd=addDays(weekOf(addDays(end,-1),settings.week_start),7);
  const first=seconds(midnight(contextStart,zone)),last=seconds(midnight(contextEnd,zone));
  const workers=new Map<string,Worker>();
  for(const worker of input.workers){
    if(workers.has(worker.user_id))workforceError('duplicate_worker');
    localDate(worker.start_date);if(worker.end_date){localDate(worker.end_date);if(worker.end_date<worker.start_date)workforceError('invalid_employment_dates');}
    workers.set(worker.user_id,worker);
  }
  const days=new Map<string,Day>(),intervals=new Map<string,Span[]>(),ids=new Set<string>();
  for(const row of input.attendance){
    if(row.status==='voided')continue;
    const rowStart=seconds(row.clock_in_at),rowEnd=row.clock_out_at?seconds(row.clock_out_at):Infinity;
    if(rowStart>=last||rowEnd<=first)continue;
    if(ids.has(row.id))workforceError('duplicate_attendance');ids.add(row.id);
    const worker=workers.get(row.user_id);if(!worker)workforceError('worker_not_enrolled');
    const spans=paidSpans(row,zone);
    if(!['regular','rest','holiday'].includes(row.day_type))workforceError('unsupported_day_type');
    const prior=intervals.get(row.user_id)??[];
    if(prior.some(value=>value.start<rowEnd&&value.end>rowStart))workforceError('attendance_overlap');
    prior.push({start:rowStart,end:rowEnd});intervals.set(row.user_id,prior);
    for(const span of spans){
      let cursor=Math.max(span.start,first);const stop=Math.min(span.end,last);
      while(cursor<stop){
        const date=dateAt(iso(cursor),zone),boundary=seconds(midnight(addDays(date,1),zone)),until=Math.min(stop,boundary);
        if(until<=cursor)workforceError('invalid_timezone');
        if(date<worker.start_date||worker.end_date&&date>worker.end_date)workforceError('attendance_outside_employment');
        const key=worker.user_id+':'+date,day=days.get(key)??{user_id:worker.user_id,date,kind:row.day_type,spans:[],seconds:0};
        if(day.kind!==row.day_type)workforceError('conflicting_day_types');
        day.spans.push({start:cursor,end:until});day.seconds+=until-cursor-(span.unlocated_break??0);days.set(key,day);cursor=until;
      }
    }
  }
  const weekly=new Map<string,number>(),monthlyOvertime=new Map<string,number>();
  for(const day of days.values()){
    day.spans.sort((a,b)=>a.start-b.start);
    if(day.seconds>43200)workforceError('daily_limit_exceeded');
    if(day.kind==='holiday'&&day.date>=start&&day.date<end)workforceError('holiday_pay_requires_review');
    if(day.kind==='regular'){
      const key=day.user_id+':'+weekOf(day.date,settings.week_start),normal=(weekly.get(key)??0)+Math.min(day.seconds,settings.daily_regular_seconds);
      if(normal>144000)workforceError('weekly_overtime_requires_review');weekly.set(key,normal);
    }
    if(day.kind!=='holiday'){
      const key=day.user_id+':'+day.date.slice(0,7),overtime=(monthlyOvertime.get(key)??0)+(day.kind==='rest'?day.seconds:Math.max(0,day.seconds-28800));
      if(overtime>46*3600)workforceError('monthly_overtime_requires_review');monthlyOvertime.set(key,overtime);
    }
  }
  const items:PayrollItem[]=[],warnings=new Set(['workforcePayrollGrossOnly']);
  if(!fullCalendarMonth(start,end))warnings.add('workforceMonthlyHoursRequireReview');
  for(const worker of workers.values()){
    if(worker.start_date>=end||worker.end_date&&worker.end_date<start)continue;
    if(!worker.active&&!worker.end_date)workforceError('employment_dates_required');
    const rates=input.rates.filter(rate=>rate.user_id===worker.user_id).map(rate=>({...rate,effective_from:localDate(rate.effective_from)})).sort((a,b)=>a.effective_from.localeCompare(b.effective_from));
    for(let i=0;i<rates.length;i++){
      money(rates[i].amount_minor);if(rates[i].currency!==settings.currency)workforceError('pay_currency_mismatch');
      if(!['hourly','monthly'].includes(rates[i].basis))workforceError('invalid_pay_basis');
      if(i&&rates[i-1].effective_from===rates[i].effective_from)workforceError('duplicate_pay_rate');
    }
    const rateAt=(date:string)=>rates.findLast(rate=>rate.effective_from<=date);
    const firstRate=rateAt(worker.start_date>start?worker.start_date:start);
    if(!firstRate)workforceError('pay_rate_missing');
    const applicable=[firstRate,...rates.filter(rate=>rate.effective_from>start&&rate.effective_from<end)];
    const monthly=applicable.some(rate=>rate.basis==='monthly');
    if(monthly){
      if(!fullCalendarMonth(start,end))workforceError('monthly_full_period_required');
      if(worker.start_date>start||worker.end_date&&worker.end_date<addDays(end,-1))workforceError('monthly_proration_requires_review');
      if(firstRate.basis!=='monthly'||applicable.some(rate=>rate.id!==firstRate.id))workforceError('monthly_rate_change_requires_review');
    }
    const item:PayrollItem={user_id:worker.user_id,user_name:worker.name,regular_seconds:0,overtime_seconds:0,regular_pay_minor:'0',overtime_pay_minor:'0',gross_minor:'0',rate_segments:[]};
    let regular=fraction(monthly?money(firstRate.amount_minor):0n),overtime=fraction(0n);
    const workerDays=[...days.values()].filter(day=>day.user_id===worker.user_id&&day.date>=start&&day.date<end).sort((a,b)=>a.date.localeCompare(b.date));
    for(const day of workerDays){
      const rate=rateAt(day.date);if(!rate)workforceError('pay_rate_missing');
      const amount=money(rate.amount_minor),divisor=rate.basis==='monthly'?240:1;
      let consumed=0;
        while(consumed<day.seconds){
          const isRegular=day.kind==='regular'&&consumed<28800;
          const tiers=day.kind==='regular'?settings.regular_overtime_tiers:settings.rest_day_tiers;
          const offset=day.kind==='regular'?28800:0;
          const tier=isRegular?{up_to_seconds:28800,multiplier:'1'}:tiers.find(value=>consumed-offset<value.up_to_seconds);
          if(!tier)workforceError('daily_limit_exceeded');
          const available=(isRegular?28800:offset+tier.up_to_seconds)-consumed,count=Math.min(day.seconds-consumed,available);
          const [numerator,denominator='1']=tier.multiplier.split('/');
          const pay=fraction(amount*BigInt(count)*BigInt(numerator),BigInt(divisor)*3600n*BigInt(denominator));
          if(isRegular){item.regular_seconds+=count;if(!monthly)regular=add(regular,pay);}else{item.overtime_seconds+=count;overtime=add(overtime,pay);}
          const segment={hourly_rate_minor:ceiling(fraction(amount,BigInt(divisor))).toString(),basis:rate.basis,amount_minor:rate.amount_minor,hourly_divisor:divisor,time_basis:'local_day_total' as const,start_at:midnight(day.date,zone),end_at:midnight(addDays(day.date,1),zone),regular_seconds:isRegular?count:0,overtime_seconds:isRegular?0:count,day_type:day.kind,multiplier:tier.multiplier};
          item.rate_segments.push(segment);consumed+=count;
        }
    }
    const regularPay=ceiling(regular),overtimePay=ceiling(overtime),gross=regularPay+overtimePay;
    if(gross>maxMoney)workforceError('payroll_amount_overflow');
    item.regular_pay_minor=regularPay.toString();item.overtime_pay_minor=overtimePay.toString();item.gross_minor=gross.toString();
    items.push(item);
  }
  return {items:items.sort((a,b)=>a.user_id.localeCompare(b.user_id)),warnings:[...warnings]};
}
