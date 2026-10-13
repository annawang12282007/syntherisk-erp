import {handle} from '@/lib/http';
import {readJson} from '@/lib/request-body';
import {DomainError} from '@/lib/context';
import {isExternal} from '@/domain/core';
import {query} from '@/lib/db';
import {z} from 'zod';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
export async function GET(r:Request){return handle(r,async ctx=>{
 if(isExternal(ctx))throw new DomainError(403,'FORBIDDEN');const id=new URL(r.url).searchParams.get('id');
 if(!id)return query('SELECT id,filename,created_at FROM mail_images WHERE workspace_id=$1 AND owner_id=$2 AND NOT archived ORDER BY created_at DESC LIMIT 100',[ctx.workspaceId,ctx.userId]);
 const [file]=await query('SELECT content,mime_type FROM mail_images WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,z.uuid().parse(id)]);if(!file)throw new DomainError(404,'NOT_FOUND');
 return new Response(new Uint8Array(file.content as Buffer),{headers:{'Content-Type':String(file.mime_type),'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});
 });}
export async function POST(r:Request){return handle(r,async ctx=>{
 if(isExternal(ctx))throw new DomainError(403,'FORBIDDEN');const input=z.record(z.string(),z.unknown()).parse(await readJson(r,3_000_000));
 if(input.action==='remove'){const result=await query('UPDATE mail_images SET archived=true WHERE workspace_id=$1 AND owner_id=$2 AND id=$3 RETURNING id',[ctx.workspaceId,ctx.userId,z.uuid().parse(input.id)]);if(!result.length)throw new DomainError(404,'NOT_FOUND');return {removed:true};}
 const d=z.object({filename:z.string().min(1).max(200),content:z.string().max(2_800_000)}).parse(input),bytes=Buffer.from(d.content,'base64');if(bytes.length>2_000_000)throw new DomainError(413,'FILE_TOO_LARGE');
 let output:Buffer;try{const image=sharp(bytes,{limitInputPixels:16_000_000}),meta=await image.metadata();if(!['png','jpeg'].includes(meta.format||''))throw new Error('format');output=await image.rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).png().toBuffer();}catch{throw new DomainError(422,'INVALID_IMAGE');}
 if(output.length>1_000_000)throw new DomainError(413,'FILE_TOO_LARGE');const [saved]=await query("INSERT INTO mail_images(workspace_id,owner_id,filename,content,mime_type,sha256) VALUES($1,$2,$3,$4,'image/png',$5) RETURNING id,filename",[ctx.workspaceId,ctx.userId,d.filename,output,createHash('sha256').update(output).digest('hex')]);return saved;
 });}
