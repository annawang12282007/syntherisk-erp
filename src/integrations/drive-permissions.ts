import {DomainError} from '../lib/context';
import {query} from '../lib/db';
import {get} from '../domain/service';
import {type Session,type Data,sharing,remoteId,requireScope,assertDestination,enc,pages} from './workspace-core';
export async function drivePermissionPlan(s:Session,input:Data){
 if(s.row.provider!=='drive')throw new DomainError(422,'INVALID_PROVIDER');requireScope(s,'drive.file','drive');assertDestination(input);
 const id=remoteId(input.file_id),file=await sharing(s,id);
 if(file.isAppAuthorized===false&&!s.tokens.scope.split(' ').includes('https://www.googleapis.com/auth/drive'))throw new DomainError(403,'EXISTING_FILE_MANAGEMENT_AUTHORIZATION_REQUIRED');
 if(!file.capabilities?.canShare||file.mimeType==='application/vnd.google-apps.folder')throw new DomainError(403,'FILE_SHARING_UNAVAILABLE');
 const [member]=await query("SELECT u.email,u.name FROM memberships m JOIN \"user\" u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND NOT(m.roles <@ ARRAY['external']::text[])",[s.ctx.workspaceId,String(input.user_id)]);
 if(!member||!String(member.email).toLowerCase().endsWith('@'+String(s.row.google_email).split('@')[1]))throw new DomainError(422,'COMPANY_RECIPIENT_REQUIRED');
 // Provenance survives selecting the same Google file again or linking another record.
 // Check all known ERP origins, including those established by another connection.
 const sources=await query(`SELECT i.data,i.resource,i.record_id FROM integration_items i WHERE i.workspace_id=$1 AND i.external_id=$2
 UNION ALL SELECT '{}'::jsonb,l.resource,l.record_id FROM integration_item_links l JOIN integration_items i ON i.id=l.item_id WHERE i.workspace_id=$1 AND i.external_id=$2`,[s.ctx.workspaceId,id]);
 for(const item of sources){const source=(item.data as Data).source as Data|undefined;const refs=[{resource:item.resource,id:item.record_id},source];for(const ref of refs){if(ref?.resource&&ref.id){const record=await get(s.ctx,String(ref.resource),String(ref.id));if(record.is_private===true&&String(member.email).toLowerCase()!==String(s.row.google_email).toLowerCase())throw new DomainError(403,'PRIVATE_DESTINATION_REQUIRED');}}}
 const permissions=await pages<Data>(s,`/drive/v3/files/${enc(id)}/permissions?supportsAllDrives=true&fields=permissions(id,type,role,emailAddress,permissionDetails),nextPageToken&pageSize=100`,'permissions');
 const existing=permissions.find(p=>p.type==='user'&&String(p.emailAddress).toLowerCase()===String(member.email).toLowerCase());
 if(existing?.role==='owner'||(existing?.permissionDetails as Data[]??[]).some(p=>p.inherited===true))throw new DomainError(403,'INHERITED_OR_OWNER_PERMISSION');
 const role=String(input.role);if(!['reader','commenter','writer','remove'].includes(role)||role==='remove'&&!existing)throw new DomainError(422,'INVALID_PERMISSION');
 return {file_id:id,file_name:file.name,file_version:file.version,recipient:{email:member.email,name:member.name},role,existing:existing??null,current_permissions:permissions,send_notification:input.send_notification===true,impact:role==='remove'?'Removes this direct Google grant; inherited access may remain.':'Grants access to the Google file and its future changes. ERP record permissions remain separate.'};
}
export async function writeDrivePermission(s:Session,p:Data){
 const existing=p.existing as Data|null,base=`/drive/v3/files/${enc(String(p.file_id))}/permissions`,qs=new URLSearchParams({supportsAllDrives:'true'});
 if(p.role==='remove'){await s.adapter.request(s.tokens,`${base}/${enc(String(existing?.id))}?${qs}`,{method:'DELETE'});return {removed:true};}
 if(existing)return s.adapter.request(s.tokens,`${base}/${enc(String(existing.id))}?${qs}`,{method:'PATCH',body:JSON.stringify({role:p.role})});
 qs.set('sendNotificationEmail',String(p.send_notification===true));return s.adapter.request(s.tokens,`${base}?${qs}`,{method:'POST',body:JSON.stringify({type:'user',role:p.role,emailAddress:(p.recipient as Data).email})});
}
