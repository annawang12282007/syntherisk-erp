import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
vi.mock('../src/lib/db',()=>({pool:{},query:vi.fn(),transaction:vi.fn()}));
vi.mock('better-auth',()=>({betterAuth:vi.fn(v=>v)}));
import {query} from '../src/lib/db';
import {googleAccountAllowed} from '../src/lib/auth';
import {privateDestination,sheetWriteRange} from '../src/integrations/files-workspace';
import {mimeMessage} from '../src/integrations/gmail';
import {addresses} from '../src/integrations/meeting-workspace';
import {requestedScopes,GoogleAdapter,type Tokens} from '../src/integrations/adapters';
import {mailConfig} from '../src/integrations/mail';
import {webhook} from '../src/integrations/chat';
import {uuid} from '../src/integrations/workspace-core';
import {mailText,getMail,mailAttachment} from '../src/integrations/workspace-reads';
beforeEach(()=>{vi.mocked(query).mockReset();vi.stubEnv('GOOGLE_WORKSPACE_DOMAIN','example.invalid');});
afterEach(()=>vi.unstubAllEnvs());
describe('company Google identity admission',()=>{
 it('rejects a matching invited identity when the organization domain is not configured',async()=>{
  vi.stubEnv('GOOGLE_WORKSPACE_DOMAIN','');
  await expect(googleAccountAllowed({email:'admin@example.invalid',email_verified:true,hd:'example.invalid'})).rejects.toThrow('GOOGLE_ACCOUNT_MISMATCH');
  expect(query).not.toHaveBeenCalled();
 });
 it('admits only an active invited identity with verified company email and hosted domain',async()=>{
  vi.mocked(query).mockResolvedValueOnce([{id:'invited'}]);
  await expect(googleAccountAllowed({email:'Admin@example.invalid',email_verified:true,hd:'example.invalid'})).resolves.toEqual({email:'admin@example.invalid',emailVerified:true});
  expect(vi.mocked(query).mock.calls[0][0]).toContain("m.status='active'");
 });
 it.each([undefined,{email:'admin@example.invalid',email_verified:false,hd:'example.invalid'},{email:'outsider@example.com',email_verified:true,hd:'example.invalid'},{email:'admin@example.invalid',email_verified:true},{email:'admin@example.invalid',email_verified:true,hd:'other.com'}])('rejects unverified or mismatched identities',async profile=>{
  await expect(googleAccountAllowed(profile)).rejects.toThrow('GOOGLE_ACCOUNT_MISMATCH');expect(query).not.toHaveBeenCalled();
 });
 it('does not provision an arbitrary valid company account',async()=>{vi.mocked(query).mockResolvedValue([]);await expect(googleAccountAllowed({email:'new@example.invalid',email_verified:true,hd:'example.invalid'})).rejects.toThrow('INVITED_ACCOUNT_REQUIRED');});
});
describe('external disclosure and write safety',()=>{
 it('reads HTML-only mail as inert text and avoids duplicating multipart alternatives',()=>{
  const html={mimeType:'text/html',body:{data:Buffer.from('<head>tracking</head><p>Syntherisk &amp; ERP</p><script>alert(1)</script><img src="https://example.test/tracker">').toString('base64url')}};
  expect(mailText(html)).toBe('Syntherisk & ERP');
  expect(mailText({mimeType:'multipart/alternative',parts:[html,{mimeType:'text/plain',body:{data:Buffer.from('Plain copy').toString('base64url')}}]})).toBe('Plain copy');
 });
 it('requires a provably private destination for creator-private records',()=>{
  const base={id:'folder',name:'Test',mimeType:'application/vnd.google-apps.folder'};
  for(const permissions of [undefined,[],[{id:'x',type:'anyone',role:'reader'}],[{id:'x',type:'group',role:'reader',emailAddress:'admin@example.invalid'}],[{id:'x',type:'user',role:'writer',emailAddress:'other@example.invalid'}]])expect(()=>privateDestination({is_private:true},{...base,permissions},'admin@example.invalid')).toThrow('PRIVATE_DESTINATION_REQUIRED');
  expect(()=>privateDestination({is_private:true},{...base,permissions:[{id:'x',type:'user',role:'owner',emailAddress:'admin@example.invalid'}]},'admin@example.invalid')).not.toThrow();
 });
 it('reviews the complete Sheets write extent, including overwritten cells',()=>{
  expect(sheetWriteRange("'Quarter 1'!Z4",3,3)).toBe("'Quarter 1'!Z4:AB6");
  expect(()=>sheetWriteRange('Sheet1!A1:B2',3,2)).toThrow('SHEET_RANGE_TOO_SMALL');
  expect(()=>sheetWriteRange('A1',1,1)).toThrow('EXPLICIT_SHEET_RANGE_REQUIRED');
 });
 it('requests service-specific minimal grants before optional writes',()=>{
  expect(requestedScopes('gmail').some(s=>s.endsWith('gmail.send')||s.endsWith('gmail.compose'))).toBe(false);
  expect(requestedScopes('gmail','draft')).toContain('https://www.googleapis.com/auth/gmail.compose');
  expect(requestedScopes('people')).not.toContain('https://www.googleapis.com/auth/contacts');
  expect(()=>requestedScopes('forms','send')).toThrow('invalid_capability');
 });
 it('rejects mail header injection and keeps UTF-8 payloads encoded',()=>{
  const row={id:'11111111-1111-4111-8111-111111111111',from_address:'admin@example.invalid',to_addresses:['admin@example.invalid'],cc_addresses:[],subject:'驗收',body:'合成內容'};
  const raw=Buffer.from(mimeMessage(row,[]),'base64url').toString();expect(raw).toContain('Subject: =?UTF-8?B?');expect(raw).toContain(Buffer.from(row.body).toString('base64'));
  expect(()=>mimeMessage({...row,subject:'Title\r\nBcc: other@example.com'},[])).toThrow('INVALID_MESSAGE');
  expect(()=>addresses('a@example.com\r\nBcc: evil@example.com')).toThrow('INVALID_EMAIL');
 });
 it('requires encrypted remote SMTP transport in development as well as production',()=>{
  expect(()=>mailConfig({SMTP_HOST:'smtp.gmail.com',SMTP_FROM:'admin@example.invalid'})).toThrow('mail_tls_required');
  expect(mailConfig({SMTP_HOST:'smtp.gmail.com',SMTP_FROM:'admin@example.invalid',SMTP_REQUIRE_TLS:'true'}).requireTLS).toBe(true);
 });
 it('rejects foreign webhook hosts and malformed record identifiers',()=>{
  expect(()=>webhook('https://attacker.example/v1/spaces/test/messages?key=x&token=y')).toThrow();
  expect(()=>uuid('------------------------------------')).toThrow('INVALID_ID');
 });
 it('does not allow Google requests to escape an approved service path',async()=>{
  const fetcher=vi.fn(),adapter=new GoogleAdapter({clientId:'controlled',clientSecret:'controlled',redirectUri:'http://localhost:3000/api/integrations',encryptionKey:Buffer.alloc(32).toString('base64')},fetcher),tokens={} as Tokens;
  await expect(adapter.request(tokens,'https://attacker.example')).rejects.toThrow();
  await expect(adapter.request(tokens,'/drive/v3/../userinfo')).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 });
});

it('downloads the stable MIME part even when Google refreshes the attachment ID',async()=>{let generation=0;const request=vi.fn(async(_:unknown,path:string)=>{if(path.includes('/attachments/')){expect(path).toContain('temporary-2');return {data:Buffer.from('test').toString('base64url')};}generation++;return {id:'m',payload:{mimeType:'multipart/mixed',parts:[{partId:'1',filename:'test.txt',mimeType:'text/plain',body:{size:4,attachmentId:'temporary-'+generation}}]}};});const s={adapter:{request},tokens:{}} as unknown as Parameters<typeof getMail>[0];const message=await getMail(s,'m');expect(message.attachments[0].attachment_id).toBe('part:1');expect((await mailAttachment(s,'m',String(message.attachments[0].attachment_id))).bytes.toString()).toBe('test');});
