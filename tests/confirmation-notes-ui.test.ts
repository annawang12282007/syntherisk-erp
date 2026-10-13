import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {translate} from '../src/locales';
import {ConfirmationNoteField,ConfirmationNotesPanel} from '../src/components/confirmation-notes';
import {TaskCompletionPanel} from '../src/components/task-completion';
import {DisplayValue} from '../src/components/primitives';
import {RICH_PREFIX} from '../src/lib/rich-text';
import type {Row} from '../src/components/types';

vi.mock('../src/components/context',()=>({useApp:()=>({
 t:(key:string)=>translate('zh-TW',key),locale:'zh-TW',prefs:{timezone:'America/Los_Angeles'},me:{user:{id:'current-user'}},
})}));

const confirmed={id:'former-member',name:'Former Member',active:false,revision:1,confirmed_at:'2026-10-12T20:30:00.000Z',confirmation_note:'Reviewed the document.\nPlease retain this note.'};

describe('confirmation note presentation',()=>{
 it('uses a labelled optional plain text input with a 4000 character limit',()=>{
  const html=renderToStaticMarkup(createElement(ConfirmationNoteField,{value:'',onChange:()=>{}}));
  expect(html).toContain('確認備註（選填）');
  expect(html).toContain('<textarea');
  expect(html).toContain('maxLength="4000"');
  expect(html).not.toContain('required=""');
  expect(html).not.toContain('contenteditable');
 });

 it('shows prior confirmations after completion requirements have been disabled',()=>{
  const row:Row={id:'task-1',version:4,completion_revision:2,completion_required:false,can_complete_task:false,completion_history:[confirmed]};
  const html=renderToStaticMarkup(createElement(TaskCompletionPanel,{row,onSaved:()=>{}}));
  expect(html).toContain('歷次確認紀錄');
  expect(html).toContain('Former Member');
  expect(html).toContain('確認輪次 1</small>');
  expect(html).toContain('Reviewed the document.\nPlease retain this note.');
  expect(html).toContain('dateTime="2026-10-12T20:30:00.000Z"');
  expect(html).not.toContain('<textarea');
 });

 it('keeps previous rounds apart from the current confirmation count',()=>{
  const row:Row={id:'task-1',version:5,completion_revision:2,completion_required:true,can_confirm_completion:true,
   completion_people:[{id:'current-user',name:'Current Member',revision:2,confirmed_at:null,confirmation_note:null}],completion_history:[confirmed]};
  const html=renderToStaticMarkup(createElement(TaskCompletionPanel,{row,onSaved:()=>{}}));
  expect(html).toContain('完成確認 · 0/1');
  expect(html).toContain('待本人確認');
  expect(html).toContain('歷次確認紀錄');
  expect(html.indexOf('<textarea')).toBeLessThan(html.indexOf('type="checkbox"'));
  expect(html).toContain('disabled=""');
 });

 it('provides an optional note for the direct complete action',()=>{
  const row:Row={id:'task-1',version:1,completion_required:false,can_complete_task:true};
  const html=renderToStaticMarkup(createElement(TaskCompletionPanel,{row,onSaved:()=>{}}));
  expect(html).toContain('確認備註（選填）');
  expect(html).toContain('<textarea');
  expect(html).not.toContain('type="checkbox"');
 });

 it('renders new note contents as text even if they mimic the rich text prefix',()=>{
  const body=RICH_PREFIX+'<strong>Literal text</strong><script>window.bad=true</script>\nSecond line';
  const row:Row={id:'task-1',version:2,confirmation_notes:[{id:'note-1',actor_name:'Sample',action:'accept',body,format:'plain',created_at:'2026-10-12T20:30:00.000Z',record_version:2}]};
  const html=renderToStaticMarkup(createElement(ConfirmationNotesPanel,{row}));
  expect(html).toContain('Sample');
  expect(html).toContain('&lt;strong&gt;Literal text&lt;/strong&gt;');
  expect(html).toContain('&lt;script&gt;window.bad=true&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<strong>Literal text</strong>');
 });

 it('keeps signature preview confirmation notes literal while existing review fields retain rich formatting',()=>{
  const value=RICH_PREFIX+'<strong>Literal note</strong><script>window.bad=true</script>\nSecond line';
  const noteHtml=renderToStaticMarkup(createElement(DisplayValue,{field:{key:'confirmation_note',type:'textarea',label:['確認備註']},value}));
  expect(noteHtml).toContain('&lt;!--syntherisk-rich:v1--&gt;');
  expect(noteHtml).toContain('&lt;strong&gt;Literal note&lt;/strong&gt;');
  expect(noteHtml).toContain('&lt;script&gt;window.bad=true&lt;/script&gt;\nSecond line');
  expect(noteHtml).toContain('white-space:pre-wrap');
  expect(noteHtml).not.toContain('<strong>Literal note</strong>');
  expect(noteHtml).not.toContain('<script>');
  const reviewHtml=renderToStaticMarkup(createElement(DisplayValue,{field:{key:'reason',type:'textarea',label:['審核意見']},value}));
  expect(reviewHtml).toContain('<strong>Literal note</strong>');
  expect(reviewHtml).not.toContain('window.bad');
 });

 it('uses the existing sanitizer only for notes explicitly marked as existing rich content',()=>{
  const row:Row={id:'task-1',version:2,confirmation_notes:[{id:'note-1',actor_name:'Sample',action:'approve',body:RICH_PREFIX+'<strong>Review opinion</strong><script>window.bad=true</script>',format:'rich',created_at:'2026-10-12T20:30:00.000Z',record_version:2}]};
  const html=renderToStaticMarkup(createElement(ConfirmationNotesPanel,{row}));
  expect(html).toContain('<strong>Review opinion</strong>');
  expect(html).not.toContain('window.bad');
  expect(html).not.toContain('<script>');
 });
});
