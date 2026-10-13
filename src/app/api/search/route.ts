import {handle} from '@/lib/http';
import {search} from '@/domain/service';
export async function GET(r:Request){return handle(r,async ctx=>search(ctx,new URL(r.url).searchParams.get('q')??''));}
