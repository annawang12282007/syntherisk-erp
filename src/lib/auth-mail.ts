import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {SmtpTransport,mailConfig} from '../integrations/mail';
import {DomainError} from './context';

export function authMailConfigured(){return process.env.AUTH_MAIL_MODE==='file-test'?['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.APP_URL??'http://localhost:3000').hostname):Boolean(process.env.SMTP_HOST&&process.env.SMTP_FROM);}
export async function sendAccountMail(email:string,url:string,purpose:'verify'|'reset'|'change-email'){
 if(!authMailConfigured())throw new DomainError(503,'ACCOUNT_MAIL_NOT_CONFIGURED');
 const expected=new URL(process.env.APP_URL??'http://localhost:3000');if(new URL(url).origin!==expected.origin)throw new DomainError(400,'INVALID_ORIGIN');
 const title=purpose==='reset'?'重設密碼':purpose==='change-email'?'確認變更綁定信箱':'驗證電子郵件';
 const message={id:randomUUID(),recipient:email,subject:`Syntherisk · ${title}`,text:`${title}\n\n請使用以下連結完成操作：\n${url}\n\n若您沒有提出此要求，請忽略這封郵件。`};
 if(process.env.AUTH_MAIL_MODE==='file-test'){
  const directory=resolve(/*turbopackIgnore: true*/ process.env.AUTH_MAIL_DIR||'data/auth-mail');await mkdir(directory,{recursive:true});await writeFile(resolve(directory,`${message.id}.json`),JSON.stringify({...message,test_only:true},null,2),{mode:0o600,flag:'wx'});return;
 }
 const config=mailConfig();await new SmtpTransport(config).send({...message,sender:config.from});
}
