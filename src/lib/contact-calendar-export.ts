import {richTextPlain} from './rich-text';
import {DomainError} from './context';
import {expandEvents} from '../domain/calendar';
type Row=Record<string,unknown>;
const text=(value:unknown)=>richTextPlain(value).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
/** RFC 5545/2426 folding uses octets, without splitting a Unicode codepoint. */
export function foldContentLine(line:string){let output='',current='',size=0;for(const char of line){const bytes=Buffer.byteLength(char);if(size+bytes>75){output+=current+'\r\n';current=' ';size=1;}current+=char;size+=bytes;}return output+current;}
const serialize=(lines:string[])=>lines.map(foldContentLine).join('\r\n')+'\r\n';
export function contactCards(rows:Row[]){return rows.map(row=>{
 if(!String(row.name??'').trim())throw new DomainError(422,'CONTACT_EXPORT_INCOMPLETE');
 const lines=['BEGIN:VCARD','VERSION:3.0','UID:'+text(row.id),'FN:'+text(row.name),'N:;'+text(row.name)+';;;'];
 for(const [field,property]of[['email','EMAIL;TYPE=INTERNET'],['phone','TEL'],['job_title','TITLE']])if(row[field])lines.push(property+':'+text(row[field]));
 if(row.organization_name)lines.push('ORG:'+text(row.organization_name));
 if(row.notes)lines.push('NOTE:'+text(row.notes));
 lines.push('X-SYNTHERISK-DO-NOT-CONTACT:'+(row.do_not_contact||row.contact_preference==='none'?'TRUE':'FALSE'));if(row.contact_preference)lines.push('X-SYNTHERISK-CONTACT-PREFERENCE:'+text(row.contact_preference));
 return serialize([...lines,'END:VCARD']);
 }).join('');}
const validDate=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const utc=(value:unknown)=>new Date(String(value)).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
export function calendarFile(rows:Row[],from:string,to:string,at=new Date(),timezone='UTC'){
 if(!validDate(from)||!validDate(to)||Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>370*86400000)throw new DomainError(422,'CALENDAR_EXPORT_RANGE');
 let formatter:Intl.DateTimeFormat;try{formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}catch{throw new DomainError(422,'CALENDAR_EXPORT_RANGE');}
 const wall=(value:unknown)=>{const parts=Object.fromEntries(formatter.formatToParts(new Date(String(value))).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;};
 for(const row of rows.filter(row=>row.status!=='cancelled')){
  const start=String(row.start_date??''),end=String(row.end_date??'');
  if(!String(row.title??'').trim()||(row.all_day?!(validDate(start)&&validDate(end)&&end>start):!Number.isFinite(new Date(String(row.start_at)).getTime())||!Number.isFinite(new Date(String(row.end_at)).getTime())||new Date(String(row.end_at))<=new Date(String(row.start_at))))throw new DomainError(422,'EVENT_EXPORT_INCOMPLETE');
 }
 const occurrences=expandEvents(rows,from,to).filter(row=>row.all_day?String(row.start_date)<to&&String(row.end_date)>from:wall(row.start_at)<to+'T00:00:00'&&wall(row.end_at)>from+'T00:00:00');
 if(occurrences.length>100000)throw new DomainError(413,'EXPORT_TOO_LARGE');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Syntherisk//Workspace calendar//EN','CALSCALE:GREGORIAN'];
 for(const row of occurrences){lines.push('BEGIN:VEVENT','UID:'+encodeURIComponent(String(row.occurrence_id??row.id))+'@syntherisk','DTSTAMP:'+utc(at.toISOString()),'SEQUENCE:'+String(Number(row.version)||0),'SUMMARY:'+text(row.title));
  if(row.all_day)lines.push('DTSTART;VALUE=DATE:'+String(row.start_date).replaceAll('-',''),'DTEND;VALUE=DATE:'+String(row.end_date).replaceAll('-',''));else lines.push('DTSTART:'+utc(row.start_at),'DTEND:'+utc(row.end_at));
  if(row.location)lines.push('LOCATION:'+text(row.location));if(row.notes||row.video_url)lines.push('DESCRIPTION:'+text([row.notes,row.video_url].filter(Boolean).join('\n')));lines.push('X-SYNTHERISK-ORIGINAL-TIME-ZONE:'+text(row.time_zone),'STATUS:CONFIRMED','END:VEVENT');
 }
 lines.push('END:VCALENDAR');return {content:serialize(lines),count:occurrences.length};
}
