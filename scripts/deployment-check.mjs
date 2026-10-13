import {existsSync} from 'node:fs';
const envFile=process.argv.find(value=>value.startsWith('--env='))?.slice(6)??'.env';
if(existsSync(envFile))process.loadEnvFile(envFile);
const env=process.env,configured=name=>Boolean(env[name]&&!/GENERATE_|CHANGEME/.test(env[name]));
let url;try{url=new URL(env.APP_URL);}catch{}
const checks={
  application_url:{configured:configured('APP_URL'),production_https:Boolean(url&&url.protocol==='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))},
  database:{configured:configured('DATABASE_URL')},
  auth_secret:{configured:configured('BETTER_AUTH_SECRET')&&env.BETTER_AUTH_SECRET.length>=32},
  integration_key:{configured:configured('INTEGRATION_ENCRYPTION_KEY')&&Buffer.from(env.INTEGRATION_ENCRYPTION_KEY,'base64').length===32},
  google:{configured:['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_INTEGRATION_REDIRECT_URI'].every(configured),login_enabled:env.GOOGLE_LOGIN_ENABLED==='true',member_consent:'requires_each_member_and_shared_resource_verification'},
  account_mail:{configured:['SMTP_HOST','SMTP_FROM'].every(configured),transport_encrypted:env.SMTP_SECURE==='true'||env.SMTP_REQUIRE_TLS==='true',test_capture:env.AUTH_MAIL_MODE==='file-test'},
  email_verification:{required:env.AUTH_REQUIRE_EMAIL_VERIFICATION==='true'},
};
const ready=checks.application_url.production_https&&checks.database.configured&&checks.auth_secret.configured&&checks.integration_key.configured&&checks.google.configured&&checks.account_mail.configured&&checks.account_mail.transport_encrypted&&!checks.account_mail.test_capture&&checks.email_verification.required;
console.log(JSON.stringify({configuration_only:true,external_services_verified:false,ready_for_live_acceptance:ready,checks},null,2));
if(process.argv.includes('--strict')&&!ready)process.exitCode=1;
