import 'dotenv/config';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
// Explicitly create a separate empty database. Never seed or modify the source database.
const path=resolve('.env'),source=await readFile(path,'utf8');
if(source.includes('INTEGRATION_SANDBOX=true'))throw new Error('Sandbox already prepared');
const name='syntherisk_integration_'+randomUUID().replaceAll('-','');
const url=new URL(process.env.DATABASE_URL),admin=new Client({connectionString:url.toString()});
await admin.connect();
try{await admin.query(`CREATE DATABASE "${name}"`);}finally{await admin.end();}
url.pathname='/'+name;
await mkdir('work',{recursive:true});
await writeFile('work/previous-private.env',source,{mode:0o600});
let updated=source.replace(/^DATABASE_URL=.*$/m,'DATABASE_URL='+JSON.stringify(url.toString()));
updated=updated.replace(/^ATTACHMENT_DIR=.*$/m,'ATTACHMENT_DIR='+JSON.stringify(resolve('work/attachments')));
updated=updated.replace(/^AUTH_MAIL_DIR=.*$/m,'AUTH_MAIL_DIR='+JSON.stringify(resolve('work/mail')));
updated=updated.replace(/^AUTH_REQUIRE_EMAIL_VERIFICATION=.*$/m,'AUTH_REQUIRE_EMAIL_VERIFICATION=false');
updated+='\nINTEGRATION_SANDBOX=true\n';
await writeFile(path,updated,{mode:0o600});
console.log('Isolated integration database prepared; no seed performed.');
