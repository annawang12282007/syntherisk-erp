import {handle,body} from '@/lib/http';
import {DomainError} from '@/lib/context';
import {budgetStatus,budgetAdministration,saveBudgetPolicy,requestExtra,reviewExtra,unresolvedUsage,reconcileUsage} from '@/file-assistant/budget';
export async function GET(request:Request){return handle(request,async ctx=>new URL(request.url).searchParams.has('manage')?{...await budgetAdministration(ctx),unresolved:await unresolvedUsage(ctx)}:budgetStatus(ctx));}
export async function POST(request:Request){return handle(request,async ctx=>{const data=await body(request);if(data.action==='policy')return saveBudgetPolicy(ctx,data);if(data.action==='request')return requestExtra(ctx,data);if(data.action==='review')return reviewExtra(ctx,data);if(data.action==='reconcile')return reconcileUsage(ctx,data);throw new DomainError(422,'INVALID_ACTION');});}
