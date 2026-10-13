import {handle} from '@/lib/http';
import {handleIntegration} from '@/integrations/service';
export async function GET(r:Request){return handle(r,ctx=>handleIntegration(ctx,r));}
export async function POST(r:Request){return handle(r,ctx=>handleIntegration(ctx,r));}
