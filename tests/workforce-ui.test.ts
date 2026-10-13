import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {AttendanceTable,ClockCard,PayrollList,ShiftList,WorkforcePaySegment,WorkforceRateAmount,workforceMinorInput} from '../src/components/workforce-view';
import {translate} from '../src/locales';
import type {WorkforceData,WorkforceAttendance} from '../src/lib/workforce-types';

vi.mock('../src/components/context',()=>({useApp:()=>({t:(key:string)=>translate('zh-TW',key),locale:'zh-TW',prefs:{timezone:'Asia/Taipei'},me:{user:{id:'worker-1'},company:{base_currency:'TWD'}}})}));
const data:WorkforceData={as_of:'2026-10-13T10:00:00.000Z',settings:{time_zone:'Asia/Taipei',currency:'TWD',currency_minor_digits:0,week_start:1,weekly_overtime_seconds:144000,overtime_multiplier:'4/3',daily_regular_seconds:28800,monthly_hour_divisor:240,regular_overtime_tiers:[{up_to_seconds:7200,multiplier:'4/3'}],rest_day_tiers:[{up_to_seconds:7200,multiplier:'4/3'}],holiday_multiplier:'unsupported',version:0},capabilities:{manage_schedule:false,manage_payroll:false,view_team:false,clock:true},members:[],workers:[],shifts:[],attendance:[],current_clock:null,pay_rates:[],payroll_periods:[]};
const attendance:WorkforceAttendance={id:'attendance-1',user_id:'worker-1',user_name:'Employee',shift_id:null,clock_in_at:'2026-10-13T01:00:00.000Z',clock_out_at:null,break_started_at:'2026-10-13T09:30:00.000Z',breaks:[],unpaid_break_seconds:1800,paid_seconds:null,day_type:'regular',status:'pending',version:1,can_edit:false,correction_reason:null};
const run=async()=>true;

describe('workforce user interface boundaries',()=>{
 it('converts wage input into exact integer minor units without floating point loss',()=>{
  expect(workforceMinorInput('9007199254740993',0)).toBe('9007199254740993');
  expect(workforceMinorInput('250.05',2)).toBe('25005');expect(workforceMinorInput('0',0)).toBe('0');
  for(const input of ['-1','1e3','1.5','NaN',''])expect(()=>workforceMinorInput(input,0)).toThrow('workforceInvalidAmount');
 });
 it('displays the monthly fraction used in calculation rather than a rounded hourly wage',()=>{
  const html=renderToStaticMarkup(createElement(WorkforceRateAmount,{segment:{basis:'monthly',amount_minor:'30001',hourly_divisor:240,hourly_rate_minor:'125',multiplier:'4/3'},currency:'TWD',digits:0}));
  expect(html).toContain('30,001');expect(html).toContain('÷ 240');expect(html).toContain('× 4/3');expect(html).not.toContain('>125<');
 });
 it('labels monthly base-pay segments as fixed pay and uses the local payroll date',()=>{
  const segment={start_at:'2026-09-09T16:00:00.000Z',end_at:'2026-09-10T16:00:00.000Z',day_type:'regular' as const,basis:'monthly' as const,amount_minor:'30001',hourly_divisor:240,hourly_rate_minor:'126',multiplier:'1',regular_seconds:28800,overtime_seconds:0};
  const html=renderToStaticMarkup(createElement(WorkforcePaySegment,{segment,currency:'TWD',digits:0,zone:'Asia/Taipei'}));
  expect(html).toContain('2026-09-10');expect(html).not.toContain('2026-09-09');expect(html).toContain('8 小時');expect(html).toContain('已包含於固定月薪');expect(html).not.toContain('÷ 240');
  const overtime=renderToStaticMarkup(createElement(WorkforcePaySegment,{segment:{...segment,regular_seconds:0,overtime_seconds:7200,multiplier:'4/3'},currency:'TWD',digits:0,zone:'Asia/Taipei'}));
  expect(overtime).toContain('2 小時');expect(overtime).toContain('30,001');expect(overtime).toContain('÷ 240');expect(overtime).toContain('× 4/3');expect(overtime).not.toContain('已包含於固定月薪');
 });
 it('uses the server snapshot for elapsed work time and excludes the current break',()=>{
  const html=renderToStaticMarkup(createElement(ClockCard,{data:{...data,current_clock:attendance},busy:false,run}));
  expect(html).toContain('08:00:00');expect(html).toContain('休息中');expect(html).toContain('結束休息');expect(html).toContain('下班打卡');expect(html).not.toContain('>上班打卡<');
 });
 it('does not offer clock-in when the worker is not enrolled',()=>{
  const html=renderToStaticMarkup(createElement(ClockCard,{data:{...data,capabilities:{...data.capabilities,clock:false}},busy:false,run}));
  expect(html).toContain('尚未啟用您的出勤帳戶');expect(html).not.toContain('<button');
 });
 it('renders shift times in the configured work zone and displays its explicit day type',()=>{
  const html=renderToStaticMarkup(createElement(ShiftList,{data:{...data,shifts:[{id:'shift-1',user_id:'worker-1',user_name:'Employee',title:'Opening shift',notes:'',start_at:'2026-10-11T01:00:00.000Z',end_at:'2026-10-11T10:00:00.000Z',unpaid_break_minutes:60,day_type:'regular',status:'published',version:1}]},busy:false,run,edit:()=>{}}));
  expect(html).toContain('09:00–18:00');expect(html).toContain('一般工作日');expect(html).not.toContain('休息日');expect(html).not.toContain('取消班次');
 });
 it('does not offer approval or corrections to an ordinary worker or an open clock record',()=>{
  const html=renderToStaticMarkup(createElement(AttendanceTable,{data:{...data,attendance:[attendance]},busy:false,run,edit:()=>{}}));
  expect(html).toContain('尚未下班');expect(html).not.toContain('<button');
  const manager=renderToStaticMarkup(createElement(AttendanceTable,{data:{...data,capabilities:{...data.capabilities,manage_schedule:true},attendance:[{...attendance,can_edit:true}]},busy:false,run,edit:()=>{}}));
  expect(manager).toContain('補登出勤');expect(manager).not.toContain('>核准出勤<');
 });
 it('lets an employee read their approved payroll without exposing manager actions',()=>{
  const html=renderToStaticMarkup(createElement(PayrollList,{data:{...data,payroll_periods:[{id:'period-1',title:'September',start_date:'2026-09-01',end_date_exclusive:'2026-10-01',status:'approved',currency:'TWD',gross_minor:'35000',employee_count:1,version:3,approved_at:'2026-10-01T10:00:00.000Z',approved_by_name:'Payroll Manager'}]},busy:false,run,open:()=>{},create:()=>{}}));
  expect(html).toContain('35,000');expect(html).toContain('2026-09-30');expect(html).toContain('工資總額');expect(html).not.toContain('核准並鎖定');expect(html).not.toContain('建立薪資期間');expect(html).not.toContain('>計算薪資<');
 });
});
