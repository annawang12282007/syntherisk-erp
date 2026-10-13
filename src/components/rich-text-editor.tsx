'use client';
import {useEffect,useRef,useState,useId,type TextareaHTMLAttributes,type ChangeEvent} from 'react';
import {Bold,Italic,Underline,Link2,ImagePlus,Undo2,Redo2,List,ListOrdered,RemoveFormatting} from 'lucide-react';
import {useApp} from './context';
import {interfaceText} from '../locales/interface-text';
import {escapeRich,richTextHtml,richTextValue,richTextPlain,richFonts,RICH_LIMIT} from '../lib/rich-text';
import './rich-text.css';

type Props=Omit<TextareaHTMLAttributes<HTMLTextAreaElement>,'value'|'defaultValue'> & {value?:string|number|readonly string[];initialHtml?:string};
export default function RichTextEditor({value='',onChange,disabled=false,readOnly=false,rows=5,maxLength=200000,id,required,placeholder,className='',initialHtml,...props}:Props){
 const {locale}=useApp(),L=(zh:string,en:string)=>interfaceText(locale,zh,en),generated=useId(),editorId=id||generated,ref=useRef<HTMLDivElement>(null),selection=useRef<Range|null>(null),last=useRef(String(value)),imageRef=useRef<HTMLImageElement|null>(null),fileRef=useRef<HTMLInputElement>(null);
 const [link,setLink]=useState(false),[url,setUrl]=useState('https://'),[caption,setCaption]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[width,setWidth]=useState(320),[selectedImage,setSelectedImage]=useState(false),[more,setMore]=useState(false);
 const locked=disabled||readOnly;
 useEffect(()=>{if(ref.current){ref.current.innerHTML=initialHtml??richTextHtml(value);last.current=String(value);}},[]);
 useEffect(()=>{if(String(value)!==last.current&&ref.current){ref.current.innerHTML=richTextHtml(value);last.current=String(value);}},[value]);
 const remember=()=>{const s=window.getSelection();if(s?.rangeCount&&ref.current?.contains(s.anchorNode)){selection.current=s.getRangeAt(0).cloneRange();}};
 const restore=()=>{ref.current?.focus();const range=selection.current;if(range&&ref.current?.contains(range.commonAncestorContainer)){const s=window.getSelection();s?.removeAllRanges();s?.addRange(range);}};
 const publish=()=>{if(locked||!ref.current)return;const raw=ref.current.innerHTML,next=richTextValue(raw);if(raw.length+30>RICH_LIMIT||richTextPlain(next).length>maxLength){ref.current.innerHTML=richTextHtml(last.current);selection.current=null;setError(L('内容超出此栏位的长度上限，请缩短文字或减少图片。','Content is too long. Shorten the text or remove an image.'));return false;}setError('');last.current=next;onChange?.({target:{value:next},currentTarget:{value:next}} as ChangeEvent<HTMLTextAreaElement>);remember();return true;};
 const command=(name:string,v?:string)=>{if(locked)return;restore();document.execCommand('styleWithCSS',false,name==='fontSize'?'false':'true');document.execCommand(name,false,v);publish();};
 const button=(name:string,Icon:typeof Bold,cmd:string)=><button type="button" title={name} aria-label={name} disabled={locked} onMouseDown={e=>e.preventDefault()} onClick={()=>command(cmd)}><Icon size={16}/></button>;
 const insertImage=async(file:File)=>{if(locked)return;setBusy(true);setError('');try{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8_000_000)throw Error(L('请使用不超过 8 MB 的 PNG、JPEG 或 WebP 图片。','Use a PNG, JPEG or WebP image up to 8 MB.'));
  const bitmap=await createImageBitmap(file),scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const c=canvas.getContext('2d');if(!c)throw Error('Image');c.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  let src=canvas.toDataURL('image/webp',.82);for(const quality of [.65,.45,.3]){if(src.length<=220_000)break;src=canvas.toDataURL('image/webp',quality);}if(src.length>220_000)throw Error(L('图片仍然过大，请先裁切后再插入。','The image is still too large. Crop it before inserting.'));
  if((ref.current?.innerHTML.length??0)+src.length>RICH_LIMIT)throw Error(L('此栏位的图片已达容量上限。','This field has reached its image limit.'));
  command('insertHTML','<img src="'+src+'" alt="'+escapeRich(file.name)+'" width="'+Math.min(canvas.width,480)+'" style="max-width:100%;height:auto"><br>');
 }catch(e){setError(e instanceof Error?e.message:L('图片无法载入。','Unable to load image.'));}finally{setBusy(false);if(fileRef.current)fileRef.current.value='';}};
 const openLink=()=>{remember();setCaption(window.getSelection()?.toString()||'');setUrl('https://');setLink(true);};
 const insertLink=()=>{if(selection.current?.toString()===caption)command('createLink',url);else command('insertHTML','<a href="'+escapeRich(url)+'" target="_blank" rel="noopener noreferrer">'+escapeRich(caption)+'</a>');setLink(false);};
 const color=(label:string,cmd:string,initial:string)=><label className="rich-color" title={label}>{label}<input aria-label={label} type="color" defaultValue={initial} disabled={locked} onMouseDown={remember} onInput={e=>command(cmd,e.currentTarget.value)}/></label>;
 const accessible=String(props['aria-label']||props.title||placeholder||L('文字内容','Text content'));
 return <div className={'rich-editor '+className+(locked?' is-disabled':'')}>
  <div className="rich-toolbar" role="toolbar" aria-label={L('文字格式','Text formatting')}>
   {button(L('粗体','Bold'),Bold,'bold')}{button(L('斜体','Italic'),Italic,'italic')}{button(L('下划线','Underline'),Underline,'underline')}
   <button type="button" aria-label={L('插入链接','Insert link')} title={L('插入链接','Insert link')} disabled={locked} onMouseDown={e=>e.preventDefault()} onClick={openLink}><Link2 size={16}/></button>
   <button type="button" aria-label={L('插入图片','Insert image')} title={L('插入图片','Insert image')} disabled={locked||busy} onMouseDown={e=>e.preventDefault()} onClick={()=>{remember();fileRef.current?.click();}}><ImagePlus size={16}/></button>
   {button(L('撤销','Undo'),Undo2,'undo')}{button(L('重做','Redo'),Redo2,'redo')}
   <button type="button" disabled={locked} aria-expanded={more} onMouseDown={e=>e.preventDefault()} onClick={()=>setMore(v=>!v)}>{L('更多格式','More formatting')}</button>
   <input ref={fileRef} type="file" hidden aria-label={L('上传内容图片','Upload content image')} accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)void insertImage(f);}}/>
  </div>
  {more&&<div className="rich-toolbar rich-toolbar-extra">
   <select aria-label={L('字体','Font')} disabled={locked} defaultValue="" onMouseDown={remember} onChange={e=>command('fontName',e.target.value)}><option value="" disabled>{L('字体','Font')}</option>{richFonts.map(font=><option key={font}>{font}</option>)}</select>
   <select aria-label={L('字号','Font size')} disabled={locked} defaultValue="3" onMouseDown={remember} onChange={e=>command('fontSize',e.target.value)}>{[10,13,16,18,24,32,48].map((px,i)=><option key={px} value={i+1}>{px} px</option>)}</select>
   {color(L('文字颜色','Text color'),'foreColor','#173341')}{color(L('底色','Highlight'),'hiliteColor','#fff2a8')}
   {button(L('项目列表','Bullets'),List,'insertUnorderedList')}{button(L('编号列表','Numbered list'),ListOrdered,'insertOrderedList')}{button(L('清除格式','Clear formatting'),RemoveFormatting,'removeFormat')}
   <select aria-label={L('对齐','Alignment')} defaultValue="justifyLeft" disabled={locked} onMouseDown={remember} onChange={e=>command(e.target.value)}>{[['justifyLeft',L('左对齐','Left')],['justifyCenter',L('居中','Center')],['justifyRight',L('右对齐','Right')]].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select>
  </div>}
  {link&&<div className="rich-insert"><label>{L('显示文字','Link text')}<input value={caption} onChange={e=>setCaption(e.target.value)}/></label><label>URL<input type="url" value={url} onChange={e=>setUrl(e.target.value)}/></label><button type="button" disabled={!caption.trim()||!/^(https?:\/\/[^\s]+|mailto:[^\s@]+@[^\s]+)$/.test(url)} onClick={insertLink}>{L('插入','Insert')}</button><button type="button" onClick={()=>setLink(false)}>{L('取消','Cancel')}</button></div>}
  {selectedImage&&<div className="rich-insert"><label>{L('图片宽度（px）','Image width (px)')}<input type="range" min="40" max="1200" value={width} onChange={e=>{const n=Number(e.target.value);setWidth(n);if(imageRef.current){imageRef.current.width=n;imageRef.current.style.width=n+'px';publish();}}}/><input aria-label={L('图片宽度数值','Image width value')} type="number" min="40" max="1600" value={width} onChange={e=>{const n=Math.min(1600,Math.max(40,Number(e.target.value)||40));setWidth(n);if(imageRef.current){imageRef.current.width=n;imageRef.current.style.width=n+'px';publish();}}}/></label><button type="button" onClick={()=>{imageRef.current?.remove();setSelectedImage(false);publish();}}>{L('移除图片','Remove image')}</button></div>}
  <div ref={ref} id={editorId} role="textbox" aria-label={accessible} aria-multiline="true" aria-required={required} aria-disabled={locked} aria-describedby={props['aria-describedby']} contentEditable={!locked} suppressContentEditableWarning className="rich-editable rich-text" style={{minHeight:Math.max(100,rows*24)}} data-placeholder={placeholder} onInput={()=>publish()} onBlur={()=>{publish();}} onKeyUp={remember} onMouseUp={remember} onClick={e=>{const el=e.target;if(el instanceof HTMLImageElement&&!locked){imageRef.current=el;setWidth(el.width||320);setSelectedImage(true);}else setSelectedImage(false);}} onPaste={e=>{e.preventDefault();remember();const f=[...e.clipboardData.files].find(f=>f.type.startsWith('image/'));if(f){void insertImage(f);return;}const html=e.clipboardData.getData('text/html'),text=e.clipboardData.getData('text/plain');command('insertHTML',html?richTextHtml('<!--syntherisk-rich:v1-->'+html):escapeRich(text).replace(/\r?\n/g,'<br>'));}} onDrop={e=>{e.preventDefault();remember();const f=e.dataTransfer.files[0];if(f)void insertImage(f);}}/>
  {required&&<input className="rich-validity" tabIndex={-1} aria-hidden="true" required value={richTextPlain(value)} onChange={()=>{}} onInvalid={()=>ref.current?.focus()}/>}
  {error&&<p role="alert" className="field-error">{error}</p>}
  {busy&&<small role="status">{L('正在处理图片…','Processing image…')}</small>}
 </div>;
}
