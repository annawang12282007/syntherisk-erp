import {signatureArtwork} from './signature-artwork';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {z} from 'zod';
import {pool,transaction} from './db';
import {DomainError,type Context} from './context';
import type {Client} from '../domain/core';
export type SignatureAppearance={display_width:number;mode:'generated'|'uploaded';style:string;version:number;data_url:string;sha256:string;signature_text:string;label:string;saved_version:number|null};
export type SignatureProfile=SignatureAppearance&{versions:{revision:number;label:string;signature_text:string;mode:string;style:string;created_at:string}[]};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export async function signatureAppearance(client:Client,userId:string):Promise<SignatureAppearance>{
 const row=(await client.query('SELECT p.*,u.name FROM "user" u LEFT JOIN signature_profiles p ON p.user_id=u.id WHERE u.id=$1',[userId])).rows[0];
 if(!row)throw new DomainError(404,'NOT_FOUND');
 const mode=row.mode??'generated',style=row.style??'script',signatureText=row.signature_text??row.name;
 const svg=signatureArtwork(String(signatureText),style);
 const bytes:Buffer=mode==='uploaded'?row.image_data:Buffer.from(svg);
 if(mode==='uploaded'&&(!bytes||hash(bytes)!==row.image_sha256))throw new DomainError(409,'SIGNATURE_IMAGE_INTEGRITY');
 return {display_width:row.display_width??280,mode,style,version:row.version??0,signature_text:signatureText,label:row.label??'Signature',saved_version:row.saved_version??null,data_url:`data:image/${mode==='uploaded'?'png':'svg+xml'};base64,${bytes.toString('base64')}`,sha256:hash(bytes)};
}
async function profile(client:Client,userId:string):Promise<SignatureProfile>{return {...await signatureAppearance(client,userId),versions:(await client.query('SELECT revision,label,signature_text,mode,style,created_at FROM signature_profile_versions WHERE user_id=$1 ORDER BY revision DESC',[userId])).rows};}
export async function getSignatureProfile(ctx:Context){return profile(pool,ctx.userId);}
export async function activateSignatureVersion(ctx:Context,input:unknown){
 const value=z.object({action:z.literal('activate'),revision:z.number().int().positive(),version:z.number().int().nonnegative()}).strict().parse(input);
 return transaction(async c=>{
  await c.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[ctx.userId]);
  const current=(await c.query('SELECT version FROM signature_profiles WHERE user_id=$1',[ctx.userId])).rows[0];
  if(current?.version!==value.version)throw new DomainError(409,'VERSION_CONFLICT');
  const saved=(await c.query('SELECT * FROM signature_profile_versions WHERE user_id=$1 AND revision=$2',[ctx.userId,value.revision])).rows[0];
  if(!saved)throw new DomainError(404,'NOT_FOUND');
  await c.query('UPDATE signature_profiles SET mode=$2,style=$3,signature_text=$4,label=$5,image_data=$6,image_sha256=$7,saved_version=$8,version=version+1,updated_at=now() WHERE user_id=$1',[ctx.userId,saved.mode,saved.style,saved.signature_text,saved.label,saved.image_data,saved.image_sha256,saved.revision]);
  await c.query('UPDATE signature_profiles SET display_width=$2 WHERE user_id=$1',[ctx.userId,saved.display_width]);
  await c.query("INSERT INTO audit_log(workspace_id,actor_id,resource,action,after_data) VALUES($1,$2,'signature_profiles','activate_version',$3)",[ctx.workspaceId,ctx.userId,JSON.stringify({revision:saved.revision,version:value.version+1})]);
  return profile(c,ctx.userId);
 });
}
export async function saveSignatureProfile(ctx:Context,input:unknown){
 const value=z.object({mode:z.enum(['generated','uploaded']),style:z.enum(['script','serif','clean']).default('script'),version:z.number().int().nonnegative(),signature_text:z.string().trim().min(1).max(120).regex(/^[^\p{Cc}]+$/u).optional(),label:z.string().trim().min(1).max(100).optional(),image:z.string().max(1450000).optional(),display_width:z.number().int().min(60).max(700).optional()}).parse(input);
 let bytes:Buffer|undefined;
 if(value.image){
  const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(value.image);if(!match)throw new DomainError(400,'SIGNATURE_IMAGE_INVALID');
  const raw=Buffer.from(match[2],'base64');if(!raw.length||raw.length>1048576)throw new DomainError(413,'SIGNATURE_IMAGE_TOO_LARGE');
  try{
   const image=sharp(raw,{limitInputPixels:10000000,failOn:'warning',animated:false});const metadata=await image.metadata();
   if(!['png','jpeg'].includes(metadata.format??'')||metadata.pages&&metadata.pages>1)throw new Error('unsupported');
   bytes=await image.rotate().resize({width:1000,height:400,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  }catch{throw new DomainError(400,'SIGNATURE_IMAGE_INVALID');}
  if(bytes.length>1048576)throw new DomainError(413,'SIGNATURE_IMAGE_TOO_LARGE');
 }
 return transaction(async client=>{
  const actor=(await client.query('SELECT id,name FROM "user" WHERE id=$1 FOR UPDATE',[ctx.userId])).rows[0];
  const current=(await client.query('SELECT * FROM signature_profiles WHERE user_id=$1',[ctx.userId])).rows[0];
  if((current?.version??0)!==value.version)throw new DomainError(409,'VERSION_CONFLICT');
  const image=value.mode==='uploaded'?(bytes??current?.image_data):null;
  if(value.mode==='uploaded'&&!image)throw new DomainError(400,'SIGNATURE_IMAGE_REQUIRED');
  const signatureText=value.signature_text??current?.signature_text??actor.name,label=value.label??current?.label??'Signature',revision=value.version+1;
  await client.query('INSERT INTO signature_profile_versions(user_id,revision,label,signature_text,mode,style,image_data,image_sha256,display_width) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ctx.userId,revision,label,signatureText,value.mode,value.style,image,image?hash(image):null,value.display_width??current?.display_width??280]);
  await client.query('INSERT INTO signature_profiles(user_id,mode,style,image_data,image_sha256,signature_text,label,saved_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id) DO UPDATE SET mode=$2,style=$3,image_data=$4,image_sha256=$5,signature_text=$6,label=$7,saved_version=$8,version=signature_profiles.version+1,updated_at=now()',[ctx.userId,value.mode,value.style,image,image?hash(image):null,signatureText,label,revision]);
  await client.query('UPDATE signature_profiles SET display_width=$2 WHERE user_id=$1',[ctx.userId,value.display_width??current?.display_width??280]);
  await client.query("INSERT INTO audit_log(workspace_id,actor_id,resource,action,after_data) VALUES($1,$2,'signature_profiles','update',$3)",[ctx.workspaceId,ctx.userId,JSON.stringify({mode:value.mode,style:value.style,version:value.version+1})]);
  return profile(client,ctx.userId);
 });
}

/** Remove a personal preset; immutable signed receipts retain their own bytes. */
export async function deleteSignatureVersion(ctx:Context,input:unknown){
 const value=z.object({revision:z.number().int().positive(),version:z.number().int().nonnegative()}).strict().parse(input);
 return transaction(async c=>{
  const actor=(await c.query('SELECT id,name FROM "user" WHERE id=$1 FOR UPDATE',[ctx.userId])).rows[0];
  const current=(await c.query('SELECT * FROM signature_profiles WHERE user_id=$1',[ctx.userId])).rows[0];
  if(current?.version!==value.version)throw new DomainError(409,'VERSION_CONFLICT');
  const removed=await c.query('DELETE FROM signature_profile_versions WHERE user_id=$1 AND revision=$2 RETURNING revision',[ctx.userId,value.revision]);
  if(!removed.rowCount)throw new DomainError(404,'NOT_FOUND');
  if(current.saved_version===value.revision){
   const saved=(await c.query('SELECT * FROM signature_profile_versions WHERE user_id=$1 ORDER BY revision DESC LIMIT 1',[ctx.userId])).rows[0];
   await c.query('UPDATE signature_profiles SET mode=$2,style=$3,signature_text=$4,label=$5,image_data=$6,image_sha256=$7,saved_version=$8,version=version+1,updated_at=now() WHERE user_id=$1',[ctx.userId,saved?.mode??'generated',saved?.style??'script',saved?.signature_text??actor.name,saved?.label??'Signature',saved?.image_data??null,saved?.image_sha256??null,saved?.revision??null]);
   await c.query('UPDATE signature_profiles SET display_width=$2 WHERE user_id=$1',[ctx.userId,saved?.display_width??280]);
  }else await c.query('UPDATE signature_profiles SET version=version+1,updated_at=now() WHERE user_id=$1',[ctx.userId]);
  await c.query("INSERT INTO audit_log(workspace_id,actor_id,resource,action,after_data) VALUES($1,$2,'signature_profiles','delete_version',$3)",[ctx.workspaceId,ctx.userId,JSON.stringify({revision:value.revision,version:value.version+1})]);
  return profile(c,ctx.userId);
 });
}
