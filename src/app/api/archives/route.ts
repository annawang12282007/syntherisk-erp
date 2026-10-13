import {handle,body} from '@/lib/http';
import {retentionAction,retentionList,retentionDependencies} from '@/domain/retention';
export async function GET(request:Request){return handle(request,ctx=>{const p=new URL(request.url).searchParams;return p.get('action')==='dependencies'?retentionDependencies(ctx,p.get('resource')??'',p.get('id')??''):retentionList(ctx,Object.fromEntries(p));});}
export async function POST(request:Request){return handle(request,async ctx=>retentionAction(ctx,await body(request)));}
