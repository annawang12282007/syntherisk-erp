import {describe,it,expect} from 'vitest';
import {spreadsheet,workbook} from '../src/lib/xlsx';
import {reportSheets} from '../src/lib/analytics-export';
import {readWorkbook} from './export-readers';
import {calendarFile,contactCards} from '../src/lib/contact-calendar-export';

describe('valid spreadsheet exports read independently by openpyxl',()=>{
 it('preserves Unicode, exact minor units, booleans and multiline content without executing formulas',()=>{
  const file=spreadsheet(['name','amount_minor','active','quantity','notes'],[{name:'=HYPERLINK("unsafe")',amount_minor:'9007199254740993123',active:true,quantity:2.5,notes:'繁體中文 <&>\nSecond line'}],'研究 / 資料');
  const parsed=readWorkbook(file),sheet=parsed.sheets[parsed.names[0]];
  expect(sheet.values[1]).toEqual(['=HYPERLINK("unsafe")','9007199254740993123',true,2.5,'繁體中文 <&>\nSecond line']);expect(sheet.types[1]).toEqual(['s','s','b','n','s']);expect(parsed.names[0]).not.toContain('/');
 });
 it('produces separate case-insensitively unique valid worksheets and rejects truncation instead of silently losing cell content',()=>{
  const parsed=readWorkbook(workbook([{name:'Duplicate',columns:['value'],rows:[{value:'first'}]},{name:'duplicate',columns:['value'],rows:[{value:'second'}]}]));
  expect(new Set(parsed.names.map(name=>name.toLowerCase())).size).toBe(2);expect(parsed.sheets[parsed.names[1]].values[1][0]).toBe('second');
  expect(()=>spreadsheet(['content'],[{content:'x'.repeat(32768)}])).toThrow('XLSX_CELL_TOO_LONG');
 });
 it('keeps analysis sections and currencies separate with an index, applied owner filters and exact account data',()=>{
  const sheets=reportSheets({operational:{tasks:[{status:'open',count:2}]},finance:{trial_balance:[{currency:'USD',balance_minor:'123'},{currency:'JPY',balance_minor:'456'}],per_currency:{USD:{profit_loss:{currency:'USD',net_income_minor:'999999999999999999',accounts:[{code:'4000',balance_minor:'-999999999999999999'}]}}}}},{owner_ids:'member-1,member-2'},'2026-10-07T00:00:00Z');
  const parsed=readWorkbook(workbook(sheets));expect(parsed.names[0]).toBe('Index');expect(parsed.names.some(name=>name.includes('trial_balance USD'))).toBe(true);expect(parsed.names.some(name=>name.includes('trial_balance JPY'))).toBe(true);expect(JSON.stringify(parsed)).toContain('999999999999999999');expect(parsed.sheets['Export information'].values).toContainEqual(['filter.owner_ids','member-1,member-2']);
 });
});
describe('portable vCard and calendar files',()=>{
 it('escapes and folds UTF-8 contact cards with mandatory names and preserves contact restrictions',()=>{
  const card=contactCards([{id:'contact-1',name:'王'.repeat(50)+'; Name, test',email:'research@example.invalid',phone:'+1 555 0000',job_title:'Director\nSECOND:escaped',do_not_contact:true}]);
  expect(card).toContain('BEGIN:VCARD\r\nVERSION:3.0');expect(card).toContain('X-SYNTHERISK-DO-NOT-CONTACT:TRUE');expect(card.replace(/\r\n /g,'')).toContain('TITLE:Director\\nSECOND:escaped');expect(card.replace(/\r\n /g,'')).toContain('\\; Name\\, test');for(const line of card.split('\r\n'))expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  expect(()=>contactCards([{id:'missing'}])).toThrow('CONTACT_EXPORT_INCOMPLETE');
 });
 it('exports all-day exclusive ends and DST-correct recurrence occurrences with moved/cancelled exceptions',()=>{
  const base={id:'series',title:'Weekly; research',all_day:false,start_at:'2026-10-26T16:00:00Z',end_at:'2026-10-26T17:00:00Z',time_zone:'America/Los_Angeles',recurrence_rule:'FREQ=WEEKLY;COUNT=4',status:'scheduled',version:2};
  const file=calendarFile([base,{...base,id:'cancelled',recurrence_parent_id:'series',recurrence_date:'2026-11-09',recurrence_rule:null,status:'cancelled'},{...base,id:'moved',recurrence_parent_id:'series',recurrence_date:'2026-11-16',recurrence_rule:null,start_at:'2026-11-17T18:00:00Z',end_at:'2026-11-17T19:00:00Z'},{id:'all-day',title:'All day',all_day:true,start_date:'2026-11-02',end_date:'2026-11-04',time_zone:'Asia/Taipei',status:'scheduled'}],'2026-10-25','2026-11-20',new Date('2026-10-07T00:00:00Z'));
  expect(file.count).toBe(4);expect(file.content).toContain('DTSTART:20261026T160000Z');expect(file.content).toContain('DTSTART:20261102T170000Z');expect(file.content).toContain('DTSTART:20261117T180000Z');expect(file.content).not.toContain('DTSTART:20261109');expect(file.content).toContain('DTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261104');expect(file.content).not.toContain('RRULE:');expect(file.content).toContain('SUMMARY:Weekly\\; research');
  expect(()=>calendarFile([{...base,end_at:null}],'2026-10-25','2026-11-20')).toThrow('EVENT_EXPORT_INCOMPLETE');expect(()=>calendarFile([],'2026-01-01','2028-01-01')).toThrow('CALENDAR_EXPORT_RANGE');
  const late={...base,recurrence_rule:null,start_at:'2026-11-03T07:30:00Z',end_at:'2026-11-03T07:45:00Z'};expect(calendarFile([late],'2026-11-02','2026-11-03',new Date(),'America/Los_Angeles').count).toBe(1);expect(calendarFile([late],'2026-11-02','2026-11-03',new Date(),'UTC').count).toBe(0);
 });
});
