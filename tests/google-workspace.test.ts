import {describe,expect,it} from 'vitest';
import {googleIdentityMatches,googleWorkspaceDomain} from '../src/lib/google-workspace';

describe('configured Google organization',()=>{
  it.each([undefined,'','  ','*','*.example.invalid','https://example.invalid','example.invalid/path','member@example.invalid','example..invalid','-example.invalid','example.invalid:443'])('fails closed for missing or invalid domain %s',value=>{
    const env={GOOGLE_WORKSPACE_DOMAIN:value};
    expect(googleWorkspaceDomain(env)).toBeUndefined();
    expect(googleIdentityMatches({email:'member@example.invalid',domain:'example.invalid'},'member@example.invalid',env)).toBe(false);
  });
  it('normalizes explicit configuration and still requires both the hosted domain and invited email',()=>{
    const env={GOOGLE_WORKSPACE_DOMAIN:'  EXAMPLE.INVALID  '};
    expect(googleWorkspaceDomain(env)).toBe('example.invalid');
    expect(googleIdentityMatches({email:'MEMBER@example.invalid',domain:'EXAMPLE.INVALID'},'member@example.invalid',env)).toBe(true);
    for(const identity of [
      {email:'other@example.invalid',domain:'example.invalid'},
      {email:'member@example.invalid',domain:'other.invalid'},
      {email:'member@other.invalid',domain:'example.invalid'},
      {email:'member@example.invalid'},
    ])expect(googleIdentityMatches(identity,'member@example.invalid',env)).toBe(false);
    expect(googleIdentityMatches({email:'member@example.invalid',domain:'example.invalid'},undefined,env)).toBe(false);
  });
});
