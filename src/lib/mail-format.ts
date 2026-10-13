import {isRichText,richTextHtml,richTextPlain} from './rich-text';
/** Safe, deterministic formatting shared by the editor, review and MIME sender.
 * User HTML is always escaped. Only the documented lightweight formatting is interpreted.
 * No remote images, scripts or CSS supplied by a user are executed. */
export interface MailStyle {preheader?:string;header?:string;footer?:string;signature?:string;accent?:string}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function mailImageIds(value:string){return [...new Set([...value.matchAll(/\/api\/mail-images\?id=([0-9a-f-]{36})/gi)].map(m=>m[1]))];}
function inline(value:string):string{
 const image=/!\[([^\]\n]*)\]\(\/api\/mail-images\?id=([0-9a-f-]{36})\)/gi;let html='',pos=0;
 for(const m of value.matchAll(image)){html+=inlineText(value.slice(pos,m.index))+'<img src="/api/mail-images?id='+m[2]+'" alt="'+escape(m[1])+'" style="max-width:100%;height:auto;display:block"/>';pos=m.index!+m[0].length;}
 return html+inlineText(value.slice(pos));
}
function inlineText(value:string):string{
 const pattern=/(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\))/g;
 let result='',offset=0;
 for(const match of value.matchAll(pattern)){
  result+=escape(value.slice(offset,match.index));
  if(match[2])result+='<strong>'+escape(match[2])+'</strong>';
  else if(match[3])result+='<em>'+escape(match[3])+'</em>';
  else result+='<a href="'+escape(match[5])+'" target="_blank" rel="noopener noreferrer" style="color:#1462c4;text-decoration:underline">'+escape(match[4])+'</a>';
  offset=match.index!+match[0].length;
 }
 return result+escape(value.slice(offset));
}
export function formattedText(value:string):string{
 if(isRichText(value))return richTextHtml(value);
 let list=false;const rows:string[]=[];
 for(const line of value.replace(/\r\n/g,'\n').split('\n')){
  if(/^[-*] /.test(line)){if(!list)rows.push('<ul style="padding-left:24px">');list=true;rows.push('<li>'+inline(line.slice(2))+'</li>');continue;}
  if(list){rows.push('</ul>');list=false;}
  const heading=/^(#{1,3}) (.*)$/.exec(line);
  rows.push(heading?'<h3 style="font-size:18px;margin:16px 0 8px">'+inline(heading[2])+'</h3>':'<div style="min-height:1em">'+inline(line)+'</div>');
 }
 if(list)rows.push('</ul>');return rows.join('');
}
export function normalizeMailStyle(value:unknown):MailStyle{
 if(value===undefined||value===null)return {};
 if(typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_MAIL_STYLE');
 const input=value as Record<string,unknown>,out:MailStyle={};
 for(const key of ['preheader','header','footer','signature'] as const){
  const v=input[key]??'';if(typeof v!=='string'||v.length>(key==='preheader'?300:10000))throw new Error('INVALID_MAIL_STYLE');out[key]=v;
 }
 const color=input.accent??'#2e7c80';if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))throw new Error('INVALID_MAIL_STYLE');out.accent=color;
 return out;
}
export function renderMail(body:string,format='plain',input:MailStyle={}){
 const style=normalizeMailStyle(input),render=format==='formatted'?formattedText:(value:string)=>'<div style="white-space:pre-wrap">'+escape(value)+'</div>';
 const plain=[style.header,body,style.signature,style.footer].filter(Boolean).map(richTextPlain).join('\n\n');
 const html='<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;color:#203744;max-width:680px;margin:auto">'+
 (style.preheader?'<div style="display:none;max-height:0;overflow:hidden">'+escape(style.preheader)+'</div>':'')+
 (style.header?'<div style="padding:20px;border-bottom:3px solid '+(style.accent||'#2e7c80')+'">'+formattedText(style.header)+'</div>':'')+
 '<div style="padding:24px 20px">'+(isRichText(body)?richTextHtml(body):render(body))+(style.signature?'<div style="margin-top:28px;padding-top:16px;border-top:1px solid #d7e2e5">'+formattedText(style.signature)+'</div>':'')+'</div>'+
 (style.footer?'<div style="padding:16px 20px;background:#f4f7f7;font-size:13px;color:#58717b">'+formattedText(style.footer)+'</div>':'')+'</div>';
 return {plain,html};
}
