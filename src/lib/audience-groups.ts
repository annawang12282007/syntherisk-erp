import {z} from 'zod';
import {pool,transaction,query} from './db';
import {DomainError,type Context} from './context';
import {find,checkVersion,patch,assertOperation,operationAccess,type Row} from '../domain/core';
import {createInTransaction} from '../domain/service';

export type RecipientStatus='ready'|'missing_email'|'invalid_email'|'do_not_contact'|'archived'|'duplicate';
export function recipientStatus(contact:Row,seen:Set<string>):RecipientStatus{
 const email=String(contact.email??'').trim().toLowerCase();
 if(contact.archived)return 'archived';
 if(contact.do_not_contact||contact.contact_preference==='none')return 'do_not_contact';
 if(!email)return 'missing_email';
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))return 'invalid_email';
 if(seen.has(email))return 'duplicate';
 seen.add(email);return 'ready';
}
export async function readAudienceGroup(ctx:Context,id:string){
 const group=await find(pool,ctx,'audience_groups',z.uuid().parse(id));
 if(group.archived)throw new DomainError(409,'RECORD_ARCHIVED');
 let canEdit=false;
 try{await find(pool,ctx,'audience_groups',id,true);await assertOperation(pool,ctx,'audience_groups','edit',group);canEdit=true;}
 catch(e){if(!(e instanceof DomainError&&[403,404].includes(e.status)))throw e;}
 const rows=await query('SELECT * FROM audience_members WHERE workspace_id=$1 AND company_id=$2 AND group_id=$3 AND NOT archived ORDER BY created_at,id LIMIT 501',[ctx.workspaceId,ctx.companyId,id]);
 if(rows.length>500)throw new DomainError(422,'SELECTION_TOO_LARGE');
 const members=[],seen=new Set<string>();let inaccessible=0;
 for(const row of rows){
  try{
   const contact=await find(pool,ctx,'contacts',row.contact_id);
   let canRemove=false;
   if(canEdit)try{await find(pool,ctx,'audience_members',row.id,true);await assertOperation(pool,ctx,'audience_members','archive',row);canRemove=true;}catch(e){if(!(e instanceof DomainError&&[403,404].includes(e.status)))throw e;}
   members.push({id:String(row.id),version:Number(row.version),contact_id:String(contact.id),name:String(contact.name),email:String(contact.email??'').trim().toLowerCase(),status:recipientStatus(contact,seen),can_remove:canRemove});
  }catch(e){if(e instanceof DomainError&&[403,404].includes(e.status)){inaccessible++;continue;}throw e;}
 }
 return {group,members,total:rows.length,inaccessible,can_edit:canEdit,can_add:canEdit&&operationAccess(ctx,'audience_members','create')};
}
const changeInput=z.object({group_id:z.uuid(),version:z.number().int().positive(),add:z.array(z.uuid()).max(100).default([]),remove:z.array(z.object({id:z.uuid(),version:z.number().int().positive()}).strict()).max(100).default([])}).strict();
export async function changeAudienceMembers(ctx:Context,input:unknown){
 const d=changeInput.parse(input);
 await transaction(async c=>{
  const group=await find(c,ctx,'audience_groups',d.group_id,true,true);
  await assertOperation(c,ctx,'audience_groups','edit',group);checkVersion(group,d);
  if(group.archived)throw new DomainError(409,'RECORD_ARCHIVED');
  let changed=false;
  for(const removal of d.remove){
   const row=await find(c,ctx,'audience_members',removal.id,true,true);checkVersion(row,removal);
   if(row.group_id!==group.id||row.archived)throw new DomainError(409,'VERSION_CONFLICT');
   // Removing a membership preserves the contact and the membership audit trail.
   await assertOperation(c,ctx,'audience_members','archive',row);
   await patch(c,ctx,'audience_members',row,{archived:true},'archive');changed=true;
  }
  for(const contactId of new Set(d.add)){
   const contact=await find(c,ctx,'contacts',contactId);
   if(contact.archived)throw new DomainError(409,'RECORD_ARCHIVED');
   if((await c.query('SELECT 1 FROM audience_members WHERE workspace_id=$1 AND group_id=$2 AND contact_id=$3 AND NOT archived',[ctx.workspaceId,group.id,contactId])).rowCount)continue;
   await createInTransaction(c,ctx,'audience_members',{group_id:group.id,contact_id:contactId});changed=true;
  }
  const count=Number((await c.query('SELECT count(*) n FROM audience_members WHERE workspace_id=$1 AND group_id=$2 AND NOT archived',[ctx.workspaceId,group.id])).rows[0].n);
  if(count>500)throw new DomainError(422,'SELECTION_TOO_LARGE');
  if(changed)await patch(c,ctx,'audience_groups',group,{},'update_members');
 });
 return readAudienceGroup(ctx,d.group_id);
}
