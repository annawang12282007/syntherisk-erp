import 'dotenv/config';
import {restore} from '../src/lib/backup';
import {pool} from '../src/lib/db';
if(!process.argv[2]||!process.env.RESTORE_DATABASE_URL||!process.env.RESTORE_ATTACHMENT_DIR)throw new Error('Usage: set RESTORE_DATABASE_URL and RESTORE_ATTACHMENT_DIR to an isolated, migrated empty target, then pnpm restore <backup-directory>.');
try{console.log(await restore(process.argv[2],process.env.RESTORE_DATABASE_URL,process.env.RESTORE_ATTACHMENT_DIR));}finally{await pool.end();}
