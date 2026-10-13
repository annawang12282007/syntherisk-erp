import {handle,body} from '@/lib/http';
import {readAudienceGroup,changeAudienceMembers} from '@/lib/audience-groups';
export async function GET(r:Request){return handle(r,ctx=>readAudienceGroup(ctx,new URL(r.url).searchParams.get('id')??''));}
export async function POST(r:Request){return handle(r,async ctx=>changeAudienceMembers(ctx,await body(r)));}
