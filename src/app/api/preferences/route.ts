import {handle,body} from '@/lib/http';
import {readPreferences,savePreferences} from '@/lib/preferences';
export async function GET(r:Request){return handle(r,readPreferences);}
export async function PUT(r:Request){return handle(r,async ctx=>savePreferences(ctx,await body(r)));}
export async function POST(r:Request){return handle(r,async ctx=>{const b=await body(r);return savePreferences(ctx,b.preferences,b.action==='publish-default');});}
