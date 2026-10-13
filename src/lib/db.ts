import 'dotenv/config';
import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
// PostgreSQL DATE is a calendar date, never a host-local instant.
types.setTypeParser(1082,value=>value);
const globalDb=globalThis as unknown as {syntheriskPool?:Pool};
export const pool=globalDb.syntheriskPool??new Pool({connectionString:process.env.DATABASE_URL,max:12,connectionTimeoutMillis:10000,statement_timeout:30000});
// pg emits idle socket failures on the pool. Log only the code, never the
// connection object (which includes credentials), and allow later reconnects.
if(!pool.listenerCount('error'))pool.on('error',error=>console.error('Database idle connection closed',{code:(error as {code?:string}).code}));
if(process.env.NODE_ENV!=='production')globalDb.syntheriskPool=pool;
export async function query<T extends QueryResultRow=Record<string,unknown>>(text:string,values?:unknown[]):Promise<T[]>{return (await pool.query<T>(text,values)).rows;}
export async function transaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
