import {z} from 'zod';
import {handle,body} from '@/lib/http';
import {DomainError} from '@/lib/context';
import {overview,detail,sourceDownload,targetChoices,upload,enqueue,confirm,discard} from '@/file-assistant/service';
import {MAX_BYTES,MAX_FILES,type Upload} from '@/file-assistant/files';
import {reviseWorkspace} from '@/workspace-assistant/service';
export const runtime='nodejs';
export async function GET(request:Request){return handle(request,async ctx=>{const p=new URL(request.url).searchParams;if(p.has('resource'))return targetChoices(ctx,p.get('resource'),p.get('q')??'');if(p.has('id'))return p.has('file')?sourceDownload(ctx,p.get('id')!,z.uuid().parse(p.get('file'))):detail(ctx,p.get('id')!);return overview(ctx);});}
async function boundedForm(request:Request){
 const limit=MAX_BYTES+100_000;if(Number(request.headers.get('Content-Length')??0)>limit)throw new DomainError(413,'ASSISTANT_INPUT_TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)throw new DomainError(400,'ASSISTANT_FILES_REQUIRED');let count=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>limit){await reader.cancel();throw new DomainError(413,'ASSISTANT_INPUT_TOO_LARGE');}chunks.push(value);}
 try{return await new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('Content-Type')!},body:Buffer.concat(chunks)}).formData();}catch{throw new DomainError(400,'ASSISTANT_FILE_INVALID');}
}
export async function POST(request:Request){return handle(request,async ctx=>{
 if(request.headers.get('Content-Type')?.startsWith('multipart/form-data')){
  const form=await boundedForm(request),files=form.getAll('files');if(files.length>MAX_FILES)throw new DomainError(422,'ASSISTANT_INPUT_TOO_LARGE');
  const raw:Upload[]=[];for(const file of files){if(typeof file==='string')throw new DomainError(422,'ASSISTANT_FILE_INVALID');raw.push({filename:file.name,mime:file.type,bytes:Buffer.from(await file.arrayBuffer())});}
  let targets:unknown;try{targets=JSON.parse(String(form.get('targets')??'[]'));}catch{throw new DomainError(422,'ASSISTANT_INVALID_TARGETS');}
  return upload(ctx,{mode:form.get('mode'),instruction:form.get('instruction'),locale:form.get('locale'),targets},raw);
 }
 const data=await body(request),id=z.uuid().parse(data.id);
 if(data.action==='analyze')return enqueue(ctx,id,data.supplement);
 if(data.action==='revise')return reviseWorkspace(ctx,id,data);
 if(data.action==='confirm')return confirm(ctx,id,data);
 if(data.action==='delete')return discard(ctx,id);
 throw new DomainError(422,'INVALID_ACTION');
 });}
