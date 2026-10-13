import {handle,body} from '@/lib/http';
import {announcementList,announcementAction} from '@/domain/announcements';
export async function GET(request:Request){return handle(request,ctx=>announcementList(ctx,new URL(request.url).searchParams.get('archived')==='true'));}
export async function POST(request:Request){return handle(request,async ctx=>announcementAction(ctx,await body(request)));}
