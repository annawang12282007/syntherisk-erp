import {describe,expect,it} from 'vitest';
import {calculateWorkforcePayroll} from '../src/domain/workforce-calculation';
import {defaultWorkforceSettings} from '../src/domain/workforce-policy';
import type {WorkforceAttendance,WorkforcePayRate,WorkforceWorker} from '../src/lib/workforce-types';

const worker:WorkforceWorker={user_id:'worker-1',name:'Sample worker',employee_number:null,active:true,start_date:'2026-01-01',end_date:null,version:1};
const rate:WorkforcePayRate={id:'rate-1',user_id:worker.user_id,user_name:worker.name,effective_from:'2026-01-01',hourly_rate_minor:'196',amount_minor:'196',basis:'hourly',currency:'TWD',version:1};
let sequence=0;
function attendance(date:string,hours:number,extra:Partial<WorkforceAttendance>={},startHour=9):WorkforceAttendance{
  const start=new Date(`${date}T${String(startHour).padStart(2,'0')}:00:00+08:00`).getTime();
  return {id:`attendance-${++sequence}`,user_id:worker.user_id,user_name:worker.name,shift_id:null,clock_in_at:new Date(start).toISOString(),clock_out_at:new Date(start+hours*3600000).toISOString(),break_started_at:null,breaks:[],unpaid_break_seconds:0,paid_seconds:hours*3600,day_type:'regular',status:'approved',version:1,can_edit:true,correction_reason:null,...extra};
}
function input(attendance:WorkforceAttendance[]=[],extra:Partial<Parameters<typeof calculateWorkforcePayroll>[0]>={}){
  return {settings:defaultWorkforceSettings,start_date:'2026-10-01',end_date_exclusive:'2026-11-01',workers:[worker],rates:[rate],attendance,...extra};
}
function result(rows:WorkforceAttendance[]=[],extra:Partial<Parameters<typeof calculateWorkforcePayroll>[0]>={}){return calculateWorkforcePayroll(input(rows,extra)).items[0];}

