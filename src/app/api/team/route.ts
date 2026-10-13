import {body,handle} from '@/lib/http';
import {teamDirectory,updateTeamProfile} from '@/lib/team';
export async function GET(request:Request){return handle(request,teamDirectory);}
export async function PATCH(request:Request){return handle(request,async ctx=>updateTeamProfile(ctx,await body(request)));}
