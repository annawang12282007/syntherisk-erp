import {query} from './db';
import {DomainError,type Context} from './context';
import {assertAccess,uuid} from '../domain/core';
import {getFile} from './storage';
import {attachmentPackage,type AttachmentMetadata} from './attachment-package';
import {imageWidth,resizedImage} from './image-sizing';

export async function attachmentImage(ctx:Context,id:string,width:unknown,download=false){
 // Reuse exactly the original attachment authorization. A derivative never
 // changes the original attachment, its checksum, or any signed snapshot.
 const original=await attachmentDownload(ctx,id),size=imageWidth(width);
 if(!['image/png','image/jpeg','image/webp'].includes(original.headers.get('Content-Type')??''))throw new DomainError(422,'INVALID_IMAGE');
 const image=await resizedImage(Buffer.from(await original.arrayBuffer()),size);
 return new Response(new Uint8Array(image),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'",'Content-Disposition':`${download?'attachment':'inline'}; filename="image-${id}-${size}px.png"`}});
}

export async function attachmentDownload(ctx:Context,id:string,checksum=false):Promise<Response>{
 const rows=await query<AttachmentMetadata&{storage_key:string}>('SELECT id,resource,record_id,storage_key,mime_type,filename,byte_size,sha256,created_at FROM attachments WHERE id=$1 AND workspace_id=$2',[uuid(id),ctx.workspaceId]);
 const file=rows[0];if(!file)throw new DomainError(404,'NOT_FOUND');
 const record=await assertAccess(ctx,file.resource,file.record_id,'read');
 const bytes=await getFile(file.storage_key);
 const headers:Record<string,string>={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 if(checksum){
  const bundle=attachmentPackage(file,bytes,record.version);
  return new Response(new Uint8Array(bundle.bytes),{headers:{...headers,'Content-Type':'application/zip','Content-Length':String(bundle.bytes.length),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(bundle.filename)}`,'X-Attachment-SHA256':bundle.sha256,'X-Content-SHA256':bundle.archiveSha256}});
 }
 return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':file.mime_type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`}});
}
