import {handle} from '@/lib/http';
import {uuid} from '@/domain/core';
import {printRecord} from '@/lib/print';
import {printTable} from '@/lib/record-print';
export async function GET(request:Request){return handle(request,async ctx=>{const params=new URL(request.url).searchParams;return params.get('mode')==='table'?printTable(ctx,params.get('resource')??'',Object.fromEntries(params)):printRecord(ctx,params.get('resource')??'',uuid(params.get('id')));});}
