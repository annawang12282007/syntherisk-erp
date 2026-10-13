import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {RequestedSignatureNote,RequestSigningDialog} from '../src/components/signature-requests';
import {RICH_PREFIX} from '../src/lib/rich-text';
import {translate} from '../src/locales';

vi.mock('../src/components/context',()=>({useApp:()=>({t:(key:string)=>translate('zh-TW',key),me:{user:{name:'Invited signer'}},locale:'zh-TW',prefs:{},resources:{}})}));
vi.mock('../src/components/signatures',()=>({SignatureReview:()=>null}));
vi.mock('../src/components/primitives',async()=>{
 const original=await vi.importActual<typeof import('../src/components/primitives')>('../src/components/primitives');
 return {...original,Modal:({children,footer}:{children:ReactNode;footer:ReactNode})=>createElement('section',null,children,footer)};
});

describe('optional signature request notes',()=>{
 it('shows the optional plain note before requesting a signature preview',()=>{
  const html=renderToStaticMarkup(createElement(RequestSigningDialog,{resource:{key:'documents',label:['文件'],module:'documents',fields:[],titleField:'title'},request:{id:'request',kind:'internal',label:'Reviewer',status:'pending',record_version:1,requested_at:'2026-10-12T20:00:00Z',can_sign:true,can_record_external:false,can_cancel:false,matches_current:true},onClose:()=>{},onSaved:()=>{}}));
  expect(html).toContain('確認備註（選填）');expect(html).toContain('maxLength="4000"');expect(html).toContain('signature-request-review');expect(html).not.toContain('signature-request-confirm');expect(html).not.toContain('signature-consent');
 });
 it('renders internal receipt notes literally and preserves newlines',()=>{
  const body=RICH_PREFIX+'<strong>Literal</strong><script>window.bad=true</script>\nSecond line';
  const html=renderToStaticMarkup(createElement(RequestedSignatureNote,{note:body,format:'plain'}));
  expect(html).toContain('&lt;strong&gt;Literal&lt;/strong&gt;');expect(html).toContain('&lt;script&gt;window.bad=true&lt;/script&gt;\nSecond line');expect(html).toContain('white-space:pre-wrap');expect(html).not.toContain('<script>');
 });
 it('sanitizes external rich archive notes and omits empty notes',()=>{
  const html=renderToStaticMarkup(createElement(RequestedSignatureNote,{note:RICH_PREFIX+'<strong>Received copy</strong><script>window.bad=true</script>',format:'rich'}));
  expect(html).toContain('<strong>Received copy</strong>');expect(html).not.toContain('window.bad');expect(renderToStaticMarkup(createElement(RequestedSignatureNote,{note:null}))).toBe('');
 });
});
