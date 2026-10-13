import {handle} from '@/lib/http';
import {query} from '@/lib/db';
import {elevated,fail} from '@/domain/core';
export async function GET(request:Request){return handle(request,async ctx=>{
 if(!elevated(ctx))fail('record_visibility_manager_required',403);
 const search=new URL(request.url).searchParams.get('q')?.slice(0,120)??'';
 const rows=await query('SELECT id,name FROM company_teams WHERE workspace_id=$1 AND name ILIKE $2 ORDER BY name,id LIMIT 200',[ctx.workspaceId,`%${search}%`]);
 return {rows};
});}
