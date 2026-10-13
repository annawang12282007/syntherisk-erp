import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {validateProductionEnvironment} from '../scripts/production-preflight.mjs';

function production(){
  const password=randomBytes(32).toString('base64url');
  return {ERP_HOSTNAME:'erp.example.com',APP_URL:'https://erp.example.com',NODE_ENV:'production',INTEGRATION_SANDBOX:'false',AUTH_MAIL_MODE:'smtp',POSTGRES_PASSWORD:password,DATABASE_URL:`postgresql://syntherisk_erp:${password}@db:5432/syntherisk_erp`,BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),GOOGLE_LOGIN_ENABLED:'false',AUTH_REQUIRE_EMAIL_VERIFICATION:'false'};
}

test('fresh production deployment can start before optional Google and SMTP setup',()=>{
  assert.deepEqual(validateProductionEnvironment(production()),[]);
});

test('rejects a local or wrong-domain callback, capture mailbox, and wrong database',()=>{
  for(const change of [{APP_URL:'http://localhost:3000'},{ERP_HOSTNAME:'different.example.com'},{AUTH_MAIL_MODE:'file-test'},{INTEGRATION_SANDBOX:'true'},{DATABASE_URL:'postgresql://syntherisk:secret@127.0.0.1:55432/company'}])assert.ok(validateProductionEnvironment({...production(),...change}).length);
});

test('Google callback must use the production origin, and all client settings must exist',()=>{
  const env={...production(),GOOGLE_LOGIN_ENABLED:'true',GOOGLE_CLIENT_ID:'controlled-fixture',GOOGLE_CLIENT_SECRET:randomBytes(32).toString('base64url'),GOOGLE_WORKSPACE_DOMAIN:'example.com',GOOGLE_INTEGRATION_REDIRECT_URI:'https://erp.example.com/api/integrations'};
  assert.deepEqual(validateProductionEnvironment(env),[]);
  assert.ok(validateProductionEnvironment({...env,GOOGLE_INTEGRATION_REDIRECT_URI:'http://localhost:3000/api/integrations'}).length);
  assert.ok(validateProductionEnvironment({...env,GOOGLE_CLIENT_SECRET:''}).length);
});

test('SMTP must use TLS and mandatory verification requires SMTP configuration',()=>{
  const env={...production(),SMTP_HOST:'smtp.example.com',SMTP_FROM:'admin@example.com',SMTP_PORT:'465',SMTP_SECURE:'true'};
  assert.deepEqual(validateProductionEnvironment(env),[]);
  assert.deepEqual(validateProductionEnvironment({...env,SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_REQUIRE_TLS:'true'}),[]);
  assert.ok(validateProductionEnvironment({...env,SMTP_SECURE:'false'}).length);
  assert.ok(validateProductionEnvironment({...production(),AUTH_REQUIRE_EMAIL_VERIFICATION:'true'}).length);
});

test('invalid keys fail without including any secret in error output',()=>{
  const env={...production(),BETTER_AUTH_SECRET:'private-short-secret',INTEGRATION_ENCRYPTION_KEY:'private-invalid-key',POSTGRES_PASSWORD:'unsafe/password-secret'};
  const errors=validateProductionEnvironment(env);
  assert.ok(errors.length>=3);
  const output=JSON.stringify(errors);
  for(const name of ['BETTER_AUTH_SECRET','INTEGRATION_ENCRYPTION_KEY','POSTGRES_PASSWORD','DATABASE_URL'])assert.ok(!output.includes(env[name]));
});
