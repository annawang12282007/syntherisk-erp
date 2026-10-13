import {richString} from './rich-text-schema';
import {isRichText} from './rich-text';
import {withoutMailLayout} from '../domain/retired-features';
import {z} from 'zod';
import {query,transaction} from './db';
import {DomainError,type Context} from './context';
import {isExternal} from '../domain/core';
import {validateRoles} from './roles';
export const companyFields={name:['公司名稱','Company name'],legal_name:['英文法律名稱','Legal name'],legal_name_fr:['法文法律名稱','French legal name'],address:['公司地址','Company address'],registration_number:['公司編號','Corporation number'],tax_number:['稅務編號','Tax number'],incorporation_date:['成立日期','Incorporation date'],jurisdiction:['註冊管轄區','Jurisdiction'],tax_information:['稅務資訊','Tax information'],shareholders:['股東資訊','Shareholder information'],directors:['董事資訊','Director information'],annual_return:['年度申報資訊','Annual return information'],company_notes:['公司備註','Company notes'],logo_width:['LOGO 寬度（px）','Logo width (px)']} as const;
type Field=keyof typeof companyFields;type Grant={read_users?:string[];edit_users?:string[];read_roles?:string[];edit_roles?:string[]};type Policy=Partial<Record<Field,Grant>>;
const baseFields=['name','legal_name','address','registration_number','tax_number'];
export async function initialAdministrator(ctx:Context){const [row]=await query('SELECT initial_admin_user_id FROM workspaces WHERE id=$1',[ctx.workspaceId]);return row?.initial_admin_user_id===ctx.userId;}
export async function companyInformation(ctx:Context){
 if(isExternal(ctx))throw new DomainError(403,'FORBIDDEN');
 const [company]=await query('SELECT * FROM companies WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,ctx.companyId]);
 const [info]=await query('SELECT * FROM company_information WHERE workspace_id=$1 AND company_id=$2',[ctx.workspaceId,ctx.companyId]);
 const root=await initialAdministrator(ctx),policy=(info?.policy??{}) as Policy,fields={...company,...(info?.fields as Record<string,unknown>??{})};
 const allowed=(grant:Grant|undefined,operation:'read'|'edit')=>root||Boolean(grant?.[`${operation}_users`]?.includes(ctx.userId)||grant?.[`${operation}_roles`]?.some(role=>ctx.roles.includes(role)));
 return {version:info?.version??0,can_manage_access:root,fields:Object.entries(companyFields).filter(([key])=>allowed(policy[key as Field],'read')||allowed(policy[key as Field],'edit')).map(([key,label])=>({key,label,value:fields[key]??'',can_edit:allowed(policy[key as Field],'edit')})),...(root?{policy:withoutMailLayout(policy)}: {})};
}
const grant=z.object({read_users:z.array(z.string().min(1)).max(200).default([]),edit_users:z.array(z.string().min(1)).max(200).default([]),read_roles:z.array(z.string().min(1)).max(50).default([]),edit_roles:z.array(z.string().min(1)).max(50).default([])}).strict();
export async function saveCompanyInformation(ctx:Context,input:unknown){
 const data=z.object({version:z.number().int().min(0),fields:z.record(z.string(),richString(20000)).default({}),policy:z.record(z.string(),grant).optional()}).strict().parse(input);
 if(Object.entries(data.fields).some(([key,value])=>isRichText(value)&&!['shareholders','directors','tax_information','company_notes','annual_return'].includes(key)))throw new DomainError(422,'INVALID_COMPANY_FIELD');
 const current=await companyInformation(ctx),allowed=new Map(current.fields.map(f=>[f.key,f.can_edit]));
 for(const key of [...Object.keys(data.fields),...Object.keys(data.policy??{})])if(!Object.hasOwn(companyFields,key))throw new DomainError(422,'INVALID_COMPANY_FIELD');
 if(Object.keys(data.fields).some(key=>!allowed.get(key))||data.policy&&!current.can_manage_access)throw new DomainError(403,'FORBIDDEN');
 if(data.fields.logo_width!==undefined&&(!/^\d+$/.test(data.fields.logo_width)||Number(data.fields.logo_width)<80||Number(data.fields.logo_width)>400))throw new DomainError(422,'INVALID_IMAGE_WIDTH');
 if(data.fields.incorporation_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.fields.incorporation_date)||new Date(data.fields.incorporation_date+'T00:00:00Z').toJSON()?.slice(0,10)!==data.fields.incorporation_date))throw new DomainError(422,'invalid_date');
 if(data.fields.name!==undefined&&!data.fields.name.trim())throw new DomainError(422,'VALIDATION_ERROR');
 await transaction(async c=>{
  await c.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[ctx.workspaceId]);
  const [row]=(await c.query('SELECT * FROM company_information WHERE company_id=$1 AND workspace_id=$2 FOR UPDATE',[ctx.companyId,ctx.workspaceId])).rows;
  if(Number(row?.version??0)!==data.version)throw new DomainError(409,'VERSION_CONFLICT');
  const [workspace]=(await c.query('SELECT initial_admin_user_id FROM workspaces WHERE id=$1',[ctx.workspaceId])).rows;
  if(workspace.initial_admin_user_id!==ctx.userId){const policy=(row?.policy??{}) as Policy;if(data.policy||Object.keys(data.fields).some(key=>!policy[key as Field]?.edit_users?.includes(ctx.userId)&&!policy[key as Field]?.edit_roles?.some(role=>ctx.roles.includes(role))))throw new DomainError(403,'FORBIDDEN');}
  if(data.policy){const users=[...new Set(Object.values(data.policy).flatMap(p=>[...p.read_users,...p.edit_users]))];if(users.length&&(await c.query("SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::text[]) AND status='active'",[ctx.workspaceId,users])).rowCount!==users.length)throw new DomainError(422,'invalid_member');const roles=[...new Set(Object.values(data.policy).flatMap(p=>[...p.read_roles,...p.edit_roles]))];if(roles.length)await validateRoles(ctx.workspaceId,roles);}
  const fields={...row?.fields,...data.fields};await c.query('INSERT INTO company_information(workspace_id,company_id,fields,policy,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(company_id) DO UPDATE SET fields=$3,policy=$4,version=company_information.version+1,updated_by=$5,updated_at=now()',[ctx.workspaceId,ctx.companyId,JSON.stringify(fields),JSON.stringify(data.policy??row?.policy??{}),ctx.userId]);
  const changed=Object.keys(data.fields).filter(key=>baseFields.includes(key));if(changed.length)await c.query(`UPDATE companies SET ${changed.map((key,i)=>`${key}=$${i+3}`).join(',')},version=version+1,updated_at=now() WHERE id=$1 AND workspace_id=$2`,[ctx.companyId,ctx.workspaceId,...changed.map(key=>data.fields[key])]);
  await c.query("INSERT INTO audit_log(workspace_id,actor_id,resource,record_id,action,after_data) VALUES($1,$2,'company_information',$3,'update',$4)",[ctx.workspaceId,ctx.userId,ctx.companyId,JSON.stringify({fields:Object.keys(data.fields),access_changed:Boolean(data.policy)})]);
 });return companyInformation(ctx);
}
