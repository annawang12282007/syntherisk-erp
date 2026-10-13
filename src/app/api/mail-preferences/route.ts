import {z} from 'zod';
import {handle,body} from '@/lib/http';
import {query} from '@/lib/db';
import {DomainError} from '@/lib/context';
import {isExternal} from '@/domain/core';
export async function GET(r:Request){return handle(r,async ctx=>{if(isExternal(ctx))throw new DomainError(403,'FORBIDDEN');return (await query('SELECT signature,version FROM personal_mail_preferences WHERE workspace_id=$1 AND user_id=$2',[ctx.workspaceId,ctx.userId]))[0]??{signature:'',version:0};});}
export async function POST(r:Request){return handle(r,async ctx=>{if(isExternal(ctx))throw new DomainError(403,'FORBIDDEN');const d=z.object({signature:z.string().max(10000),version:z.number().int().min(0)}).parse(await body(r));const saved=d.version===0?await query('INSERT INTO personal_mail_preferences(workspace_id,user_id,signature) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING signature,version',[ctx.workspaceId,ctx.userId,d.signature]):await query('UPDATE personal_mail_preferences SET signature=$3,version=version+1 WHERE workspace_id=$1 AND user_id=$2 AND version=$4 RETURNING signature,version',[ctx.workspaceId,ctx.userId,d.signature,d.version]);if(!saved.length)throw new DomainError(409,'VERSION_CONFLICT');return saved[0];});}
