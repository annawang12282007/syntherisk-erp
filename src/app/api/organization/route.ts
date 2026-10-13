import {handle,body} from '@/lib/http';import {organization,saveOrganization} from '@/lib/organization';
import {departmentImpact,permissionSources} from '@/lib/organization-lifecycle';
export async function GET(r:Request){return handle(r,async ctx=>{const p=new URL(r.url).searchParams;if(p.has('impact')){const {assignments,...visible}=await departmentImpact(ctx,p.get('impact')!);void assignments;return visible;}if(p.has('member'))return permissionSources(ctx,p.get('member')!);return organization(ctx);});}
export async function POST(r:Request){return handle(r,async ctx=>saveOrganization(ctx,await body(r)));}
