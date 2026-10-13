import type {APIRequestContext,APIResponse} from '@playwright/test';
import {setTimeout as delay} from 'node:timers/promises';

export async function waitForSignInRetry(header:string|null|undefined):Promise<void>{
 const seconds=header==null?Number.NaN:Number(header);
 const dateDelay=header==null?Number.NaN:Date.parse(header)-Date.now();
 const requested=Number.isFinite(seconds)?seconds*1000:Number.isFinite(dateDelay)?dateDelay:60_000;
 await delay(Math.min(60_000,Math.max(0,requested))+250);
}

/** Keep the application's persistent login limiter active during acceptance tests. */
export async function signIn(request:APIRequestContext,credentials:{email:string;password:string}):Promise<APIResponse>{
 const send=()=>request.post('/api/auth/sign-in/email',{data:{email:credentials.email,password:credentials.password}});
 const response=await send();
 if(response.status()!==429)return response;
 const header=response.headers()['retry-after'];
 await response.dispose();
 await waitForSignInRetry(header);
 // The caller must still assert 200; a second 429 or any other error fails normally.
 return send();
}
