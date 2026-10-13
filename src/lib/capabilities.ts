import type {Context} from './context';
import {query} from './db';
import {resources,type ResourceDef} from '../domain/registry';
import {finance,isExternal,operationAccess,permissionScope,scope} from '../domain/core';
import {signatureRequestResources} from '../domain/signature-request-support';

/** Navigation hints only. Every record request still enforces its own authorization. */
export function baseCapabilities(ctx:Context,resource:ResourceDef){
 if(resource.key==='communication_templates')return {read:false,create:false,needsRecordCheck:false};
 const external=isExternal(ctx),custom=permissionScope(ctx,resource.key,'read');
 const financeRead=finance(ctx)||ctx.roles.includes('admin')||['expense_claims','expense_lines','approvals'].includes(resource.key);
 const read=custom?custom!=='none'&&custom!=='granted':!external&&(resource.module!=='finance'||financeRead);
 const create=!external&&!resource.readonly&&!resource.parent&&operationAccess(ctx,resource.key,'create')&&(resource.module!=='settings'||ctx.roles.includes('admin')||finance(ctx));
 return {read,create,needsRecordCheck:custom!=='none'&&!read};
}

export async function resourceCapabilities(ctx:Context){
 const entries=await Promise.all(Object.values(resources).map(async resource=>{
  const base=baseCapabilities(ctx,resource);let read=base.read;
  if(base.needsRecordCheck){const access=scope(ctx,resource.key);const rows=await query<{allowed:boolean}>(`SELECT EXISTS(SELECT 1 FROM ${resource.key} r WHERE ${access.sql} AND NOT r.archived) AS allowed`,access.values);read=Boolean(rows[0]?.allowed);}
  return [resource.key,{...resource,fields:resource.fields.filter(f=>!(resource.module==='communications'&&f.key==='template_id')),signature_requests_supported:signatureRequestResources.includes(resource.key as typeof signatureRequestResources[number]),capabilities:{read,create:base.create,edit:!resource.readonly&&operationAccess(ctx,resource.key,'edit')}}] as const;
 }));
 return Object.fromEntries(entries);
}
