import {handle} from '@/lib/http';
import {requireRole} from '@/lib/context';
import {visibleAuditHistory} from '@/domain/audit-history';
export async function GET(r:Request){return handle(r,async ctx=>{requireRole(ctx,'admin');const p=new URL(r.url).searchParams;const requestedPage=Number(p.get('page')??1);const page=Number.isSafeInteger(requestedPage)&&requestedPage>0?Math.min(requestedPage,100000):1;const rows=await visibleAuditHistory(ctx,p.get('resource')||null,page);return{rows,page,pageSize:100};});}
