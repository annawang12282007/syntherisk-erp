import {handle,body} from '@/lib/http';
import {DomainError} from '@/lib/context';
import {fiscalSettings,saveFiscalSettings,previewFiscalPeriods,generateFiscalPeriods} from '@/domain/fiscal-settings';
export async function GET(request:Request){return handle(request,ctx=>{const year=new URL(request.url).searchParams.get('year');return year===null?fiscalSettings(ctx):previewFiscalPeriods(ctx,Number(year));});}
export async function POST(request:Request){return handle(request,async ctx=>{const {action,...data}=await body(request);if(action==='generate')return generateFiscalPeriods(ctx,data);if(action==='save')return saveFiscalSettings(ctx,data);throw new DomainError(422,'invalid_value');});}
