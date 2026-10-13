import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
const fixture=JSON.parse(await readFile('work/final-acceptance/runtime.json','utf8'));
if(!/^syntherisk_final_acceptance_[a-f0-9]{32}$/.test(fixture.database))throw new Error('Not an isolated acceptance database.');
const configured=new URL(process.env.DATABASE_URL),target=new URL(fixture.url);
if(configured.pathname===target.pathname||configured.host!==target.host||target.pathname!=='/'+fixture.database)throw new Error('Fixture does not match this local database server.');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try{
 const active=await pool.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1',[fixture.database]);
 if(active.rows[0].count)throw new Error('Stop the acceptance server before cleaning its database.');
 await pool.query(`DROP DATABASE IF EXISTS "${fixture.database}"`);console.log('Isolated acceptance database removed; company database unchanged.');
}finally{await pool.end();}
