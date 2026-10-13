import {expect,it} from 'vitest';
import {publicOrigin} from '../src/lib/public-origin';
import {permittedOperations} from '../src/domain/permission-options';
it('uses the configured public origin and ignores callback paths',()=>{
 expect(publicOrigin({NODE_ENV:'production',APP_URL:'https://erp.example.invalid'})).toBe('https://erp.example.invalid');
 expect(publicOrigin({NODE_ENV:'production',GOOGLE_INTEGRATION_REDIRECT_URI:'https://erp.example.invalid/api/integrations'})).toBe('https://erp.example.invalid');
 expect(publicOrigin({NODE_ENV:'development',APP_URL:'http://localhost:3000'})).toBe('http://localhost:3000');
});
it('fails closed on missing production origin, bind addresses, credentials and insecure remote origins',()=>{
 expect(()=>publicOrigin({NODE_ENV:'production'})).toThrow('PUBLIC_URL_REQUIRED');
 for(const APP_URL of ['https://0.0.0.0:3000','http://0.0.0.0:3000','https://[::]:3000','https://user:secret@example.com','http://erp.example.invalid','javascript:alert(1)'])expect(()=>publicOrigin({NODE_ENV:'production',APP_URL})).toThrow();
});
it('withdrawn templates cannot be offered as permission operations',()=>{
 expect(permittedOperations('communication_templates')).toEqual([]);
 expect(permittedOperations('contacts')).toContain('create');
});
