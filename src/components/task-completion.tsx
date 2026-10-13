'use client';
import {useState} from 'react';
import {useApp} from './context';
import {post,errorMessage} from './api';
import {Button,ErrorBanner} from './primitives';
import {ConfirmationNoteField,ConfirmationTimestamp} from './confirmation-notes';
import MultiMemberPicker from './multi-member-picker';
import type {Row} from './types';
import styles from './confirmation-notes.module.css';

type Person={id:string;name:string;active?:boolean;revision?:number;confirmed_at?:string|null;confirmation_note?:string|null};
export function TaskCompletionFields({data,disabled,onChange}:{data:Record<string,unknown>;disabled:boolean;onChange:(data:Record<string,unknown>)=>void}){
 const {t}=useApp();const enabled=data.completion_required===true;
 return <fieldset className="full-field"><legend>{t('taskCompletion')}</legend><label><input type="checkbox" checked={enabled} disabled={disabled} onChange={event=>onChange({completion_required:event.target.checked,completion_user_ids:event.target.checked?data.completion_user_ids||[]:[]})}/>{t('taskRequireCompletion')}</label>{enabled&&<><p className="field-help">{t('taskCompletionHint')}</p><MultiMemberPicker id="task-completion-members" disabled={disabled} selection={{ids:data.completion_user_ids as string[]||[],people:data.completion_people as Person[]||[],onChange:ids=>onChange({completion_user_ids:ids})}}/></>}</fieldset>;
}
export function TaskCompletionPanel({row,onSaved}:{row:Row;onSaved:(row:Row)=>void}){
 const {me}=useApp();
 return <TaskCompletionContent key={`${row.id}:${row.completion_revision}:${row.version}:${me.user.id}`} row={row} onSaved={onSaved}/>;
}

function ConfirmationPerson({person,history=false}:{person:Person;history?:boolean}){
 const {t}=useApp();
 return <li>
  <div className={styles.metadata}>
   <strong>{person.name}</strong><span>{t(person.confirmed_at?'taskConfirmed':'taskAwaitingConfirmation')}</span>
   {history&&<small>{t('taskConfirmationRound')} {person.revision}</small>}
   {person.active===false&&<small>{t('responsibilityInactive')}</small>}
   {person.confirmed_at&&<small><ConfirmationTimestamp value={person.confirmed_at}/></small>}
  </div>
  {person.confirmed_at&&person.confirmation_note&&<p className={styles.body}>{person.confirmation_note}</p>}
 </li>;
}

function TaskCompletionContent({row,onSaved}:{row:Row;onSaved:(row:Row)=>void}){
 const {t,me}=useApp();
 const [checked,setChecked]=useState(false),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const people=(row.completion_people||[]) as Person[],history=(row.completion_history||[]) as Person[];
 const done=people.filter(person=>person.confirmed_at).length,mine=people.find(person=>person.id===me.user.id);
 const canConfirm=Boolean(row.can_confirm_completion&&!mine?.confirmed_at);
 const complete=async(action:'complete'|'confirm_completion')=>{
  if(busy||(action==='confirm_completion'&&!checked))return;
  setBusy(true);setError('');
  try{
   const next=await post<Row>(`/api/data/tasks/${row.id}/actions/${action}`,{version:row.version,idempotency_key:crypto.randomUUID(),confirmation_note:note.trim()});
   setNote('');setChecked(false);onSaved(next);
  }catch(e){setError(errorMessage(e,t));}finally{setBusy(false);}
 };
 if(!row.completion_required&&!row.can_complete_task&&!history.length)return null;
 return <section className="workflow-section">
  {row.completion_required?<>
   <h3>{t('taskCompletion')} · {done}/{people.length}</h3>
   <p className="field-help">{t('taskCompletionHint')}</p>
   <ul className={styles.people}>{people.map(person=><ConfirmationPerson key={person.id} person={person}/>)}</ul>
  </>:null}
  {error&&<ErrorBanner message={error}/>}
  {row.completion_required?canConfirm&&<>
   <ConfirmationNoteField value={note} disabled={busy} onChange={setNote}/>
   <div className="action-wrap">
    <label><input type="checkbox" checked={checked} disabled={busy} onChange={event=>setChecked(event.target.checked)}/>{t('taskConfirmStatement')}</label>
    <Button variant="primary" disabled={!checked||busy} onClick={()=>void complete('confirm_completion')}>{t('taskSubmitCompletion')}</Button>
   </div>
  </>:row.can_complete_task?<>
   <ConfirmationNoteField value={note} disabled={busy} onChange={setNote}/>
   <Button variant="primary" disabled={busy} onClick={()=>void complete('complete')}>{t('complete')}</Button>
  </>:null}
  {history.length>0&&<section className={styles.history}>
   <h4>{t('taskCompletionHistory')}</h4>
   <p className="field-help">{t('taskCompletionHistoryHint')}</p>
   <ul className={styles.notes}>{history.map(person=><ConfirmationPerson key={`${person.id}:${person.revision}`} person={person} history/>)}</ul>
  </section>}
 </section>;
}
