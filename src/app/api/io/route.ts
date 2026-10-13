import {handle,body} from '@/lib/http';
import {exportRecords,previewImport} from '@/lib/io';
import {DomainError} from '@/lib/context';
import {resources} from '@/domain/registry';
import {commitImport} from '@/domain/service';
export async function GET(r:Request){return handle(r,async ctx=>{const p=new URL(r.url).searchParams;const resource=p.get('resource')??'';if(p.get('template')==='true'){const def=resources[resource];if(!def)throw new DomainError(404,'NOT_FOUND');return new Response('\uFEFF'+def.fields.filter(f=>!f.readonly).map(f=>f.key).join(',')+'\r\n',{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${resource}-template.csv"`}});}const result=await exportRecords(ctx,resource,Object.fromEntries(p),p.get('format')??'csv');return new Response(result.bytes?new Uint8Array(result.bytes):result.content,{headers:{'Content-Type':result.mime,'Content-Disposition':`attachment; filename="${resource}.${result.extension}"`,'Cache-Control':'no-store'}});});}
export async function POST(r:Request){return handle(r,async ctx=>{const data=await body(r);if(data.action==='preview')return previewImport(ctx,data);if(data.action==='commit')return commitImport(ctx,String(data.preview_id??''));throw new DomainError(400,'INVALID_ACTION');});}
