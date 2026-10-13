import type {Context} from '../lib/context';
import {DomainError} from '../lib/context';
import {type Client,type Row,def,find,str} from './core';
import {recordsConfirmationNote,confirmationOpinionKeys} from './confirmation-policy';
import {parseConfirmationNote} from './task-completion';
import {isRichText} from '../lib/rich-text';

export function confirmationNoteInput(resource:string,action:string,data:Row){
 if(!recordsConfirmationNote(resource,action))return null;
 const existing=def(resource).actionFields?.[action]?.find(field=>confirmationOpinionKeys.includes(field.key));
 if(existing){
  const value=data[existing.key];
  return typeof value==='string'&&value.trim()?{body:value.trim(),format:isRichText(value)?'rich':'plain'}:null;
 }
 const body=parseConfirmationNote(data.confirmation_note);
 return body?{body,format:'plain'}:null;
}

export async function saveConfirmationNote(c:Client,ctx:Context,resource:string,row:Row,result:Row,action:string,note:ReturnType<typeof confirmationNoteInput>){
 if(!note)return;
 const target=row.target_resource&&row.target_id?{resource:str(row.target_resource),id:row.target_id}
  :row.task_id?{resource:'tasks',id:row.task_id}:row.document_id?{resource:'documents',id:row.document_id}:null;
 await c.query(`INSERT INTO record_confirmation_notes(workspace_id,company_id,resource,record_id,record_version,action,actor_id,actor_name,body,format,target_resource,target_id)
  SELECT $1,$2,$3,$4,$5,$6,$7,u.name,$8,$9,$10,$11 FROM "user" u WHERE u.id=$7`,
 [ctx.workspaceId,ctx.companyId,resource,row.id,result.version,action,ctx.userId,note.body,note.format,target?.resource??null,target?.id??null]);
}

/** A linked note is visible only while both its source and target are readable. */
export async function enrichConfirmationNotes(c:Client,ctx:Context,resource:string,row:Row){
 const notes=(await c.query(`SELECT id,resource,record_id,record_version,action,actor_name,body,format,created_at
  FROM record_confirmation_notes WHERE workspace_id=$1 AND company_id=$2
  AND ((resource=$3 AND record_id=$4) OR (target_resource=$3 AND target_id=$4))
  ORDER BY created_at DESC,id DESC`,[ctx.workspaceId,ctx.companyId,resource,row.id])).rows as Row[];
 const access=new Map<string,boolean>();
 row.confirmation_notes=[];
 for(const note of notes){
  const source=`${note.resource}:${note.record_id}`;
  if(!access.has(source)){
   try{await find(c,ctx,str(note.resource),note.record_id);access.set(source,true);}
   catch(error){if(!(error instanceof DomainError&&[403,404].includes(error.status)))throw error;access.set(source,false);}
  }
  if(access.get(source))(row.confirmation_notes as Row[]).push(note);
 }
 return row;
}
