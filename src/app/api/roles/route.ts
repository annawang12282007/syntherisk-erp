import {handle,body} from '@/lib/http';
import {roleCatalog,saveRole} from '@/lib/roles';
export async function GET(request:Request){return handle(request,roleCatalog);}
export async function POST(request:Request){return handle(request,async ctx=>saveRole(ctx,await body(request)));}
