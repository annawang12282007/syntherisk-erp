import {z} from 'zod';
import {query,transaction} from './db';
import {DomainError,type Context} from './context';
import {isExternal} from '../domain/core';
export async function mailIdentities(ctx:Context){
 if(isExternal(ctx))throw new DomainError(403,'FORBIDDEN');
 const identities=await query(`SELECT id,label,display_name,signature,version,active FROM mail_identities WHERE workspace_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY version DESC`,[ctx.workspaceId,ctx.userId]);
 const [profile]=await query(`SELECT u.name,p.work_phone,p.job_title,e.employee_number,c.name company_name,COALESCE((SELECT string_agg(DISTINCT d.name,'、') FROM employee_assignments a JOIN department_jobs j ON j.id=a.job_id JOIN departments d ON d.id=j.department_id WHERE a.workspace_id=$1 AND a.user_id=$2 AND j.active AND d.active),'') departments FROM "user" u JOIN companies c ON c.id=$3 LEFT JOIN team_profiles p ON p.workspace_id=$1 AND p.user_id=u.id LEFT JOIN employee_numbers e ON e.workspace_id=$1 AND e.user_id=u.id WHERE u.id=$2`,[ctx.workspaceId,ctx.userId,ctx.companyId]);
 const [gmail]=await query(`SELECT google_email FROM integration_connections WHERE workspace_id=$1 AND user_id=$2 AND provider='gmail' AND status='connected' ORDER BY updated_at DESC LIMIT 1`,[ctx.workspaceId,ctx.userId]);
 const [preference]=await query(`SELECT signature FROM personal_mail_preferences WHERE workspace_id=$1 AND user_id=$2`,[ctx.workspaceId,ctx.userId]);const active=identities.find(i=>i.active);
 return {identities,variables:{user_name:String(active?.display_name||profile?.name||''),user_mail:String(gmail?.google_email||''),user_signature:String(active?.signature||preference?.signature||''),user_employee_id:String(profile?.employee_number||''),user_job_title:String(profile?.job_title||''),user_department:String(profile?.departments||''),user_phone:String(profile?.work_phone||''),company_name:String(profile?.company_name||'')}};
}
export async function saveMailIdentity(ctx:Context,input:Record<string,unknown>){
 if(isExternal(ctx))throw new DomainError(403,'FORBIDDEN');
 return transaction(async c=>{
 await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[ctx.workspaceId+':mail-identity:'+ctx.userId]);
 if(input.action==='save'){
 const d=z.object({label:z.string().trim().min(1).max(80),display_name:z.string().trim().min(1).max(120).refine(v=>!/[\x00-\x1f\x7f<>]/.test(v)),signature:z.string().max(10000).default('')}).parse(input);
 const [{version}]=(await c.query(`SELECT COALESCE(max(version),0)+1 version FROM mail_identities WHERE workspace_id=$1 AND user_id=$2`,[ctx.workspaceId,ctx.userId])).rows;
 await c.query(`UPDATE mail_identities SET active=false WHERE workspace_id=$1 AND user_id=$2`,[ctx.workspaceId,ctx.userId]);
 return (await c.query(`INSERT INTO mail_identities(workspace_id,user_id,label,display_name,signature,version,active) VALUES($1,$2,$3,$4,$5,$6,true) RETURNING id`,[ctx.workspaceId,ctx.userId,d.label,d.display_name,d.signature,version])).rows[0];
 }
 const id=z.uuid().parse(input.id),[row]=(await c.query(`SELECT id FROM mail_identities WHERE workspace_id=$1 AND user_id=$2 AND id=$3 AND deleted_at IS NULL FOR UPDATE`,[ctx.workspaceId,ctx.userId,id])).rows;if(!row)throw new DomainError(404,'NOT_FOUND');
 if(input.action==='activate'){await c.query(`UPDATE mail_identities SET active=false WHERE workspace_id=$1 AND user_id=$2`,[ctx.workspaceId,ctx.userId]);await c.query(`UPDATE mail_identities SET active=true WHERE id=$1`,[id]);}
 else if(input.action==='delete'){await c.query(`UPDATE mail_identities SET active=false,deleted_at=now() WHERE id=$1`,[id]);await c.query(`UPDATE mail_identities SET active=true WHERE id=(SELECT id FROM mail_identities WHERE workspace_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY version DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM mail_identities WHERE workspace_id=$1 AND user_id=$2 AND active)`,[ctx.workspaceId,ctx.userId]);}
 else throw new DomainError(422,'INVALID_ACTION');return {saved:true};
 });
}
