import {handle,body} from '@/lib/http';
import {auth} from '@/lib/auth';
import {query} from '@/lib/db';
import {DomainError} from '@/lib/context';
import {authMailConfigured} from '@/lib/auth-mail';
import {z} from 'zod';
export async function GET(request:Request){return handle(request,async ctx=>{const user=(await query('SELECT email,"emailVerified" FROM "user" WHERE id=$1',[ctx.userId]))[0];return {...user,mail_configured:authMailConfigured(),must_change_password:ctx.mustChangePassword??false};});}
export async function POST(request:Request){return handle(request,async ctx=>{
 if(ctx.mustChangePassword)throw new DomainError(428,'PASSWORD_CHANGE_REQUIRED');
 if(!authMailConfigured())throw new DomainError(503,'ACCOUNT_MAIL_NOT_CONFIGURED');
 const input=await body(request),session=await auth.api.getSession({headers:request.headers});if(!session)throw new DomainError(401,'SESSION_EXPIRED');
 if(input.action==='verify_email'){await auth.api.sendVerificationEmail({body:{email:session.user.email,callbackURL:'/settings?section=profile'},headers:request.headers});return {sent:true};}
 if(input.action==='change_email'){
  const value=z.object({new_email:z.email(),password:z.string().min(1).max(128)}).parse(input);
  await auth.api.verifyPassword({body:{password:value.password},headers:request.headers});
  await auth.api.changeEmail({body:{newEmail:value.new_email,callbackURL:'/settings?section=profile'},headers:request.headers});return {sent:true};
 }
 throw new DomainError(400,'INVALID_ACTION');
});}
