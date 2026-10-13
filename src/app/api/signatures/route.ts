import {z} from 'zod';
import {handle,body} from '@/lib/http';
import {previewSignature,listSignatures,signatureReceipt} from '@/domain/signatures';

const resourceName=z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
export async function POST(request:Request){return handle(request,async ctx=>{
 const input=z.object({resource:resourceName,record_id:z.uuid(),operation:resourceName,values:z.record(z.string(),z.unknown())}).parse(await body(request));
 return previewSignature(ctx,input.resource,input.record_id,input.operation,input.values);
});}
export async function GET(request:Request){return handle(request,async ctx=>{
 const params=new URL(request.url).searchParams;
 if(params.has('id')){
  const receipt=await signatureReceipt(ctx,z.uuid().parse(params.get('id')));
  const checksum=params.get('format')==='sha256';
  return new Response(checksum?`${receipt.sha256}  ${receipt.filename}\n`:receipt.canonical,{headers:{
   'Content-Type':checksum?'text/plain; charset=utf-8':'application/json; charset=utf-8',
   'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(receipt.filename+(checksum?'.sha256':''))}`,
   'X-Content-Type-Options':'nosniff',
   'X-Content-SHA256':receipt.sha256,
  }});
 }
 const resource=resourceName.parse(params.get('resource')),id=z.uuid().parse(params.get('record_id'));
 return {rows:await listSignatures(ctx,resource,id)};
});}