describe('Taiwan standard gross payroll calculation',()=>{
  it('aggregates separate punches by local date before applying exact daily tiers',()=>{
    const item=result([attendance('2026-10-05',4),attendance('2026-10-05',6.5,{},14)]);
    expect(item).toMatchObject({regular_seconds:28800,overtime_seconds:9000,regular_pay_minor:'1568',overtime_pay_minor:'686',gross_minor:'2254'});
    expect(item.rate_segments.map(segment=>[segment.multiplier,segment.regular_seconds,segment.overtime_seconds])).toEqual([['1',28800,0],['4/3',0,7200],['5/3',0,1800]]);
    expect(item.rate_segments[0].start_at).toBe('2026-10-04T16:00:00.000Z');
  });

  it('applies all rest-day tiers with one final upward rounding',()=>{
    const item=result([attendance('2026-10-03',12,{day_type:'rest'})]);
    expect(item).toMatchObject({regular_seconds:0,overtime_seconds:43200,regular_pay_minor:'0',overtime_pay_minor:'4574',gross_minor:'4574'});
    expect(item.rate_segments.map(segment=>segment.multiplier)).toEqual(['4/3','5/3','8/3']);
  });

  it('uses the full monthly amount and exact amount/240 instead of a rounded hourly basis',()=>{
    const item=result([attendance('2026-10-05',10)],{rates:[{...rate,basis:'monthly',amount_minor:'29500',hourly_rate_minor:'123'}]});
    expect(item).toMatchObject({regular_pay_minor:'29500',overtime_pay_minor:'328',gross_minor:'29828'});
    expect(item.rate_segments[1]).toMatchObject({basis:'monthly',amount_minor:'29500',hourly_divisor:240,multiplier:'4/3'});
  });

  it('pays a full-month salary with no recorded overtime without inventing attendance',()=>{
    const item=result([],{rates:[{...rate,basis:'monthly',amount_minor:'36000'}]});
    expect(item).toMatchObject({regular_seconds:0,overtime_seconds:0,regular_pay_minor:'36000',gross_minor:'36000',rate_segments:[]});
    expect(calculateWorkforcePayroll(input()).warnings).toContain('workforcePayrollGrossOnly');
  });

  it('splits actual cross-midnight work and a located break at the organization date and rate boundary',()=>{
    const row=attendance('2026-10-05',3,{breaks:[{start_at:'2026-10-05T23:30:00+08:00',end_at:'2026-10-06T00:30:00+08:00'}],unpaid_break_seconds:3600,paid_seconds:7200},23);
    const item=result([row],{rates:[{...rate,amount_minor:'200'}, {...rate,id:'rate-2',effective_from:'2026-10-06',amount_minor:'300'}]});
    expect(item).toMatchObject({regular_seconds:7200,regular_pay_minor:'550',gross_minor:'550'});
    expect(item.rate_segments.map(segment=>segment.regular_seconds)).toEqual([1800,5400]);
  });

  it('clips payroll to local dates while retaining surrounding days for weekly checks',()=>{
    const row=attendance('2026-10-05',3,{},23);
    const item=result([row],{start_date:'2026-10-06',end_date_exclusive:'2026-10-07'});
    expect(item).toMatchObject({regular_seconds:7200,regular_pay_minor:'392'});
  });

  it('measures actual elapsed time through daylight-saving changes',()=>{
    const row=attendance('2026-03-08',3,{clock_in_at:'2026-03-08T00:00:00-05:00',clock_out_at:'2026-03-08T04:00:00-04:00'});
    const item=result([row],{settings:{...defaultWorkforceSettings,time_zone:'America/New_York'},start_date:'2026-03-08',end_date_exclusive:'2026-03-09'});
    expect(item).toMatchObject({regular_seconds:10800,regular_pay_minor:'588'});
  });

  it('accepts same-date unlocated unpaid pauses without fabricating a break interval',()=>{
    const item=result([attendance('2026-10-05',9,{unpaid_break_seconds:3600,paid_seconds:28800})]);
    expect(item).toMatchObject({regular_seconds:28800,overtime_seconds:0,gross_minor:'1568'});
    expect(item.rate_segments[0]).toMatchObject({time_basis:'local_day_total',start_at:'2026-10-04T16:00:00.000Z',end_at:'2026-10-05T16:00:00.000Z'});
  });

  it('rounds accumulated fractional currency only once per worker and pay category',()=>{
    const item=result([attendance('2026-10-05',1/3600),attendance('2026-10-06',1/3600)]);
    expect(item).toMatchObject({regular_seconds:2,regular_pay_minor:'1',gross_minor:'1'});
  });

  it('uses the service policy whole-second normalization for legacy fractional instants',()=>{
    expect(result([attendance('2026-10-05',8,{clock_in_at:'2026-10-05T01:00:00.500Z'})]).regular_seconds).toBe(28800);
  });

  it('retains exact amounts beyond the safe floating-point integer range',()=>{
    expect(result([attendance('2026-10-05',1)],{rates:[{...rate,amount_minor:'9007199254740993'}]}).gross_minor).toBe('9007199254740993');
  });

  it('supports historical inactive employees whose inclusive termination date covers the month',()=>{
    const item=result([],{workers:[{...worker,active:false,end_date:'2026-10-31'}],rates:[{...rate,basis:'monthly',amount_minor:'36000'}]});
    expect(item.gross_minor).toBe('36000');
  });
});

