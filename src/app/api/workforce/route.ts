import {body,handle} from '../../../lib/http';
import {getWorkforce,workforceAction} from '../../../domain/workforce';
export const runtime='nodejs';
export async function GET(request:Request){return handle(request,ctx=>{const q=new URL(request.url).searchParams;return getWorkforce(ctx,{from:q.get('from')??undefined,to:q.get('to')??undefined,view:q.get('view')??undefined});});}
export async function POST(request:Request){return handle(request,async ctx=>workforceAction(ctx,await body(request)));}
