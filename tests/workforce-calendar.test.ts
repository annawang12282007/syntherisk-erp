import {describe,expect,it} from 'vitest';
import {calendarMonthRange,moveCalendarMonth,shiftsOnCalendarDay} from '../src/lib/workforce-calendar';
import type {WorkforceShift} from '../src/lib/workforce-types';

const shift=(id:string,start_at:string,end_at:string):WorkforceShift=>({id,user_id:'worker-1',user_name:'Employee',title:id,notes:'',start_at,end_at,unpaid_break_minutes:0,day_type:'regular',status:'published',version:1});
const ids=(rows:WorkforceShift[])=>rows.map(row=>row.id);

describe('workforce calendar month ranges',()=>{
  it('pads the full month to Monday-based weeks and uses an exclusive end',()=>{
    const range=calendarMonthRange('2026-10-13');
    expect(range.from).toBe('2026-09-28');
    expect(range.to).toBe('2026-11-02');
    expect(range.days).toHaveLength(35);
    expect(range.days[0]).toBe(range.from);
    expect(range.days.at(-1)).toBe('2026-11-01');
    expect(range.days).not.toContain(range.to);
    expect(new Set(range.days).size).toBe(range.days.length);
  });
  it('uses four weeks when February fits exactly and six when necessary',()=>{
    expect(calendarMonthRange('2021-02-28')).toMatchObject({from:'2021-02-01',to:'2021-03-01'});
    expect(calendarMonthRange('2021-02-28').days).toHaveLength(28);
    expect(calendarMonthRange('2021-05-15')).toMatchObject({from:'2021-04-26',to:'2021-06-07'});
    expect(calendarMonthRange('2021-05-15').days).toHaveLength(42);
  });
  it('honors Sunday or Saturday week starts',()=>{
    expect(calendarMonthRange('2026-10-01',0)).toMatchObject({from:'2026-09-27',to:'2026-11-01'});
    expect(calendarMonthRange('2026-10-31',6)).toMatchObject({from:'2026-09-26',to:'2026-11-07'});
  });
  it('includes leap day and pads across year boundaries',()=>{
    const leap=calendarMonthRange('2024-02-29');
    expect(leap.days).toContain('2024-02-29');
    expect(leap).toMatchObject({from:'2024-01-29',to:'2024-03-04'});
    expect(calendarMonthRange('2026-12-31')).toMatchObject({from:'2026-11-30',to:'2027-01-04'});
  });
  it('navigates from month-end without overflowing the target month',()=>{
    expect(moveCalendarMonth('2026-01-31',1)).toBe('2026-02-01');
    expect(moveCalendarMonth('2024-02-29',12)).toBe('2025-02-01');
    expect(moveCalendarMonth('2026-01-31',-1)).toBe('2025-12-01');
    expect(moveCalendarMonth('2026-12-31',1)).toBe('2027-01-01');
    expect(moveCalendarMonth('2026-10-13',0)).toBe('2026-10-01');
  });
  it('rejects malformed civil dates and invalid navigation options',()=>{
    for(const anchor of ['2026-02-30','2026-2-01','not-a-date'])expect(()=>calendarMonthRange(anchor)).toThrow(RangeError);
    for(const weekStart of [-1,7,1.5])expect(()=>calendarMonthRange('2026-10-13',weekStart)).toThrow(RangeError);
    expect(()=>moveCalendarMonth('2026-10-13',0.5)).toThrow(RangeError);
  });
});

describe('workforce calendar local-day overlap',()=>{
  it('shows an overnight shift on every occupied local day, independently of UTC dates',()=>{
    const rows=[shift('overnight','2026-10-12T14:00:00Z','2026-10-12T18:00:00Z')];
    expect(ids(shiftsOnCalendarDay(rows,'2026-10-12','Asia/Taipei'))).toEqual(['overnight']);
    expect(ids(shiftsOnCalendarDay(rows,'2026-10-13','Asia/Taipei'))).toEqual(['overnight']);
    expect(shiftsOnCalendarDay(rows,'2026-10-14','Asia/Taipei')).toEqual([]);
  });
  it('excludes a shift from the day at its exclusive midnight end',()=>{
    const rows=[shift('ending','2026-10-12T14:00:00Z','2026-10-12T16:00:00Z'),shift('starting','2026-10-12T16:00:00Z','2026-10-12T18:00:00Z')];
    expect(ids(shiftsOnCalendarDay(rows,'2026-10-12','Asia/Taipei'))).toEqual(['ending']);
    expect(ids(shiftsOnCalendarDay(rows,'2026-10-13','Asia/Taipei'))).toEqual(['starting']);
  });
  it('keeps a multi-day shift in intervening calendar days',()=>{
    const rows=[shift('long','2026-10-11T18:00:00Z','2026-10-14T02:00:00Z')];
    expect(ids(shiftsOnCalendarDay(rows,'2026-10-13','Asia/Taipei'))).toEqual(['long']);
  });
  it('respects the 23-hour spring-forward day and 25-hour fall-back day',()=>{
    const spring=[shift('before','2026-03-08T07:00:00Z','2026-03-08T08:00:00Z'),shift('inside','2026-03-08T08:00:00Z','2026-03-09T07:00:00Z'),shift('after','2026-03-09T07:00:00Z','2026-03-09T08:00:00Z')];
    expect(ids(shiftsOnCalendarDay(spring,'2026-03-08','America/Los_Angeles'))).toEqual(['inside']);
    const fall=[shift('before','2026-11-01T06:00:00Z','2026-11-01T07:00:00Z'),shift('inside','2026-11-01T07:00:00Z','2026-11-02T08:00:00Z'),shift('last-hour','2026-11-02T07:30:00Z','2026-11-02T08:00:00Z'),shift('after','2026-11-02T08:00:00Z','2026-11-02T09:00:00Z')];
    expect(ids(shiftsOnCalendarDay(fall,'2026-11-01','America/Los_Angeles'))).toEqual(['inside','last-hour']);
  });
  it('omits invalid, reversed and zero-length intervals',()=>{
    const rows=[shift('valid','2026-10-13T01:00:00Z','2026-10-13T02:00:00Z'),shift('invalid','invalid','2026-10-13T02:00:00Z'),shift('invalid-end','2026-10-13T01:00:00Z','invalid'),shift('empty','2026-10-13T01:00:00Z','2026-10-13T01:00:00Z'),shift('reversed','2026-10-13T02:00:00Z','2026-10-13T01:00:00Z')];
    expect(ids(shiftsOnCalendarDay(rows,'2026-10-13','Asia/Taipei'))).toEqual(['valid']);
  });
  it('sorts by actual instant and then id without mutating the source array',()=>{
    const rows=[shift('b','2026-10-13T09:00:00+08:00','2026-10-13T11:00:00+08:00'),shift('earlier','2026-10-13T00:00:00Z','2026-10-13T02:00:00Z'),shift('a','2026-10-13T01:00:00Z','2026-10-13T03:00:00Z')];
    expect(ids(shiftsOnCalendarDay(rows,'2026-10-13','Asia/Taipei'))).toEqual(['earlier','a','b']);
    expect(ids(rows)).toEqual(['b','earlier','a']);
  });
});
