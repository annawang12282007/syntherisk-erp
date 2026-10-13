import {existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if(existsSync('.env.compose'))throw new Error('Existing .env.compose preserved. Edit it explicitly if needed.');
const password=randomBytes(24).toString('hex'),image=`syntherisk-erp:install-${randomBytes(8).toString('hex')}`;
writeFileSync('.env.compose',`NODE_ENV=production\nAPP_URL=http://localhost:3030\nERP_PORT=3030\nERP_IMAGE=${image}\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://syntherisk_erp:${password}@db:5432/syntherisk_erp\nBETTER_AUTH_SECRET=${randomBytes(48).toString('base64url')}\nINTEGRATION_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\nATTACHMENT_DIR=/app/data/attachments\nGOOGLE_LOGIN_ENABLED=false\nSMTP_HOST=\nSMTP_PORT=1025\nSMTP_FROM=\nSMTP_SECURE=false\nSMTP_REQUIRE_TLS=false\n`,{mode:0o600,flag:'wx'});
console.log('Created private .env.compose. Start: docker compose --env-file .env.compose up --build -d');
