'use client';
import {useId} from 'react';
import {useApp} from './context';
import RichText from './rich-text';
import type {Row} from './types';
import styles from './confirmation-notes.module.css';

type ConfirmationNote={
 id:string;resource:string;record_id:string;record_version:number;action:string;
 actor_name:string;body:string;created_at:string;format?:'plain'|'rich';
};

export function ConfirmationNoteField({value,disabled=false,onChange}:{value:string;disabled?:boolean;onChange:(value:string)=>void}){
 const {t}=useApp(),id=useId();
 return <div className={`field full-field ${styles.input}`}>
  <label htmlFor={id}>{t('confirmationNoteOptional')}</label>
  <textarea id={id} rows={3} maxLength={4000} value={value} disabled={disabled} aria-describedby={`${id}-hint`} onChange={event=>onChange(event.target.value)}/>
  <small id={`${id}-hint`} className="field-help">{t('confirmationNoteHint')}</small>
 </div>;
}

export function ConfirmationTimestamp({value}:{value:string}){
 const {locale,prefs}=useApp();
 let formatted=value;
 try{formatted=new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short',timeZone:prefs.timezone||'America/Los_Angeles'}).format(new Date(value));}catch{}
 return <time dateTime={value}>{formatted}</time>;
}

export function ConfirmationNotesPanel({row}:{row:Row}){
 const {t}=useApp();
 const notes=(Array.isArray(row.confirmation_notes)?row.confirmation_notes:[]) as ConfirmationNote[];
 if(!notes.length)return null;
 return <section className="workflow-section">
  <h3>{t('confirmationNotes')}</h3>
  <ul className={styles.notes}>{notes.map(note=><li key={note.id}>
   <div className={styles.metadata}><strong>{note.actor_name}</strong><span>{t(note.action)}</span><small><ConfirmationTimestamp value={note.created_at}/></small><small>{t('version')} {note.record_version}</small></div>
   {note.format==='rich'?<RichText value={note.body}/>:<p className={styles.body}>{note.body}</p>}
  </li>)}</ul>
 </section>;
}
