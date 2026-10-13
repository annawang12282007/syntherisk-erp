import {it,expect} from 'vitest';
import {readJson} from '../src/lib/request-body';
it('bounds chunked bodies without trusting content length',async()=>{const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('123456'));c.close();}});await expect(readJson(new Request('http://localhost/test',{method:'POST',body:stream,duplex:'half'} as RequestInit),5)).rejects.toMatchObject({status:413});});
it('rejects malformed JSON and accepts bounded structured data',async()=>{await expect(readJson(new Request('http://localhost/test',{method:'POST',body:'bad'}))).rejects.toMatchObject({status:400});expect(await readJson(new Request('http://localhost/test',{method:'POST',body:'{"ok":true}'}))).toEqual({ok:true});});
