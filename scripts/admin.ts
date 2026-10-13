import 'dotenv/config';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {bootstrap} from '../src/lib/identity';
import {pool,query} from '../src/lib/db';

const rl=createInterface({input:stdin,output:stdout});
try{const email=process.env.ADMIN_EMAIL??await rl.question('Administrator email: ');const name=process.env.ADMIN_NAME??await rl.question('Display name: ');const password=process.env.ADMIN_PASSWORD;if(!password)throw new Error('Set ADMIN_PASSWORD for this process only (minimum 12 characters); passwords are never printed.');const workspace=process.env.WORKSPACE_NAME??'Syntherisk';const ctx=await bootstrap({email,name,password,workspace});await query('SELECT ensure_builtin_record_categories($1)',[ctx.workspaceId]);await query('INSERT INTO account_security(user_id,must_change_password) VALUES($1,true)',[ctx.userId]);console.log('Administrator and empty workspace initialized. First sign-in requires a password change.');}finally{rl.close();await pool.end();}

