import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
if(!existsSync('.env')){const password=randomBytes(24).toString('hex');writeFileSync('.env',`NODE_ENV=development\nAPP_URL=http://localhost:3030\nPORT=3030\nDATABASE_URL=postgresql://syntherisk_erp:${password}@127.0.0.1:55434/syntherisk_erp\nBETTER_AUTH_SECRET=${randomBytes(48).toString('base64url')}\nINTEGRATION_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\nATTACHMENT_DIR=./data/attachments\n`,{mode:0o600,flag:'wx'});console.log('Created private .env with random development credentials.');}else console.log('Existing .env preserved.');
mkdirSync(resolve('data/attachments'),{recursive:true});
console.log('Next: pnpm db:start (keep running), pnpm db:migrate, pnpm admin, pnpm dev; run pnpm worker in another terminal.');

