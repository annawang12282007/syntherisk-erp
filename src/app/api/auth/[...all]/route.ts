import {query} from '@/lib/db';
import {csrf,failure} from '@/lib/http';
import {auth} from '@/lib/auth';
export const dynamic='force-dynamic';
async function route(request:Request){const path=new URL(request.url).pathname;if(['/sign-up/email','/change-email','/update-user','/delete-user','/set-password'].some(endpoint=>path.endsWith(endpoint)))return Response.json({error:{code:'INVITATION_REQUIRED',message:'INVITATION_REQUIRED'}},{status:403});try{csrf(request);const passwordChange=path.endsWith('/change-password')&&request.method==='POST';const session=passwordChange?await auth.api.getSession({headers:request.headers}):null;if(passwordChange){const input=await request.clone().json();if(input.currentPassword===input.newPassword)return Response.json({error:{code:'PASSWORD_MUST_DIFFER'}},{status:400});}const response=await auth.handler(request);if(passwordChange&&response.ok&&session)await query('UPDATE account_security SET must_change_password=false,password_changed_at=now() WHERE user_id=$1',[session.user.id]);return response;}catch(error){return failure(error);}}
export {route as GET,route as POST};
