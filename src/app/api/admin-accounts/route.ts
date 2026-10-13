import {handle,body} from '@/lib/http';
import {createManagedAccount,invitationList,revokeInvitation} from '@/lib/admin-accounts';
export async function GET(request:Request){return handle(request,async ctx=>({invitations:await invitationList(ctx)}));}
export async function POST(request:Request){return handle(request,async ctx=>{const input=await body(request);return input.action==='revoke_invitation'?revokeInvitation(ctx,String(input.id)):createManagedAccount(ctx,input);});}
