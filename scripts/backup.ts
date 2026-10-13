import 'dotenv/config';
import {backup} from '../src/lib/backup';
import {pool} from '../src/lib/db';
const dest=process.argv[2]??`backups/${new Date().toISOString().replace(/[:.]/g,'-')}`;
try{const result=await backup(dest);console.log(JSON.stringify({destination:dest,counts:result.counts,attachments:Object.keys(result.files).length}));}finally{await pool.end();}
