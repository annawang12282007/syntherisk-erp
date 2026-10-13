import {it,expect} from 'vitest';
import {renderMail,formattedText,normalizeMailStyle} from '../src/lib/mail-format';
it('escapes user HTML and supports only safe formatted links and text',()=>{
 const html=formattedText('<img src=x onerror=alert(1)>\n**Strong** *Emphasis*\n[Unsafe](javascript:alert)\n[Site](https://example.invalid)\n- Item');
 expect(html).not.toContain('<img');expect(html).toContain('&lt;img');expect(html).not.toContain('href="javascript:');expect(html).toContain('<strong>Strong</strong>');expect(html).toContain('<em>Emphasis</em>');expect(html).toContain('<ul');expect(html).toContain('href="https://example.invalid"');
});
it('generates separate company header, signature, footer and escaped preview without remote assets',()=>{
 const result=renderMail('Hello **Sample**','formatted',{header:'Syntherisk',signature:'Sample\n[Company](https://example.invalid)',footer:'Confidential',preheader:'<script>not executable</script>',accent:'#225588'});
 expect(result.html).toContain('border-bottom:3px solid #225588');expect(result.html).not.toContain('<script>');expect(result.plain).toContain('Syntherisk\n\nHello');expect(result.plain).toContain('Confidential');expect(result.html).not.toContain('<img');
});
it('rejects arbitrary CSS, malformed format objects and oversized layout text',()=>{
 expect(()=>normalizeMailStyle({accent:'red; background:url(https://tracker)'})).toThrow();
 expect(()=>normalizeMailStyle({header:'x'.repeat(10001)})).toThrow();
 expect(()=>normalizeMailStyle({signature:{html:'x'}})).toThrow();
});
