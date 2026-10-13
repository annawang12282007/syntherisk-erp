import {handle} from '../../../../../lib/http';
import {getWorkforcePayroll} from '../../../../../domain/workforce';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return handle(request,async ctx=>getWorkforcePayroll(ctx,(await params).id));}
