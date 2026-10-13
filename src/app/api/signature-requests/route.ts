import {z} from 'zod';
import {handle,body} from '@/lib/http';
import {getSignatureRequests,mutateSignatureRequests,signatureRequestReceipt} from '@/domain/signature-requests';
export async function GET(request:Request){return handle(request,async ctx=>{
 const params=new URL(request.url).searchParams;if(params.has('receipt_id')){const receipt=await signatureRequestReceipt(ctx,z.uuid().parse(params.get('receipt_id'))),checksum=params.get('format')==='sha256';return new Response(checksum?`${receipt.sha256}  ${receipt.filename}\n`:receipt.canonical,{headers:{'Content-Type':checksum?'text/plain; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(receipt.filename+(checksum?'.sha256':''))}`,'X-Content-SHA256':receipt.sha256,'X-Content-Type-Options':'nosniff'}});}
 const resource=z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).parse(params.get('resource')),id=params.has('record_id')?z.uuid().parse(params.get('record_id')):undefined;return getSignatureRequests(ctx,resource,id);
});}
export async function POST(request:Request){return handle(request,async ctx=>mutateSignatureRequests(ctx,await body(request)));}
