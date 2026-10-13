import {handle} from '@/lib/http';
import {dashboard} from '@/domain/service';
export async function GET(r:Request){return handle(r,async ctx=>dashboard(ctx,new URL(r.url).searchParams.get('scope')??'mine'));}
