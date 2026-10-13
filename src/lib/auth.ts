import { betterAuth } from 'better-auth';
import { pool,query } from './db';
import {sendAccountMail} from './auth-mail';
import {APIError} from 'better-auth/api';
import {googleWorkspaceDomain,googleIdentityMatches} from './google-workspace';
export async function googleAccountAllowed(profile?:{email?:unknown;email_verified?:unknown;hd?:unknown}){
 const email=typeof profile?.email==='string'?profile.email.toLowerCase():undefined;
 if(!email||profile?.email_verified!==true||typeof profile.hd!=='string'||!googleIdentityMatches({email,domain:profile.hd},email))throw new APIError('FORBIDDEN',{message:'GOOGLE_ACCOUNT_MISMATCH'});
 const [invited]=await query('SELECT u.id FROM "user" u JOIN memberships m ON m.user_id=u.id WHERE lower(u.email)=$1 AND m.status=\'active\' LIMIT 1',[email]);
 if(!invited)throw new APIError('FORBIDDEN',{message:'INVITED_ACCOUNT_REQUIRED'});
 return {email,emailVerified:true};
}
const appURL=process.env.APP_URL??'http://localhost:3000';
export function validateAuthOrigin(url:string,environment=process.env.NODE_ENV){const parsed=new URL(url);if(environment==='production'&&parsed.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))throw new Error('HTTPS_REQUIRED_FOR_PRODUCTION');}
validateAuthOrigin(appURL);
export const auth=betterAuth({
  appName:'Syntherisk',baseURL:appURL,secret:process.env.BETTER_AUTH_SECRET,database:pool,
  trustedOrigins:[appURL],emailAndPassword:{enabled:true,minPasswordLength:12,maxPasswordLength:128,autoSignIn:false,requireEmailVerification:process.env.AUTH_REQUIRE_EMAIL_VERIFICATION==='true',revokeSessionsOnPasswordReset:true,sendResetPassword:async({user,url})=>sendAccountMail(user.email,url,'reset'),onPasswordReset:async({user})=>{await query('UPDATE account_security SET must_change_password=false,password_changed_at=now() WHERE user_id=$1',[user.id]);}},
  emailVerification:{sendVerificationEmail:async({user,url})=>sendAccountMail(user.email,url,'verify'),expiresIn:3600},
  user:{validateUserInfo:async({user,source})=>{if(source.oauth?.providerId==='google'){await googleAccountAllowed(source.oauth.profile);if(user.id){const [bound]=await query('SELECT email FROM "user" WHERE id=$1',[user.id]);if(bound&&String(bound.email).toLowerCase()!==String(user.email).toLowerCase())return {error:'GOOGLE_ACCOUNT_MISMATCH'};}}},changeEmail:{enabled:true,updateEmailWithoutVerification:false,sendChangeEmailConfirmation:async({user,url})=>sendAccountMail(user.email,url,'change-email')}},
  session:{expiresIn:60*60*24*7,updateAge:60*60*12,cookieCache:{enabled:false}},
  rateLimit:{enabled:true,window:60,max:60,storage:'database',customRules:{'/sign-in/email':{window:60,max:8},'/request-password-reset':{window:300,max:3},'/send-verification-email':{window:300,max:3},'/change-email':{window:300,max:3},'/change-password':{window:300,max:5}}},
  // Only the verified company Google identity may claim a pre-provisioned account.
  // SMTP verification can be unavailable during setup; googleAccountAllowed is the gate.
  account:{encryptOAuthTokens:true,accountLinking:{enabled:true,trustedProviders:['google'],requireLocalEmailVerified:false,allowDifferentEmails:false}},
  advanced:{useSecureCookies:appURL.startsWith('https://'),defaultCookieAttributes:{httpOnly:true,sameSite:'lax',secure:appURL.startsWith('https://')}},
  socialProviders:process.env.GOOGLE_LOGIN_ENABLED==='true'&&process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&googleWorkspaceDomain()?{google:{clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,disableSignUp:true,hd:googleWorkspaceDomain(),includeGrantedScopes:false,mapProfileToUser:googleAccountAllowed}}:{},
});
