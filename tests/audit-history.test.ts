import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {pool} from '../src/lib/db';
import {auditHistoryProjection,auditHistoryJoins} from '../src/domain/audit-history';

let client:PoolClient,workspace:string,actor:string;
beforeEach(async()=>{
 client=await pool.connect();await client.query('BEGIN');workspace=randomUUID();actor=randomUUID();
 await client.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspace,'History transaction fixture']);
 await client.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[actor,'History operator',`${actor}@example.invalid`]);
 await client.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[workspace,actor,['admin','operations']]);
});
afterEach(async()=>{await client.query('ROLLBACK');client.release();});
async function event(user:string|null){return (await client.query("INSERT INTO audit_log(workspace_id,actor_id,resource,action,after_data) VALUES($1,$2,'documents','create',$3) RETURNING id",[workspace,user,{title:'Recorded title'}])).rows[0].id as string;}
async function read(id:string){return (await client.query(`SELECT ${auditHistoryProjection} FROM audit_log a ${auditHistoryJoins} WHERE a.workspace_id=$1 AND a.id=$2`,[workspace,id])).rows[0];}

describe('audit role history in rolled-back PostgreSQL transactions',()=>{
 it('snapshots every writer and preserves event roles after membership changes',async()=>{
  const oldId=await event(actor);await client.query('UPDATE memberships SET roles=$1 WHERE workspace_id=$2 AND user_id=$3',[['reviewer'],workspace,actor]);
  const old=await read(oldId),next=await read(await event(actor));
  expect(old.actor_name).toBe('History operator');expect(old.actor_roles).toEqual(['admin','operations']);expect(old.actor_role_basis).toBe('event');
  expect(next.actor_roles).toEqual(['reviewer']);expect(next.after_data).toEqual({title:'Recorded title'});
 });
 it('marks legacy current roles explicitly and never borrows another workspace membership',async()=>{
  const legacyId=await event(actor);await client.query('UPDATE audit_log SET actor_roles=NULL WHERE id=$1',[legacyId]);
  const second=randomUUID();await client.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[second,'Other workspace']);await client.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[second,actor,['finance']]);
  expect(await read(legacyId)).toMatchObject({actor_role_basis:'current',actor_roles:['admin','operations']});
  await client.query('DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2',[workspace,actor]);
  expect(await read(legacyId)).toMatchObject({actor_role_basis:'unknown',actor_roles:[]});
 });
 it('distinguishes system events from unknown users without guessing permissions',async()=>{
  expect(await read(await event(null))).toMatchObject({actor_role_basis:'system',actor_roles:[],actor_name:null});
  expect(await read(await event(randomUUID()))).toMatchObject({actor_role_basis:'unknown',actor_roles:[],actor_name:null});
 });
});
