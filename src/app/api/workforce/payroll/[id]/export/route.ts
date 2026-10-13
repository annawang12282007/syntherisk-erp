import {handle} from '../../../../../../lib/http';
import {exportWorkforcePayroll} from '../../../../../../domain/workforce';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return handle(request,async ctx=>new Response(await exportWorkforcePayroll(ctx,(await params).id),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="gross-pay.csv"'}}));}
