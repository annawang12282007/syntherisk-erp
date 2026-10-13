import {handle,body} from '@/lib/http';
import {getRecordOrganization,updateRecordOrganization} from '@/domain/record-organization';
export async function GET(request:Request){return handle(request,async ctx=>{const params=new URL(request.url).searchParams;return getRecordOrganization(ctx,params.get('resource')??undefined,params.get('id')??undefined);});}
export async function POST(request:Request){return handle(request,async ctx=>updateRecordOrganization(ctx,await body(request)));}
