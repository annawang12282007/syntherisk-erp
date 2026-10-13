import {handle,body} from '@/lib/http';
import {personalOverview,savePersonal} from '@/workspace-assistant/personal';
export async function GET(r:Request){return handle(r,personalOverview);}
export async function POST(r:Request){return handle(r,async ctx=>savePersonal(ctx,await body(r)));}
