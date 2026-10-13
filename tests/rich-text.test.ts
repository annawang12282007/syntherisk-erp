import {it,expect} from 'vitest';
import {RICH_PREFIX,richTextValue,richTextPlain,richTextHtml,normalizeRichText} from '../src/lib/rich-text';
import {richString} from '../src/lib/rich-text-schema';
import {renderMail} from '../src/lib/mail-format';
import {driveBrowseQuery} from '../src/integrations/drive-browse';
it('round trips styles, Unicode, links and raster image widths without losing plain text',()=>{
 const value=richTextValue('<p><b>中文</b> <i>English</i> <u>underline</u><span style="font-family: &quot;Times New Roman&quot;; font-size:24px;color:#123456;background-color:#ffff00">Large</span></p><a href="https://example.com/?x=1&amp;y=2">Link</a><img src="data:image/png;base64,aGVsbG8=" width="240" alt="Logo">');
 const html=richTextHtml(normalizeRichText(value));
 expect(html).toContain('font-family:Times New Roman');expect(html).toContain('font-size:24px');expect(html).toContain('background-color:#ffff00');expect(html).toContain('width="240"');
 expect(html).toContain('rel="noopener noreferrer"');expect(richTextPlain(value)).toContain('中文 English underlineLarge\nLink[Logo]');
 expect(normalizeRichText(value)).toBe(value);expect(richTextHtml('literal <b>text</b>')).toBe('literal &lt;b&gt;text&lt;/b&gt;');
 const styledLink=richTextValue('<a href="https://example.com" style="font-weight:bold;color:#aa2244"><font size="5">Link</font></a>');
 expect(richTextHtml(styledLink)).toContain('font-weight:bold');expect(richTextHtml(styledLink)).toContain('font-size:24px');expect(normalizeRichText(styledLink)).toBe(styledLink);
});
it('removes executable markup, external images and unsafe CSS on both write and display',()=>{
 const html=richTextHtml(RICH_PREFIX+'<script>alert(1)</script><svg onload="evil()"></svg><img src="https://tracking.example/pixel"><img src="data:image/svg+xml;base64,PHN2Zz4="><a href="javascript:alert(1)">Link</a><span style="position:fixed;background-image:url(https://example.com);color:red" onclick="evil()">Safe</span>');
 expect(html).not.toMatch(/script|svg|javascript:|tracking|onclick|position|background-image/);expect(html).toContain('color:red');expect(html).toContain('Safe');
});
it('limits visible text separately from image content and rejects oversized bodies',()=>{
 const value=richTextValue('<b>Hello</b><img alt="X" src="data:image/png;base64,'+'A'.repeat(12000)+'">');
 expect(richString(50).parse(value)).toBe(value);expect(()=>richString(5).parse(value)).toThrow();
 expect(normalizeRichText(RICH_PREFIX+'<p><br></p>')).toBe('');expect(()=>richString(20,1).parse(RICH_PREFIX+'<p><br></p>')).toThrow();
 expect(()=>normalizeRichText(RICH_PREFIX+'A'.repeat(700000))).toThrow();
});
it('renders the same rich mail body in preview and send with a readable plain alternative',()=>{
 const v=richTextValue('<b>Dear team</b><br><span style="font-size:24px">Update</span>');
 const mail=renderMail(v,'plain');expect(mail.html).toContain('<b>Dear team</b>');expect(mail.html).toContain('font-size:24px');expect(mail.plain).toBe('Dear team\nUpdate');expect(mail.plain).not.toContain(RICH_PREFIX);
});
it('uses shared-drive corpora, safe filters, natural sorting and pagination',()=>{
 const q=driveBrowseQuery({folder_id:'folder-1',drive_id:'company-drive',q:"a'\\b",file_kind:'pdf',modified_days:'7',order_by:'modified',page_token:'next'},new Date('2026-10-09T00:00:00Z'));
 expect(q.get('corpora')).toBe('drive');expect(q.get('driveId')).toBe('company-drive');expect(q.get('orderBy')).toBe('modifiedTime desc');expect(q.get('pageToken')).toBe('next');
 expect(q.get('q')).toContain("name contains 'a\\'\\\\b'");expect(q.get('q')).toContain("modifiedTime > '2026-10-02T00:00:00.000Z'");expect(q.get('q')).toContain("mimeType='application/pdf'");
 expect(driveBrowseQuery({shared_with_me:true}).get('q')).toContain('sharedWithMe=true');
 expect(()=>driveBrowseQuery({order_by:'bad'})).toThrow();expect(()=>driveBrowseQuery({folder_id:"' or trashed=true"})).toThrow();
});

