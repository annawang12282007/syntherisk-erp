import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

// Reports setting names only; never interpolate credentials or complete URLs.
export function validateProductionEnvironment(env) {
  const errors=[];
  const configured=name=>Boolean(env[name]&&!/GENERATE_|CHANGEME/.test(env[name]));
  const requireSetting=name=>{if(!configured(name))errors.push(name+': required');};
  let app;
  try { app=new URL(env.APP_URL); } catch { /* checked below */ }
  if(!app||app.protocol!=='https:'||app.username||app.password||app.search||app.hash||app.pathname!=='/'||app.port||!app.hostname.includes('.')||['localhost','127.0.0.1','[::1]'].includes(app.hostname))errors.push('APP_URL: public HTTPS origin required');
  if(!configured('ERP_HOSTNAME')||env.ERP_HOSTNAME!==app?.hostname)errors.push('ERP_HOSTNAME: must match APP_URL');
  requireSetting('BETTER_AUTH_SECRET');
  if(configured('BETTER_AUTH_SECRET')&&env.BETTER_AUTH_SECRET.length<32)errors.push('BETTER_AUTH_SECRET: too short');
  requireSetting('INTEGRATION_ENCRYPTION_KEY');
  if(configured('INTEGRATION_ENCRYPTION_KEY')&&(!/^[A-Za-z0-9+/]{43}=$/.test(env.INTEGRATION_ENCRYPTION_KEY)||Buffer.from(env.INTEGRATION_ENCRYPTION_KEY,'base64').length!==32))errors.push('INTEGRATION_ENCRYPTION_KEY: expected 32-byte base64 key');
  requireSetting('POSTGRES_PASSWORD');
  if(configured('POSTGRES_PASSWORD')&&(!/^[A-Za-z0-9_-]{32,}$/.test(env.POSTGRES_PASSWORD)))errors.push('POSTGRES_PASSWORD: expected at least 32 URL-safe characters');
  let database;
  try { database=new URL(env.DATABASE_URL); } catch { /* checked below */ }
  if(!database||!['postgres:','postgresql:'].includes(database.protocol)||database.hostname!=='db'||database.pathname!=='/syntherisk_erp'||database.username!=='syntherisk_erp'||database.password!==env.POSTGRES_PASSWORD)errors.push('DATABASE_URL: must target the isolated production Compose database');
  if(env.NODE_ENV!=='production')errors.push('NODE_ENV: must be production');
  if(env.INTEGRATION_SANDBOX!=='false')errors.push('INTEGRATION_SANDBOX: must be false');
  if(env.AUTH_MAIL_MODE!=='smtp')errors.push('AUTH_MAIL_MODE: must be smtp');
  if(env.SMTP_HOST){
    requireSetting('SMTP_FROM');
    const implicit=env.SMTP_SECURE==='true'&&env.SMTP_PORT==='465';
    const starttls=env.SMTP_REQUIRE_TLS==='true'&&env.SMTP_SECURE==='false'&&env.SMTP_PORT==='587';
    if(!implicit&&!starttls)errors.push('SMTP: require port 465 with TLS or port 587 with mandatory STARTTLS');
  } else if(env.AUTH_REQUIRE_EMAIL_VERIFICATION==='true') errors.push('SMTP_HOST: required before mandatory email verification');
  if(env.GOOGLE_LOGIN_ENABLED==='true'||env.GOOGLE_CLIENT_ID||env.GOOGLE_CLIENT_SECRET){
    requireSetting('GOOGLE_CLIENT_ID');requireSetting('GOOGLE_CLIENT_SECRET');
    requireSetting('GOOGLE_WORKSPACE_DOMAIN');
    if(!app||env.GOOGLE_INTEGRATION_REDIRECT_URI!==app.origin+'/api/integrations')errors.push('GOOGLE_INTEGRATION_REDIRECT_URI: must match APP_URL callback');
  }
  return errors;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const errors=validateProductionEnvironment(process.env);
  if(errors.length){console.error(JSON.stringify({production_configuration:'rejected',errors}));process.exitCode=1;}
  else console.log(JSON.stringify({production_configuration:'passed',external_services_verified:false}));
}
