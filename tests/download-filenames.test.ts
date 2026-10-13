import {describe,it,expect} from 'vitest';
import {responseFileName} from '../src/components/api';
describe('receipt download filenames',()=>{
 it('preserves the server receipt/checksum pair exactly',()=>{const filename='Syntherisk-signature-request-receipt-id.json';for(const suffix of ['', '.sha256']){const response=new Response('',{headers:{'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename+suffix)}`}});expect(responseFileName(response,'fallback')).toBe(filename+suffix);}});
 it('supports quoted Unicode filenames and safely falls back for malformed encoded names',()=>{expect(responseFileName(new Response('',{headers:{'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent('簽署紀錄.json')}`}}),'fallback')).toBe('簽署紀錄.json');expect(responseFileName(new Response('',{headers:{'Content-Disposition':'attachment; filename="signed-record.json.sha256"'}}),'fallback')).toBe('signed-record.json.sha256');expect(responseFileName(new Response('',{headers:{'Content-Disposition':"attachment; filename*=UTF-8''%ZZ"}}),'fallback')).toBe('fallback');expect(responseFileName(new Response(''),'fallback')).toBe('fallback');});
});
