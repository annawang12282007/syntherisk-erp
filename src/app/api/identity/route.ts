import {csrf,body,handle,response,failure} from '@/lib/http';
import {members,invite,acceptInvitation,changeMember,updateCompany} from '@/lib/identity';
import {DomainError} from '@/lib/context';
import {updateAccountName} from '@/lib/team';
export async function GET(request:Request){return handle(request,async ctx=>({members:await members(ctx)}));}
export async function POST(request:Request){
 try{
  csrf(request);const data=await body(request);
  if(data.action==='accept')return response(await acceptInvitation(data,request.headers));
  return handle(request,async ctx=>{
   if(data.action==='profile')return updateAccountName(ctx,data);
   if(data.action==='invite')return invite(ctx,data);
   if(data.action==='disable')return changeMember(ctx,{...data,status:'disabled'});
   if(data.action==='update-member')return changeMember(ctx,data);
   if(data.action==='company')return updateCompany(ctx,data);
   throw new DomainError(400,'INVALID_ACTION');
  });
 }catch(error){return failure(error);}
}
