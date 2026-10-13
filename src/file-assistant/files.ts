import {inflateRawSync} from 'node:zlib';
import {parse} from 'csv-parse/sync';
import sharp from 'sharp';
import {DomainError} from '../lib/context';
export const MAX_BYTES=20_000_000,MAX_FILES=20;
export type Upload={filename:string;mime:string;bytes:Buffer};
const allowed=new Set(['pdf','png','jpg','jpeg','webp','csv','txt','md','xlsx','docx']);
const fail=()=>{throw new DomainError(422,'ASSISTANT_FILE_INVALID');};
const ext=(name:string)=>name.toLowerCase().split('.').pop()??'';
export function crc32(bytes:Buffer){let n=0xffffffff;for(const b of bytes){n^=b;for(let j=0;j<8;j++)n=(n>>>1)^(n&1?0xedb88320:0);}return(n^0xffffffff)>>>0;}
export function zipEntries(bytes:Buffer,maxEntries=200):{name:string;bytes:Buffer}[]{
 let e=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){e=i;break;}
 if(e<0||bytes.readUInt16LE(e+4)||bytes.readUInt16LE(e+6))return fail();
 const count=bytes.readUInt16LE(e+10),centralSize=bytes.readUInt32LE(e+12),start=bytes.readUInt32LE(e+16);
 if(count!==bytes.readUInt16LE(e+8)||count>maxEntries||start+centralSize>e)return fail();
 const result:{name:string;bytes:Buffer}[]=[],seen=new Set<string>();let at=start,total=0;
 for(let n=0;n<count;n++){
  if(at+46>e||bytes.readUInt32LE(at)!==0x02014b50)return fail();
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),crc=bytes.readUInt32LE(at+16),packed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),nameSize=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42);
  if(at+46+nameSize+extra+comment>e||flags&1||![0,8].includes(method)||size>MAX_BYTES||size>Math.max(1,packed)*200||((bytes.readUInt32LE(at+38)>>>16)&0xf000)===0xa000)return fail();
  const name=bytes.subarray(at+46,at+46+nameSize).toString('utf8');
  if(!name||name.includes('\0')||name.includes('\\')||name.startsWith('/')||name.includes(':')||name.split('/').includes('..')||seen.has(name))return fail();seen.add(name);
  at+=46+nameSize+extra+comment;
  if(local+30>start||bytes.readUInt32LE(local)!==0x04034b50)return fail();
  const localNameSize=bytes.readUInt16LE(local+26),body=local+30+localNameSize+bytes.readUInt16LE(local+28);
  if(body+packed>start||bytes.readUInt16LE(local+8)!==method||bytes.readUInt16LE(local+6)&1||bytes.subarray(local+30,local+30+localNameSize).toString('utf8')!==name)return fail();
  total+=size;if(total>MAX_BYTES)return fail();
  let unpacked:Buffer;try{unpacked=method===0?bytes.subarray(body,body+packed):inflateRawSync(bytes.subarray(body,body+packed),{maxOutputLength:MAX_BYTES});}catch{return fail();}
  if(unpacked.length!==size||crc32(unpacked)!==crc)return fail();
  if(!name.endsWith('/'))result.push({name,bytes:unpacked});
 }
 if(at!==start+centralSize)return fail();return result;
}
export function expandUploads(raw:Upload[]):Upload[]{
 const out:Upload[]=[];let bytes=0;
 for(const f of raw){
  const entries=ext(f.filename)==='zip'?zipEntries(f.bytes).filter(x=>!x.name.startsWith('__MACOSX/')&&!x.name.split('/').pop()?.startsWith('.')).map(x=>({filename:x.name,mime:'',bytes:x.bytes})):[f];
  for(const item of entries){bytes+=item.bytes.length;if(bytes>MAX_BYTES||out.length>=MAX_FILES||!item.bytes.length||!allowed.has(ext(item.filename)))return fail();
   if(item.filename.length>220)return fail();
   const name=item.filename.replace(/[\r\n]/g,' '),extension=ext(name);
   const mime:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',csv:'text/csv',txt:'text/plain',md:'text/plain',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
   if(extension==='pdf'&&!item.bytes.subarray(0,8).toString('ascii').startsWith('%PDF-'))return fail();
   out.push({...item,filename:name,mime:mime[extension]});
  }
 }if(!out.length&&raw.length)return fail();return out;
}
function xmlText(s:string){return s.replace(/<[^>]*>/g,'').replace(/&#(x[\da-f]+|\d+);/gi,(_,v:string)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');}
export function officeText(bytes:Buffer,extension:string){
 const entries=zipEntries(bytes,500),read=(name:string)=>entries.find(e=>e.name===name)?.bytes.toString('utf8')??'';
 if(extension==='docx'){const xml=read('word/document.xml');if(!xml)return fail();return xmlText(xml.replace(/<\/w:p>/g,'\n').replace(/<w:tab\b[^>]*\/>/g,'\t'));}
 const shared=[...read('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>xmlText(m[1]));
 const sheets=entries.filter(e=>/^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));if(!sheets.length)return fail();
 return sheets.map(sheet=>sheet.name+'\n'+[...sheet.bytes.toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(r=>[...r[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(c=>{const address=c[1].match(/\br="([^"]+)"/)?.[1]??'',type=c[1].match(/\bt="([^"]+)"/)?.[1],v=c[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];return address+': '+(type==='s'?shared[Number(v)]??'':type==='inlineStr'?xmlText(c[2]):v!==undefined?xmlText(v):c[2].includes('<f')?'[formula has no cached value]':xmlText(c[2]));}).join('\t')).join('\n')).join('\n\n');
}
export async function fileContent(file:Upload,id:string):Promise<Record<string,unknown>[]>{
 const descriptor={type:'text',text:JSON.stringify({source_file:id,filename:file.filename})},extension=ext(file.filename);
 if(extension==='pdf')return[descriptor,{type:'document',source:{type:'base64',media_type:'application/pdf',data:file.bytes.toString('base64')}}];
 if(['png','jpg','jpeg','webp'].includes(extension)){
  let image:Buffer;try{image=await sharp(file.bytes,{limitInputPixels:40_000_000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).png().toBuffer();}catch{return fail();}
  return[descriptor,{type:'image',source:{type:'base64',media_type:'image/png',data:image.toString('base64')}}];
 }
 let text:string;
 if(['docx','xlsx'].includes(extension))text=officeText(file.bytes,extension);
 else {try{text=new TextDecoder('utf-8',{fatal:true}).decode(file.bytes);}catch{return fail();}
  if(extension==='csv'){try{text=JSON.stringify(parse(text,{bom:true,skip_empty_lines:true,relax_column_count:true,max_record_size:100_000}));}catch{return fail();}}
 }
 if(text.length>400_000||text.includes('\0'))return fail();
 return[descriptor,{type:'text',text:'UNTRUSTED_FILE_CONTENT\n'+text+'\nEND_FILE_CONTENT'}];
}
