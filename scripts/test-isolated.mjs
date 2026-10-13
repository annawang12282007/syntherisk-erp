import 'dotenv/config';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Client} from 'pg';

// Only this freshly generated database is migrated and removed. Never run the
// business suite against the configured working database.
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required to create an isolated test database.');
const name=`syntherisk_suite_${randomUUID().replaceAll('-','')}`;
const database=new URL(process.env.DATABASE_URL);database.pathname='/'+name;
const root=resolve('work',name),admin=new Client({connectionString:process.env.DATABASE_URL});
const env={...process.env,DATABASE_URL:database.toString(),APP_URL:'http://localhost:3000',
  BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),
  ATTACHMENT_DIR:resolve(root,'attachments'),AUTH_MAIL_MODE:'file-test',AUTH_MAIL_DIR:resolve(root,'mail'),
  AUTH_REQUIRE_EMAIL_VERIFICATION:'false',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',GOOGLE_LOGIN_ENABLED:'false',
  ANTHROPIC_API_KEY:'',ANTHROPIC_WORKSPACE_ID:'',ANTHROPIC_MODEL:'',CLAUDE_MONTHLY_BUDGET_USD:'10',
  SMTP_HOST:'',SMTP_FROM:'',SMTP_USER:'',SMTP_PASSWORD:'',S3_BUCKET:''};
let child,created=false;
const run=args=>new Promise((done,fail)=>{child=spawn(process.execPath,args,{env,windowsHide:true,stdio:'inherit'});child.once('error',fail);child.once('exit',code=>{child=undefined;done(code??1);});});
const stop=()=>child?.kill('SIGTERM');process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
  await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;await mkdir(root,{recursive:true});
  const migrated=await run(['node_modules/prisma/build/index.js','migrate','deploy']);
  if(migrated!==0)process.exitCode=migrated;
  else process.exitCode=await run(['node_modules/vitest/vitest.mjs','run',...process.argv.slice(2)]);
}finally{
  if(created&&/^syntherisk_suite_[a-f0-9]{32}$/.test(name))await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.end();
}
