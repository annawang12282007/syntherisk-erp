import {richTextPlain} from './rich-text';
import {storedZip} from './zip';
import {DomainError} from './context';

const xml=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
function column(index:number){let result='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;}
function cell(value:unknown,ref:string,header=false){
 if(!header&&typeof value==='boolean')return `<c r="${ref}" t="b"><v>${value?1:0}</v></c>`;
 // Exact integer minor units and long identifiers must never be silently rounded by Excel.
 if(!header&&typeof value==='number'&&Number.isFinite(value)&&String(value).replace(/[-.]/g,'').length<=15)return `<c r="${ref}"><v>${value}</v></c>`;
 const text=value instanceof Date?value.toISOString():typeof value==='object'&&value!==null?JSON.stringify(value):richTextPlain(value);
 if(text.length>32767)throw new DomainError(413,'XLSX_CELL_TOO_LONG');
 return `<c r="${ref}" t="inlineStr" s="${header?1:0}"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}
export type Sheet={name:string;columns:string[];rows:Record<string,unknown>[]};
function worksheetXml(columns:string[],rows:Record<string,unknown>[]){
 if(!columns.length||columns.length>200||rows.length>100000)throw new DomainError(413,'EXPORT_TOO_LARGE');
 const last=`${column(columns.length-1)}${rows.length+1}`;
 const data=`<row r="1">${columns.map((name,i)=>cell(name,`${column(i)}1`,true)).join('')}</row>`+rows.map((row,index)=>`<row r="${index+2}">${columns.map((key,i)=>cell(row[key],`${column(i)}${index+2}`)).join('')}</row>`).join('');
 const worksheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns.map((key,i)=>`<col min="${i+1}" max="${i+1}" width="${/description|notes|content|body/.test(key)?50:24}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData><autoFilter ref="A1:${last}"/><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.2" footer="0.2"/></worksheet>`;
 if(Buffer.byteLength(worksheet)>80_000_000)throw new DomainError(413,'EXPORT_TOO_LARGE');
 return worksheet;
}
export function workbook(sheets:Sheet[],at?:Date):Buffer{
 if(!sheets.length||sheets.length>200)throw new DomainError(413,'EXPORT_TOO_LARGE');
 const used=new Set<string>();const names=sheets.map(sheet=>{const base=sheet.name.replace(/[\\/*?:\[\]]/g,' ').replace(/^'+|'+$/g,'').slice(0,31)||'Records';let name=base,number=2;while(used.has(name.toLowerCase())){const suffix=' '+number++;name=base.slice(0,31-suffix.length)+suffix;}used.add(name.toLowerCase());return name;});
 const parts:Record<string,string>={
 '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
 '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+names.map((name,i)=>'<sheet name="'+xml(name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId'+(sheets.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
 'xl/styles.xml':'<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173341"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
 };
 sheets.forEach((sheet,i)=>{parts['xl/worksheets/sheet'+(i+1)+'.xml']=worksheetXml(sheet.columns,sheet.rows);});
 if(Object.values(parts).reduce((sum,value)=>sum+Buffer.byteLength(value),0)>90_000_000)throw new DomainError(413,'EXPORT_TOO_LARGE');
 return storedZip(Object.entries(parts).map(([name,content])=>({name,bytes:Buffer.from(content,'utf8')})),at);
}
export function spreadsheet(columns:string[],rows:Record<string,unknown>[],name='Records'):Buffer{return workbook([{columns,rows,name}]);}
