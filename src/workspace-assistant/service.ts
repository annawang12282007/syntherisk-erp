import {richTextPlain} from '../lib/rich-text';
import {interfaceText} from '../locales/interface-text';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool,query,transaction} from '../lib/db';
import {DomainError,type Context} from '../lib/context';
import {getFile} from '../lib/storage';
import {assertRecordExport} from '../lib/io';
import {resources as domainResources} from '../domain/registry';
import {teamAssistantResources} from './team-resources';
import {isTeamResource,listAssistantTeams,readAssistantTeam,validateTeamPost} from './team-operations';
import {saveBoardPostInTransaction} from '../lib/team-boards';
const resources={...domainResources,...teamAssistantResources};
import {isRetiredResource} from '../domain/retired-features';
import {list,createInTransaction,updateInTransaction,actionInTransaction} from '../domain/service';
import {find,assertOperation,operationAccess,audit,str,type Row,type Client} from '../domain/core';
import {liveContext} from './context';
import {beginUsage,settle} from '../file-assistant/budget';
import {countInput,generate,AssistantProviderError,type GenerationProfile} from '../file-assistant/provider';
import {fileContent} from '../file-assistant/files';
import {workspacePlanSchema,lookupSchema,planningSystem,type WorkspacePlan,type Step} from './schema';
import {personalTopics} from './personal';
type Run={id:string;workspace_id:string;company_id:string;user_id:string;mode:string;instruction:string;supplement:string;locale:string;attempt:number;status:string;plan:unknown;preview:unknown;fingerprint:string;result:unknown;error_code:string|null};
export type OperationPreview=Step&{status:'ready'|'blocked';reason?:string;version?:number;before?:Row;values:Row};
export type WorkspacePreview={summary:string;questions:string[];warnings:string[];operations:OperationPreview[];sources:{resource:string;id:string;version:number;title:string}[]};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const operation=(step:Step)=>step.kind==='create'?'create':step.kind==='update'?'edit':step.action==='refund'?'pay':step.action==='reverse'?'post':['approve','pay','post'].includes(step.action??'')?step.action!:'action:'+step.action;
export function catalog(ctx:Context){return Object.values(resources).filter(r=>!isRetiredResource(r.key)&&operationAccess(ctx,isTeamResource(r.key)?'team_boards':r.key,'read')).map(r=>({resource:r.key,label:r.label,fields:r.fields,states:r.states,create:!r.readonly&&operationAccess(ctx,isTeamResource(r.key)?'team_boards':r.key,'create'),edit:!r.readonly&&operationAccess(ctx,isTeamResource(r.key)?'team_boards':r.key,'edit'),actions:(r.actions??[]).filter(a=>operationAccess(ctx,r.key,operation({kind:'action',action:a} as Step))),action_fields:r.actionFields,signature_actions:r.signatureActions}));}
function values(step:Step){const result:Row={};for(const f of step.fields){if(Object.hasOwn(result,f.key))throw new DomainError(422,'ASSISTANT_INVALID_PLAN');try{result[f.key]=JSON.parse(f.value_json);}catch{throw new DomainError(422,'ASSISTANT_INVALID_PLAN');}}return result;}
export function validateSteps(plan:WorkspacePlan){
 const seen=new Set<string>(),targets=new Set<string>();
 for(const s of plan.operations){const r=resources[s.resource];if(!r||isRetiredResource(s.resource)||seen.has(s.step_id))throw new DomainError(422,'ASSISTANT_INVALID_PLAN');
  if(s.kind==='create'&&r.readonly||s.kind==='update'&&r.readonly||s.kind==='action'&&!r.actions?.includes(s.action??''))throw new DomainError(422,'ASSISTANT_INVALID_PLAN');
  if(s.kind==='create'&&(s.record_id!==null||s.action!==null)||s.kind==='update'&&s.action!==null)throw new DomainError(422,'ASSISTANT_INVALID_PLAN');
  if(s.kind!=='create'){if(!z.uuid().safeParse(s.record_id).success||targets.has(s.resource+':'+s.record_id))throw new DomainError(422,'ASSISTANT_INVALID_PLAN');targets.add(s.resource+':'+s.record_id);}
  const fields=s.kind==='action'?[...(r.actionFields?.[s.action??'']??[]),{key:'target_id',type:'reference',readonly:false,ref:s.resource}]:r.fields;
  for(const [key,value] of Object.entries(values(s))){const f=fields.find(f=>f.key===key);if(!f||f.readonly||['version','id','workspace_id','company_id','created_by','idempotency_key'].includes(key))throw new DomainError(422,'ASSISTANT_INVALID_PLAN');
   if(typeof value==='string'&&value.startsWith('$')){const previous=plan.operations.find(p=>p.step_id===value.slice(1));if(f.type!=='reference'||!seen.has(value.slice(1))||previous?.kind!=='create'||previous.resource!==f.ref)throw new DomainError(422,'ASSISTANT_INVALID_PLAN');}
  }seen.add(s.step_id);
 }
}
function visibleRow(resource:string,row:Row){const keys=new Set(['id','version','status','archived',...resources[resource].fields.map(f=>f.key)]);return Object.fromEntries(Object.entries(row).filter(([k])=>keys.has(k)).map(([k,v])=>[k,typeof v==='string'?richTextPlain(v).slice(0,12000):v]));}
async function paid(run:Run,phase:number,content:Record<string,unknown>[],profile:GenerationProfile){
 await countInput(content,profile);const id=await beginUsage(run.id,run.workspace_id,run.attempt*100+phase);
 try{const result=await generate(content,profile);await settle(id,result);return result.value;}catch(e){await settle(id,null,e instanceof AssistantProviderError?e.uncertain:true);throw e;}
}
export async function previewPlan(ctx:Context,plan:WorkspacePlan,sources:WorkspacePreview['sources'],c:Client=pool):Promise<WorkspacePreview>{
 validateSteps(plan);const operations:OperationPreview[]=[];
 for(const step of plan.operations){const item:OperationPreview={...step,status:'ready',values:values(step)};try{
  if(isTeamResource(step.resource)){if(step.resource!=='team_board_posts')throw new DomainError(403,'FORBIDDEN');let old:Row|undefined;if(step.kind==='update'){const source=sources.find(s=>s.resource===step.resource&&s.id===step.record_id);if(!source)throw new DomainError(422,'ASSISTANT_TARGET_NOT_REVIEWED');old=await readAssistantTeam(ctx,step.resource,step.record_id!,c,true);if(Number(old.version)!==source.version)throw new DomainError(409,'ASSISTANT_RECORD_CHANGED');item.version=Number(old.version);item.before=visibleRow(step.resource,old);}await validateTeamPost(ctx,item.values,c,old);operations.push(item);continue;}
  if(!operationAccess(ctx,step.resource,operation(step)))throw new DomainError(403,'FORBIDDEN');
  if(resources[step.resource].signatureActions?.includes(step.action??''))throw new DomainError(409,'ASSISTANT_SIGNATURE_REQUIRED');
  if(step.kind==='create')await assertOperation(c,ctx,step.resource,'create');
  else{if(!sources.some(s=>s.resource===step.resource&&s.id===step.record_id))throw new DomainError(422,'ASSISTANT_TARGET_NOT_REVIEWED');
   const row=await find(c,ctx,step.resource,step.record_id!,step.kind==='update');await assertRecordExport(ctx,step.resource,step.record_id!);await assertOperation(c,ctx,step.resource,operation(step),row);if(Number(row.version)!==sources.find(s=>s.resource===step.resource&&s.id===step.record_id)?.version)throw new DomainError(409,'ASSISTANT_RECORD_CHANGED');item.version=Number(row.version);item.before=visibleRow(step.resource,row);
  }
 }catch(e){item.status='blocked';item.reason=e instanceof DomainError?e.code:'ASSISTANT_INVALID_PLAN';}operations.push(item);}
 return{summary:plan.summary,questions:plan.questions,warnings:plan.warnings,operations,sources};
}
export async function analyzeWorkspace(workspace:string,id:string,attempt:number){
 const run=(await query<Run>("UPDATE file_assistant_runs SET status='analyzing',updated_at=now() WHERE id=$1 AND workspace_id=$2 AND attempt=$3 AND status='queued' AND deleted_at IS NULL RETURNING *",[id,workspace,attempt]))[0];if(!run)return;
 await query("UPDATE outbox SET locked_until=now()+interval '10 minutes' WHERE workspace_id=$1 AND dedupe_key=$2 AND status='running'",[workspace,'file-assistant:'+id+':'+attempt]);
 try{
  const ctx=await liveContext({workspace_id:workspace,user_id:run.user_id},run.company_id),available=catalog(ctx),files=await query('SELECT * FROM file_assistant_files WHERE run_id=$1 AND deleted_at IS NULL',[id]);
  const content:Record<string,unknown>[]=[{type:'text',text:JSON.stringify({instruction:run.instruction,supplement:run.supplement,language:run.locale,user_id:ctx.userId,now:new Date().toISOString(),catalog:available})}];
  for(const file of files){const bytes=await getFile(str(file.storage_key));if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new DomainError(409,'ASSISTANT_SOURCE_CHANGED');content.push(...await fileContent({bytes,filename:str(file.filename),mime:str(file.mime_type)},str(file.id)));}
  const daily=(await query('SELECT 1 FROM assistant_daily_reports WHERE run_id=$1',[id])).length>0;
  const settings=daily?(await query('SELECT * FROM assistant_personal_settings WHERE workspace_id=$1 AND user_id=$2',[workspace,run.user_id]))[0]:null;
  if(daily&&!settings?.daily_enabled){await query("UPDATE file_assistant_runs SET status='cancelled' WHERE id=$1",[id]);await query("UPDATE assistant_daily_reports SET status='cancelled' WHERE run_id=$1",[id]);return;}
  const lookup=daily?{questions:[],queries:(settings!.topics as (keyof typeof personalTopics)[]).map(topic=>({resource:personalTopics[topic],filters:[{key:'dashboard',value_json:JSON.stringify(topic)},{key:'scope',value_json:'"mine"'}]}))}:lookupSchema.parse(await paid(run,1,content,{system:planningSystem+' First choose only the relevant searches needed for this task. Return resource and filters as JSON values. Supported filters include q,status,owner_id,reference/select fields,due_date_from,due_date_to,start_date,end_date,archived. Use user_id for personal ownership. Do not assume a search result exists. At most 8 searches. Ask for clarification when ambiguous.',schema:lookupSchema}));
  const rows:Row[]=[],sources:WorkspacePreview['sources']=[],warnings:string[]=[];
  for(const search of lookup.queries){if(!available.some(r=>r.resource===search.resource))continue;const filter:Row={pageSize:30};for(const f of search.filters){const allowed=['q','status','owner_id','due_date_from','due_date_to','start_date','end_date','archived',...(daily?['dashboard','scope']:[]),...resources[search.resource].fields.filter(f=>['reference','select','boolean'].includes(f.type)).map(f=>f.key)];if(!allowed.includes(f.key))throw new DomainError(422,'ASSISTANT_INVALID_PLAN');filter[f.key]=JSON.parse(f.value_json);}
   const result=isTeamResource(search.resource)?await listAssistantTeams(ctx,search.resource,filter):await list(ctx,search.resource,filter);if(result.total>result.rows.length)warnings.push(interfaceText(run.locale,'搜索结果未全部加载；批量操作前请缩小筛选范围。','Search results are limited; narrow the filters for a complete bulk operation.'));
   for(const row of result.rows){try{if(isTeamResource(search.resource))await readAssistantTeam(ctx,search.resource,str(row.id));else await assertRecordExport(ctx,search.resource,str(row.id));}catch{continue;}if(sources.some(s=>s.resource===search.resource&&s.id===row.id))continue;rows.push({resource:search.resource,...visibleRow(search.resource,row)});sources.push({resource:search.resource,id:str(row.id),version:Number(row.version),title:str(row[resources[search.resource].titleField])});}
  }
  const memberRows=lookup.queries.length?(await list(ctx,'members')).rows.map(row=>({id:row.id,name:row.name})):[];
  content.push({type:'text',text:JSON.stringify({records:rows,members:memberRows,search_questions:lookup.questions,limits:warnings,currencies:await query('SELECT code,minor_digits FROM currencies WHERE workspace_id=$1 AND company_id=$2 AND NOT archived',[ctx.workspaceId,ctx.companyId])})});
  const plan=workspacePlanSchema.parse(await paid(run,2,content,{system:planningSystem+(daily?' This is an opted-in scheduled personal daily report. Return no operations.':''),schema:workspacePlanSchema}));
  if(daily&&plan.operations.length)throw new DomainError(422,'ASSISTANT_INVALID_PLAN');
  plan.warnings=[...new Set([...plan.warnings,...warnings])].slice(0,20);
  const current=await liveContext({workspace_id:workspace,user_id:run.user_id},run.company_id);
  for(const source of sources){if(isTeamResource(source.resource))await readAssistantTeam(current,source.resource,source.id);else{await find(pool,current,source.resource,source.id);await assertRecordExport(current,source.resource,source.id);}}
  const preview=await previewPlan(current,plan,sources);
  await query("UPDATE file_assistant_runs SET status=$2,plan=$3,preview=$4,fingerprint=$5,updated_at=now(),version=version+1 WHERE id=$1 AND status='analyzing'",[id,plan.questions.length?'needs_input':plan.operations.length?'review':'completed',JSON.stringify(plan),JSON.stringify(preview),hash(preview)]);
  await query("UPDATE assistant_daily_reports SET status='completed' WHERE run_id=$1",[id]);
 }catch(error){await query("UPDATE file_assistant_runs SET status='failed',error_code=$2,updated_at=now() WHERE id=$1 AND status='analyzing'",[id,error instanceof DomainError?error.code:'ASSISTANT_ANALYSIS_FAILED']);await query("UPDATE assistant_daily_reports SET status='failed' WHERE run_id=$1",[id]);}
}
async function owner(ctx:Context,id:string,c:Client=pool){const run=(await c.query("SELECT * FROM file_assistant_runs WHERE workspace_id=$1 AND company_id=$2 AND user_id=$3 AND id=$4 AND deleted_at IS NULL",[ctx.workspaceId,ctx.companyId,ctx.userId,z.uuid().parse(id)])).rows[0] as Run|undefined;if(!run)throw new DomainError(404,'NOT_FOUND');return run;}
export async function workspaceDetail(ctx:Context,id:string){
 const run=await owner(ctx,id);const preview=run.preview as WorkspacePreview|null;
 for(const source of preview?.sources??[]){if(isTeamResource(source.resource))await readAssistantTeam(ctx,source.resource,source.id);else{await find(pool,ctx,source.resource,source.id);await assertRecordExport(ctx,source.resource,source.id);}}
 return{...run,files:await query<{id:string;filename:string;mime_type:string;byte_size:number}>('SELECT id,filename,mime_type,byte_size FROM file_assistant_files WHERE run_id=$1 AND deleted_at IS NULL',[id]),steps:await query('SELECT step_id,status,result,error_code FROM assistant_operation_results WHERE run_id=$1 ORDER BY created_at',[id])};
}
export async function reviseWorkspace(ctx:Context,id:string,input:Row){
 const run=await owner(ctx,id),patch=z.object({fingerprint:z.string().length(64),changes:z.array(z.object({step_id:z.string(),fields:z.array(z.object({key:z.string(),value_json:z.string().max(20000)})).max(60)})).max(50)}).parse(input);
 if(run.status!=='review'||run.fingerprint!==patch.fingerprint)throw new DomainError(409,'ASSISTANT_PREVIEW_CHANGED');
 if((await query('SELECT 1 FROM assistant_operation_results WHERE run_id=$1',[id])).length)throw new DomainError(409,'ASSISTANT_PREVIEW_CHANGED');
 const plan=workspacePlanSchema.parse(run.plan);for(const change of patch.changes){const step=plan.operations.find(s=>s.step_id===change.step_id);if(!step)throw new DomainError(422,'ASSISTANT_INVALID_SELECTION');step.fields=change.fields;}
 const preview=await previewPlan(ctx,plan,(run.preview as WorkspacePreview).sources),fingerprint=hash(preview);
 const saved=await query("UPDATE file_assistant_runs SET plan=$2,preview=$3,fingerprint=$4,version=version+1 WHERE id=$1 AND fingerprint=$5 AND status='review' AND NOT EXISTS(SELECT 1 FROM assistant_operation_results WHERE run_id=$1) RETURNING id",[id,JSON.stringify(plan),JSON.stringify(preview),fingerprint,patch.fingerprint]);if(!saved.length)throw new DomainError(409,'ASSISTANT_PREVIEW_CHANGED');
 return workspaceDetail(ctx,id);
}
export async function confirmWorkspace(ctx:Context,id:string,input:Row){
 const request=z.object({fingerprint:z.string().length(64),selected:z.array(z.string()).min(1).max(50)}).parse(input),run=await owner(ctx,id);
 if(run.status==='completed')return workspaceDetail(ctx,id);
 if(run.status!=='review'||run.fingerprint!==request.fingerprint)throw new DomainError(409,'ASSISTANT_PREVIEW_CHANGED');
 const plan=workspacePlanSchema.parse(run.plan),preview=run.preview as WorkspacePreview;validateSteps(plan);
 if(plan.questions.length||new Set(request.selected).size!==request.selected.length||request.selected.some(s=>!plan.operations.some(p=>p.step_id===s)))throw new DomainError(422,'ASSISTANT_INVALID_SELECTION');
 for(const step of plan.operations.filter(s=>request.selected.includes(s.step_id))){
  try{await transaction(async c=>{
   const locked=(await c.query('SELECT status,fingerprint FROM file_assistant_runs WHERE id=$1 FOR UPDATE',[id])).rows[0];if(locked.status!=='review'||locked.fingerprint!==request.fingerprint)throw new DomainError(409,'ASSISTANT_PREVIEW_CHANGED');
   const prior=(await c.query("SELECT 1 FROM assistant_operation_results WHERE run_id=$1 AND step_id=$2 AND status='completed'",[id,step.step_id])).rows[0];if(prior)return;
   const current=await liveContext({workspace_id:ctx.workspaceId,user_id:ctx.userId},ctx.companyId,c),item=preview.operations.find(p=>p.step_id===step.step_id)!;if(item.status!=='ready')throw new DomainError(403,item.reason??'FORBIDDEN');
   const data=values(step);for(const [key,v] of Object.entries(data))if(typeof v==='string'&&v.startsWith('$')){const previous=(await c.query("SELECT result FROM assistant_operation_results WHERE run_id=$1 AND step_id=$2 AND status='completed'",[id,v.slice(1)])).rows[0];if(!previous?.result?.id)throw new DomainError(409,'ASSISTANT_DEPENDENCY_REQUIRED');data[key]=previous.result.id;}
   if(step.kind!=='create'){const row=isTeamResource(step.resource)?await readAssistantTeam(current,step.resource,step.record_id!,c,true):await find(c,current,step.resource,step.record_id!,step.kind==='update',true);if(!isTeamResource(step.resource))await assertRecordExport(current,step.resource,step.record_id!);if(Number(row.version)!==item.version)throw new DomainError(409,'ASSISTANT_RECORD_CHANGED');data.version=item.version;}
   let teamValues:Row|undefined;if(step.resource==='team_board_posts'){const old=step.record_id?await readAssistantTeam(current,step.resource,step.record_id,c,true):undefined;teamValues=await validateTeamPost(current,data,c,old);}
   const result=teamValues?await saveBoardPostInTransaction(c,current,teamValues):step.kind==='create'?await createInTransaction(c,current,step.resource,data):step.kind==='update'?await updateInTransaction(c,current,step.resource,step.record_id!,data):await actionInTransaction(c,current,step.resource,step.record_id!,step.action!,{...data,idempotency_key:'assistant:'+id+':'+step.step_id});
   const receipt={id:result.id,resource:result._resource??step.resource,title:step.title};
   await c.query("INSERT INTO assistant_operation_results(run_id,step_id,status,result) VALUES($1,$2,'completed',$3) ON CONFLICT(run_id,step_id) DO UPDATE SET status='completed',result=excluded.result,error_code=NULL",[id,step.step_id,JSON.stringify(receipt)]);
   await audit(c,current,'file_assistant',id,'execute_step',null,{step_id:step.step_id,resource:step.resource,kind:step.kind,record_id:result.id});
  });}catch(e){await query("INSERT INTO assistant_operation_results(run_id,step_id,status,error_code) VALUES($1,$2,'failed',$3) ON CONFLICT(run_id,step_id) DO UPDATE SET error_code=excluded.error_code WHERE assistant_operation_results.status<>'completed'",[id,step.step_id,e instanceof DomainError?e.code:'ASSISTANT_OPERATION_FAILED']);}
 }
 const results=await query('SELECT * FROM assistant_operation_results WHERE run_id=$1',[id]);if(request.selected.every(key=>results.some(r=>r.step_id===key&&r.status==='completed')))await query("UPDATE file_assistant_runs SET status='completed',result=$2,updated_at=now() WHERE id=$1 AND status='review'",[id,JSON.stringify({records:results.map(r=>r.result).filter(Boolean),count:results.filter(r=>r.status==='completed').length})]);
 return workspaceDetail(ctx,id);
}
