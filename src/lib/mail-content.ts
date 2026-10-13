import sanitizeHtml from 'sanitize-html';
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Mail is untrusted. No tracking images, executable HTML, styles, forms or embedded documents. */
export function safeMailHtml(html:string){return sanitizeHtml(html.slice(0,1_000_000),{
 allowedTags:['p','div','span','br','hr','strong','b','em','i','u','s','blockquote','pre','code','ul','ol','li','h1','h2','h3','h4','table','thead','tbody','tr','td','th','a'],
 allowedAttributes:{a:['href','target','rel'],td:['colspan','rowspan'],th:['colspan','rowspan']},
 allowedSchemes:['https','http','mailto'],allowProtocolRelative:false,
 transformTags:{a:(_,attrs)=>({tagName:'a',attribs:{href:attrs.href||'',target:'_blank',rel:'noopener noreferrer'}})},
 nonTextTags:['style','script','textarea','option','head','svg','math'],enforceHtmlBoundary:false,
 });}
export function plainMailHtml(text:string){
 const pattern=/(?:https?:\/\/|mailto:)[^\s<>]+/g;let out='',at=0;
 for(const match of text.slice(0,1_000_000).matchAll(pattern)){const url=match[0].replace(/[).,;!?，。；）]+$/u,'');out+=escape(text.slice(at,match.index))+'<a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+escape(url)+'</a>';at=match.index!+url.length;}
 return out+escape(text.slice(at,1_000_000));
}
