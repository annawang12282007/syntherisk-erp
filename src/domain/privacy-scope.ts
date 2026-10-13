import type {Context} from '../lib/context';
import {resources} from './registry';
import {supportsPrivacy} from './privacy-resources';
import {recordVisibilityPredicate} from './task-visibility';
import {delegatedPredicate} from './delegation-scope';
import {scope} from './core';

const bridges=['handoffs','work_requests','reviews','delegations'];
const uuidPattern="^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
/** Traverse actual record IDs once, including workflow bridges and document sources.
 * UNION deduplicates cycles. Each node uses the existing read scope with only this
 * graph expansion disabled internally; financial role ceilings remain identical.
 * SQL identifiers come solely from the registry. Client data cannot set skip mode.
 */
export function privacyGraphPredicate(ctx:Context,resourceExpression:string,idExpression:string,allowGrants=true,requireRole=true){
 const edges:string[]=[],readers:string[]=[],constant=/^'([a-z_]+)'$/.exec(resourceExpression)?.[1],reachable=new Set<string>();
 const dynamic=(resource:string)=>['tasks','events','documents',...bridges].includes(resource);
 const refFields=(resource:string)=>['finance','procurement','settings'].includes(resources[resource].module)?[]:resources[resource].fields.filter(field=>field.ref&&resources[field.ref]);
 const visit=(resource:string)=>{if(reachable.has(resource)||!resources[resource])return;reachable.add(resource);for(const field of refFields(resource))visit(field.ref!);if(dynamic(resource))for(const possible of Object.keys(resources))visit(possible);};
 if(constant)visit(constant);else for(const resource of Object.keys(resources))visit(resource);
 for(const resource of reachable){
  const refs=refFields(resource).map(field=>`('${field.ref}'::text,p.${field.key}::uuid,${['project_id','pipeline_id','stage_id'].includes(field.key)?'false':'true'})`);
  const pair=resource==='documents'?['related_resource','related_id']:['tasks','events'].includes(resource)?['source_resource','source_id']:bridges.includes(resource)?['target_resource','target_id']:undefined;
  if(pair){const [kind,id]=pair;const standalone=resource==='events'?`(p.${kind} IS NULL OR p.${kind} IN ('manual','google_calendar')) AND p.${id} IS NULL`:`p.${kind} IS NULL AND p.${id} IS NULL`;refs.push(`(CASE WHEN ${standalone} THEN NULL WHEN p.${kind} IS NULL OR NOT COALESCE(p.${id}::text ~* '${uuidPattern}',false) THEN '__invalid__' ELSE p.${kind} END,CASE WHEN ${standalone} THEN NULL WHEN p.${id}::text ~* '${uuidPattern}' THEN p.${id}::uuid ELSE p.id END,true)`);}
  if(refs.length)edges.push(`SELECT edge.resource,edge.id,edge.require_role FROM ${resource} p CROSS JOIN LATERAL(VALUES ${refs.join(',')}) edge(resource,id,require_role) WHERE node.resource='${resource}' AND p.id=node.id AND p.workspace_id=$1 AND p.company_id=$2`);
  if(resource==='documents')edges.push("SELECT source.resource,source.record_id,true FROM cloud_export_sources source JOIN documents d ON d.id=source.document_id WHERE node.resource='documents' AND d.id=node.id AND d.workspace_id=$1 AND d.company_id=$2");
  const access=scope(ctx,resource,'p',false,allowGrants,undefined,true),grant=allowGrants?`(EXISTS(SELECT 1 FROM record_grants g WHERE g.workspace_id=$1 AND g.resource='${resource}' AND g.record_id=p.id AND g.user_id=$3) OR ${delegatedPredicate(resource,'p')})`:'false',privacy=supportsPrivacy(resource)?recordVisibilityPredicate(ctx,resource,'p',grant):'true';
  readers.push(`SELECT ((NOT node.require_role OR (${access.sql})) AND ${privacy}) AS allowed FROM ${resource} p WHERE node.resource='${resource}' AND p.id=node.id AND p.workspace_id=$1 AND p.company_id=$2`);
 }
 const traversal=edges.length?` UNION SELECT edge.resource,edge.id,edge.require_role FROM privacy_walk node CROSS JOIN LATERAL(${edges.join(' UNION ALL ')}) edge WHERE edge.id IS NOT NULL`:'';
 return `NOT EXISTS(WITH RECURSIVE privacy_walk(resource,id,require_role) AS(SELECT (${resourceExpression})::text,(${idExpression})::uuid,${requireRole?'true':'false'}${traversal}) SELECT 1 FROM privacy_walk node LEFT JOIN LATERAL(${readers.join(' UNION ALL ')}) reader ON true WHERE reader.allowed IS DISTINCT FROM true)`;
}
