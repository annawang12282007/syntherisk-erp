import {handle,body} from '@/lib/http';import {mailIdentities,saveMailIdentity} from '@/lib/mail-identities';
export async function GET(r:Request){return handle(r,mailIdentities);}export async function POST(r:Request){return handle(r,async ctx=>saveMailIdentity(ctx,await body(r)));}
