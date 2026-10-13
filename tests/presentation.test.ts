import {expect,it} from 'vitest';
import {decodeMailSnippet,mailDisplayDate,moneyLabel} from '../src/lib/presentation';
it('decodes provider mail snippets once without parsing markup or invalid code points',()=>{
 expect(decodeMailSnippet('Tom&#39;s &amp; Sons &AMP; &#x1F600;')).toBe("Tom's & Sons & 😀");
 expect(decodeMailSnippet('&lt;script&gt; &amp;lt; &#xD800; &#1114112;')).toBe('<script> &lt; &#xD800; &#1114112;');
});
it('uses the viewer timezone for RFC mail dates and provider timestamp fallback',()=>{
 expect(mailDisplayDate('Fri, 09 Oct 2026 23:00:00 +0000',null,'en-US','America/Los_Angeles')).toBe('Oct 9, 2026, 4:00 PM');
 expect(mailDisplayDate('unparseable',Date.parse('2026-10-09T23:00:00Z'),'en-US','Asia/Taipei')).toBe('Oct 10, 2026, 7:00 AM');
 expect(mailDisplayDate(null,null,'en-US','UTC')).toBe('—');
 expect(mailDisplayDate('bad','bad','en-US','UTC')).toBe('—');
});
it('labels formatted currency fields without claiming the display is minor units',()=>{
 expect(moneyLabel('Total (minor units)')).toBe('Total');
 expect(moneyLabel('金额（最小单位）')).toBe('金额');
 expect(moneyLabel('金額（最小單位）')).toBe('金額');
});