describe('unsupported or inconsistent payroll evidence',()=>{
  it('rejects weekly normal work above 40 hours even when earlier days precede the pay period',()=>{
    const rows=[5,6,7,8,9,10].map(day=>attendance(`2026-10-${String(day).padStart(2,'0')}`,8));
    expect(()=>result(rows,{start_date:'2026-10-10',end_date_exclusive:'2026-10-11'})).toThrow('workforce_weekly_overtime_requires_review');
  });
  it('does not count correctly classified daily overtime or rest work as extra weekly normal time',()=>{
    const rows=[5,6,7,8,9].map(day=>attendance(`2026-10-${String(day).padStart(2,'0')}`,10));rows.push(attendance('2026-10-10',2,{day_type:'rest'}));
    expect(result(rows).regular_seconds).toBe(40*3600);
  });
  it('rejects a known monthly overtime total above the standard 46-hour limit',()=>{
    const rows=[3,10,17,24].map(day=>attendance(`2026-10-${String(day).padStart(2,'0')}`,12,{day_type:'rest'}));
    expect(()=>result(rows)).toThrow('workforce_monthly_overtime_requires_review');
  });
  it.each([
    ['daily_limit_exceeded',()=>[attendance('2026-10-05',13)]],
    ['daily_limit_exceeded',()=>[attendance('2026-10-05',8,{},0),attendance('2026-10-05',5,{},10)]],
    ['attendance_not_approved',()=>[attendance('2026-10-05',8,{status:'pending'})]],
    ['attendance_open',()=>[attendance('2026-10-05',8,{clock_out_at:null})]],
    ['holiday_pay_requires_review',()=>[attendance('2026-10-05',8,{day_type:'holiday'})]],
    ['conflicting_day_types',()=>[attendance('2026-10-05',2),attendance('2026-10-05',2,{day_type:'rest'},14)]],
    ['attendance_overlap',()=>[attendance('2026-10-05',4),attendance('2026-10-05',2,{},11)]],
    ['break_intervals_required',()=>[attendance('2026-10-05',3,{unpaid_break_seconds:3600,paid_seconds:7200},23)]],
    ['invalid_break_intervals',()=>[attendance('2026-10-05',8,{breaks:[{start_at:'2026-10-05T08:00:00+08:00',end_at:'2026-10-05T10:00:00+08:00'}]})]],
    ['attendance_total_mismatch',()=>[attendance('2026-10-05',8,{paid_seconds:1})]],
  ] as const)('rejects %s', (code,makeRows)=>{
    expect(()=>result(makeRows())).toThrow('workforce_'+code);
  });
  it('ignores voided evidence without turning it into pay',()=>{
    expect(result([attendance('2026-10-05',8,{status:'voided'})]).gross_minor).toBe('0');
  });
  it('requires an effective rate even when a worker has no attendance',()=>{
    expect(()=>result([],{rates:[]})).toThrow('workforce_pay_rate_missing');
    expect(()=>result([],{rates:[{...rate,effective_from:'2026-10-15'}]})).toThrow('workforce_pay_rate_missing');
  });
  it('rejects partial-month salary and mid-month rate/employment changes',()=>{
    const monthly={...rate,basis:'monthly' as const,amount_minor:'36000'};
    expect(()=>result([],{rates:[monthly],end_date_exclusive:'2026-10-16'})).toThrow('workforce_monthly_full_period_required');
    expect(()=>result([],{rates:[monthly],workers:[{...worker,start_date:'2026-10-02'}]})).toThrow('workforce_monthly_proration_requires_review');
    expect(()=>result([],{rates:[monthly],workers:[{...worker,end_date:'2026-10-30'}]})).toThrow('workforce_monthly_proration_requires_review');
    expect(()=>result([],{rates:[monthly,{...monthly,id:'rate-2',effective_from:'2026-10-15',amount_minor:'40000'}]})).toThrow('workforce_monthly_rate_change_requires_review');
  });
  it('does not apply a different currency or silently treat nonstandard policy as standard Taiwan payroll',()=>{
    expect(()=>result([],{rates:[{...rate,currency:'USD'}]})).toThrow('workforce_pay_currency_mismatch');
    expect(()=>result([],{settings:{...defaultWorkforceSettings,daily_regular_seconds:36000}})).toThrow('workforce_unsupported_policy');
  });
});
