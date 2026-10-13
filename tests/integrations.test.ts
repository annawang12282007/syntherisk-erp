import { describe, expect, it, vi } from 'vitest';
import { authorization, eventExternalId, GoogleAdapter, googleConfig, ProviderError, seal, unseal, type GoogleConfig, type Tokens } from '../src/integrations/adapters';
import { mailConfig, renderTemplate } from '../src/integrations/mail';

const config: GoogleConfig = { clientId: 'isolated-client', clientSecret: 'isolated-secret', redirectUri: 'http://localhost:3000/api/integrations', encryptionKey: Buffer.alloc(32, 7).toString('base64') };
const tokens: Tokens = { access_token: 'isolated-access', refresh_token: 'isolated-refresh', expires_at: Date.now() + 3600000, scope: '' };
const json = (data: unknown, status=200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
describe('Google authorization and encrypted server storage',()=>{
  it('requires deployment credentials, encryption key and a safe redirect',()=>{
    expect(()=>googleConfig({})).toThrow('integration_not_configured');
    expect(()=>googleConfig({GOOGLE_CLIENT_ID:'x',GOOGLE_CLIENT_SECRET:'x',GOOGLE_INTEGRATION_REDIRECT_URI:'http://untrusted.example/callback',INTEGRATION_ENCRYPTION_KEY:config.encryptionKey})).toThrow('insecure_redirect_uri');
  });
  it('uses independent unpredictable state and S256 PKCE per authorization',()=>{
    const a=authorization(config,'calendar'),b=authorization(config,'calendar'),url=new URL(a.url);
    expect(a.state).not.toBe(b.state);expect(a.verifier).not.toBe(b.verifier);expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).not.toContain('gmail');expect(url.searchParams.get('scope')).not.toContain('drive');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);expect(url.searchParams.get('access_type')).toBe('offline');
  });
  it('encrypts tokens and authenticates workspace/user/provider context',()=>{
    const encrypted=seal(tokens,config.encryptionKey,'workspace:user:calendar');
    expect(encrypted).not.toContain('isolated-access');expect(unseal(encrypted,config.encryptionKey,'workspace:user:calendar')).toEqual(tokens);
    expect(()=>unseal(encrypted,config.encryptionKey,'another:user:calendar')).toThrow();
    expect(()=>unseal(encrypted,Buffer.alloc(32,8).toString('base64'),'workspace:user:calendar')).toThrow();
  });
  it('exchanges and refreshes with POST bodies and never places tokens in URLs',async()=>{
    const transport=vi.fn<typeof fetch>().mockImplementation(async()=>json({access_token:'new',expires_in:3600,scope:'calendar'}));
    const adapter=new GoogleAdapter(config,transport);
    await adapter.exchange('test-code','test-verifier');const refreshed=await adapter.refresh(tokens);
    expect(String(transport.mock.calls[0][1]?.body)).toContain('code_verifier=test-verifier');expect(transport.mock.calls[1][0]).toBe('https://oauth2.googleapis.com/token');
    expect(refreshed.refresh_token).toBe(tokens.refresh_token);expect(refreshed.expires_at).toBeGreaterThan(Date.now());
  });
  it('revoked grants require reconnection',async()=>{
    const adapter=new GoogleAdapter(config,vi.fn<typeof fetch>().mockResolvedValue(json({error:'invalid_grant'},400)));
    await expect(adapter.refresh(tokens)).rejects.toMatchObject({code:'authorization_expired',retryable:false});
    await expect(adapter.refresh({...tokens,refresh_token:undefined})).rejects.toMatchObject({code:'authorization_expired'});
  });
  it('sends revocation to provider and exposes provider failure honestly',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status:200}));await new GoogleAdapter(config,f).revoke(tokens);
    expect(f.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/revoke');expect(String(f.mock.calls[0][1]?.body)).toContain('token=isolated-refresh');
    await expect(new GoogleAdapter(config,vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))).revoke(tokens)).rejects.toMatchObject({retryable:true});
  });
});
describe('Calendar provider contract',()=>{
  it('creates a stable provider ID, recovers an uncertain insert, and suppresses invitations',async()=>{
    const id=eventExternalId('workspace','event');expect(id).toBe(eventExternalId('workspace','event'));expect(id).not.toBe(eventExternalId('other','event'));
    const f=vi.fn<typeof fetch>().mockResolvedValueOnce(json({},409)).mockResolvedValueOnce(json({id,etag:'v1',extendedProperties:{private:{syntherisk_id:'event'}}}));
    const result=await new GoogleAdapter(config,f).putEvent(tokens,'company@example.test',{id});
    expect(result.id).toBe(id);expect(String(f.mock.calls[0][0])).toContain('sendUpdates=none');expect(f.mock.calls[0][1]?.method).toBe('POST');expect(f.mock.calls[1][1]?.method).toBeUndefined();
  });
  it('protects updates and cancellations with etags and reports conflict',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(json({},412)),adapter=new GoogleAdapter(config,f);
    await expect(adapter.putEvent(tokens,'calendar',{id:'event'},'old-etag')).rejects.toMatchObject({code:'sync_conflict',retryable:false});
    expect(f.mock.calls[0][1]?.headers).toMatchObject({'If-Match':'old-etag'});
    await expect(adapter.cancelEvent(tokens,'calendar','event','old-etag')).rejects.toMatchObject({code:'sync_conflict'});
  });
  it('makes cancellation replay safe when event has already gone',async()=>{
    for(const status of [404,410])await expect(new GoogleAdapter(config,vi.fn<typeof fetch>().mockResolvedValue(json({},status))).cancelEvent(tokens,'calendar','event')).resolves.toBeUndefined();
  });
  it('preserves sync/page tokens, cancellations and recurring masters',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(json({items:[],nextSyncToken:'next'}));await new GoogleAdapter(config,f).listEvents(tokens,'company/calendar','sync','page');
    const url=new URL(String(f.mock.calls[0][0]));expect(url.searchParams.get('syncToken')).toBe('sync');expect(url.searchParams.get('pageToken')).toBe('page');expect(url.searchParams.get('showDeleted')).toBe('true');expect(url.searchParams.get('singleEvents')).toBe('false');
  });
  it.each([[401,'authorization_expired',false],[403,'provider_permission_denied',false],[404,'provider_resource_not_found',false],[410,'sync_token_expired',false],[429,'provider_unavailable',true],[503,'provider_unavailable',true]])('classifies provider status %s',async(status,code,retryable)=>{
    const adapter=new GoogleAdapter(config,vi.fn<typeof fetch>().mockResolvedValue(json({},Number(status))));await expect(adapter.listEvents(tokens,'calendar')).rejects.toMatchObject({code,retryable});
  });
});
describe('Drive provider contract',()=>{
  it('includes shared-drive parameters and limits metadata projection',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(json({files:[]}));await new GoogleAdapter(config,f).driveFiles(tokens,'shared-drive','folder');const url=new URL(String(f.mock.calls[0][0]));
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');expect(url.searchParams.get('driveId')).toBe('shared-drive');expect(url.searchParams.get('q')).toContain("'folder' in parents");expect(url.searchParams.get('fields')).toContain('capabilities');
  });
  it('never treats a stored link as proof of current access',async()=>{
    for(const status of [403,404])await expect(new GoogleAdapter(config,vi.fn<typeof fetch>().mockResolvedValue(json({},status))).driveFile(tokens,'old-file')).rejects.toBeInstanceOf(ProviderError);
  });
  it('verifies the selected folder permits writes before uploading',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(json({id:'folder',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:false}}));
    await expect(new GoogleAdapter(config,f).upload(tokens,'folder','proof.txt','text/plain',new Uint8Array([1]))).rejects.toMatchObject({code:'provider_permission_denied'});expect(f).toHaveBeenCalledTimes(1);
  });
  it('uploads bytes only to an authorized folder with shared-drive support',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValueOnce(json({id:'folder',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}})).mockResolvedValueOnce(json({id:'file',name:'proof.txt',mimeType:'text/plain'}));
    const file=await new GoogleAdapter(config,f).upload(tokens,'folder','proof.txt','text/plain',Buffer.from('isolated payload'));expect(file.id).toBe('file');expect(String(f.mock.calls[1][0])).toContain('supportsAllDrives=true');expect(String(f.mock.calls[1][1]?.body)).toContain('isolated payload');
  });
  it('rejects arbitrary fetch paths',async()=>{await expect(new GoogleAdapter(config).request(tokens,'https://malicious.example')).rejects.toMatchObject({code:'invalid_provider_path'});});
});
describe('mail configuration and rendering',()=>{
  it('has no configured fallback or fake send success',()=>{expect(()=>mailConfig({})).toThrow('mail_not_configured');expect(()=>mailConfig({SMTP_HOST:'mail',SMTP_FROM:'ops@example.test',NODE_ENV:'production'})).toThrow('mail_tls_required');});
  it('requires every template field to be known',()=>{expect(renderTemplate('Hello {{ name }}',{name:'Example'})).toBe('Hello Example');expect(()=>renderTemplate('{{ unknown }}',{name:'Example'})).toThrow('unknown_template_field');});
});
