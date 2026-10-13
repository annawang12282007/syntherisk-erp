import 'dotenv/config';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {Pool} from 'pg';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import type {Context} from '../src/lib/context';
vi.mock('../src/lib/auth',()=>({auth:{api:{getSession:vi.fn(),signUpEmail:vi.fn()}}}));
const original=process.env.DATABASE_URL,name='syntherisk_accounts_'+randomUUID().replaceAll('-','');
const workspaceId=randomUUID(),companyId=randomUUID();
const actor=(roles:string[]):Context=>({workspaceId,companyId,userId:randomUUID(),roles});
const root=actor(['admin']),operator=actor(['admin','operations']),peer=actor(['admin','operations']),admin=actor(['admin']),adminPeer=actor(['admin']),member=actor(['member']);
let db:typeof import('../src/lib/db'),identity:typeof import('../src/lib/identity'),team:typeof import('../src/lib/team'),organization:typeof import('../src/lib/organization'),accounts:typeof import('../src/lib/admin-accounts'),control:Pool;
beforeAll(async()=>{
 control=new Pool({connectionString:original});await control.query(`CREATE DATABASE "${name}"`);const url=new URL(original!);url.pathname='/'+name;process.env.DATABASE_URL=url.toString();
 db=await import('../src/lib/db');identity=await import('../src/lib/identity');team=await import('../src/lib/team');organization=await import('../src/lib/organization');accounts=await import('../src/lib/admin-accounts');
 for(const folder of (await readdir('prisma/migrations')).filter(n=>/^\d/.test(n)).sort())await db.query(await readFile('prisma/migrations/'+folder+'/migration.sql','utf8'));
 await db.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,'Account boundary test']);await db.query('INSERT INTO companies(id,workspace_id) VALUES($1,$2)',[companyId,workspaceId]);
 for(const ctx of [root,operator,peer,admin,adminPeer,member]){await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[ctx.userId,ctx===root?'Hidden initial account':ctx.userId,ctx.userId+'@example.invalid']);await db.query('INSERT INTO memberships(workspace_id,user_id,roles) VALUES($1,$2,$3)',[workspaceId,ctx.userId,ctx.roles]);}
 await db.query('UPDATE workspaces SET initial_admin_user_id=$2 WHERE id=$1',[workspaceId,root.userId]);
},90000);
afterAll(async()=>{if(db)await db.pool.end();process.env.DATABASE_URL=original;if(control){await control.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await control.end();}});
it('hides the initial account from non-root directory and account responses',async()=>{
 for(const ctx of [operator,peer,admin,member]){
  expect(JSON.stringify(await identity.members(ctx))).not.toContain(root.userId);
  expect(JSON.stringify(await team.teamDirectory(ctx))).not.toContain(root.userId);
  expect(JSON.stringify(await organization.organization(ctx))).not.toContain(root.userId);
 }
 expect((await identity.members(root)).some(m=>m.user_id===root.userId)).toBe(true);
});
it('rejects known root IDs, peer edits, lower-to-higher edits and self elevation',async()=>{
 for(const [ctx,target] of [[operator,root],[operator,peer],[admin,adminPeer],[admin,operator],[operator,operator]] as const){
  await expect(identity.changeMember(ctx,{user_id:target.userId,status:'disabled'})).rejects.toMatchObject({status:target===root?404:403});
  if(target!==ctx)await expect(team.updateTeamProfile(ctx,{user_id:target.userId,version:0,work_phone:'tamper'})).rejects.toMatchObject({status:target===root?404:403});
 }
 await expect(identity.changeMember(admin,{user_id:member.userId,roles:['admin']})).rejects.toMatchObject({status:403});
 await expect(identity.changeMember(operator,{user_id:member.userId,roles:['operations']})).rejects.toMatchObject({status:403});
 expect((await db.query("SELECT count(*)::int n FROM memberships WHERE status='disabled'"))[0].n).toBe(0);
});
it('reports usable controls and still permits lower-account management and personal edits',async()=>{
 const list=await identity.members(operator);
 expect(list.find(m=>m.user_id===peer.userId)).toMatchObject({can_edit:false,can_disable:false});
 expect(list.find(m=>m.user_id===admin.userId)).toMatchObject({can_edit:true,can_disable:true});
 const directory=await team.teamDirectory(operator);expect(directory.members.find(m=>m.user_id===peer.userId)).toMatchObject({can_edit:false,can_edit_private:false});
 expect(await team.updateTeamProfile(operator,{user_id:operator.userId,version:0,work_phone:'555-0100'})).toMatchObject({can_edit:true});
 await identity.changeMember(operator,{user_id:admin.userId,status:'disabled'});await identity.changeMember(root,{user_id:admin.userId,status:'active'});
 await identity.changeMember(root,{user_id:member.userId,roles:['member','reviewer']});
});
it('blocks invite and create routes from granting a peer rank or replacing existing memberships',async()=>{
 await expect(identity.invite(admin,{email:'new@example.invalid',roles:['admin']})).rejects.toMatchObject({status:403});
 await expect(accounts.createManagedAccount(admin,{email:'new@example.invalid',name:'New',roles:['admin']})).rejects.toMatchObject({status:403});
 await expect(identity.invite(operator,{email:root.userId+'@example.invalid',roles:['member']})).rejects.toMatchObject({code:'ACCOUNT_ALREADY_EXISTS'});
 const token='controlled-invitation-token-'+randomUUID();
 await db.query("INSERT INTO invitations(workspace_id,email,roles,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')",[workspaceId,peer.userId+'@example.invalid',['member'],createHash('sha256').update(token).digest('hex'),operator.userId]);
 const {auth}=await import('../src/lib/auth');vi.mocked(auth.api.getSession).mockResolvedValue({user:{id:peer.userId}} as never);
 await expect(identity.acceptInvitation({token,name:'Peer'},new Headers())).rejects.toMatchObject({code:'ACCOUNT_ALREADY_EXISTS'});
 expect((await db.query('SELECT roles FROM memberships WHERE user_id=$1',[peer.userId]))[0].roles).toEqual(peer.roles);
});
it('rechecks the actor role from the database instead of trusting a stale request context',async()=>{
 await db.query('UPDATE memberships SET roles=$2 WHERE user_id=$1',[admin.userId,['member']]);
 await expect(identity.changeMember(admin,{user_id:member.userId,status:'disabled'})).rejects.toMatchObject({status:403});
});
