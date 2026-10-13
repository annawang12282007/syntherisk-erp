import {it,expect,vi} from 'vitest';
import {GoogleAdapter,SCOPES,type Tokens} from '../src/integrations/adapters';
import {canUseGoogle} from '../src/integrations/access';
const config={clientId:'isolated',clientSecret:'isolated',redirectUri:'http://localhost/callback',encryptionKey:Buffer.alloc(32).toString('base64')};
const tokens:Tokens={access_token:'isolated-test-access',refresh_token:'isolated-test-refresh',scope:SCOPES.calendar.join(' '),expires_at:1};
const ctx={workspaceId:'test',companyId:'test',userId:'member',roles:['member']};
it('allows each internal member to connect their own Google account and honors revocation',()=>{
 expect(canUseGoogle(ctx)).toBe(true);expect(canUseGoogle({...ctx,roles:['external']})).toBe(false);
 expect(canUseGoogle({...ctx,permissions:[{resource:'google_integrations',operation:'connect',scope:'none'}]})).toBe(false);
 expect(canUseGoogle({...ctx,roles:['custom_test']})).toBe(false);
});
it('requires Google-verified email identity and keeps access tokens out of URL parameters',async()=>{
 const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({sub:'google-user',email:'MEMBER@example.invalid',email_verified:true,hd:'example.invalid'})));
 expect(await new GoogleAdapter(config,transport).identity(tokens)).toEqual({email:'member@example.invalid',subject:'google-user',domain:'example.invalid'});
 expect(transport.mock.calls[0][0]).toBe('https://openidconnect.googleapis.com/v1/userinfo');
 const denied=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({sub:'google-user',email:'member@example.invalid',email_verified:false})));
 await expect(new GoogleAdapter(config,denied).identity(tokens)).rejects.toMatchObject({code:'google_identity_unverified'});
});
it('retains existing granted scopes when a refresh response omits scope',async()=>{
 const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({access_token:'new-isolated-access',expires_in:3600})));
 expect((await new GoogleAdapter(config,transport).refresh(tokens)).scope).toBe(tokens.scope);
});
