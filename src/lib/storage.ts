import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {DomainError} from './context';
function localPath(key:string){if(!/^[a-f0-9-]+\/[a-f0-9-]+$/.test(key))throw new DomainError(400,'INVALID_STORAGE_KEY');const root=resolve(/* turbopackIgnore: true */ process.env.ATTACHMENT_DIR??'data/attachments');const path=resolve(root,key);if(!path.startsWith(root+sep))throw new DomainError(400,'INVALID_STORAGE_KEY');return path;}
const s3=()=>new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION??'us-east-1',forcePathStyle:true,credentials:process.env.S3_ACCESS_KEY_ID&&process.env.S3_SECRET_ACCESS_KEY?{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}:undefined});
export async function putFile(key:string,bytes:Buffer,mime:string){if(process.env.S3_BUCKET){await s3().send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:bytes,ContentType:mime}));}else{const path=localPath(key);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx',mode:0o600});}}
export async function getFile(key:string){if(process.env.S3_BUCKET){const result=await s3().send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));if(!result.Body)throw new DomainError(404,'FILE_UNAVAILABLE');return Buffer.from(await result.Body.transformToByteArray());}return readFile(/* turbopackIgnore: true */ localPath(key));}
export async function removeFile(key:string){if(process.env.S3_BUCKET)await s3().send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));else{const{unlink}=await import('node:fs/promises');await unlink(localPath(key));}}
