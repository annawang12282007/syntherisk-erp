import {formatInTimeZone,fromZonedTime} from 'date-fns-tz';
import {DomainError} from '../lib/context';
import type {WorkforceDayType,WorkforceSettings} from '../lib/workforce-types';

export const defaultWorkforceSettings:WorkforceSettings={time_zone:'Asia/Taipei',currency:'TWD',currency_minor_digits:0,week_start:1,weekly_overtime_seconds:144000,overtime_multiplier:'4/3',daily_regular_seconds:28800,monthly_hour_divisor:240,regular_overtime_tiers:[{up_to_seconds:7200,multiplier:'4/3'},{up_to_seconds:14400,multiplier:'5/3'}],rest_day_tiers:[{up_to_seconds:7200,multiplier:'4/3'},{up_to_seconds:28800,multiplier:'5/3'},{up_to_seconds:43200,multiplier:'8/3'}],holiday_multiplier:'unsupported',version:0};
export function workforceError(code:string,status=422):never{throw new DomainError(status,`workforce_${code}`);}
export function localDate(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)workforceError('invalid_date');return value;}
export function instant(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))workforceError('invalid_instant');localDate(value.slice(0,10));if(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)workforceError('invalid_instant');return new Date(Math.floor(Date.parse(value)/1000)*1000).toISOString();}
export function dayType(value:unknown):WorkforceDayType{if(!['regular','rest','holiday'].includes(String(value)))workforceError('day_type_required');return value as WorkforceDayType;}
export function int(value:unknown,min:number,max:number):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)workforceError('invalid_number');return value;}
export function textValue(value:unknown,max=4000):string{if(value===undefined||value===null)return '';if(typeof value!=='string'||value.length>max)workforceError('invalid_text');return value.trim();}
export const dateAt=(value:string,zone:string)=>formatInTimeZone(new Date(value),zone,'yyyy-MM-dd');
export function addDays(value:string,count:number):string{const d=new Date(localDate(value)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);}
export const midnight=(value:string,zone:string)=>fromZonedTime(localDate(value)+'T00:00:00',zone).toISOString();
export function validateSettings(value:Record<string,unknown>):WorkforceSettings{
 const zone=textValue(value.time_zone??defaultWorkforceSettings.time_zone,100);try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();}catch{workforceError('invalid_timezone');}
 for(const key of Object.keys(defaultWorkforceSettings) as (keyof WorkforceSettings)[])if(!['time_zone','week_start','version'].includes(key)&&value[key]!==undefined&&JSON.stringify(value[key])!==JSON.stringify(defaultWorkforceSettings[key]))workforceError('unsupported_policy');
 return {...defaultWorkforceSettings,time_zone:zone,week_start:int(value.week_start??1,0,6)};
}
