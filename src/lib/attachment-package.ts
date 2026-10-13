import {createHash} from 'node:crypto';
import {storedZip} from './zip';
import {DomainError} from './context';

export type AttachmentMetadata={id:string;filename:string;mime_type:string;byte_size:string|number;sha256:string;created_at:Date|string;resource:string;record_id:string};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

/** A single portable basename, including protection against ZIP paths and Windows device names. */
export function attachmentBasename(value:string):string {
 let name=value.split(/[\\/]/).at(-1)?.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*\u202a-\u202e\u2066-\u2069]/g,'_').replace(/^\.+|[. ]+$/g,'').trim()||'attachment';
 if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)||/^(?:SHA256SUMS|metadata\.json)$/i.test(name))name=`attachment-${name}`;
 while(Buffer.byteLength(name)>180)name=Array.from(name).slice(0,-1).join('');
 return name;
}

export function attachmentPackage(file:AttachmentMetadata,bytes:Buffer,recordVersion:unknown,at=new Date()) {
 // Hash precisely the same bytes inserted into the ZIP; never trust database digest text alone.
 const sha256=digest(bytes);
 if(bytes.length!==Number(file.byte_size)||sha256!==file.sha256)throw new DomainError(409,'ATTACHMENT_INTEGRITY_MISMATCH');
 if(bytes.length>20_000_000)throw new DomainError(413,'TOO_LARGE');
 const filename=attachmentBasename(file.filename);
 const metadata=Buffer.from(JSON.stringify({format:'syntherisk-attachment-package-v1',attachment_id:file.id,filename,mime_type:file.mime_type,byte_size:bytes.length,sha256,uploaded_at:new Date(file.created_at).toISOString(),downloaded_at:at.toISOString(),record:{resource:file.resource,id:file.record_id,version_at_download:Number.isSafeInteger(recordVersion)?recordVersion:null}},null,2)+'\n','utf8');
 const manifest=Buffer.from(`${sha256}  ${filename}\n${digest(metadata)}  metadata.json\n`,'utf8');
 const zip=storedZip([{name:'SHA256SUMS',bytes:manifest},{name:filename,bytes},{name:'metadata.json',bytes:metadata}],at);
 return {bytes:zip,filename:`${filename}.checksum.zip`,sha256,archiveSha256:digest(zip)};
}
