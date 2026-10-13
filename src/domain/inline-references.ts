import {z} from 'zod';
import {type Client,type Row,def,fail,str} from './core';
import type {Context} from '../lib/context';
import {supportsPrivacy} from './privacy-resources';
const inputSchema=z.record(z.string(),z.object({text:z.string().trim().max(300),create:z.boolean().default(false)}).strict());
type CreateLinked=(resource:string,data:Row)=>Promise<Row>;
export function optionalInlineReferences(resource:string){return def(resource).fields.filter(field=>field.type==='reference'&&!field.required&&!field.readonly&&['projects','meetings'].includes(str(field.ref)));}
/** Resolve explicit inline choices in the same transaction as their enclosing record. */
export async function prepareInlineReferences(_c:Client,ctx:Context,resource:string,data:Row,createLinked:CreateLinked,existing?:Row){
 if(Object.hasOwn(data,'reference_notes'))fail('readonly_or_unknown_field');
 const cleaned={...data};delete cleaned.reference_inputs;
 const fields=optionalInlineReferences(resource);if(!fields.length){if(Object.hasOwn(data,'reference_inputs'))fail('inline_reference_unsupported');return {data:cleaned,notes:undefined};}
 const supplied=Object.hasOwn(data,'reference_inputs'),inputs=supplied?inputSchema.parse(data.reference_inputs):{};
 if(Object.keys(inputs).some(key=>!fields.some(field=>field.key===key)))fail('inline_reference_unsupported');
 const notes={...((existing?.reference_notes??{}) as Record<string,string>)};let changed=false;
 for(const field of [...fields].sort((a,b)=>Number(a.ref==='meetings')-Number(b.ref==='meetings'))){
  if(Object.hasOwn(cleaned,field.key)){delete notes[field.key];changed=true;}
  const choice=inputs[field.key];if(!choice)continue;changed=true;
  if(cleaned[field.key])fail('inline_reference_conflict');
  cleaned[field.key]=null;delete notes[field.key];
  if(!choice.text){if(choice.create)fail('required_field');continue;}
  if(!choice.create){notes[field.key]=choice.text;continue;}
  const source={...existing,...cleaned};const privacy=supportsPrivacy(resource)?{visibility:source.visibility??'team',viewer_user_ids:source.viewer_user_ids??[],viewer_team_ids:source.viewer_team_ids??[],is_private:source.is_private??false}:{};
  // An inherited private mode must belong to the creator of both records.
  if(privacy.is_private&&existing&&existing.created_by!==ctx.userId)fail('private_creator_required',403);
  const meetingProject=field.ref==='meetings'?(source.project_id?{project_id:source.project_id}:notes.project_id?{reference_inputs:{project_id:{text:notes.project_id,create:false}}}:{}):{};
  const linked=await createLinked(str(field.ref),{[field.ref==='projects'?'name':'title']:choice.text,...privacy,...meetingProject});
  cleaned[field.key]=linked.id;
 }
 return {data:cleaned,notes:changed?notes:undefined};
}
