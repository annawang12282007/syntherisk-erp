import sanitizeHtml from 'sanitize-html';
import {decodeMailSnippet} from './presentation';

export const RICH_PREFIX='<!--syntherisk-rich:v1-->';
export const RICH_LIMIT=700_000;
export const richFonts=['Arial','Georgia','Times New Roman','Verdana','Courier New','Noto Sans SC','Noto Sans TC','sans-serif','serif','monospace'];
export function isRichText(value:unknown):boolean{return typeof value==='string'&&value.startsWith(RICH_PREFIX);}
export const escapeRich=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const color=/^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|transparent|black|white|red|blue|green|yellow)$/i;
const imageSource=/^(?:data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}|\/api\/mail-images\?id=[0-9a-f-]{36})$/i;
/** No remote images, arbitrary CSS, scripts, SVG or embedded documents. */
export function safeRichHtml(value:string){return sanitizeHtml(value.slice(0,RICH_LIMIT),{
 allowedTags:['p','div','span','br','strong','b','em','i','u','s','strike','blockquote','ul','ol','li','h1','h2','h3','h4','a','img','font'],
 allowedAttributes:{'*':['style'],a:['href','target','rel'],img:['src','alt','width'],font:['face','size','color']},
 allowedSchemes:['http','https','mailto'],allowedSchemesByTag:{img:['data']},allowProtocolRelative:false,
 allowedStyles:{'*':{'color':[color],'background-color':[color],'font-family':[/^(?:Arial|Georgia|Times New Roman|Verdana|Courier New|Noto Sans SC|Noto Sans TC|sans-serif|serif|monospace)$/i],'font-size':[/^(?:[8-9]|[1-6][0-9]|7[0-2])px$/],'font-weight':[/^(?:bold|normal|[1-9]00)$/],'font-style':[/^(?:italic|normal)$/],'text-decoration':[/^(?:underline|line-through|none)(?:\s+(?:underline|line-through))*$/],'text-align':[/^(?:left|center|right|justify)$/]},img:{width:[/^(?:[1-9][0-9]{0,2}|1[0-5][0-9]{2}|1600)px$/],height:[/^auto$/],'max-width':[/^100%$/]}},
 transformTags:{'*':(tagName,a)=>{if(a.style)a.style=a.style.replace(/font-family:\s*["']([^"']+)["']/gi,'font-family:$1');return {tagName,attribs:a};},a:(_,a)=>({tagName:'a',attribs:{...(a.style?{style:a.style}:{}),href:/^(?:https?:\/\/|mailto:)/i.test(a.href||'')?a.href:'',target:'_blank',rel:'noopener noreferrer'}}),font:(_,a)=>({tagName:'span',attribs:{style:[richFonts.includes(a.face)?`font-family:${a.face}`:'',color.test(a.color||'')?`color:${a.color}`:'',/^[1-7]$/.test(a.size||'')?`font-size:${[0,10,13,16,18,24,32,48][Number(a.size)]}px`:'',a.style||''].filter(Boolean).join(';')}}),img:(_,a)=>({tagName:'img',attribs:{src:imageSource.test(a.src||'')&&a.src.length<=240_000?a.src:'',alt:(a.alt||'').slice(0,300),style:[...(a.style||'').split(';').filter(v=>!/^\s*(?:max-width|height)\s*:/i.test(v)&&v.trim()),'max-width:100%','height:auto'].join(';'),...(/^\d{1,4}$/.test(a.width||'')?{width:String(Math.min(1600,Math.max(24,Number(a.width))))}:{})}})},
 exclusiveFilter:frame=>frame.tag==='img'&&!frame.attribs.src,
 nonTextTags:['script','style','textarea','option','head','svg','math','iframe','object'],enforceHtmlBoundary:false,
 });}
export function richTextHtml(value:unknown){const text=String(value??'');return isRichText(text)?safeRichHtml(text.slice(RICH_PREFIX.length)):escapeRich(text).replace(/\r?\n/g,'<br>');}
export function richTextPlain(value:unknown){const text=String(value??'');if(!isRichText(text))return text;return decodeMailSnippet(safeRichHtml(text.slice(RICH_PREFIX.length)).replace(/<img\b[^>]*alt="([^"]*)"[^>]*>/g,'[$1]').replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-4]|blockquote)>/g,'\n').replace(/<[^>]*>/g,'')).replace(/\n{3,}/g,'\n\n').trim();}
export function richTextValue(html:string){const clean=safeRichHtml(html);return richTextPlain(RICH_PREFIX+clean)||/<img\b/.test(clean)?RICH_PREFIX+clean:'';}
export function normalizeRichText(value:string,max=200000,min=0){
 if(!isRichText(value)){if(value.length>max||value.trim().length<min)throw Error('INVALID_TEXT');return value;}
 if(value.length>RICH_LIMIT)throw Error('INVALID_TEXT');const clean=richTextValue(value.slice(RICH_PREFIX.length)),plain=richTextPlain(clean);
 if(plain.length>max||plain.length<min&&!/<img\b/.test(clean))throw Error('INVALID_TEXT');return clean;
}
