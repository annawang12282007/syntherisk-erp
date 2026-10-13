import {handle} from '@/lib/http';
import {analytics} from '@/domain/service';
import {exportAnalytics} from '@/lib/analytics-export';
export async function GET(r:Request){return handle(r,async ctx=>{const params=Object.fromEntries(new URL(r.url).searchParams);return params.format?exportAnalytics(ctx,params):analytics(ctx,params);});}
