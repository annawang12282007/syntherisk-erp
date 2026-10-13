import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {translate} from '../src/locales';
import {AnnouncementAcknowledgement} from '../src/components/announcements';

vi.mock('../src/components/context',()=>({useApp:()=>({t:(key:string)=>translate('zh-TW',key),locale:'zh-TW',prefs:{timezone:'America/Los_Angeles'}})}));
const notice={archived:false,addressed_to_me:true,status:'published',require_ack:true,acknowledged_at:null,confirmation_note:null};
const render=(value:Parameters<typeof AnnouncementAcknowledgement>[0]['notice'])=>renderToStaticMarkup(createElement(AnnouncementAcknowledgement,{notice:value,busy:false,onConfirm:()=>{}}));

describe('announcement acknowledgment notes',()=>{
 it('offers the addressed recipient an optional plain note before acknowledgment',()=>{
  const html=render(notice);
  expect(html).toContain('確認備註（選填）');expect(html).toContain('maxLength="4000"');
  expect(html).not.toContain('required=""');expect(html.indexOf('<textarea')).toBeLessThan(html.indexOf('<button'));
 });
 it('shows the saved receipt time and literal note after acknowledgment without an editable field',()=>{
  const html=render({...notice,acknowledged_at:'2026-10-12T20:30:00.000Z',confirmation_note:'<!--syntherisk-rich:v1--><b>Literal note</b>\nSecond line'});
  expect(html).toContain('dateTime="2026-10-12T20:30:00.000Z"');expect(html).toContain('&lt;b&gt;Literal note&lt;/b&gt;\nSecond line');
  expect(html).not.toContain('<b>Literal note</b>');expect(html).not.toContain('<textarea');expect(html).not.toContain('<button');
 });
 it('retains a saved receipt on an archived announcement',()=>{
  const html=render({...notice,archived:true,acknowledged_at:'2026-10-12T20:30:00.000Z',confirmation_note:'Retained receipt'});
  expect(html).toContain('Retained receipt');expect(html).not.toContain('<textarea');
 });
 it('does not offer acknowledgment to non-recipients or archived announcements',()=>{
  expect(render({...notice,addressed_to_me:false})).toBe('');expect(render({...notice,archived:true})).toBe('');
 });
});
