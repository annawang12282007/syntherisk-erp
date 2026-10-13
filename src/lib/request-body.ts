import {DomainError} from './context';

/** Bound the stream even when Content-Length is omitted or forged. */
export async function readJson(request:Request,limit=2_000_000):Promise<unknown>{
 if(Number(request.headers.get('content-length')??0)>limit)throw new DomainError(413,'TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)throw new DomainError(400,'INVALID_JSON');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw new DomainError(413,'TOO_LARGE');}chunks.push(part.value);}}
 finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new DomainError(400,'INVALID_JSON');}
}
