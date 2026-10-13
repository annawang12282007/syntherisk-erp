import {handle} from '@/lib/http';
import {resourceCapabilities} from '@/lib/capabilities';
export async function GET(r:Request){return handle(r,async ctx=>({resources:await resourceCapabilities(ctx)}));}
