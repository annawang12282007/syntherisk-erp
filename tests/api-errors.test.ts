import {it,expect,vi} from 'vitest';
import {api,errorMessage} from '../src/components/api';
import {translate} from '../src/locales';
it('makes plain rate-limit responses and Better Auth top-level errors actionable',async()=>{
 const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('Too many attempts',{status:429})).mockResolvedValueOnce(Response.json({code:'INVALID_EMAIL_OR_PASSWORD',message:'Invalid credentials'},{status:401}));vi.stubGlobal('fetch',transport);
 const t=(key:string)=>translate('zh-TW',key);
 try{for(const expected of ['一分鐘','信箱或密碼不正確']){let message='';try{await api('/api/auth/sign-in/email');}catch(error){message=errorMessage(error,t);}expect(message).toContain(expected);}}finally{vi.unstubAllGlobals();}
});
