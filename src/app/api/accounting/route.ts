import {handle,body} from '@/lib/http';
import {accountingSettings,configureAccounting,previewAccounting,financeOverview} from '@/domain/accounting';
export async function GET(request:Request){return handle(request,ctx=>new URL(request.url).searchParams.has('settings')?accountingSettings(ctx):financeOverview(ctx));}
export async function POST(request:Request){return handle(request,async ctx=>{const data=await body(request);return data.action==='preview'?previewAccounting(ctx,data):configureAccounting(ctx,data);});}
